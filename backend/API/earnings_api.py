from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from contextlib import asynccontextmanager
import httpx
import uvicorn
import asyncio
import json
import os
import re
import time as time_module
from datetime import datetime, timedelta, time, timezone
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

# ================= CONFIG =================
TRADINGVIEW_SCAN_URL = os.getenv("TRADINGVIEW_SCAN_URL") or "https://scanner.tradingview.com/{market}/scan?label-product=screener-stock-old"
# ✅ เพิ่ม DR_LIST_URL เพื่อใช้ดึงรายชื่อหุ้นที่มี DR
DR_LIST_URL = "http://172.17.1.85:8333/dr"
# ✅ เพิ่มการตั้งค่าเปิด-ปิดฟิลเตอร์ DR (True = กรองเฉพาะหุ้นที่มี DR, False = เอาหุ้นทั้งหมด)
ENABLE_DR_FILTER = os.getenv("ENABLE_DR_FILTER", "True").lower() == "true"
CACHE_FILE = "earnings_cache.json"
UPDATE_INTERVAL_SECONDS = int(os.getenv("EARNINGS_UPDATE_INTERVAL_SECONDS") or "3600")

FAKE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/"
}

COLUMNS_MAP = [
    "logoid", "name", "market_cap_basic", "earnings_per_share_forecast_next_fq",
    "earnings_per_share_fq", "eps_surprise_fq", "eps_surprise_percent_fq",
    "revenue_forecast_next_fq", "revenue_fq", "earnings_release_next_date",
    "earnings_release_next_calendar_date", "earnings_release_next_time",
    "description", "type", "subtype", "update_mode",
    "earnings_per_share_forecast_fq", "revenue_forecast_fq", "earnings_release_date",
    "earnings_release_calendar_date", "earnings_release_time", "currency",
    "fundamental_currency_code", "exchange"
]

MARKET_DISPLAY_NAMES = {
    "america": "US United States", "thailand": "TH Thailand", "hongkong": "HK Hong Kong",
    "japan": "JP Japan", "china": "CN China", "singapore": "SG Singapore",
    "vietnam": "VN Vietnam", "france": "FR France", "germany": "DE Germany",
    "netherlands": "NL Netherlands", "denmark": "DK Denmark", "italy": "IT Italy",
    "taiwan": "TW Taiwan"
}

# Global DB
_earnings_db = {}
_last_update_str = "-"
_previous_earnings_db = {}  # Store previous earnings state for comparison

# SSE Client Management
_sse_clients: list[asyncio.Queue] = []
_sse_lock = asyncio.Lock()

# ================= HELPERS =================
def extract_symbol(text):
    """Extract ticker symbol from text (e.g., from 'AAPL INC' or 'Company (AAPL)')"""
    if not text:
        return ""
    text_upper = str(text).upper().strip()
    
    # Try to extract from parentheses first
    match = re.search(r'\(([A-Z0-9.\-_]+)\)$', text_upper)
    if match:
        return match.group(1).strip()
    
    # If it's already a short symbol (no spaces, < 10 chars), return as-is
    if ' ' not in text_upper and len(text_upper) < 10:
        return text_upper
    
    return text_upper

def is_exchange_match(earnings_exchange, dr_exchange):
    """Check if exchange names match (handles variations)"""
    if not earnings_exchange or not dr_exchange:
        return True  # If no exchange info, allow match
    
    earnings_ex = str(earnings_exchange).upper().strip()
    dr_ex = str(dr_exchange).upper().strip()
    
    # Exact match
    if earnings_ex == dr_ex:
        return True
    
    # Partial match
    if earnings_ex in dr_ex or dr_ex in earnings_ex:
        return True
    
    # Handle common exchange name variations
    exchange_map = {
        'TSE': ['TOKYO', 'TOKYO STOCK EXCHANGE'],
        'HKEX': ['HONG KONG', 'STOCK EXCHANGE OF HONG KONG'],
        'NYSE': ['NEW YORK', 'NEW YORK STOCK EXCHANGE'],
        'NASDAQ': ['NASDAQ'],
        'SSE': ['SHANGHAI', 'SHANGHAI STOCK EXCHANGE'],
        'SZSE': ['SHENZHEN', 'SHENZHEN STOCK EXCHANGE']
    }
    
    for code, names in exchange_map.items():
        if earnings_ex.find(code) != -1 or any(name in earnings_ex for name in names):
            if dr_ex.find(code) != -1 or any(name in dr_ex for name in names):
                return True
    
    return False

def calculate_dr_metrics(ticker, exchange, dr_rows):
    """
    Calculate DR metrics (mostPopularDR, highSensitivityDR) for a given ticker and exchange.
    
    Args:
        ticker: Stock ticker symbol
        exchange: Exchange name
        dr_rows: List of DR data from DR API
    
    Returns:
        dict with mostPopularDR and highSensitivityDR
    """
    if not ticker or not dr_rows:
        return {"mostPopularDR": None, "highSensitivityDR": None}
    
    ticker_upper = str(ticker).upper().strip()
    
    # Find matching DRs
    matching_drs = []
    for dr in dr_rows:
        # Check if ticker matches
        ticker_matches = False
        
        # Strategy 1: Extract from underlying field
        underlying1 = extract_symbol(dr.get("underlying") or "")
        if underlying1 and underlying1 == ticker_upper:
            ticker_matches = True
        
        # Strategy 2: Extract from underlyingName field
        if not ticker_matches:
            underlying2 = extract_symbol(dr.get("underlyingName") or "")
            if underlying2 and underlying2 == ticker_upper:
                ticker_matches = True
        
        # Strategy 3: Direct match
        if not ticker_matches:
            underlying_direct = str(dr.get("underlying") or dr.get("underlyingName") or "").upper().strip()
            if underlying_direct == ticker_upper:
                ticker_matches = True
        
        if not ticker_matches:
            continue
        
        # If ticker matches, check exchange
        dr_exchange = dr.get("underlyingExchange") or dr.get("exchange") or ""
        if is_exchange_match(exchange, dr_exchange):
            matching_drs.append(dr)
    
    if not matching_drs:
        return {"mostPopularDR": None, "highSensitivityDR": None}
    
    # Calculate Most Popular DR (highest volume)
    most_popular_dr = None
    max_volume = -1
    for dr in matching_drs:
        vol = float(dr.get("totalVolume") or 0)
        if vol > max_volume:
            max_volume = vol
            most_popular_dr = {
                "symbol": dr.get("symbol") or "",
                "volume": vol
            }
    
    # If no DR with volume found, use first matching DR
    if not most_popular_dr and matching_drs:
        most_popular_dr = {
            "symbol": matching_drs[0].get("symbol") or "",
            "volume": 0
        }
    
    # Calculate High Sensitivity DR (lowest bid > 0)
    high_sensitivity_dr = None
    min_bid = float('inf')
    for dr in matching_drs:
        bid = float(dr.get("bidPrice") or 0)
        if bid > 0 and bid < min_bid:
            min_bid = bid
            high_sensitivity_dr = {
                "symbol": dr.get("symbol") or "",
                "bid": bid
            }
    
    # If still no DR with bid, use first matching DR
    if not high_sensitivity_dr and matching_drs:
        high_sensitivity_dr = {
            "symbol": matching_drs[0].get("symbol") or "",
            "bid": 0
        }
    
    return {
        "mostPopularDR": most_popular_dr,
        "highSensitivityDR": high_sensitivity_dr
    }

