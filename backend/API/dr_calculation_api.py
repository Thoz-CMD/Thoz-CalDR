import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import time
import httpx
import re
import os
import json
from contextlib import suppress
import uvicorn

app = FastAPI(title="DR Calculation API (Cache + Background Refresh + Symbol Map)")

IDEATRADE_BASE = "https://api.ideatrade1.com"
TV_SCAN_URL = "https://scanner.tradingview.com/global/scan"

# -----------------------------
# CONFIG (ปรับได้)
# -----------------------------
CACHE_TTL_SECONDS = 5            # อายุ cache (วินาที) เช่น 3-10
REFRESH_INTERVAL_SECONDS = 2     # background รีทุกกี่วินาที
WARM_KEYS_LIMIT = 120            # จะอุ่นกี่ตัวล่าสุด (กันหนัก)
CACHE_FILE = "dr_price_cache.json"   # จะเก็บไฟล์แคชไว้ไฟล์นี้
CACHE_SAVE_DEBOUNCE_SEC = 0.5        # หน่วงรวมการเขียนไฟล์ (กันเขียนถี่)
CACHE_MAX_ITEMS = 5000               # กันไฟล์โตเกิน (ปรับได้)
FX_CACHE_TTL_SECONDS = 60        # ✅ FX cache นานขึ้น ลดจำนวนยิง
TV_MAX_RETRIES = 4               # ✅ retry 1,2,4,8 วิเมื่อเจอ 429
TV_BACKOFF_BASE_SEC = 1.0
TV_COOLDOWN_ON_429_SEC = 60      # ✅ ถ้าโดน 429 ให้พักทั้งระบบ 60 วิ
TV_CONCURRENCY = 1               # ✅ กันยิงพร้อมกัน (1-2 พอ)


# ถ้าอยากให้ FX รีถี่กว่า underlying:
FX_REFRESH_MULT = 1              # 1 = เท่ากัน, 2 = underlying ช้ากว่า FX 2 เท่า ฯลฯ

# -----------------------------
# MAPS (ตามของคุณ)
# -----------------------------
EXCHANGE_CURRENCY_MAP = {
    "The Nasdaq Global Select Market": "USD",
    "The Nasdaq Stock Market": "USD",
    "The New York Stock Exchange": "USD",
    "The New York Stock Exchange Archipelago": "USD",
    "The Stock Exchange of Hong Kong Limited": "HKD",
    "Nasdaq Copenhagen": "DKK",
    "Euronext Amsterdam": "EUR",
    "Euronext Paris": "EUR",
    "Euronext Milan": "EUR",
    "Tokyo Stock Exchange": "JPY",
    "Singapore Exchange": "SGD",
    "Taiwan Stock Exchange": "TWD",
    "Shenzhen Stock Exchange": "CNY",
    "Hochiminh Stock Exchange": "VND",
    "Shanghai Stock Exchange": "CNY",
}

EXCHANGE_TV_PREFIX_MAP = {
    "The Nasdaq Global Select Market": "NASDAQ",
    "The Nasdaq Stock Market": "NASDAQ",
    "The New York Stock Exchange": "NYSE",
    "The New York Stock Exchange Archipelago": "NYSEARCA",
    "The Stock Exchange of Hong Kong Limited": "HKEX",
    "Nasdaq Copenhagen": "OMXCOP",
    "Euronext Paris": "EURONEXT",
    "Euronext Amsterdam": "EURONEXT",
    "Euronext Milan": "EURONEXT",
    "Tokyo Stock Exchange": "TSE",
    "Singapore Exchange": "SGX",
    "Taiwan Stock Exchange": "TWSE",
    "Shenzhen Stock Exchange": "SZSE",
    "Hochiminh Stock Exchange": "HOSE",
    "Shanghai Stock Exchange": "SSE",
}

FX_PAIR_MAP = {
    "USD": "USDTHB",
    "HKD": "HKDTHB",
    "DKK": "DKKTHB",
    "EUR": "EURTHB",
    "JPY": "JPYTHB",
    "SGD": "SGDTHB",
    "TWD": "TWDTHB",
    "CNY": "CNYTHB",
    "VND": "VNDTHB",
}

