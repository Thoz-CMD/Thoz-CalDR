from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager
import httpx
import os
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))


NEWS_API_BASE_URL = os.getenv("NEWS_API_BASE_URL") or "https://newsapi.org/v2/top-headlines"
NEWS_API_KEY = os.getenv("NEWS_API_KEY") or None
NEWS_TTL_SECONDS = int(os.getenv("NEWS_TTL_SECONDS") or "300")
FINNHUB_BASE_URL = "https://finnhub.io/api/v1"
FINNHUB_TOKEN = os.getenv("FINNHUB_TOKEN") or None
DR_LIST_URL = os.getenv("DR_LIST_URL") or "http://172.17.1.85:8333/dr"
TRADINGVIEW_SCANNER_URL = os.getenv("TRADINGVIEW_SCANNER_URL") or "https://scanner.tradingview.com/america/scan"

app = FastAPI(title="News API")

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

_client: httpx.AsyncClient | None = None
_news_cache: dict[str, dict] = {}

FALLBACK_SYMBOLS = [
    {"symbol": "AAPL", "name": "Apple Inc.", "logo": "https://s3-symbol-logo.tradingview.com/apple.svg"},
    {"symbol": "MSFT", "name": "Microsoft Corporation", "logo": "https://s3-symbol-logo.tradingview.com/microsoft.svg"},
    {"symbol": "GOOG", "name": "Alphabet Inc.", "logo": "https://s3-symbol-logo.tradingview.com/alphabet.svg"},
    {"symbol": "AMZN", "name": "Amazon.com, Inc.", "logo": "https://s3-symbol-logo.tradingview.com/amazon.svg"},
    {"symbol": "NVDA", "name": "NVIDIA Corporation", "logo": "https://s3-symbol-logo.tradingview.com/nvidia.svg"},
    {"symbol": "TSLA", "name": "Tesla, Inc.", "logo": "https://s3-symbol-logo.tradingview.com/tesla.svg"},
    {"symbol": "META", "name": "Meta Platforms, Inc.", "logo": "https://s3-symbol-logo.tradingview.com/meta-platforms.svg"},
    {"symbol": "BABA", "name": "Alibaba Group Holding Limited", "logo": "https://s3-symbol-logo.tradingview.com/alibaba.svg"},
    {"symbol": "NFLX", "name": "Netflix, Inc.", "logo": "https://s3-symbol-logo.tradingview.com/netflix.svg"},
    {"symbol": "AMD", "name": "Advanced Micro Devices, Inc.", "logo": "https://s3-symbol-logo.tradingview.com/advanced-micro-devices.svg"}
]


def _now() -> float:
    return time.time()


def _cache_get(key: str):
    item = _news_cache.get(key)
    if not item:
        return None
    if item["exp"] <= _now():
        return None
    return item["value"]


def _cache_set(key: str, value, ttl: int = NEWS_TTL_SECONDS):
    _news_cache[key] = {"value": value, "exp": _now() + ttl}


async def init_client():
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10)

async def close_client():
    global _client
    if _client:
        await _client.aclose()
        _client = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_client()
    try:
        yield
    finally:
        await close_client()

app.router.lifespan_context = lifespan


async def fetch_news(symbol: str, limit: int, language: str | None, hours: int, country: str | None):
    if not NEWS_API_KEY:
        return await fetch_google_news(symbol, limit, language, hours, country)

    assert _client is not None

    params: dict[str, str | int] = {
        "q": symbol,
        "pageSize": limit,
        "sortBy": "publishedAt",
        "apiKey": NEWS_API_KEY,
        "category": "business",
    }

    if country:
        params["country"] = country
    else:
        params["country"] = "us"

    if language:
        params["language"] = language

    if hours > 0:
        now_utc = datetime.now(timezone.utc)
        since = now_utc - timedelta(hours=hours)
        params["from"] = since.isoformat()

    r = await _client.get(NEWS_API_BASE_URL, params=params)
    if r.status_code != 200:
        return await fetch_google_news(symbol, limit, language, hours, country)

    data = r.json()
    articles = data.get("articles") or []
    if not articles:
        return await fetch_google_news(symbol, limit, language, hours, country)

    normalized = []
    for a in articles:
        source = a.get("source") or {}
        normalized.append(
            {
                "title": a.get("title"),
                "summary": a.get("description") or a.get("content"),
                "published_at": a.get("publishedAt"),
                "source": source.get("name"),
                "url": a.get("url"),
                "image_url": a.get("urlToImage"),
            }
        )

    return normalized