def get_market_code(country_code: str):
    mapping = {
        "US": "america", "TH": "thailand", "HK": "hongkong", "JP": "japan",
        "CN": "china", "SG": "singapore", "VN": "vietnam", "FR": "france",
        "DE": "germany", "NL": "netherlands", "DK": "denmark", "IT": "italy",
        "TW": "taiwan"
    }
    return mapping.get(country_code.upper())

def get_tradingview_range(country: str = "US"):
    now_utc = datetime.now(timezone.utc)
    today_date = now_utc.date()
    # ✅ คำนวณวันจันทร์ของสัปดาห์หน้า (next Monday)
    # weekday() คืนค่า 0=Monday, 1=Tuesday, ..., 6=Sunday
    # ถ้าวันนี้เป็นวันจันทร์ (weekday=0) จะได้ next_monday = today_date + 7 days
    # ถ้าวันนี้เป็นวันอังคาร-อาทิตย์ จะได้ next_monday = today_date + (7 - weekday) days
    days_until_monday = 7 - today_date.weekday()
    if days_until_monday == 0:  # ถ้าวันนี้เป็นวันจันทร์ ให้ไปสัปดาห์หน้า
        days_until_monday = 7
    next_monday = today_date + timedelta(days=days_until_monday)
    next_monday_dt = datetime.combine(next_monday, time.min).replace(tzinfo=timezone.utc)
    offset_hours = 15 if country.upper() == "JP" else 0
    start_dt = next_monday_dt + timedelta(hours=offset_hours)
    end_dt = start_dt + timedelta(days=7)
    return int(start_dt.timestamp()), int(end_dt.timestamp())

async def fetch_tradingview_earnings(market_code: str, start_ts: int, end_ts: int):
    """Fetch earnings data from TradingView with pagination to get all results"""
    url = TRADINGVIEW_SCAN_URL.format(market=market_code)
    all_data = []
    page_size = 500  # ดึงครั้งละ 500 ตัว
    offset = 0
    
    async with httpx.AsyncClient() as client:
        while True:
            payload = {
                "filter": [
                    {"left": "is_primary", "operation": "equal", "right": True},
                    {"left": "earnings_release_date,earnings_release_next_date", "operation": "in_range", "right": [start_ts, end_ts]},
                    {"left": "earnings_release_date,earnings_release_next_date", "operation": "nequal", "right": end_ts}
                ],
                "options": {"lang": "th"},
                "markets": [market_code],
                "symbols": {
                    "query": {"types": []},
                    "tickers": []
                },
                "columns": COLUMNS_MAP,
                "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
                "preset": None,
                "range": [offset, offset + page_size]
            }
            try:
                resp = await client.post(url, json=payload, headers=FAKE_HEADERS, timeout=15)
                if resp.status_code != 200:
                    break
                
                page_data = resp.json().get("data", [])
                if not page_data:
                    break
                
                all_data.extend(page_data)
                
                # ถ้าดึงมาได้น้อยกว่า page_size แสดงว่าเป็นหน้าสุดท้ายแล้ว
                if len(page_data) < page_size:
                    break
                
                offset += page_size
                
                # จำกัดสูงสุดที่ 5000 ตัวเพื่อป้องกัน infinite loop
                if offset >= 5000:
                    break
                    
            except Exception as e:
                print(f"⚠️ Error fetching page {offset}: {e}")
                break
    
    return all_data