TV_SYMBOL_OVERRIDES: dict[str, str] = {
    "EPA:OR": "EURONEXT:OR",
    "HOSE:DCVFMVN30 ETF": "HOSE:E1VFVN30",
    "NYSEARCA:GLD": "AMEX:GLD",
    "EPA:RMS": "EURONEXT:RMS",
    "EPA:HERMES": "EURONEXT:RMS",
    "HKEX:0388": "HKEX:388",
    "EPA:LVMH": "EURONEXT:MC",
    "EPA:MC": "EURONEXT:MC",
    "OMXCOP:NOVOB": "OMXCOP:NOVO_B",
    "OMXCOP:NOVO-B": "OMXCOP:NOVO_B",
    "HKEX:PINGAN": "HKEX:2318",
    "EURONEXT:SANOFI": "EURONEXT:SAN",
    "NYSEARCA:SPY":  "AMEX:SPY",
    "NYSEARCA:SPYM": "AMEX:SPYM",
    "NYSEARCA:SPAB": "AMEX:SPAB",
}

def _norm(s: str) -> str:
    return (s or "").strip().lower()

def _now() -> float:
    return time.time()

# -----------------------------
# CORS (ให้ frontend เครื่องอื่นเรียกได้)
# -----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # prod ควร lock domain
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

# -----------------------------
# CACHE (in-memory)
# -----------------------------
_price_cache: dict[str, dict] = {}
_warm_keys: dict[str, float] = {}
_cache_lock = asyncio.Lock()
_cache_dirty = False
_cache_save_task: asyncio.Task | None = None

def cache_get(key: str):
    item = _price_cache.get(key)
    if not item:
        return None
    if item["exp"] <= _now():
        _price_cache.pop(key, None)
        return None
    return item["value"]

def cache_set(key: str, value: float, ttl: int = CACHE_TTL_SECONDS):
    _price_cache[key] = {"value": float(value), "exp": _now() + ttl}
    schedule_cache_save()   # ✅ บันทึกลงไฟล์

def mark_warm(key: str):
    _warm_keys[key] = _now()

def _prune_expired_inplace():
    now = _now()
    expired = [k for k, v in _price_cache.items() if v.get("exp", 0) <= now]
    for k in expired:
        _price_cache.pop(k, None)

def _prune_to_limit_inplace(limit=CACHE_MAX_ITEMS):
    if len(_price_cache) <= limit:
        return
    items = sorted(
        _price_cache.items(),
        key=lambda kv: kv[1].get("exp", 0),
        reverse=True
    )
    _price_cache.clear()
    _price_cache.update(dict(items[:limit]))

async def load_cache_from_file():
    if not os.path.exists(CACHE_FILE):
        return

    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        async with _cache_lock:
            _price_cache.clear()
            _price_cache.update(data.get("price_cache", {}))

            _warm_keys.clear()
            wk = data.get("warm_keys", {})
            _warm_keys.update({str(k): float(v) for k, v in wk.items() if v is not None})

            _prune_expired_inplace()
            _prune_to_limit_inplace()

        print(f"✅ Loaded cache file: {CACHE_FILE} items={len(_price_cache)}")

    except Exception as e:
        print("⚠️ Cache load failed:", e)

def _write_cache_file(snapshot: dict):
    tmp = CACHE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False)
    os.replace(tmp, CACHE_FILE)

async def save_cache_to_file():
    global _cache_dirty
    async with _cache_lock:
        snapshot = {
            "ts": _now(),
            "price_cache": dict(_price_cache),
            "warm_keys": dict(_warm_keys),
        }
        _cache_dirty = False

    await asyncio.to_thread(_write_cache_file, snapshot)

def schedule_cache_save():
    global _cache_save_task, _cache_dirty
    _cache_dirty = True

    if _cache_save_task and not _cache_save_task.done():
        return

    async def _debounced():
        global _cache_save_task
        await asyncio.sleep(CACHE_SAVE_DEBOUNCE_SEC)
        if _cache_dirty:
            await save_cache_to_file()
        _cache_save_task = None

    _cache_save_task = asyncio.create_task(_debounced())