async def fetch_google_news(query: str, limit: int, language: str | None, hours: int, country: str | None):
    assert _client is not None
    hl = "en-US"
    gl = "US"
    ceid = "US:en"

    if country:
        gl = country.upper()
        hl = f"en-{gl}"
        ceid = f"{gl}:en"

    if language and language.lower().startswith("th"):
        hl = "th"
        gl = "TH"
        ceid = "TH:th"
    params = {"q": query, "hl": hl, "gl": gl, "ceid": ceid}
    r = await _client.get("https://news.google.com/rss/search", params=params)
    if r.status_code != 200:
        return []
    text = r.text
    try:
        import xml.etree.ElementTree as ET
        root = ET.fromstring(text)
    except Exception:
        return []
    channel = root.find("channel")
    items = channel.findall("item") if channel is not None else []
    normalized = []
    since_dt = None
    if hours and hours > 0:
        since_dt = datetime.now(timezone.utc) - timedelta(hours=hours)
    for it in items:
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        pub = it.findtext("pubDate")
        source_el = it.find("source")
        source = source_el.text.strip() if source_el is not None and source_el.text else None
        published_at = pub
        if pub:
            try:
                dt = parsedate_to_datetime(pub)
                if dt and since_dt and dt.tzinfo:
                    if dt < since_dt:
                        continue
            except Exception:
                pass
        normalized.append(
            {
                "title": title or None,
                "summary": None,
                "published_at": published_at,
                "source": source,
                "url": link or None,
                "image_url": None,
            }
        )
        if len(normalized) >= limit:
            break
    return normalized


async def fetch_quote(symbol: str):
    if not FINNHUB_TOKEN:
        return None

    assert _client is not None

    try:
        r = await _client.get(f"{FINNHUB_BASE_URL}/quote", params={"symbol": symbol.upper(), "token": FINNHUB_TOKEN})
        if r.status_code != 200:
            return None
        q = r.json() or {}
        return {
            "symbol": symbol.upper(),
            "price": q.get("c"),
            "change": q.get("d"),
            "change_pct": q.get("dp"),
            "high": q.get("h"),
            "low": q.get("l"),
            "open": q.get("o"),
            "prev_close": q.get("pc"),
        }
    except Exception:
        return None


async def fetch_logo(symbol: str):
    if not FINNHUB_TOKEN:
        return None

    assert _client is not None

    try:
        r = await _client.get(
            f"{FINNHUB_BASE_URL}/stock/profile2",
            params={"symbol": symbol.upper(), "token": FINNHUB_TOKEN},
        )
        if r.status_code != 200:
            return None
        data = r.json() or {}
        return data.get("logo")
    except Exception:
        return None

@app.get("/api/news/{symbol}")
async def get_news(
    symbol: str,
    limit: int = Query(10, ge=1, le=50),
    language: str | None = Query(None),
    hours: int = Query(24, ge=1, le=168),
    country: str | None = Query(None, description="Two-letter country code (e.g., us, gb)"),
):
    key = f"news-v2|{symbol.upper()}|{limit}|{language or ''}|{hours}|{country or ''}"
    cached = _cache_get(key)
    if cached is not None:
        return {
            "symbol": symbol.upper(),
            "total": len(cached["news"]),
            "news": cached["news"],
            "quote": cached.get("quote"),
            "logo_url": cached.get("logo_url"),
            "cached": True,
            "ttl_seconds": NEWS_TTL_SECONDS,
        }

    items = await fetch_news(symbol, limit, language, hours, country)
    quote = await fetch_quote(symbol)
    logo_url = await fetch_logo(symbol)

    payload = {"news": items, "quote": quote, "logo_url": logo_url}
    _cache_set(key, payload, ttl=NEWS_TTL_SECONDS)

    return {
        "symbol": symbol.upper(),
        "total": len(items),
        "news": items,
        "quote": quote,
        "logo_url": logo_url,
        "cached": False,
        "ttl_seconds": NEWS_TTL_SECONDS,
    }

import random

# =============== FINNHUB PROXY ENDPOINTS ===============

async def _require_client():
    if _client is None:
        raise HTTPException(500, "HTTP client not initialized")