# ✅ แก้ไขให้รับ valid_tickers, ticker_mapping และ dr_rows เพื่อคำนวณ DR metrics
def map_tv_data_to_object(raw_data, valid_tickers: set = None, ticker_mapping: dict = None, dr_rows: list = None):
    mapped_list = []
    seen = set()
    current_ts = datetime.now(timezone.utc).timestamp()
    for item in raw_data:
        d = item.get("d", [])
        if not d or len(d) < len(COLUMNS_MAP): continue
        obj = {COLUMNS_MAP[i]: d[i] for i in range(len(COLUMNS_MAP))}
        
        # ✅ ใช้ logoid เป็น ticker symbol (ถ้ามี) หรือใช้ name เป็น fallback
        # logoid มักจะเป็น ticker symbol เช่น "AAPL", "AMZN" 
        # name มักจะเป็นชื่อเต็ม เช่น "APPLE INC", "AMAZON.COM, INC"
        logoid = str(obj.get("logoid") or "").upper().strip()
        ticker_name = str(obj["name"]).upper().strip()
        description = str(obj.get("description") or "").upper().strip()
        
        # ✅ กำหนดค่าเริ่มต้นสำหรับ matched_underlying (ใช้เมื่อ DR Filter ปิด)
        matched_underlying = None
        
        # ✅ ตัวกรอง: ถ้ามี Whitelist ให้ตรวจสอบทั้ง ticker และ exchange
        # ต้องตรวจสอบว่า ticker และ exchange match กับ DR list หรือไม่
        if valid_tickers is not None and dr_rows is not None:
            matched = False
            matched_ticker = None
            matched_underlying = None
            
            # Get exchange from earnings data
            earnings_exchange = obj.get("exchange", "")
            
            # Helper function to check if ticker+exchange match any DR
            def check_ticker_exchange_match(ticker_to_check):
                if not ticker_to_check:
                    return None
                ticker_upper = str(ticker_to_check).upper().strip()
                
                # Search in DR rows for matching ticker AND exchange
                for dr in dr_rows:
                    # Extract ticker from DR
                    dr_ticker = None
                    underlying_name = dr.get("underlyingName") or ""
                    match = re.search(r'\(([A-Z0-9.\-_]+)\)$', underlying_name)
                    if match:
                        dr_ticker = match.group(1)
                    else:
                        dr_ticker = dr.get("underlying")
                    
                    if not dr_ticker:
                        continue
                    
                    dr_ticker_upper = str(dr_ticker).upper().strip()
                    
                    # Check if ticker matches
                    if ticker_upper != dr_ticker_upper:
                        continue
                    
                    # Check if exchange matches
                    dr_exchange = dr.get("underlyingExchange") or dr.get("exchange") or ""
                    if is_exchange_match(earnings_exchange, dr_exchange):
                        return dr_ticker_upper
                
                return None
            
            # ลำดับการตรวจสอบ:
            # 1) ตรวจสอบ ticker_name
            matched_underlying = check_ticker_exchange_match(ticker_name)
            if matched_underlying:
                matched = True
                matched_ticker = ticker_name
            # 2) ตรวจสอบ logoid
            elif logoid:
                matched_underlying = check_ticker_exchange_match(logoid)
                if matched_underlying:
                    matched = True
                    matched_ticker = logoid
            # 3) ลอง extract ticker symbol จาก name
            if not matched:
                name_parts = re.split(r'[-,\s]+', ticker_name)
                for part in name_parts:
                    if part:
                        matched_underlying = check_ticker_exchange_match(part)
                        if matched_underlying:
                            matched = True
                            matched_ticker = part
                            break
            
            if not matched:
                # Debug: แสดง ticker ที่ไม่ match (แสดงแค่ 10 ตัวแรกเพื่อไม่ให้ log เยอะเกินไป)
                if len([x for x in mapped_list if not hasattr(x, '_debug_shown')]) < 10:
                    print(f"  ⚠️ Filtered out: logoid='{logoid}', name='{ticker_name}', exchange='{earnings_exchange}' (not in DR list or exchange mismatch)")
                continue  # ไม่พบใน whitelist ให้ข้าม
            else:
                # Debug: แสดง ticker ที่ match ได้ (แสดงแค่ 10 ตัวแรก)
                if len(mapped_list) < 10:
                    print(f"  ✅ Matched: logoid='{logoid}', name='{ticker_name}', exchange='{earnings_exchange}' -> underlying='{matched_underlying}'")
        
        event_date = obj["earnings_release_next_date"] or obj["earnings_release_date"]
        
        # ✅ ใช้ (ticker, date) เป็น unique key เพื่อป้องกัน duplicate
        # ใช้ matched_underlying ถ้ามี (เพื่อให้ตรงกับ DR underlying code)
        # ถ้าไม่มี matched_underlying ให้ใช้ ticker_name (กรณีที่ไม่ได้ filter)
        final_ticker_for_key = matched_underlying if matched_underlying else ticker_name
        
        if event_date:
            unique_key = (final_ticker_for_key, event_date)
            if unique_key in seen: 
                continue
            seen.add(unique_key)
        else:
            # ถ้าไม่มี date ให้ใช้ logoid หรือ ticker เป็น fallback
            unique_id = obj.get("logoid") or final_ticker_for_key
            if unique_id in seen: 
                continue
            seen.add(unique_id)
        
        is_future = event_date and event_date > current_ts
        
        # ✅ ใช้ matched_underlying เป็น ticker ถ้ามี (เพื่อให้ตรงกับ DR underlying code)
        # ถ้าไม่มี matched_underlying ให้ใช้ ticker_name (กรณีที่ไม่ได้ filter)
        final_ticker = matched_underlying if matched_underlying else ticker_name
        
        # Calculate DR metrics if dr_rows is provided
        dr_metrics = {"mostPopularDR": None, "highSensitivityDR": None}
        if dr_rows:
            dr_metrics = calculate_dr_metrics(final_ticker, obj["exchange"], dr_rows)
        
        mapped_list.append({
            "ticker": final_ticker,
            "company": obj["description"],
            "marketCap": obj["market_cap_basic"], 
            "epsEstimate": obj["earnings_per_share_forecast_next_fq"],
            "epsReported": None if is_future else obj["earnings_per_share_fq"],
            "surprise": None if is_future else obj["eps_surprise_fq"],
            "pctSurprise": None if is_future else obj["eps_surprise_percent_fq"],
            "revenueForecast": obj["revenue_forecast_next_fq"],
            "revenueActual": None if is_future else obj["revenue_fq"],
            "date": event_date, 
            "period": obj["earnings_release_next_calendar_date"],
            "currency": obj["currency"],
            "exchange": obj["exchange"],
            "mostPopularDR": dr_metrics["mostPopularDR"],
            "highSensitivityDR": dr_metrics["highSensitivityDR"]
        })
    return mapped_list

# ================= PERSISTENCE LOGIC =================
def load_db_from_disk():
    global _earnings_db, _last_update_str, _previous_earnings_db
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                _earnings_db = loaded.get("data", {})
                _last_update_str = loaded.get("meta", {}).get("updated_at", "-")
                # Initialize previous_earnings_db with current data (so first update won't trigger false positives)
                _previous_earnings_db = _earnings_db.copy()
            print(f"✅ Loaded cache: {len(_earnings_db)} markets.")
        except Exception as e: print(f"⚠️ Load fail: {e}")

def save_db_to_disk():
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"meta": {"updated_at": _last_update_str}, "data": _earnings_db}, f, ensure_ascii=False)
    except Exception as e: print(f"⚠️ Save fail: {e}")

async def broadcast_to_sse_clients(message: dict):
    """Broadcast message to all connected SSE clients"""
    async with _sse_lock:
        client_count = len(_sse_clients)
        if client_count > 0:
            print(f"📡 [SSE] Broadcasting to {client_count} client(s): {message.get('type', 'unknown')}")
        disconnected_clients = []
        for queue in _sse_clients:
            try:
                await queue.put(message)
            except Exception as e:
                # Mark for removal if queue is closed
                print(f"⚠️ [SSE] Failed to send to client: {e}")
                disconnected_clients.append(queue)
        
        # Remove disconnected clients
        for queue in disconnected_clients:
            if queue in _sse_clients:
                _sse_clients.remove(queue)