def _trim_warm_keys():
    if len(_warm_keys) <= WARM_KEYS_LIMIT:
        return
    oldest = sorted(_warm_keys.items(), key=lambda kv: kv[1])[: max(1, len(_warm_keys) - WARM_KEYS_LIMIT)]
    for k, _ in oldest:
        _warm_keys.pop(k, None)

# -----------------------------
# HTTP clients (reuse)
# -----------------------------
_tv_client: httpx.AsyncClient | None = None
_idea_client: httpx.AsyncClient | None = None
_tv_sem = asyncio.Semaphore(TV_CONCURRENCY)
_tv_block_until = 0.0


# ✅ แก้หลัก: fallback columns + debug log ตอน error
async def tv_scan_close(tv_ticker: str) -> float:
    columns = ["last", "close", "open"]
    assert _tv_client is not None

    def to_float(x):
        if x is None:
            return None
        try:
            f = float(x)
            if f == f and f > 0:  # กัน NaN / 0 / ติดลบ
                return f
        except Exception:
            return None
        return None

    # -------------------------
    # ✅ 429 handling helpers
    # ต้องมีตัวแปร global เหล่านี้ประกาศไว้นอกฟังก์ชัน:
    # _tv_sem = asyncio.Semaphore(TV_CONCURRENCY)
    # _tv_block_until = 0.0
    # และ CONFIG:
    # TV_MAX_RETRIES, TV_BACKOFF_BASE_SEC, TV_COOLDOWN_ON_429_SEC
    # -------------------------
    async def _post_once(ticker: str):
        payload = {
            "symbols": {"tickers": [ticker], "query": {"types": []}},
            "columns": columns,
        }

        async with _tv_sem:
            r = await _tv_client.post(TV_SCAN_URL, json=payload)

        status = r.status_code
        text = (r.text or "")[:300]

        if status == 429:
            return 429, text, None

        r.raise_for_status()
        try:
            return status, text, r.json()
        except Exception:
            print("TV_SCAN_NONJSON ticker=", ticker, "status=", status, "text=", text)
            raise HTTPException(502, f"TradingView returned non-JSON for {ticker}")

    async def _fetch_with_retry(ticker: str) -> dict:
        global _tv_block_until

        # cooldown ทั้งระบบ
        if _now() < _tv_block_until:
            raise HTTPException(503, f"TradingView cooldown until {_tv_block_until:.0f}")

        last_text = ""
        for attempt in range(TV_MAX_RETRIES):
            status, text, data = await _post_once(ticker)
            last_text = text

            if status != 429:
                return data  # type: ignore

            wait = TV_BACKOFF_BASE_SEC * (2 ** attempt)  # 1,2,4,8...
            print("TV_SCAN_429 ticker=", ticker, "attempt=", attempt + 1, "sleep=", wait)
            await asyncio.sleep(wait)

        _tv_block_until = _now() + TV_COOLDOWN_ON_429_SEC
        print("TV_SCAN_COOLDOWN_SET until=", _tv_block_until, "ticker=", ticker, "last_text=", last_text)
        raise HTTPException(429, f"TradingView rate limited for {ticker}")

    data = None
    used_ticker = tv_ticker

    try:
        # 1) ยิงด้วย ticker เดิมก่อน
        data = await _fetch_with_retry(tv_ticker)

        # 2) fallback ด้วย TV_SYMBOL_OVERRIDES (สำคัญ)
        if not data.get("data"):
            override = TV_SYMBOL_OVERRIDES.get(tv_ticker)
            if override and override != tv_ticker:
                data2 = await _fetch_with_retry(override)
                if data2.get("data"):
                    data = data2
                    used_ticker = override

        # 3) fallback NYSEARCA → AMEX / ARCA / BATS
        if not data.get("data"):
            if tv_ticker.startswith("NYSEARCA:"):
                sym = tv_ticker.split(":", 1)[1]
                candidates = [f"AMEX:{sym}", f"ARCA:{sym}", f"BATS:{sym}"]

                for alt in candidates:
                    data2 = await _fetch_with_retry(alt)
                    if data2.get("data"):
                        data = data2
                        used_ticker = alt
                        break

                if not data.get("data"):
                    print("TV_SCAN_NOT_FOUND ticker=", tv_ticker, "override=", TV_SYMBOL_OVERRIDES.get(tv_ticker), "candidates=", candidates)
                    print("TV_SCAN_RESPONSE=", data)
                    raise HTTPException(404, f"TradingView ticker not found or no data returned: {tv_ticker}")
            else:
                print("TV_SCAN_NOT_FOUND ticker=", tv_ticker)
                print("TV_SCAN_RESPONSE=", data)
                raise HTTPException(404, f"TradingView ticker not found or no data returned: {tv_ticker}")

        # 4) ดึงราคา last → close → open
        d = data["data"][0]["d"]
        for v in d:
            fv = to_float(v)
            if fv is not None:
                return fv

        raise HTTPException(500, f"No usable price fields for {used_ticker} (tried {columns})")

    except HTTPException:
        raise

    except httpx.HTTPError as e:
        # (จริง ๆ ส่วนใหญ่จะถูกดักใน _post_once แล้ว)
        try:
            status = getattr(e.response, "status_code", None)
            text = getattr(e.response, "text", "")
        except Exception:
            status, text = None, ""
        print("TV_SCAN_HTTP_ERROR ticker=", used_ticker, "status=", status, "err=", repr(e), "text=", (text or "")[:300])
        raise HTTPException(502, f"TradingView request failed for {used_ticker}")

    except Exception as e:
        print("TV_SCAN_ERROR ticker=", used_ticker)
        print("TV_SCAN_ERROR response=", data)
        raise HTTPException(500, f"Cannot fetch close for {used_ticker}: {type(e).__name__}")