@app.get("/api/finnhub/quote/{symbol}")
async def get_quote(symbol: str):
    symbol = symbol.upper()
    
    # 1. Try Finnhub first
    q = {}
    success = False
    
    if FINNHUB_TOKEN:
        await _require_client()
        try:
            r = await _client.get(f"{FINNHUB_BASE_URL}/quote", params={"symbol": symbol, "token": FINNHUB_TOKEN})
            if r.status_code == 200:
                q = r.json() or {}
                # Finnhub often returns c=0 for invalid symbols
                if q.get("c") != 0:
                     success = True
        except Exception as e:
            print(f"Finnhub quote exception for {symbol}: {e}")

    # 2. Fallback to internal list (TradingView data) if Finnhub failed
    if not success:
        print(f"Finnhub failed/empty for {symbol}, trying internal list fallback")
        try:
            # We call get_symbols but we might need to await it properly if it's cached or not.
            # get_symbols uses a cache key.
            # To avoid circular dependency or complex logic, let's just check the cache directly first
            # or call the function.
            all_symbols = await get_symbols()
            match = next((s for s in all_symbols if s["symbol"] == symbol), None)
            
            if match:
                print(f"Found fallback data for {symbol}")
                return {
                    "symbol": symbol,
                    "price": match.get("price", 0),
                    "change": match.get("change", 0),
                    "change_pct": match.get("change_pct", 0),
                    "high": match.get("price", 0), # Approximate
                    "low": match.get("price", 0),  # Approximate
                    "open": match.get("price", 0), # Approximate
                    "prev_close": match.get("price", 0), # Approximate
                    "logo_url": match.get("logo"),
                    "source": "fallback"
                }
        except Exception as e:
            print(f"Fallback quote error: {e}")

    # If still no success, return what we have (even if zeros) or raise error if it was a hard failure?
    # If Finnhub returned 0s and we have no fallback, returning 0s is better than 500 Error
    # because 500 Error causes the whole page to crash with "Invalid Symbol".
    # Returning 0s allows the page to render (maybe with $0.00) but News might still load.
    
    if not success and not q:
        # If we didn't get a response from Finnhub AND no fallback
        # raise HTTPException(404, "Symbol not found")
        # BUT, to be safe for user experience, let's return a dummy object with 0s
        # so at least the News part (which is fetched separately) has a chance to show up?
        # Actually, if quote fails, News.jsx throws error.
        # So return dummy 0s is safer.
        return {
            "symbol": symbol,
            "price": 0,
            "change": 0,
            "change_pct": 0,
            "high": 0,
            "low": 0,
            "open": 0,
            "prev_close": 0,
            "logo_url": None
        }

    logo_url = await fetch_logo(symbol)

    return {
        "symbol": symbol,
        "price": q.get("c"),
        "change": q.get("d"),
        "change_pct": q.get("dp"),
        "high": q.get("h"),
        "low": q.get("l"),
        "open": q.get("o"),
        "prev_close": q.get("pc"),
        "logo_url": logo_url,
    }

@app.get("/api/finnhub/company-news/{symbol}")
async def get_company_news(
    symbol: str,
    hours: int = Query(24, ge=1, le=168),
    limit: int = Query(20, ge=1, le=50),
    country: str | None = Query(None, description="Two-letter country code (e.g., us, gb)"),
):
    # Cache check
    key = f"company_news|{symbol.upper()}|{hours}|{limit}|{country}"
    cached = _cache_get(key)
    if cached:
        return cached

    if not FINNHUB_TOKEN:
        items = await fetch_news(symbol.upper(), limit, language="en", hours=hours, country=country)
        return {
            "symbol": symbol.upper(),
            "total": len(items),
            "news": items,
        }

    await _require_client()

    # Finnhub company-news requires date range (YYYY-MM-DD)
    now_utc = datetime.now(timezone.utc)
    since = now_utc - timedelta(hours=hours)
    params = {
        "symbol": symbol.upper(),
        "from": since.date().isoformat(),
        "to": now_utc.date().isoformat(),
        "token": FINNHUB_TOKEN,
    }
    r = await _client.get(f"{FINNHUB_BASE_URL}/company-news", params=params)
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Finnhub news error: {r.text[:200]}")
    items = r.json() or []
    # Normalize structure similar to NewsAPI
    normalized = []
    for a in items[:limit]:
        normalized.append(
            {
                "title": a.get("headline"),
                "summary": a.get("summary"),
                "published_at": a.get("datetime"),
                "source": a.get("source"),
                "url": a.get("url"),
                "image_url": a.get("image"),
            }
        )
    
    result = {
        "symbol": symbol.upper(),
        "total": len(normalized),
        "news": normalized,
    }
    
    _cache_set(key, result, ttl=NEWS_TTL_SECONDS)
    return result