def get_earnings_set(earnings_db: dict) -> set:
    """Convert earnings_db to a set of (ticker, date) tuples for comparison"""
    earnings_set = set()
    for market_data in earnings_db.values():
        if isinstance(market_data, dict) and "data" in market_data:
            for earning in market_data["data"]:
                ticker = earning.get("ticker", "")
                date = earning.get("date")
                if ticker and date:
                    earnings_set.add((ticker, date))
    return earnings_set

def find_new_earnings(current_db: dict, previous_db: dict) -> list:
    """Find new earnings by comparing current_db with previous_db"""
    current_set = get_earnings_set(current_db)
    previous_set = get_earnings_set(previous_db)
    
    new_keys = current_set - previous_set
    
    # Extract full earning objects for new keys
    new_earnings = []
    for market_data in current_db.values():
        if isinstance(market_data, dict) and "data" in market_data:
            for earning in market_data["data"]:
                ticker = earning.get("ticker", "")
                date = earning.get("date")
                if (ticker, date) in new_keys:
                    new_earnings.append(earning)
    
    return new_earnings

async def background_updater():
    global _earnings_db, _last_update_str, _previous_earnings_db
    while True:
        try:
            print(f"🔄 [Background] Updating Earnings Data at {datetime.now()}")
            
            # ✅ ปรับปรุง Logic การดึงรายชื่อหุ้นที่มี DR ตามค่า ENABLE_DR_FILTER
            valid_dr_tickers = None
            ticker_mapping = {}  # Mapping table: {ticker_from_tv: underlying_code}
            dr_rows = []  # Store DR rows for DR metrics calculation
            if ENABLE_DR_FILTER:
                valid_dr_tickers = set()
                skipped_count = 0
                skipped_reasons = {}
                skipped_items = []  # เก็บรายการที่ถูก skip เพื่อ debug
                try:
                    async with httpx.AsyncClient() as client:
                        r_dr = await client.get(DR_LIST_URL, timeout=10)
                        dr_rows = r_dr.json().get("rows", [])
                        print(f"  📊 [Background] Total DR rows from API: {len(dr_rows)}")
                        for item in dr_rows:
                            u_code = None
                            source = None
                            
                            # ✅ ลำดับความสำคัญ: 1) extract จาก underlyingName ที่มี format "(TICKER)" ก่อน
                            underlying_name = item.get("underlyingName") or ""
                            match = re.search(r'\(([A-Z0-9.\-_]+)\)$', underlying_name)
                            if match:
                                u_code = match.group(1)
                                source = "underlyingName"
                            else:
                                # 2) ใช้ underlying field (ถ้ามี)
                                u_code = item.get("underlying")
                                if u_code:
                                    source = "underlying"
                                else:
                                    # 3) extract จาก symbol (เช่น "JPM80" -> "JPM")
                                    sym = item.get("symbol") or ""
                                    if "80" in sym: 
                                        u_code = sym.replace("80", "")
                                        source = "symbol(80)"
                                    elif "19" in sym: 
                                        u_code = sym.replace("19", "")
                                        source = "symbol(19)"
                            
                            if u_code:
                                u_code = u_code.strip().upper()
                                # ✅ กรองเฉพาะ ticker symbol (ไม่ใช่ชื่อเต็มที่มี space หลายตัว)
                                # เช่น "JPM", "BAC", "CNSEMI" ผ่าน แต่ "CNSEMI ETF" ไม่ผ่าน
                                # อนุญาตให้มี dash/underscore/dot ได้ (เช่น "A-B", "A_B", "A.B")
                                if u_code and len(u_code) > 0:
                                    # ถ้ามี space แสดงว่าเป็นชื่อเต็ม ให้ลอง extract ticker จากหลายวิธี
                                    if ' ' in u_code:
                                        # วิธี 1: ลอง extract ticker จาก underlyingName อีกครั้ง (อาจมี format อื่น)
                                        name_match_alt = re.search(r'\(([A-Z0-9.\-_]+)\)', underlying_name.upper())
                                        if name_match_alt:
                                            alt_ticker = name_match_alt.group(1).strip()
                                            if alt_ticker and ' ' not in alt_ticker and len(alt_ticker) <= 15:
                                                u_code = alt_ticker
                                                source = "underlyingName(alt)"
                                            else:
                                                # วิธี 2: ลอง extract ticker จาก underlying โดยลบคำว่า "ETF", "DIAMOND ETF" ฯลฯ
                                                u_code_clean = re.sub(r'\s+(ETF|DIAMOND ETF|FUND|TRUST).*$', '', u_code, flags=re.IGNORECASE).strip()
                                                if u_code_clean and ' ' not in u_code_clean and len(u_code_clean) <= 15:
                                                    u_code = u_code_clean
                                                    source = "underlying(clean)"
                                                else:
                                                    # วิธี 3: ลองใช้ symbol โดยลบ suffix (เช่น "E1VFVN3001" -> "E1VFVN30", "FUEVFVND01" -> "FUEVFVND")
                                                    sym = item.get("symbol") or ""
                                                    if sym:
                                                        # ลบ suffix ตัวเลขท้าย (เช่น "01", "24", "3001")
                                                        sym_clean = re.sub(r'\d+$', '', sym).strip()
                                                        if sym_clean and len(sym_clean) >= 2 and len(sym_clean) <= 15:
                                                            u_code = sym_clean.upper()
                                                            source = "symbol(clean)"
                                                        else:
                                                            skipped_count += 1
                                                            skipped_reasons['has_space'] = skipped_reasons.get('has_space', 0) + 1
                                                            skipped_items.append({
                                                                'symbol': item.get('symbol', 'N/A'),
                                                                'underlyingName': underlying_name[:50],
                                                                'u_code': u_code,
                                                                'reason': 'has_space'
                                                            })
                                                            continue
                                                    else:
                                                        skipped_count += 1
                                                        skipped_reasons['has_space'] = skipped_reasons.get('has_space', 0) + 1
                                                        skipped_items.append({
                                                            'symbol': item.get('symbol', 'N/A'),
                                                            'underlyingName': underlying_name[:50],
                                                            'u_code': u_code,
                                                            'reason': 'has_space'
                                                        })
                                                        continue
                                        else:
                                            # วิธี 2: ลอง extract ticker จาก underlying โดยลบคำว่า "ETF", "DIAMOND ETF" ฯลฯ
                                            u_code_clean = re.sub(r'\s+(ETF|DIAMOND ETF|FUND|TRUST).*$', '', u_code, flags=re.IGNORECASE).strip()
                                            if u_code_clean and ' ' not in u_code_clean and len(u_code_clean) <= 15:
                                                u_code = u_code_clean
                                                source = "underlying(clean)"
                                            else:
                                                # วิธี 3: ลองใช้ symbol โดยลบ suffix (เช่น "E1VFVN3001" -> "E1VFVN30", "FUEVFVND01" -> "FUEVFVND")
                                                sym = item.get("symbol") or ""
                                                if sym:
                                                    # ลบ suffix ตัวเลขท้าย (เช่น "01", "24", "3001")
                                                    sym_clean = re.sub(r'\d+$', '', sym).strip()
                                                    if sym_clean and len(sym_clean) >= 2 and len(sym_clean) <= 15:
                                                        u_code = sym_clean.upper()
                                                        source = "symbol(clean)"
                                                    else:
                                                        skipped_count += 1
                                                        skipped_reasons['has_space'] = skipped_reasons.get('has_space', 0) + 1
                                                        skipped_items.append({
                                                            'symbol': item.get('symbol', 'N/A'),
                                                            'underlyingName': underlying_name[:50],
                                                            'u_code': u_code,
                                                            'reason': 'has_space'
                                                        })
                                                        continue
                                                else:
                                                    skipped_count += 1
                                                    skipped_reasons['has_space'] = skipped_reasons.get('has_space', 0) + 1
                                                    skipped_items.append({
                                                        'symbol': item.get('symbol', 'N/A'),
                                                        'underlyingName': underlying_name[:50],
                                                        'u_code': u_code,
                                                        'reason': 'has_space'
                                                    })
                                                    continue
                                    # ถ้ายาวเกิน 15 ตัวอักษร อาจเป็นชื่อเต็ม ให้ข้าม
                                    if len(u_code) > 15:
                                        skipped_count += 1
                                        skipped_reasons['too_long'] = skipped_reasons.get('too_long', 0) + 1
                                        skipped_items.append({
                                            'symbol': item.get('symbol', 'N/A'),
                                            'underlyingName': underlying_name[:50],
                                            'u_code': u_code,
                                            'reason': 'too_long'
                                        })
                                        continue
                                    valid_dr_tickers.add(u_code)
                                    
                                    # ✅ สร้าง mapping table: ใช้ underlying code เป็น key และ value
                                    # และเพิ่ม alias จาก symbol (เช่น "JPM80" -> "JPM")
                                    ticker_mapping[u_code] = u_code
                                    
                                    # เพิ่ม alias จาก symbol (ถ้า symbol ไม่ใช่ underlying code)
                                    sym_clean = item.get("symbol", "").strip().upper()
                                    if sym_clean and sym_clean != u_code:
                                        # ลบ suffix "80", "19" จาก symbol
                                        sym_no_suffix = sym_clean.replace("80", "").replace("19", "").strip()
                                        if sym_no_suffix and sym_no_suffix != u_code and len(sym_no_suffix) <= 15 and ' ' not in sym_no_suffix:
                                            ticker_mapping[sym_no_suffix] = u_code
                                    
                                    # ✅ เพิ่ม alias จาก underlyingName (extract ticker จากชื่อบริษัท)
                                    # เช่น "บริษัท JP MORGAN CHASE & CO. (JPM)" -> "JPM"
                                    if underlying_name:
                                        name_match = re.search(r'\(([A-Z0-9.\-_]+)\)', underlying_name.upper())
                                        if name_match:
                                            name_ticker = name_match.group(1).strip()
                                            if name_ticker and name_ticker != u_code and len(name_ticker) <= 15 and ' ' not in name_ticker:
                                                ticker_mapping[name_ticker] = u_code
                                    
                                    # Debug: แสดงตัวอย่างการ extract (เฉพาะ 10 ตัวแรก)
                                    if len(valid_dr_tickers) <= 10:
                                        print(f"    ✅ Extracted: {u_code} from {source} (symbol: {item.get('symbol', 'N/A')}, underlyingName: {underlying_name[:50]})")
                    
                    # Debug: แสดงจำนวนที่ถูก skip
                    if skipped_count > 0:
                        print(f"  ⚠️ Skipped {skipped_count} items: {skipped_reasons}")
                        # แสดงรายละเอียดของ items ที่ถูก skip (เฉพาะ 5 ตัวแรก)
                        for skipped in skipped_items[:5]:
                            print(f"    - Skipped: symbol='{skipped['symbol']}', u_code='{skipped['u_code']}', reason={skipped['reason']}, underlyingName='{skipped['underlyingName']}'")
                    print(f"📊 [Background] DR Filter is ENABLED. Found {len(valid_dr_tickers)} unique symbols (from {len(dr_rows)} DR rows, skipped {skipped_count}).")
                    # Debug: ตรวจสอบว่ามี underlying codes ซ้ำกันหรือไม่
                    if len(valid_dr_tickers) < len(dr_rows) - skipped_count:
                        duplicate_count = len(dr_rows) - skipped_count - len(valid_dr_tickers)
                        print(f"  ℹ️ Note: {duplicate_count} underlying codes are duplicates (multiple DR rows share the same underlying code)")
                    # Debug: แสดง sample ของ underlying codes (เฉพาะ ticker symbols ไม่ใช่ชื่อเต็ม)
                    # กรองเฉพาะ ticker symbols ที่ไม่มี space และไม่ยาวเกินไป
                    clean_tickers = [c for c in valid_dr_tickers if ' ' not in c and len(c) <= 15]
                    sample_codes = sorted(clean_tickers)[:10]
                    print(f"  📋 Sample ticker symbols: {sample_codes}")
                    # Debug: แสดง ticker symbols ที่มี space (ชื่อเต็ม) เพื่อตรวจสอบ - ควรไม่มี
                    full_names = [c for c in valid_dr_tickers if ' ' in c]
                    if full_names:
                        print(f"  ⚠️ Found {len(full_names)} full names (should be filtered out): {full_names[:5]}")
                    # Debug: ตรวจสอบว่ามี "JPM", "WFC", "BAC", "MS" อยู่ใน valid_dr_tickers หรือไม่
                    test_tickers = ["JPM", "WFC", "BAC", "MS", "GS", "C"]
                    found_test = [t for t in test_tickers if t in valid_dr_tickers]
                    missing_test = [t for t in test_tickers if t not in valid_dr_tickers]
                    if found_test:
                        print(f"  ✅ Found test tickers in DR list: {found_test}")
                    if missing_test:
                        print(f"  ⚠️ Missing test tickers in DR list: {missing_test}")
                    # Debug: แสดง sample ของ ticker_mapping
                    if ticker_mapping:
                        mapping_samples = list(ticker_mapping.items())[:10]
                        print(f"  📋 Sample ticker mapping: {mapping_samples}")
                except Exception as dr_err:
                    print(f"❌ [Background] Failed to fetch DR whitelist: {dr_err}")
                    # กรณีดึงข้อมูล DR ไม่ได้ ให้ยกเลิกการกรองชั่วคราวเพื่อป้องกันข้อมูลว่างเปล่า
                    valid_dr_tickers = None 
            else:
                print(f"🔓 [Background] DR Filter is DISABLED. Fetching all stocks.")

            new_db = {}
            all_markets = ["america", "hongkong", "japan", "china", "singapore", "vietnam", "france", "netherlands", "denmark", "italy", "taiwan", "thailand"]
            
            for m in all_markets:
                c_code = "JP" if m == "japan" else "US"
                s_ts, e_ts = get_tradingview_range(c_code)
                print(f"📅 [Background] [{m}] Date range: {datetime.fromtimestamp(s_ts, tz=timezone.utc)} to {datetime.fromtimestamp(e_ts, tz=timezone.utc)}")
                
                raw_data = await fetch_tradingview_earnings(m, s_ts, e_ts)
                print(f"📊 [Background] [{m}] Received {len(raw_data)} raw items from TradingView")
                
                # Debug: แสดง sample ของ raw data structure (เฉพาะ 2 ตัวแรก)
                if raw_data and len(raw_data) > 0:
                    sample = raw_data[0]
                    if isinstance(sample, dict) and "d" in sample:
                        d = sample.get("d", [])
                        if len(d) >= len(COLUMNS_MAP):
                            sample_obj = {COLUMNS_MAP[i]: d[i] for i in range(min(len(d), len(COLUMNS_MAP)))}
                            print(f"  🔍 Sample TradingView item: logoid='{sample_obj.get('logoid')}', name='{sample_obj.get('name')}', description='{sample_obj.get('description', '')[:50]}'")
                
                # ตรวจสอบหุ้น 2653 ใน raw_data สำหรับตลาดญี่ปุ่น
                if m == "japan":
                    raw_2653 = [item for item in raw_data if item.get("d") and len(item.get("d", [])) > 1 and "2653" in str(item.get("d", [])[1]).upper()]
                    if raw_2653:
                        print(f"✅ [Background] Found 2653 in raw_data: {raw_2653}")
                    else:
                        print(f"⚠️ [Background] 2653 NOT found in raw_data")
                
                # ✅ ส่ง valid_dr_tickers, ticker_mapping และ dr_rows ไปใช้กรองข้อมูล
                if valid_dr_tickers:
                    print(f"  🔍 [Background] [{m}] Filtering with {len(valid_dr_tickers)} DR tickers. Sample: {list(valid_dr_tickers)[:5]}")
                    print(f"  📋 [Background] [{m}] Ticker mapping table has {len(ticker_mapping)} entries")
                stock_list = map_tv_data_to_object(raw_data, valid_dr_tickers, ticker_mapping, dr_rows)
                print(f"✅ [Background] [{m}] Mapped to {len(stock_list)} stocks (from {len(raw_data)} raw items)")
                
                # ตรวจสอบหุ้น 2653 ใน stock_list สำหรับตลาดญี่ปุ่น
                if m == "japan":
                    ticker_2653 = [s for s in stock_list if "2653" in s.get("ticker", "")]
                    if ticker_2653:
                        print(f"✅ [Background] Found 2653 in stock_list: {ticker_2653}")
                    else:
                        print(f"⚠️ [Background] 2653 NOT found in stock_list (was filtered out)")
                
                stock_list.sort(key=lambda x: x["date"] if x["date"] else float('inf'))
                
                display_name = MARKET_DISPLAY_NAMES.get(m, m.upper())
                if stock_list:
                    new_db[display_name] = {"totalCount": len(stock_list), "data": stock_list}
                await asyncio.sleep(0.5) 

            # Detect new earnings before updating
            new_earnings = find_new_earnings(new_db, _previous_earnings_db)
            
            # Update earnings database
            _earnings_db = new_db
            _last_update_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            save_db_to_disk()
            
            # Broadcast new earnings to SSE clients
            if new_earnings:
                print(f"📢 [Background] Found {len(new_earnings)} new earnings, broadcasting to SSE clients")
                await broadcast_to_sse_clients({
                    "type": "new_earnings",
                    "earnings": new_earnings,
                    "count": len(new_earnings),
                    "updated_at": _last_update_str
                })
            
            # Update previous earnings state for next comparison
            _previous_earnings_db = new_db.copy()
            
            print(f"✅ [Background] Update complete. (ENABLE_DR_FILTER={ENABLE_DR_FILTER})")
        except Exception as e: print(f"❌ Updater error: {e}")
        await asyncio.sleep(UPDATE_INTERVAL_SECONDS)

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_db_from_disk()
    asyncio.create_task(background_updater())
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/earnings")
async def get_earnings(country: str = Query("US")):
    if country.upper() == "ALL":
        # Calculate date range for US market (default)
        s_ts, e_ts = get_tradingview_range("US")
        start_date = datetime.fromtimestamp(s_ts, tz=timezone.utc)
        end_date = datetime.fromtimestamp(e_ts, tz=timezone.utc)
        return {
            "updated_at": _last_update_str,
            "date_range": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat(),
                "start_display": start_date.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "end_display": end_date.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "note": "Shows earnings from next Monday to next Sunday (excluding end date)"
            },
            "data": _earnings_db
        }
    
    market_code = get_market_code(country)
    display_name = MARKET_DISPLAY_NAMES.get(market_code, "")
    
    # Calculate date range for the requested country
    c_code = "JP" if market_code == "japan" else "US"
    s_ts, e_ts = get_tradingview_range(c_code)
    start_date = datetime.fromtimestamp(s_ts, tz=timezone.utc)
    end_date = datetime.fromtimestamp(e_ts, tz=timezone.utc)
    
    if display_name in _earnings_db:
        return {
            "updated_at": _last_update_str,
            "date_range": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat(),
                "start_display": start_date.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "end_display": end_date.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "note": "Shows earnings from next Monday to next Sunday (excluding end date)"
            },
            "data": {display_name: _earnings_db[display_name]}
        }
    return {
        "updated_at": _last_update_str,
        "date_range": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "start_display": start_date.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "end_display": end_date.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "note": "Shows earnings from next Monday to next Sunday (excluding end date)"
        },
        "data": {}
    }