async def get_price_cached(kind: str, tv_ticker: str, ttl: int = CACHE_TTL_SECONDS) -> float:
    """
    kind: 'U' underlying, 'F' fx
    key: f"{kind}|{tv_ticker}"
    """
    key = f"{kind}|{tv_ticker}"
    mark_warm(key)
    _trim_warm_keys()

    v = cache_get(key)
    if v is not None:
        return v

    v = await tv_scan_close(tv_ticker)
    cache_set(key, v, ttl=ttl)
    return v

# -----------------------------
# DR selection helpers (ของคุณ)
# -----------------------------
def _extract_code_in_parens(s: str) -> str | None:
    if not s:
        return None
    s = str(s)
    i = s.rfind("(")
    j = s.rfind(")")
    if i != -1 and j != -1 and j > i:
        code = s[i+1:j].strip()
        return code if code else None
    return None

def choose_best_row(candidates: list) -> dict:
    def score(r: dict):
        status = str(r.get("marketStatus", "")).lower()
        is_open = 1 if status == "open" else 0
        tv = float(r.get("totalValue") or 0)
        vol = float(r.get("totalVolume") or 0)
        return (is_open, tv, vol)
    return sorted(candidates, key=score, reverse=True)[0]

def pick_dr_row(rows: list, query_symbol: str) -> dict:
    q = _norm(query_symbol)

    exact_symbol = [r for r in rows if _norm(str(r.get("symbol", ""))) == q]
    if exact_symbol:
        return exact_symbol[0]

    exact_underlying = [r for r in rows if _norm(str(r.get("underlying", ""))) == q]
    if exact_underlying:
        return choose_best_row(exact_underlying)

    contains_underlying = [r for r in rows if q and q in _norm(str(r.get("underlying", "")))]
    if contains_underlying:
        return choose_best_row(contains_underlying)

    raise HTTPException(404, f"No matching DR found for '{query_symbol}'")

def _strip_tv_suffix(sym: str) -> str:
    return re.sub(r"\.(HK|SS|SZ|T)\s*$", "", (sym or "").strip(), flags=re.I)

