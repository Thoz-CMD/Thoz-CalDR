import { useEffect, useMemo, useState, useRef } from "react";

// const API_BASE = "http://172.17.1.85:8333";
const API_BASE = import.meta.env.VITE_DR_LIST_BASE_API; // DR snapshot (use same as DRList)
const CALC_API_BASE = import.meta.env.VITE_CAL_API; // DR real-time calc

const EXCHANGE_CURRENCY_MAP = {
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
};


// Helper functions for table formatting
const formatNum = (n) => {
  const num = Number(n);
  if (!isFinite(num)) return "0.00";
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatInt = (n) => {
  const num = Number(n);
  if (!isFinite(num)) return "0";
  return Math.round(num).toLocaleString();
};

const formatInputNum = (n, d = 2) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return "";
  return num.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};


const formatRatio = (raw) => {
  if (!raw) return "0:1";
  const s = String(raw);
  const parts = s.split(":");
  const leftRaw = parts[0] ? parts[0].replace(/[^\d.-]/g, "") : "0";
  const right = parts[1] ? parts[1].trim() : "1";
  const leftNum = Number(leftRaw) || 0;
  return `${Math.round(leftNum).toLocaleString()}:${right}`;
};

const extractSymbol = (str) => {
  if (!str) return "-";
  const match = String(str).match(/\(([^)]+)\)$/);
  return match ? match[1] : str;
};

const fxDecimalsByCcy = (ccy) => {
  if (!ccy) return 2;
  const u = String(ccy).toUpperCase();
  if (u === "JPY" || u === "CNY" || u === "TWD" || u === "SGD" || u === "DKK") return 4;
  if (u === "VND") return 6;
  return 2; // USD/HKD/EUR ปกติ
};

const roundToTick = (p) => {
  const tick = 0.01; // SET DR ส่วนใหญ่ใช้ 0.01
  return Math.round(Number(p) / tick) * tick;
};


export default function DRCal() {
  // ================== state สำหรับ DR & การค้นหา ==================
  const [allDR, setAllDR] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [selectedDR, setSelectedDR] = useState(null);

  const [showSuggest, setShowSuggest] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });

// ================== state สำหรับการคำนวณ ==================
const [underlyingValue, setUnderlyingValue] = useState(null);              // ✅ ใช้แสดงผล (ปัดแล้ว)
const [underlyingValueRaw, setUnderlyingValueRaw] = useState(null);        // ✅ ค่าดิบจาก backend (ไว้คำนวณ)
const [fxTHBPerUnderlying, setFxTHBPerUnderlying] = useState(null);
const [underlyingCurrency, setUnderlyingCurrency] = useState("USD");

const [loadingRealtime, setLoadingRealtime] = useState(false);
const [defaultDR, setDefaultDR] = useState(null);