@app.get("/api/earnings/stream")
async def earnings_stream():
    """SSE endpoint for real-time earnings updates"""
    async def event_generator():
        # Create a queue for this client
        queue = asyncio.Queue()
        
        # Add client to the list
        async with _sse_lock:
            _sse_clients.append(queue)
            client_count = len(_sse_clients)
        
        print(f"🔌 [SSE] New client connected. Total clients: {client_count}")
        
        try:
            # Send initial connection message
            yield f"data: {json.dumps({'type': 'connected', 'message': 'SSE connection established'})}\n\n"
            
            # Send heartbeat every 30 seconds to keep connection alive
            last_heartbeat = time_module.time()
            heartbeat_interval = 30
            
            while True:
                # Wait for message with timeout for heartbeat
                current_time = time_module.time()
                time_since_heartbeat = current_time - last_heartbeat
                timeout = max(0.1, heartbeat_interval - time_since_heartbeat)
                
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=timeout)
                    yield f"data: {json.dumps(message)}\n\n"
                except asyncio.TimeoutError:
                    # Send heartbeat (uncomment to see heartbeats in console)
                    # print(f"💓 [SSE] Sending heartbeat to {len(_sse_clients)} clients")
                    yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': datetime.now().isoformat()})}\n\n"
                    last_heartbeat = time_module.time()
                        
        except asyncio.CancelledError:
            # Client disconnected
            print(f"🔌 [SSE] Client disconnected")
        finally:
            # Remove client from the list
            async with _sse_lock:
                if queue in _sse_clients:
                    _sse_clients.remove(queue)
                    remaining = len(_sse_clients)
                    print(f"🔌 [SSE] Client removed. Remaining clients: {remaining}")
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.post("/api/earnings/refresh")
async def force_refresh_earnings():
    """Force refresh earnings data immediately (bypass cache interval)"""
    global _earnings_db, _last_update_str, _previous_earnings_db
    try:
        print(f"🔄 [Manual Refresh] Forcing earnings update at {datetime.now()}")
        
        # ✅ ปรับปรุง Logic การดึงรายชื่อหุ้นที่มี DR ตามค่า ENABLE_DR_FILTER
        valid_dr_tickers = None
        ticker_mapping = {}  # Mapping table: {ticker_from_tv: underlying_code}
        dr_rows = []  # Store DR rows for DR metrics calculation
        if ENABLE_DR_FILTER:
            valid_dr_tickers = set()
            skipped_count = 0
            skipped_reasons = {}
            skipped_items = []
            try:
                async with httpx.AsyncClient() as client:
                    r_dr = await client.get(DR_LIST_URL, timeout=10)
                    dr_rows = r_dr.json().get("rows", [])
                    print(f"  📊 [Manual Refresh] Total DR rows from API: {len(dr_rows)}")
                    for item in dr_rows:
                        u_code = None
                        source = None
                        
                        underlying_name = item.get("underlyingName") or ""
                        match = re.search(r'\(([A-Z0-9.\-_]+)\)$', underlying_name)
                        if match:
                            u_code = match.group(1)
                            source = "underlyingName"
                        else:
                            u_code = item.get("underlying")
                            if u_code:
                                source = "underlying"
                            else:
                                sym = item.get("symbol") or ""
                                if "80" in sym: 
                                    u_code = sym.replace("80", "")
                                    source = "symbol(80)"
                                elif "19" in sym: 
                                    u_code = sym.replace("19", "")
                                    source = "symbol(19)"
                        
                        if u_code:
                            u_code = u_code.strip().upper()
                            if u_code and len(u_code) > 0:
                                if ' ' in u_code:
                                    name_match_alt = re.search(r'\(([A-Z0-9.\-_]+)\)', underlying_name.upper())
                                    if name_match_alt:
                                        alt_ticker = name_match_alt.group(1).strip()
                                        if alt_ticker and ' ' not in alt_ticker and len(alt_ticker) <= 15:
                                            u_code = alt_ticker
                                            source = "underlyingName(alt)"
                                        else:
                                            u_code_clean = re.sub(r'\s+(ETF|DIAMOND ETF|FUND|TRUST).*$', '', u_code, flags=re.IGNORECASE).strip()
                                            if u_code_clean and ' ' not in u_code_clean and len(u_code_clean) <= 15:
                                                u_code = u_code_clean
                                                source = "underlying(clean)"
                                            else:
                                                sym = item.get("symbol") or ""
                                                if sym:
                                                    sym_clean = re.sub(r'\d+$', '', sym).strip()
                                                    if sym_clean and len(sym_clean) >= 2 and len(sym_clean) <= 15:
                                                        u_code = sym_clean.upper()
                                                        source = "symbol(clean)"
                                                    else:
                                                        skipped_count += 1
                                                        skipped_reasons['has_space'] = skipped_reasons.get('has_space', 0) + 1
                                                        skipped_items.append({
                                                            'symbol': item.get('symbol', 'N/A'),
                                                            'underlyingName': underlying_name[:50],
                                                            'u_code': u_code,
                                                            'reason': 'has_space'
                                                        })
                                                        continue
                                                else:
                                                    skipped_count += 1
                                                    skipped_reasons['has_space'] = skipped_reasons.get('has_space', 0) + 1
                                                    skipped_items.append({
                                                        'symbol': item.get('symbol', 'N/A'),
                                                        'underlyingName': underlying_name[:50],
                                                        'u_code': u_code,
                                                        'reason': 'has_space'
                                                    })
                                                    continue
                                    else:
                                        u_code_clean = re.sub(r'\s+(ETF|DIAMOND ETF|FUND|TRUST).*$', '', u_code, flags=re.IGNORECASE).strip()
                                        if u_code_clean and ' ' not in u_code_clean and len(u_code_clean) <= 15:
                                            u_code = u_code_clean
                                            source = "underlying(clean)"
                                        else:
                                            sym = item.get("symbol") or ""
                                            if sym:
                                                sym_clean = re.sub(r'\d+$', '', sym).strip()
                                                if sym_clean and len(sym_clean) >= 2 and len(sym_clean) <= 15:
                                                    u_code = sym_clean.upper()
                                                    source = "symbol(clean)"
                                                else:
                                                    skipped_count += 1
                                                    skipped_reasons['has_space'] = skipped_reasons.get('has_space', 0) + 1
                                                    skipped_items.append({
                                                        'symbol': item.get('symbol', 'N/A'),
                                                        'underlyingName': underlying_name[:50],
                                                        'u_code': u_code,
                                                        'reason': 'has_space'
                                                    })
                                                    continue
                                            else:
                                                skipped_count += 1
                                                skipped_reasons['has_space'] = skipped_reasons.get('has_space', 0) + 1
                                                skipped_items.append({
                                                    'symbol': item.get('symbol', 'N/A'),
                                                    'underlyingName': underlying_name[:50],
                                                    'u_code': u_code,
                                                    'reason': 'has_space'
                                                })
                                                continue
                                if len(u_code) > 15:
                                    skipped_count += 1
                                    skipped_reasons['too_long'] = skipped_reasons.get('too_long', 0) + 1
                                    skipped_items.append({
                                        'symbol': item.get('symbol', 'N/A'),
                                        'underlyingName': underlying_name[:50],
                                        'u_code': u_code,
                                        'reason': 'too_long'
                                    })
                                    continue
                                valid_dr_tickers.add(u_code)
                                ticker_mapping[u_code] = u_code
                                
                                sym_clean = item.get("symbol", "").strip().upper()
                                if sym_clean and sym_clean != u_code:
                                    sym_no_suffix = sym_clean.replace("80", "").replace("19", "").strip()
                                    if sym_no_suffix and sym_no_suffix != u_code and len(sym_no_suffix) <= 15 and ' ' not in sym_no_suffix:
                                        ticker_mapping[sym_no_suffix] = u_code
                                
                                if underlying_name:
                                    name_match = re.search(r'\(([A-Z0-9.\-_]+)\)', underlying_name.upper())
                                    if name_match:
                                        name_ticker = name_match.group(1).strip()
                                        if name_ticker and name_ticker != u_code and len(name_ticker) <= 15 and ' ' not in name_ticker:
                                            ticker_mapping[name_ticker] = u_code
                    
                    if skipped_count > 0:
                        print(f"  ⚠️ Skipped {skipped_count} items: {skipped_reasons}")
                    print(f"📊 [Manual Refresh] DR Filter is ENABLED. Found {len(valid_dr_tickers)} unique symbols.")
            except Exception as dr_err:
                print(f"❌ [Manual Refresh] Failed to fetch DR whitelist: {dr_err}")
                valid_dr_tickers = None 
        else:
            print(f"🔓 [Manual Refresh] DR Filter is DISABLED. Fetching all stocks.")

        new_db = {}
        all_markets = ["america", "hongkong", "japan", "china", "singapore", "vietnam", "france", "netherlands", "denmark", "italy", "taiwan", "thailand"]
        
        for m in all_markets:
            c_code = "JP" if m == "japan" else "US"
            s_ts, e_ts = get_tradingview_range(c_code)
            print(f"📅 [Manual Refresh] [{m}] Date range: {datetime.fromtimestamp(s_ts, tz=timezone.utc)} to {datetime.fromtimestamp(e_ts, tz=timezone.utc)}")
            
            raw_data = await fetch_tradingview_earnings(m, s_ts, e_ts)
            print(f"📊 [Manual Refresh] [{m}] Received {len(raw_data)} raw items from TradingView")
            
            stock_list = map_tv_data_to_object(raw_data, valid_dr_tickers, ticker_mapping, dr_rows)
            print(f"✅ [Manual Refresh] [{m}] Mapped to {len(stock_list)} stocks")
            
            stock_list.sort(key=lambda x: x["date"] if x["date"] else float('inf'))
            
            display_name = MARKET_DISPLAY_NAMES.get(m, m.upper())
            if stock_list:
                new_db[display_name] = {"totalCount": len(stock_list), "data": stock_list}
            await asyncio.sleep(0.5)

        # Detect new earnings before updating
        new_earnings = find_new_earnings(new_db, _previous_earnings_db)
        
        # Update earnings database
        _earnings_db = new_db
        _last_update_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        save_db_to_disk()
        
        # Broadcast new earnings to SSE clients
        if new_earnings:
            print(f"📢 [Manual Refresh] Found {len(new_earnings)} new earnings, broadcasting to SSE clients")
            await broadcast_to_sse_clients({
                "type": "new_earnings",
                "earnings": new_earnings,
                "count": len(new_earnings),
                "updated_at": _last_update_str
            })
        
        # Update previous earnings state for next comparison
        _previous_earnings_db = new_db.copy()
        
        return {
            "success": True,
            "message": "Earnings data refreshed successfully",
            "updated_at": _last_update_str,
            "markets": list(new_db.keys()),
            "total_earnings": sum(m.get("totalCount", 0) for m in new_db.values()),
            "new_earnings_count": len(new_earnings)
        }
    except Exception as e:
        print(f"❌ [Manual Refresh] Error: {e}")
        return {"success": False, "error": str(e)}

@app.get("/api/test")
async def get_earnings(country: str = Query("US")):
    return {'d': 1234}

if __name__ == "__main__":
    uvicorn.run("earnings_api:app", host="0.0.0.0", port=3001, reload=True)