# ✅ NEW: helper สำหรับ HK ให้เหลือเลข 4 หลักเสมอ
def _hk_digits(code: str) -> str | None:
    code = _strip_tv_suffix(code or "")
    digits = "".join(ch for ch in code if ch.isdigit())
    if not digits:
        return None
    return str(int(digits))  # ✅ ตัด leading zero


def build_underlying_tv_map(rows: list) -> dict[str, str]:
    """
    key = normalized "exchange_prefix:underlying"
    value = "exchange_prefix:resolved_symbol"
    """
    m: dict[str, str] = {}

    for dr in rows:
        exchange_name = dr.get("underlyingExchange")
        if not exchange_name:
            continue

        tv_prefix = EXCHANGE_TV_PREFIX_MAP.get(exchange_name)
        if not tv_prefix:
            continue

        underlying = str(dr.get("underlying", "")).strip()
        if not underlying:
            continue

        # HK → ใช้เลขล้วน 4 หลัก (NO .HK)
        if exchange_name == "The Stock Exchange of Hong Kong Limited":
            code = _extract_code_in_parens(dr.get("underlyingName", "")) or underlying
            hk = _hk_digits(code)
            if hk:
                underlying = hk
            else:
                # ✅ ไม่ให้พังทั้งระบบถ้าบางแถวข้อมูล HK แปลก ๆ
                continue

        # JP → เลขตรง ๆ
        if exchange_name == "Tokyo Stock Exchange":
            code = _extract_code_in_parens(dr.get("underlyingName", ""))
            if code:
                underlying = code

        # SSE → เลขตรง ๆ
        if exchange_name == "Shanghai Stock Exchange":
            code = _extract_code_in_parens(dr.get("underlyingName", ""))
            if code:
                underlying = code

        key = _norm(f"{tv_prefix}:{underlying}")
        m[key] = f"{tv_prefix}:{underlying}"

    return m

def map_to_tv_symbol_and_currency(dr: dict, underlying_tv_map: dict[str, str]) -> tuple[str, str]:
    exchange_name = dr.get("underlyingExchange")
    if not exchange_name:
        raise HTTPException(400, "Missing underlyingExchange")

    currency = EXCHANGE_CURRENCY_MAP.get(exchange_name)
    if not currency:
        raise HTTPException(400, f"Unsupported exchange (currency map missing): {exchange_name}")

    tv_prefix = EXCHANGE_TV_PREFIX_MAP.get(exchange_name)
    if not tv_prefix:
        raise HTTPException(400, f"Unsupported exchange (tv map missing): {exchange_name}")

    underlying = str(dr.get("underlying", "")).strip()
    if not underlying:
        raise HTTPException(400, "Missing underlying")

    # ✅ NEW: US / ETF / หุ้นส่วนใหญ่ ใช้ ticker ในวงเล็บจาก underlyingName เช่น "(GLD)"