const fetchRealtimeUnderlying = async (drSymbol) => {
  try {
    setLoadingRealtime(true);

const res = await fetch(
  `${CALC_API_BASE}/api/calc/dr/${encodeURIComponent(drSymbol)}`
);
    if (!res.ok) throw new Error("Failed realtime calc");

    const data = await res.json();

    const ccy = String(data.currency ?? "USD");
    setUnderlyingCurrency(ccy);

    // ✅ 1) รับค่าดิบก่อน (ถ้า backend ส่ง underlying_price_raw มา)
    const undRaw =
      data.underlying_price_raw != null
        ? Number(data.underlying_price_raw)
        : (data.underlying_price != null ? Number(data.underlying_price) : null);

    setUnderlyingValueRaw(undRaw);
    setUnderlyingValue(undRaw != null ? Math.round((undRaw + 1e-10) * 100) / 100 : null);

    // ✅ 2) ปัด 2 ตำแหน่งเพื่อแสดงผลในหน้าเว็บ
    const undRounded =
      Number.isFinite(undRaw) ? Math.round(undRaw * 100) / 100 : null;

    setUnderlyingValue(undRounded);

    setFxTHBPerUnderlying(
      data.fx_rate != null ? Number(data.fx_rate) : null
    );
  } catch (err) {
    console.error("Realtime calc error:", err);
  } finally {
    setLoadingRealtime(false);
  }
};

  const tableRef = useRef(null);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  const searchInputRef = useRef(null);

  // ================== ดึง DR ทั้งหมด ==================
  useEffect(() => {
    async function fetchDR() {
      try {
        const res = await fetch(
          // `${API_BASE}/dr?fields=` +
          `${API_BASE}/caldr?fields=`+
          [
            "symbol",
            "name",
            "conversionRatio",
            "conversionRatioR",
            "last",
            "change",
            "percentChange",
            "underlyingExchange",
            "open",
            "high",
            "low",
            "bidPrice",
            "offerPrice",
            "totalVolume",
            "totalValue",
            "tradingSession",
            "underlying",
            "underlyingName",
            "issuer",
            "issuerName",
            "marketCap",
            "ytdChange",
            "ytdPercentChange",
            "dividendYield12M",
            "underlyingClassName",
            "outstandingShare",
          ].join(",")
        );
        if (!res.ok) throw new Error("Error fetching DR");

        const data = await res.json();
        setAllDR(data.rows || []);
        
        if (data.updated_at) {
          const date = new Date(data.updated_at * 1000);
          if (!isNaN(date.getTime())) {
            setUpdatedAt(date);
          }
        }

        if (data.rows.length > 0) {
          setAllDR(data.rows || []);

          const first = data.rows[0];
          setDefaultDR(first);              // ✅ เก็บ default
          setSelectedDR(first);
          setSearchText(first.symbol);

          fetchRealtimeUnderlying(first.symbol); // ✅ ดึง realtime
        }
      } catch (err) {
        console.error(err);
      }
    }
    fetchDR();
  }, []);

  // ================== format numbers ==================
  const fmtNum = (n, d = 2) =>
    new Intl.NumberFormat("th-TH", {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    }).format(Number(n || 0));

  const fmtTHB = (n) =>
    new Intl.NumberFormat("th-TH", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(Number(n || 0));

  const fmtPct = (n) =>
    `${new Intl.NumberFormat("th-TH", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(Number(n || 0))}%`;

  /*const underlyingCurrency = useMemo(() => {
    if (!selectedDR) return "";
    return EXCHANGE_CURRENCY_MAP[selectedDR.underlyingExchange] || "";
  }, [selectedDR]);*/

  // ================== ratio ==================
// ================== ratio ==================
const ratioDR = useMemo(() => {
  if (!selectedDR) return 0;

  if (selectedDR?.conversionRatio) {
    const left = String(selectedDR.conversionRatio).split(":")[0];
    const n = Number(left.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  if (selectedDR?.conversionRatioR) {
    const r = Number(selectedDR.conversionRatioR);
    return r > 0 ? (1 / r) : 0;
  }

  return 0;
}, [selectedDR]);

// ================== dynamic spread ==================
const dynamicSpreadPct = useMemo(() => {
  if (!selectedDR) return 0.002;

  const bid = Number(selectedDR.bidPrice || 0);
  const ask = Number(selectedDR.offerPrice || 0);

  let spread = null;

  if (bid > 0 && ask > 0 && ask > bid) {
    const mid = (bid + ask) / 2;
    if (mid > 0) spread = (ask - bid) / mid;
  }

  if (spread == null) {
    const value = Number(selectedDR.totalValue || 0);
    spread =
      value >= 50_000_000 ? 0.001 :
      value >= 10_000_000 ? 0.002 :
      value >= 2_000_000  ? 0.004 :
                           0.008;
  }

  return clamp(spread, 0.001, 0.02);
}, [selectedDR]);



  // ================== fair value ==================
  const fairMidTHB = useMemo(() => {
    const und = Number(underlyingValueRaw ?? underlyingValue ?? 0);
    const fx = Number(fxTHBPerUnderlying || 0);
    if (!und || !fx || !ratioDR) return 0;
    return (und * fx) / ratioDR;
  }, [underlyingValue, fxTHBPerUnderlying, ratioDR]);

  const fairBidTHB = useMemo(
    () => roundToTick(fairMidTHB * (1 - dynamicSpreadPct / 2)),
    [fairMidTHB, dynamicSpreadPct]
  );

  const fairAskTHB = useMemo(
    () => roundToTick(fairMidTHB * (1 + dynamicSpreadPct / 2)),
    [fairMidTHB, dynamicSpreadPct]
  );
  
  const hasInput = Number(underlyingValue) > 0 && Number(fxTHBPerUnderlying) > 0 && ratioDR > 0;

  // ================== Suggest ==================
  const filteredSuggest = useMemo(() => {
    const q = searchText.trim().toUpperCase();
    if (!q) return [];

    return allDR
      .filter((dr) => {
        const sym = (dr.symbol || "").toUpperCase();                 // DR
        const nm = (dr.name || "").toUpperCase();                    // ชื่อ DR
        const und = (dr.underlying || "").toUpperCase();             // underlying (บางทีเป็นชื่อสั้น)
        const undName = (dr.underlyingName || "").toUpperCase();     // ชื่อบริษัท/ชื่อกองทุนเต็ม
        const issuer = (dr.issuer || "").toUpperCase();              // ผู้ออก (KTB/FSS)
        const issuerName = (dr.issuerName || "").toUpperCase();      // ชื่อผู้ออก

        // ✅ เพิ่มค้นหา “ชื่อบริษัท” ได้จาก underlyingName
        return (
          sym.includes(q) ||
          nm.includes(q) ||
          und.includes(q) ||
          undName.includes(q) ||
          issuer.includes(q) ||
          issuerName.includes(q)
        );
      })
      .slice(0, 8);
  }, [searchText, allDR]);

  const applyDR = (dr) => {
    setSelectedDR(dr);
    setSearchText(dr.symbol);
    setShowSuggest(false);
    setHighlightIndex(-1);

    // fallback ระหว่างรอ realtime
    setUnderlyingCurrency(EXCHANGE_CURRENCY_MAP[dr.underlyingExchange] || "USD");

    // ยิง realtime ครั้งเดียวพอ
    fetchRealtimeUnderlying(dr.symbol);
  };

  const handleSearchChange = (e) => {
    setSearchText(e.target.value.toUpperCase());
    setShowSuggest(true);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filteredSuggest.length && highlightIndex >= 0) {
        applyDR(filteredSuggest[highlightIndex]);
        return;
      }
      if (filteredSuggest.length) {
        applyDR(filteredSuggest[0]);
        return;
      }
      const match = allDR.find((dr) => dr.symbol?.toUpperCase() === searchText.trim().toUpperCase());
      if (match) applyDR(match);
      return;
    }
    if (!filteredSuggest.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i < filteredSuggest.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i > 0 ? i - 1 : filteredSuggest.length - 1));
    }
  };

  const onReset = () => {
    if (!defaultDR) return;

    setSelectedDR(defaultDR);
    setSearchText(defaultDR.symbol);
    setShowSuggest(false);
    setHighlightIndex(-1);

    setUnderlyingCurrency(
      EXCHANGE_CURRENCY_MAP[defaultDR.underlyingExchange] || "USD"
    );

    // ดึง realtime ใหม่ของ default
    fetchRealtimeUnderlying(defaultDR.symbol);
  };

  const SortIndicator = ({ colKey }) => {
    const active = sortConfig.key === colKey;
    const direction = sortConfig.direction;
    const upColor = active && direction === "asc" ? "#FFFFFF" : "rgba(255, 255, 255, 0.4)";
    const downColor = active && direction === "desc" ? "#FFFFFF" : "rgba(255, 255, 255, 0.4)";

    return (
      <div className="flex items-center ml-0 flex-shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="w-[12px] h-[12px] transition-all duration-200">
          <path d="M14 2.256V30c-2.209 0-4-1.791-4-4V13H4.714c-.633 0-.949-.765-.502-1.212l9.607-9.607C13.886 2.114 14 2.162 14 2.256z" fill={upColor} />
          <path d="M27.788 20.212l-9.6 9.6C18.118 29.882 18 29.832 18 29.734V2c2.209 0 4 1.791 4 4v13h5.286C27.918 19 28.235 19.765 27.788 20.212z" fill={downColor} />
        </svg>
      </div>
    );
  };

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        if (prev.direction === "asc") return { key, direction: "desc" };
        return { key: null, direction: "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  const filteredTableData = useMemo(() => {
    if (!selectedDR) return [];
    const selectedUnderlying = extractSymbol(selectedDR.underlying || selectedDR.underlyingName || "");
    if (!selectedUnderlying || selectedUnderlying === "-") return [];

    let sameUnderlyingList = allDR.filter((dr) => {
      const drUnderlying = extractSymbol(dr.underlying || dr.underlyingName || "");
      return drUnderlying === selectedUnderlying;
    });

    const mappedData = sameUnderlyingList.map((x) => ({
      dr: x.symbol ?? "-",
      open: x.open ?? 0,
      high: x.high ?? 0,
      low: x.low ?? 0,
      last: x.last ?? 0,
      pct: x.percentChange ?? 0,
      bid: x.bidPrice ?? 0,
      offer: x.offerPrice ?? 0,
      vol: x.totalVolume ?? 0,
      value: (x.totalValue ?? 0) / 1000,
      marketCap: x.marketCap ?? 0,
      underlying: extractSymbol(x.underlying || x.underlyingName),
      divYield: x.dividendYield12M ?? 0,
      exchange: x.underlyingExchange ?? "",
      outstandingShare: x.outstandingShare ?? 0,
      ratio: formatRatio(x.conversionRatio),
    }));

    if (sortConfig.key) {
      mappedData.sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];
        const dir = sortConfig.direction === "asc" ? 1 : -1;
        if (typeof valA === "string") return valA.localeCompare(valB) * dir;
        return (valA - valB) * dir;
      });
    } else {
      mappedData.sort((a, b) => {
        if (a.dr === selectedDR.symbol) return -1;
        if (b.dr === selectedDR.symbol) return 1;
        return a.dr.localeCompare(b.dr);
      });
    }

    return mappedData;
  }, [selectedDR, allDR, sortConfig]);

  const changeAbs = Number(selectedDR?.change || 0);
  const changePct = Number(selectedDR?.percentChange || 0);

  const renderComparisonTable = () => {
    if (filteredTableData.length === 0) return null;

    return (
      <div ref={tableRef} className="w-full mt-3 md:mt-2 bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.05)] border border-gray-100 overflow-hidden font-['Sarabun'] overflow-x-auto md:overflow-x-visible">
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] sm:text-xs md:text-sm lg:text-sm text-left border-separate border-spacing-0">
            <thead className="bg-[#0B102A] text-white font-bold sticky top-0">
              <tr>
                <th rowSpan={2} className="py-3 md:py-4 px-2 sm:px-3 text-left sticky bg-[#0B102A] align-middle cursor-pointer relative"
                  style={{ left: "0px", width: "120px", minWidth: "120px", zIndex: 30 }}
                  onClick={() => handleSort("dr")}>
                  <div className={`flex items-center gap-0.5 text-[10px] sm:text-xs`}>DR <SortIndicator colKey="dr" /></div>
                  {sortConfig.key === "dr" && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2F80ED] z-50">
                      <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-[#2F80ED]"></div>
                    </div>
                  )}
                </th>
                <th colSpan={9} className="py-2 md:py-3 text-center text-[10px] sm:text-xs bg-[#020323]">Trading information</th>
                <th colSpan={6} className="py-2 md:py-3 text-center text-[10px] sm:text-xs bg-[#020323] border-l border-gray-700">Basic DR information</th>
              </tr>
              <tr>
                {[
                  { key: "open", label: "Open", align: "right" },
                  { key: "high", label: "High", align: "right" },
                  { key: "low", label: "Low", align: "right" },
                  { key: "last", label: "Last", align: "right" },
                  { key: "pct", label: "%Chg", align: "right" },
                  { key: "bid", label: "Bid", align: "right" },
                  { key: "offer", label: "Ask", align: "right" },
                  { key: "vol", label: "Vol", align: "right" },
                  { key: "value", label: "Value('000)", align: "right" },
                  { key: "marketCap", label: "MCap (M)", align: "right", border: true },
                  { key: "underlying", label: "UDL", align: "left" },
                  { key: "ratio", label: "Ratio", align: "right" },
                  { key: "divYield", label: "Div%", align: "right" },
                  { key: "exchange", label: "Exchange", align: "left" },
                  { key: "outstandingShare", label: "Out Share", align: "right" },
                ].map((item) => (
                  <th key={item.key}
                    className={`py-2 md:py-3 px-2 sm:px-3 text-${item.align} text-[10px] sm:text-xs bg-[#1C1D39] border-b border-gray-700 whitespace-nowrap cursor-pointer relative ${item.border ? 'border-l border-gray-700' : ''}`}
                    onClick={() => handleSort(item.key)}>
                    <div className={`flex items-center ${item.align === "right" ? "justify-end" : "justify-start"} gap-0.5`}>
                      {item.label} <SortIndicator colKey={item.key} />
                    </div>
                    {sortConfig.key === item.key && (
                      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2F80ED] z-50">
                        <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-[#2F80ED]"></div>
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredTableData.map((row, index) => {
                const isSelected = row.dr === selectedDR?.symbol;
                let stickyBgClass = isSelected ? "#eff6ff" : (index % 2 === 0 ? "#ffffff" : "#F9FAFB");
                const textBaseColor = isSelected ? "text-[#1e3a8a] font-semibold" : "text-gray-600";

                return (
                  <tr key={row.dr} className={`transition-colors duration-200 text-[10px] sm:text-xs md:text-sm ${isSelected ? "bg-[#eff6ff] border-l-4 border-[#2F80ED] shadow-sm relative z-10" : (index % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]") + " hover:bg-gray-50 border-l-4 border-transparent"}`} style={{ height: "auto", minHeight: "48px" }}>
                    <td className="py-2 md:py-4 px-2 sm:px-3 text-left font-bold text-[#2F80ED] sticky left-0 z-20" style={{ backgroundColor: stickyBgClass }}>
                      <div className="flex items-center gap-1">
                        {isSelected && <div className="w-1 md:w-1.5 h-1 md:h-1.5 rounded-full bg-[#2F80ED]"></div>}
                        <span className="text-[10px] sm:text-xs md:text-sm">{row.dr}</span>
                      </div>
                    </td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-[9px] sm:text-[10px] md:text-xs font-medium font-mono ${textBaseColor}`}>{formatNum(row.open)}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-[9px] sm:text-[10px] md:text-xs font-medium font-mono ${textBaseColor}`}>{formatNum(row.high)}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-[9px] sm:text-[10px] md:text-xs font-medium font-mono ${textBaseColor}`}>{formatNum(row.low)}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-[9px] sm:text-[10px] md:text-xs font-medium font-mono ${textBaseColor}`}>{formatNum(row.last)}</td>
                    <td className="py-2 md:py-4 px-2 sm:px-3 text-right font-medium text-[9px] sm:text-[10px] md:text-xs font-mono" style={{ color: row.pct > 0 ? "#27AE60" : row.pct < 0 ? "#EB5757" : "#111827" }}>
                      {row.pct === 0 ? "-" : row.pct > 0 ? `+${formatNum(row.pct)}` : formatNum(row.pct)}
                    </td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-gray-600 text-[9px] sm:text-[10px] md:text-xs font-medium font-mono`}>{formatNum(row.bid)}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-gray-600 text-[9px] sm:text-[10px] md:text-xs font-medium font-mono`}>{formatNum(row.offer)}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-gray-600 text-[9px] sm:text-[10px] md:text-xs font-medium font-mono`}>{formatInt(row.vol)}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-gray-600 text-[9px] sm:text-[10px] md:text-xs font-medium font-mono`}>{formatNum(row.value)}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-gray-600 text-[9px] sm:text-[10px] md:text-xs font-medium font-mono border-l border-gray-200`}>{row.marketCap ? formatNum(row.marketCap / 1000000) : "-"}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-left font-bold text-[#2F80ED] text-[10px] sm:text-xs md:text-sm`}>{row.underlying || "-"}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-gray-600 text-[9px] sm:text-[10px] md:text-xs font-medium`}>{row.ratio}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-gray-600 text-[9px] sm:text-[10px] md:text-xs font-medium font-mono`}>{row.divYield ? formatNum(row.divYield) : "-"}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-left text-gray-600 text-[9px] sm:text-[10px] md:text-xs font-medium max-w-[120px] md:max-w-[200px] truncate`} title={row.exchange}>{row.exchange || "-"}</td>
                    <td className={`py-2 md:py-4 px-2 sm:px-3 text-right text-gray-600 text-[9px] sm:text-[10px] md:text-xs font-medium font-mono`}>{row.outstandingShare ? formatInt(row.outstandingShare) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full bg-[#f5f5f5] flex flex-col items-center pb-6 lg:pb-10">
      <div className="w-full max-w-full px-3 sm:px-4 md:px-6 lg:px-0 lg:max-w-[1040px] mx-auto">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2 sm:mb-3 text-black mt-6 lg:mt-10">Calculation DR</h1>
        <p className="text-xs sm:text-sm lg:text-base text-[#6B6B6B] mb-4 sm:mb-6 lg:mb-8 break-words">
          Calculate DR Fair Value based on Underlying Price, Exchange Rate, and Conversion Ratio.
        </p>

      <div className="w-full min-h-auto lg:min-h-[627px] mt-2 font-sarabun">
        <div className="flex flex-col lg:flex-row w-full gap-3 sm:gap-4 lg:gap-0">
          <div className="flex-1 min-h-auto md:min-h-[427px] bg-[#FFFFFF] rounded-t-[12px] md:rounded-tl-[12px] md:rounded-tr-none md:rounded-bl-[12px] md:rounded-br-none shadow-[0_10px_25px_rgba(0,0,0,0.12)] px-4 sm:px-6 pt-6 md:pt-10 pb-6 md:pb-0 border border-[#e0e0e0]">
            <h2 className="font-semibold text-lg sm:text-xl md:text-[26px] text-black mb-3 md:mb-[14px]">Select DR</h2>
            <div className="relative w-full h-[42px] sm:h-[46px] md:h-[48px]">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Select DR"
                value={searchText}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                onClick={(e) => { e.target.select(); setShowSuggest(true); }}
                className="w-full h-full bg-white border border-[#d0d0d0] rounded-[12px] pl-3 sm:pl-4 pr-10 sm:pr-12 text-xs sm:text-sm text-black shadow-lg focus:outline-none"
              />
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 h-5 sm:h-6 w-5 sm:w-6 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {showSuggest && filteredSuggest.length > 0 && (
                <div className="absolute z-40 mt-1 max-h-48 sm:max-h-64 w-full overflow-y-auto rounded-2xl border border-[#e0e0e0] bg-white shadow-xl">
                  {filteredSuggest.map((dr, idx) => (
                    <button
                      key={dr.symbol}
                      type="button"
                      onMouseDown={() => applyDR(dr)}
                      className={`flex w-full justify-between px-3 sm:px-4 py-2 text-left text-xs sm:text-sm ${idx === highlightIndex ? "bg-gray-100" : "hover:bg-gray-50"}`}
                    >
                      <span className="font-semibold text-black">{dr.symbol}</span>
                      <span className="text-[10px] sm:text-xs text-gray-500 truncate w-20 sm:w-40 text-right">
                        {(dr.underlyingName || dr.name)
                          ?.replace(/^โครงการจัดการลงทุนต่างประเทศ\s*/g, "")
                          ?.replace(/^บริษัทหลักทรัพย์\s*/g, "")
                          ?.replace(/^บริษัท\s*/g, "")
                          ?.replace(/\s*บริษัท$/g, "")
                          ?.trim()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 lg:mt-6">
              <h3 className="text-[#0046b8] font-extrabold text-xl sm:text-2xl lg:text-3xl leading-snug break-words">{selectedDR?.symbol || "—"}</h3>
              <p className="font-medium text-[9px] sm:text-[10px] text-[#555] mt-1 line-clamp-2 break-words">
                {selectedDR ? `Depositary Receipt on ${selectedDR.underlying || selectedDR.underlyingName} Issued by ${selectedDR.issuer}` : "—"}
              </p>
              <div className="w-full min-h-auto lg:h-[175px] bg-white border border-[#e0e0e0] rounded-[12px] shadow-lg mt-4 p-3 sm:p-4 relative">
                <p className="font-bold text-[11px] sm:text-[12px] lg:text-[13px] text-[#6B6B6B] break-words">Ratio (DR : Underlying)</p>
                <p className="font-bold text-lg sm:text-xl lg:text-2xl text-[#111] mt-1">{ratioDR ? `${fmtNum(ratioDR, 0)} : 1` : "—"} </p>
                <div className="w-full h-[1px] bg-[#9A9A9A] mt-2"></div>
                <div className="flex flex-col lg:flex-row items-center mt-3 gap-3 lg:gap-0">
                  <div className="w-full lg:w-1/2">
                    <p className="font-bold text-[11px] sm:text-[12px] lg:text-[13px] text-[#6B6B6B] mt-1 break-words">Last Price</p>
                    <p className="font-bold text-lg sm:text-xl lg:text-2xl mt-1">{selectedDR?.last ? fmtNum(selectedDR.last) : "—"}</p>
                  </div>
                  <div className="hidden lg:block absolute left-1/2 -translate-x-1/2 w-[1px] h-[56px] bg-[#9A9A9A]"></div>
                  <div className="w-full lg:w-1/2 lg:pl-6">
                    <p className="font-bold text-[11px] sm:text-[12px] lg:text-[13px] text-[#6B6B6B] mt-1 break-words">Change</p>
                    <p className={`font-bold text-lg sm:text-xl lg:text-2xl mt-1 ${changeAbs > 0 ? "text-[#27AE60]" : changeAbs < 0 ? "text-[#EB5757]" : "text-black"}`}>
                      {`${fmtNum(changeAbs)} (${fmtPct(changePct)})`}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 bg-[#0B102A] rounded-b-[16px] lg:rounded-b-none lg:rounded-tr-[16px] lg:rounded-br-[16px] shadow-lg p-4 sm:p-5 lg:p-6">
            <div className="w-full min-h-auto lg:h-[253px] bg-white/20 border border-[#9A9A9A] rounded-[12px] shadow-lg p-3 sm:p-6 flex flex-col">
              <div className="mb-3 sm:mb-4">
                <p className="font-bold text-[11px] sm:text-[13px] text-white mb-1">Underlying Price</p>
                <div className="w-full h-[40px] sm:h-[46px] bg-white/20 border border-[#9A9A9A] rounded-[12px] flex items-center hover:border-[#4AB6FF] transition-colors duration-150">
                  <input
                    type="text"
                    autoComplete="off"
                    value={formatInputNum(underlyingValue, 2)}
                    readOnly
                    disabled={loadingRealtime}
                    style={{ WebkitTextFillColor: "white" }}
                    className={`flex-1 h-full bg-transparent text-xs sm:text-sm text-white placeholder-[#9A9A9A] px-3 sm:px-4 focus:outline-none ${loadingRealtime ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                  <div className="w-[1px] h-[25px] sm:h-[30px] bg-[#9A9A9A]"></div>
                  <div className="w-[80px] sm:w-[100px] flex justify-center text-white font-bold text-[11px] sm:text-[13px]">
                    {underlyingCurrency || "USD"}
                  </div>
                </div>
              </div>

              <div className="mb-3 sm:mb-4">
                <p className="font-bold text-[11px] sm:text-[13px] text-white mb-1">Exchange Rate</p>
                <div className="w-full h-[40px] sm:h-[46px] bg-white/20 border border-[#9A9A9A] rounded-[12px] flex items-center hover:border-[#4AB6FF] transition-colors duration-150">
                  <input
                    type="text"
                    autoComplete="off"
                    value={formatInputNum(fxTHBPerUnderlying, fxDecimalsByCcy(underlyingCurrency))}
                    readOnly
                    disabled={loadingRealtime}
                    style={{ WebkitTextFillColor: "white" }}
                    className={`flex-1 h-full bg-transparent text-xs sm:text-sm text-white placeholder-[#9A9A9A] px-3 sm:px-4 focus:outline-none ${loadingRealtime ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                  <div className="w-[1px] h-[25px] sm:h-[30px] bg-[#9A9A9A]"></div>
                  <div className="w-[80px] sm:w-[100px] flex justify-center text-white font-bold text-[11px] sm:text-[13px]">{"THB/" + (underlyingCurrency || "USD")}</div>
                </div>
              </div>

              {loadingRealtime && (
                <span className="text-[10px] sm:text-xs text-blue-300 ml-2 mb-2">
                  Calculating fair value…
                </span>
              )}

              <div className="flex justify-center gap-2 mt-3 sm:mt-4 w-full">
                <button
                  onClick={onReset}
                  className="w-[120px] sm:w-[139px] h-[36px] sm:h-[38px] bg-white rounded-[8px] flex justify-center items-center gap-2 text-black font-bold text-[11px] sm:text-[12px] hover:bg-gray-200 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="mt-4 sm:mt-6 px-2 sm:px-4">
              <h3 className="text-white font-bold text-base sm:text-[20px] mb-3 sm:mb-4">Calculation Result</h3>
              <div className="flex justify-between items-center mb-2 px-3 sm:px-4">
                <span className="text-white font-bold text-sm sm:text-[16px]">Fair Bid</span>
                <span className="text-white font-bold text-base sm:text-[18px]">{hasInput ? `${fmtTHB(fairBidTHB)} THB` : "-  THB"}</span>
              </div>
              <div className="flex justify-between items-center px-3 sm:px-4 mb-4">
                <span className="text-white font-bold text-sm sm:text-[16px]">Fair Ask</span>
                <span className="text-white font-bold text-base sm:text-[18px]">{hasInput ? `${fmtTHB(fairAskTHB)} THB` : "-  THB"}</span>
              </div>
            </div>

            {/* Warning Box */}
            <div className="mt-0 px-0">
              <div className="w-full bg-red-500/20 backdrop-blur-sm border border-red-500 rounded-[12px] p-3 sm:p-4">
                <p className="text-red-400 text-[11px] sm:text-[12px] leading-relaxed">
                  <span className="font-extrabold">หมายเหตุ:</span> ระบบแสดงราคา Fair Bid / Fair Ask เพื่อเป็นข้อมูลประกอบการตัดสินใจเบื้องต้นเท่านั้น โดยประมวลผลจากราคาสินทรัพย์อ้างอิง อัตราแลกเปลี่ยน และ อัตราส่วนต่อสินทรัพย์อ้างอิง ราคาบนกระดานซื้อขายจริงอาจแตกต่างไปตามสภาพคล่องของ DR
                </p>
              </div>
            </div>
          </div>
        </div>

        {updatedAt && (
          <div className="flex flex-col items-end gap-0.5 text-[10px] sm:text-xs text-gray-500 pr-1 mt-3 sm:mt-4 mb-1 overflow-hidden">
              <div className="break-words">
                Last Updated:{" "}
                {updatedAt.toLocaleString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
          </div>
        )}

        {renderComparisonTable()}
        </div>
      </div>
    </div>
  );
}