@app.get("/api/stock/overview/{symbol}")
async def get_stock_overview(
    symbol: str,
    hours: int = Query(24, ge=1, le=168),
    limit: int = Query(20, ge=1, le=50),
    language: str | None = Query(None),
    country: str | None = Query(None, description="Two-letter country code (e.g., us, gb)"),
):
    symbol_upper = symbol.upper()

    quote = None
    news_items = []
    logo_url = None

    if FINNHUB_TOKEN:
        await _require_client()

        r_quote = await _client.get(
            f"{FINNHUB_BASE_URL}/quote",
            params={"symbol": symbol_upper, "token": FINNHUB_TOKEN},
        )
        if r_quote.status_code != 200:
            raise HTTPException(r_quote.status_code, f"Finnhub quote error: {r_quote.text[:200]}")
        q = r_quote.json() or {}
        quote = {
            "symbol": symbol_upper,
            "price": q.get("c"),
            "change": q.get("d"),
            "change_pct": q.get("dp"),
            "high": q.get("h"),
            "low": q.get("l"),
            "open": q.get("o"),
            "prev_close": q.get("pc"),
        }

        logo_url = await fetch_logo(symbol_upper)

        now_utc = datetime.now(timezone.utc)
        since = now_utc - timedelta(hours=hours)
        params = {
            "symbol": symbol_upper,
            "from": since.date().isoformat(),
            "to": now_utc.date().isoformat(),
            "token": FINNHUB_TOKEN,
        }
        r_news = await _client.get(f"{FINNHUB_BASE_URL}/company-news", params=params)
        if r_news.status_code != 200:
            raise HTTPException(r_news.status_code, f"Finnhub news error: {r_news.text[:200]}")
        items = r_news.json() or []
        for a in items[:limit]:
            news_items.append(
                {
                    "title": a.get("headline"),
                    "summary": a.get("summary"),
                    "published_at": a.get("datetime"),
                    "source": a.get("source"),
                    "url": a.get("url"),
                    "image_url": a.get("image"),
                }
            )
    else:
        items = await fetch_news(symbol_upper, limit, language or "en", hours, country)
        news_items = items

    return {
        "symbol": symbol_upper,
        "quote": quote,
        "logo_url": logo_url,
        "news": {
            "total": len(news_items),
            "items": news_items,
        },
    }

@app.get("/api/symbols")
async def get_symbols():
    """
    Fetches the list of available DR symbols and merged with TradingView stocks.
    """
    key = "dr_tv_symbols_list"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    client_to_use = _client
    local_client = False
    if client_to_use is None:
        client_to_use = httpx.AsyncClient()
        local_client = True
    
    try:
        # 1. Fetch DR Symbols (keep existing logic)
        dr_symbols = []
        try:
            r = await client_to_use.get("http://172.17.1.85:8333/dr", timeout=2)
            if r.status_code == 200:
                data = r.json()
                rows = data.get("rows", [])
                for row in rows:
                    underlying = row.get("underlying")
                    if underlying:
                        underlying = underlying.strip().upper()
                        dr_symbols.append({
                            "symbol": underlying,
                            "name": row.get("underlyingName") or row.get("name") or "",
                            "dr_symbol": row.get("symbol"),
                            "logo": row.get("logo") or row.get("logoUrl") or row.get("image")
                        })
        except Exception as e:
            print(f"Error fetching DR symbols: {e}")
            # Don't fail completely, just use fallback or empty

        # 2. Fetch TradingView Stocks (US and Thailand)
        tv_symbols_us = await _fetch_tradingview_stocks(client_to_use, region="america")
        tv_symbols_th = await _fetch_tradingview_stocks(client_to_use, region="thailand")
        tv_symbols = tv_symbols_us + tv_symbols_th
        
        # 3. Merge Lists
        # Use a dict to dedup by symbol, preferring DR info if available (or TV info if better?)
        # Let's prefer TV info for logo/name as it might be more standard, 
        # but keep DR specific fields if any.
        merged = {}
        
        # Add fallback symbols first
        for s in FALLBACK_SYMBOLS:
            merged[s["symbol"]] = s.copy()

        # Add DR symbols
        for s in dr_symbols:
            if s["symbol"] not in merged:
                merged[s["symbol"]] = s
            else:
                # Merge?
                pass
        
        # Add TV symbols (will overwrite if exists, which might be good for better names/logos)
        for s in tv_symbols:
            # If exists, update logo/name but also merge volume/market_cap info if available
            if s["symbol"] in merged:
                existing = merged[s["symbol"]]
                if not existing.get("logo") and s.get("logo"):
                    existing["logo"] = s["logo"]
                if not existing.get("name") and s.get("name"):
                    existing["name"] = s["name"]
                
                # Merge financial info
                existing["market_cap"] = s.get("market_cap", 0)
                existing["volume"] = s.get("volume", 0)
                existing["price"] = s.get("price", 0)
                existing["change_pct"] = s.get("change_pct", 0)
                existing["change"] = s.get("change", 0)
            else:
                merged[s["symbol"]] = s
        
        result = list(merged.values())
        # Sort by Market Cap Descending (Popularity)
        result.sort(key=lambda x: x.get("market_cap", 0), reverse=True)
        
        _cache_set(key, result, ttl=3600)
        return result
        
    finally:
        if local_client:
            await client_to_use.aclose()