# ✅ ใช้ ticker/code ในวงเล็บจาก underlyingName เป็นหลัก
# ครอบคลุม: US / SGX / Euronext / ETF
    if exchange_name in (
        "The Nasdaq Global Select Market",
        "The Nasdaq Stock Market",
        "The New York Stock Exchange",
        "The New York Stock Exchange Archipelago",
        "Singapore Exchange",
        "Euronext Paris",
        "Euronext Amsterdam",
        "Euronext Milan",
    ):
        code = _extract_code_in_parens(dr.get("underlyingName", ""))
        if code:
            underlying = code
        else:
            # ⚠️ ตลาดพวกนี้ไม่ควรเดา symbol จากชื่อ
            raise HTTPException(
                400,
                f"Missing ticker code in underlyingName: exchange={exchange_name}, underlyingName={dr.get('underlyingName')}"
            )

    # JP ต้องใช้เลข
    if exchange_name == "Tokyo Stock Exchange":
        code = _extract_code_in_parens(dr.get("underlyingName", ""))
        if code:
            underlying = code
        else:
            raise HTTPException(400, f"Missing JP numeric code in underlyingName: {dr.get('underlyingName')}")

    # SSE ต้องใช้เลขใน underlyingName เช่น "(588000)"
    if exchange_name == "Shanghai Stock Exchange":
        code = _extract_code_in_parens(dr.get("underlyingName", ""))
        if code:
            underlying = code
        else:
            if underlying.isdigit():
                pass
            else:
                raise HTTPException(400, f"Missing SSE numeric code in underlyingName: {dr.get('underlyingName')}")
            
    # ✅ HK ต้องเป็นเลขเท่านั้น (กันไม่ให้ยิง HKEX:PINGAN / HKEX:NONGFU / ชื่อ ETF)
    if exchange_name == "The Stock Exchange of Hong Kong Limited":
        code = _extract_code_in_parens(dr.get("underlyingName", "")) or underlying
        hk = _hk_digits(code)
        if hk:
            underlying = hk
        else:
            # ถ้าไม่มีเลขจริง ๆ ให้ error (หรือจะ rely on explicit override ก็ได้)
            raise HTTPException(
                400,
                f"HK underlying missing numeric code: underlying={dr.get('underlying')} underlyingName={dr.get('underlyingName')}"
            )

    # ✅ TWSE ต้องใช้ "เลขในวงเล็บ" เท่านั้น เช่น (0050)
    if exchange_name == "Taiwan Stock Exchange":
        code = _extract_code_in_parens(dr.get("underlyingName", ""))
        if code and code.isdigit():
            underlying = code
        else:
            raise HTTPException(
                400,
                f"TWSE underlying missing numeric code: underlyingName={dr.get('underlyingName')}"
            )
    # ✅ ถ้า underlying เป็นชื่อยาว/มีช่องว่าง/มีคำว่า ETF
    # ให้ใช้ ticker ในวงเล็บจาก underlyingName (เช่น (FUESSVFL))
    if (" " in underlying) or ("ETF" in underlying.upper()):
        code = _extract_code_in_parens(dr.get("underlyingName", ""))
        if code:
            underlying = code

    tv_symbol = f"{tv_prefix}:{underlying}"

    # ✅ 1) override แบบ explicit
    tv_symbol = TV_SYMBOL_OVERRIDES.get(tv_symbol, tv_symbol)

    # ✅ 2) map จาก ideatrade (กันเคส symbol แปลก)
    tv_symbol = underlying_tv_map.get(_norm(tv_symbol), tv_symbol)

    return tv_symbol, currency

# -----------------------------
# Background refresher
# -----------------------------
async def refresher_loop():
    tick = 0
    while True:
        try:
            tick += 1
            keys = sorted(_warm_keys.items(), key=lambda kv: kv[1], reverse=True)
            keys = [k for k, _ in keys[:WARM_KEYS_LIMIT]]

            for key in keys:
                if "|" not in key:
                    continue

                item = _price_cache.get(key)
                near_exp = (not item) or (item["exp"] - _now() < 1)
                if not near_exp:
                    continue

                kind, tv_ticker = key.split("|", 1)

                # ✅ ทำให้ Underlying รีช้ากว่า FX ตามที่ตั้งใจ
                if kind == "U" and FX_REFRESH_MULT > 1:
                    if tick % FX_REFRESH_MULT != 0:
                        continue

                v = await tv_scan_close(tv_ticker)
                cache_set(key, v, ttl=CACHE_TTL_SECONDS)

        except asyncio.CancelledError:
            raise
        except Exception:
            pass

        await asyncio.sleep(REFRESH_INTERVAL_SECONDS)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _tv_client, _idea_client
    _tv_client = httpx.AsyncClient(timeout=10)
    _idea_client = httpx.AsyncClient(timeout=20)

    # ✅ โหลด cache จากไฟล์
    await load_cache_from_file()

    task = asyncio.create_task(refresher_loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

        # ✅ เซฟก่อนปิด
        if _cache_dirty:
            await save_cache_to_file()

        await _tv_client.aclose()
        await _idea_client.aclose()

app.router.lifespan_context = lifespan

# -----------------------------
# MAIN ENDPOINT
# -----------------------------
@app.get("/api/calc/dr/{dr_symbol}")
async def calculate_dr(dr_symbol: str):
    """
    - ดึง DR list จาก ideatrade (snapshot)
    - เลือก row ให้ถูก
    - map เป็น tv symbol + currency (มี map ช่วย)
    - ดึง underlying + fx ผ่าน cache (เร็ว)
    """
    try:
        assert _idea_client is not None

        r = await _idea_client.get(f"{IDEATRADE_BASE}/caldr")
        r.raise_for_status()
        rows = r.json().get("rows", [])
        if not rows:
            raise HTTPException(404, "DR list is empty")

        # ✅ build map จาก ideatrade rows ก่อน
        underlying_tv_map = build_underlying_tv_map(rows)

        dr = pick_dr_row(rows, dr_symbol)

        tv_symbol, currency = map_to_tv_symbol_and_currency(dr, underlying_tv_map)

        fx_pair = FX_PAIR_MAP.get(currency)
        if not fx_pair:
            raise HTTPException(400, f"Unsupported currency (FX map missing): {currency}")

        # ✅ ดึงผ่าน cache
        underlying_price = None  # ✅ เพิ่มบรรทัดนี้ก่อน try

        try:
            underlying_price = await get_price_cached("U", tv_symbol, ttl=CACHE_TTL_SECONDS)

        except HTTPException as e:
            print("CALC_UNDERLYING_FAIL", dr_symbol, "tv_symbol=", tv_symbol, "status=", e.status_code, "detail=", e.detail)

            # ✅ fallback: ถ้า tv_symbol แปลกจริง ๆ ให้ลอง override จาก underlyingName
            code = _extract_code_in_parens(dr.get("underlyingName", ""))
            exchange_name = dr.get("underlyingExchange")
            tv_prefix = EXCHANGE_TV_PREFIX_MAP.get(exchange_name, "")

            # ✅ ถ้าคุณยังไม่ทำ fallback จริง ๆ ในโค้ด ให้จบตรงนี้เลย
            raise

        # ✅ กันหลุด (ถึงแม้โค้ดด้านบนควร raise แล้ว)
        if underlying_price is None:
            raise HTTPException(404, f"Underlying price not resolved for {dr_symbol} (tv_symbol={tv_symbol})")

        fx_rate = await get_price_cached("F", f"FX_IDC:{fx_pair}", ttl=FX_CACHE_TTL_SECONDS)

        return {
            "dr_symbol": dr_symbol,
            "matched_symbol": dr.get("symbol"),
            "tv_symbol": tv_symbol,
            "currency": currency,
            "fx_pair": fx_pair,
            "fx_rate": float(fx_rate),  # จะปัดหรือไม่ก็ได้ แต่ถ้าจะให้ frontend จัดการ ก็ส่ง raw ไปเลย
            "underlying_price_raw": float(underlying_price),  # ✅ เพิ่มบรรทัดนี้ (ห้ามปัด)
            "underlying_price": float(underlying_price),      # ✅ แก้ไม่ให้ round (ให้หน้าเว็บปัดเอง)
            "underlyingExchange": dr.get("underlyingExchange"),
            "underlying": dr.get("underlying"),
            "underlyingName": dr.get("underlyingName"),
            "cache_ttl_sec": CACHE_TTL_SECONDS,
            "refresh_interval_sec": REFRESH_INTERVAL_SECONDS,
        }

    except HTTPException as e:
        # ✅ log แบบรู้ทันทีว่าพังที่ไหน
        print(
            "CALC_ERROR",
            "dr_symbol=", dr_symbol,
            "status=", e.status_code,
            "detail=", e.detail
        )
        raise

    except Exception as e:
        print("CALC_CRASH", "dr_symbol=", dr_symbol, "err=", type(e).__name__, str(e))
        raise HTTPException(500, f"Unhandled error: {type(e).__name__}")

if __name__ == "__main__":
    uvicorn.run("dr_calculation_api:app", host="0.0.0.0", port=8002, reload=True)