async def _fetch_tradingview_stocks(client, region="america"):
    try:
        url = "https://scanner.tradingview.com/america/scan"
        min_volume = 500000 # Higher threshold for US to ensure news availability
        exchange_filter = ["AMEX", "NASDAQ", "NYSE"]

        if region == "thailand":
            url = "https://scanner.tradingview.com/thailand/scan"
            min_volume = 50000 # Threshold for Thai stocks
            exchange_filter = ["SET", "mai"]

        # Filter logic to reduce noise (remove derivatives, low volume, etc.)
        # We restrict subtypes to common/etf/reit to avoid warrants/structured products that rarely have news.
        subtypes = ["common", "preference", "etf", "reit"]
        
        payload = {
            "filter": [
                {"left": "type", "operation": "in_range", "right": ["stock", "dr", "fund"]},
                {"left": "subtype", "operation": "in_range", "right": subtypes},
                {"left": "exchange", "operation": "in_range", "right": exchange_filter},
                # Filter out inactive stocks
                {"left": "average_volume_10d_calc", "operation": "greater", "right": min_volume}
            ],
            "options": {"lang": "en"},
            "symbols": {"query": {"types": []}, "tickers": []},
            "columns": ["logoid", "name", "close", "change", "change_abs", "Recommend.All", "volume", "market_cap_basic"],
            "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
            "range": [0, 2000] 
        }
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin": "https://www.tradingview.com",
            "Referer": "https://www.tradingview.com/",
            "Content-Type": "application/json"
        }

        r = await client.post(url, json=payload, headers=headers, timeout=10)
        if r.status_code != 200:
            print(f"TV Scanner error: {r.status_code} {r.text[:100]}")
            return []
            
        data = r.json()
        total = data.get("totalCount", 0)
        rows = data.get("data", [])
        
        results = []
        for row in rows:
            # "d": ["apple-big", "Apple Inc", 234.5, ...]
            # columns: ["logoid", "name", ...]
            d = row.get("d", [])
            if not d or len(d) < 2:
                continue
                
            symbol = row.get("s", "").split(":")[-1] # NASDAQ:AAPL -> AAPL
            logoid = d[0]
            name = d[1]
            
            # --- Additional Filtering Heuristics ---
            # 1. Thai Specific Filters
            if region == "thailand":
                # Exclude Foreign board / NVDR / Warrants often denoted by dots (e.g., PTT.F, PTT.R)
                # But allow numbers (2S, 7UP)
                if "." in symbol:
                    continue
                # Exclude if Name is same as Symbol (often bad data like "88TH")
                # Real companies usually have full names "PTT Public Company..."
                if name.strip().upper() == symbol.strip().upper():
                    continue

            # 2. General Filters
            # Exclude if name is empty
            if not name:
                continue
            # ---------------------------------------

            # Extract additional data (close, change, change_abs, volume, market_cap)
            # columns: ["logoid", "name", "close", "change", "change_abs", "Recommend.All", "volume", "market_cap_basic"]
            # indices:     0        1        2        3          4              5             6           7
            close = d[2] if len(d) > 2 else 0
            change_pct = d[3] if len(d) > 3 else 0
            change_abs = d[4] if len(d) > 4 else 0
            volume = d[6] if len(d) > 6 else 0
            market_cap = d[7] if len(d) > 7 else 0

            logo_url = None
            if logoid:
                # TV logo logic
                base_tv_logo = "https://s3-symbol-logo.tradingview.com/"
                logo_url = f"{base_tv_logo}{logoid}.svg"
            
            results.append({
                "symbol": symbol,
                "name": name,
                "logo": logo_url,
                "price": close,
                "change_pct": change_pct,
                "change": change_abs,
                "volume": volume,
                "market_cap": market_cap
            })
            
        return results
    except Exception as e:
        print(f"Error fetching TV stocks: {e}")
        return []

# Removed old _fetch_and_cache_symbols as it's integrated above



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=8003)
