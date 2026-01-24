import { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";

// ================= CONSTANTS =================
const countryOptions = [
  { code: "All", label: "All Markets" },
  { code: "US", label: "US United States" },
  { code: "HK", label: "HK Hong Kong" },
  { code: "DK", label: "DK Denmark" },
  { code: "NL", label: "NL Netherlands" },
  { code: "FR", label: "FR France" },
  { code: "IT", label: "IT Italy" },
  { code: "JP", label: "JP Japan" },
  { code: "SG", label: "SG Singapore" },
  { code: "TW", label: "TW Taiwan" },
  { code: "CN", label: "CN China" },
  { code: "VN", label: "VN Vietnam" },
];

const formatDate = (v) => {
  if (!v || v === "-") return "-";
  const d = new Date(v * 1000);
  if (isNaN(d)) return v;

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  return `${day}-${month}-${year}`;
};

const formatInt = (n) => {
  const num = Number(n);
  if (!isFinite(num)) return "0";
  return Math.round(num).toLocaleString();
};

const formatPrice = (n) => {
  const num = Number(n);
  if (!isFinite(num)) return "0.00";
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Function to convert company name to TradingView logo format
const getLogoSlug = (name) => {
  if (!name) {
    return '';
  }
  
  let cleanName = name;
  
  // Remove Thai text (บริษัท or หุ้นสามัญของบริษัท)
  cleanName = cleanName.replace(/^(บริษัท|หุ้นสามัญของบริษัท)\s*/i, '');
  
  // Extract company name before parentheses (AMZN) or other markers
  // "AMAZON.COM, INC. (AMZN)" -> "AMAZON.COM, INC."
  cleanName = cleanName.replace(/\s*\([^)]+\)\s*$/g, '');
  
  // Special handling for company names with multiple parts separated by comma
  // "BECTON, DICKINSON AND COMPANY" -> keep "BECTON, DICKINSON"
  // "AMAZON.COM, INC." -> "AMAZON"
  
  // First, check if it has .COM or .INC before comma
  const comMatch = cleanName.match(/^([A-Z][A-Z0-9&]*?)\.(?:COM|INC)/i);
  if (comMatch) {
    // For "AMAZON.COM, INC." -> "AMAZON" (remove .COM/.INC)
    cleanName = comMatch[1];
  } else {
    // For other cases, check for comma pattern
    const commaMatch = cleanName.match(/^([A-Z][A-Z0-9&\s]*?),\s*([A-Z][A-Z0-9&\s]*?)(?:,|\s+(?:AND|&)\s+)/i);
    if (commaMatch) {
      // For "BECTON, DICKINSON AND COMPANY" -> "BECTON, DICKINSON"
      cleanName = commaMatch[1] + ', ' + commaMatch[2];
    } else {
      // For simple cases, extract first word before comma or space
      const simpleMatch = cleanName.match(/^([A-Z][A-Z0-9&]*?)(?:\s*,|\s+)/i);
      if (simpleMatch) {
        cleanName = simpleMatch[1];
      }
    }
  }
  
  // Convert to lowercase
  let slug = cleanName.toLowerCase();
  
  // Remove common suffixes (iterative removal for nested cases)
  const suffixes = [
    'incorporated', 'incorporation', 'corporation', 'corp',
    'company', 'limited', 'ltd', 'plc', 'group', 'holdings', 'holding',
    'international', 'technologies', 'technology', 'tech',
    'systems', 'solutions', 'software', 'inc', 'co'
  ];
  
  for (let i = 0; i < 3; i++) {
    suffixes.forEach(suffix => {
      const regex = new RegExp(`\\b${suffix}\\.?\\b`, 'gi');
      slug = slug.replace(regex, ' ');
    });
    slug = slug.replace(/\s+/g, ' ').trim();
  }
  
  // Clean up: replace spaces with hyphens, remove special characters
  slug = slug
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  
  return slug;
};

const extractSymbol = (str) => {
  if (!str) return "";
  const strUpper = String(str).toUpperCase().trim();
  
  const match = strUpper.match(/\(([^)]+)\)$/);
  if (match) {
    return match[1].trim();
  }
  
  if (strUpper.includes(" ") && strUpper.length > 10) {

    const words = strUpper.split(/\s+/);
    if (words[0] && /^[A-Z0-9.\-]{1,6}$/.test(words[0])) {
      return words[0];
    }
  }
  
  return strUpper;
};

const formatMarketCapValue = (val, currency = "", isLargeNumber = false) => {
  if (val === null || val === undefined || val === "" || val === "-") return <span className="text-gray-300 text-xs sm:text-sm">-</span>;
  
  const num = Number(val);
  if (isNaN(num)) return <span className="text-gray-300 text-xs sm:text-sm">-</span>;

  let displayNum = num;
  let suffix = "";

  if (isLargeNumber) {
    if (Math.abs(num) >= 1.0e12) {
      displayNum = num / 1.0e12;
      suffix = "T";
    } else if (Math.abs(num) >= 1.0e9) {
      displayNum = num / 1.0e9;
      suffix = "B";
    } else if (Math.abs(num) >= 1.0e6) {
      displayNum = num / 1.0e6;
      suffix = "M";
    } else if (Math.abs(num) >= 1.0e3) {
      displayNum = num / 1.0e3;
      suffix = "K";
    }
  }

  const formattedNum = displayNum.toLocaleString("en-US", { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });

  let color = "";
  let bgColor = "";
  if (isLargeNumber) {
    switch (suffix) {
      case "T":
        color = "#ffffff"; // White text
        bgColor = "#0F172A"; // Very Dark Blue (Trillion - Highest)
        break;
      case "B":
        color = "#ffffff"; // White text
        bgColor = "#1E3A8A"; // Dark Blue (Billion - High)
        break;
      case "M":
        color = "#ffffff"; // White text
        bgColor = "#2563EB"; // Medium-Dark Blue (Million - Medium)
        break;
      case "K":
        color = "#ffffff"; // White text
        bgColor = "#60A5FA"; // Medium Blue (Thousand - Low)
        break;
      default:
        color = "#4B5563"; // Gray-600 text for lowest (no suffix)
        bgColor = "#CAE2FF"; // Light Blue (Lowest)
        break;
    }
  }

  return (
    <div className="flex items-center justify-center">
      <span 
        className="font-medium tracking-tight text-xs sm:text-[14.4px] px-2 sm:px-3 py-0.5 sm:py-1 rounded-lg inline-flex items-center justify-center gap-0.5 min-w-[90px] sm:min-w-[110px] font-mono" 
        style={{ color, backgroundColor: bgColor }}
      >
        {formattedNum}
        {suffix && <span className="ml-0.5">{suffix}</span>}
        {currency && <span className="text-xs sm:text-[14.4px] font-normal uppercase ml-0.5">{currency}</span>}
      </span>
    </div>
  );
};

const formatValue = (val, currency = "", isLargeNumber = false) => {
  if (val === null || val === undefined || val === "" || val === "-") return <span className="text-gray-300 text-xs sm:text-sm">-</span>;
  
  const num = Number(val);
  if (isNaN(num)) return <span className="text-gray-300 text-xs sm:text-sm">-</span>;

  let displayNum = num;
  let suffix = "";

  if (isLargeNumber) {
    if (Math.abs(num) >= 1.0e9) {
      displayNum = num / 1.0e9;
      suffix = "B";
    } else if (Math.abs(num) >= 1.0e6) {
      displayNum = num / 1.0e6;
      suffix = "M";
    } else if (Math.abs(num) >= 1.0e3) {
      displayNum = num / 1.0e3;
      suffix = "K";
    }
  }

  const formattedNum = displayNum.toLocaleString("en-US", { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });

  return (
    <div className="flex items-baseline justify-end gap-0.5">
      <span className="font-medium tracking-tight text-xs sm:text-[14.4px] font-mono">
        {formattedNum}
        {suffix && <span className="ml-0.5">{suffix}</span>}
      </span>
      {currency && <span className="text-xs sm:text-[14.4px] text-gray-600 font-normal uppercase">{currency}</span>}
    </div>
  );
};

const formatColoredValue = (val, suffix = "", currency = "") => {
  if (val === null || val === undefined || val === "" || val === "-") return <span className="text-gray-300 text-xs sm:text-sm">-</span>;
  const num = Number(val);
  const colorClass = num > 0 ? "text-[#27AE60]" : num < 0 ? "text-[#EB5757]" : "text-gray-500";
  
  return (
    <div className="flex items-baseline justify-end gap-0.5">
      <span className={`font-medium ${colorClass} text-xs sm:text-[14.4px] font-mono`}>
        {num > 0 ? "+" : ""}{num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        {suffix && <span className="ml-0.5 text-xs sm:text-[14.4px] font-normal opacity-80">{suffix}</span>}
      </span>
      {currency && <span className={`text-xs sm:text-[14.4px] font-normal uppercase ${colorClass} opacity-70`}>{currency}</span>}
    </div>
  );
};

export default function Calendar() {
  const [country, setCountry] = useState("US");
  const [earnings, setEarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  
  const [sortKey, setSortKey] = useState(null);
  const [sortOrder, setSortOrder] = useState("asc");
  const [search, setSearch] = useState("");
  const [selectedDay, setSelectedDay] = useState("All");

  const [seenEarningsIds, setSeenEarningsIds] = useState(new Set());
  const [newEarningsCount, setNewEarningsCount] = useState(0);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [logoErrors, setLogoErrors] = useState({});
  const [showCountryMenu, setShowCountryMenu] = useState(false);
  
  const countryDropdownRef = useRef(null);

  const selectedLabel = useMemo(() => countryOptions.find((c) => c.code === country)?.label || "All Markets", [country]);

  // Load seen earnings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('calendar_seen_earnings');
      if (saved) {
        setSeenEarningsIds(new Set(JSON.parse(saved)));
        setIsFirstLoad(false); 
      }
    } catch (e) {
      console.error('Error loading seen earnings:', e);
    }
  }, []);
  
  // Save seen earnings to localStorage and update navbar
  useEffect(() => {
    try {
      localStorage.setItem('calendar_seen_earnings', JSON.stringify([...seenEarningsIds]));
      
      // Update global notification count for navbar
      const event = new CustomEvent('calendarNotificationUpdate', { 
        detail: { count: newEarningsCount } 
      });
      window.dispatchEvent(event);
    } catch (e) {
      console.error('Error saving seen earnings:', e);
    }
  }, [seenEarningsIds, newEarningsCount]);

  const flattenData = (responseData) => {
    if (!responseData) return [];
    if (Array.isArray(responseData)) return responseData;
    
    // Handle new structure with {data: {...}, updated_at: "..."}
    let dataToProcess = responseData;
    if (responseData.data) {
      dataToProcess = responseData.data;
    }
    
    let allRows = [];
    Object.values(dataToProcess).forEach(group => {
        if (group && Array.isArray(group.data)) {
            allRows.push(...group.data);
        }
    });
    return allRows;
  };

  // Close menu when route changes
  useEffect(() => {
    const controller = new AbortController();
    

    const loadData = async (showLoading = true) => {
      if (showLoading) setLoading(true);
      try {
        let finalData = [];
        let apiUpdateTime = null;
        // ดึงข้อมูลจาก backend ตาม country ที่เลือก (หรือ All)
        const res = await axios.get(`${import.meta.env.VITE_EARNINGS_API}?country=${country}`, { signal: controller.signal });
        const responseData = res.data;
        finalData = flattenData(responseData);
        if (responseData.updated_at) {
          const apiDate = new Date(responseData.updated_at);
          if (!isNaN(apiDate.getTime())) {
            apiUpdateTime = apiDate;
          }
        }
        if (!controller.signal.aborted) {
          setEarnings(finalData);
          setLastUpdateTime(apiUpdateTime || new Date());
          const currentIds = new Set(finalData.map(e => `${e.ticker}-${e.date}`));
          const unseenIds = [...currentIds].filter(id => !seenEarningsIds.has(id));
          setNewEarningsCount(unseenIds.length);
          if (isFirstLoad) {
            if (seenEarningsIds.size === 0) {
              setSeenEarningsIds(currentIds);
              setNewEarningsCount(0);
            } else {
              const updatedSeenIds = new Set([...seenEarningsIds, ...currentIds]);
              setSeenEarningsIds(updatedSeenIds);
            }
            setIsFirstLoad(false);
          } else {
            const updatedSeenIds = new Set([...seenEarningsIds, ...currentIds]);
            setSeenEarningsIds(updatedSeenIds);
          }
        }
      } catch (err) {
        if (!axios.isCancel(err)) {
          console.error(err);
          setEarnings([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadData(true);

    // SSE Connection for real-time updates
    let eventSource = null;
    let reconnectTimeout = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000;

    const connectSSE = () => {
      try {
        eventSource = new EventSource(import.meta.env.VITE_EARNINGS_STREAM_API);
        
        eventSource.onopen = () => {
          reconnectAttempts = 0; 
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'new_earnings' && data.earnings) {
              // Process new earnings
              const newEarnings = data.earnings;
              const newIds = new Set(newEarnings.map(e => `${e.ticker}-${e.date}`));
              
              setSeenEarningsIds(currentSeenIds => {
                const unseenIds = [...newIds].filter(id => !currentSeenIds.has(id));
                
                if (unseenIds.length > 0) {
                  setNewEarningsCount(prev => prev + unseenIds.length);
                  
                  setEarnings(prev => {
                    const existingIds = new Set(prev.map(e => `${e.ticker}-${e.date}`));
                    const trulyNew = newEarnings.filter(e => !existingIds.has(`${e.ticker}-${e.date}`));
                    return [...prev, ...trulyNew];
                  });
                  
                  // Update last update time
                  if (data.updated_at) {
                    setLastUpdateTime(new Date(data.updated_at));
                  }
                  
                  return new Set([...currentSeenIds, ...newIds]);
                }
                
                return currentSeenIds;
              });
            } else if (data.type === 'heartbeat') {

            } else if (data.type === 'connected') {
            }
          } catch (err) {
            // Silent error handling
          }
        };

        eventSource.onerror = (error) => {
          eventSource.close();
          
          // Attempt to reconnect with exponential backoff
          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
            reconnectAttempts++;
            
            reconnectTimeout = setTimeout(() => {
              connectSSE();
            }, delay);
          } else {
            // Fallback to polling if SSE fails completely
            const fallbackInterval = setInterval(() => {
              loadData(false);
            }, 300000); 
            
            return () => {
              clearInterval(fallbackInterval);
            };
          }
        };
      } catch (err) {
        // Silent error handling
      }
    };

    // Connect to SSE
    connectSSE();

    return () => {
      controller.abort();
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [country]);

  const handleSort = (key) => {
    if (key === sortKey) {
      if (sortOrder === "asc") setSortOrder("desc");
      else { setSortKey(null); setSortOrder("asc"); }
    } else {
      setSortKey(key); setSortOrder("asc");
    }
  };

  const filtered = useMemo(() => {
    return earnings.filter((e) => {
      // Filter by search
      if (search.trim()) {
        const q = search.toUpperCase();
        const ticker = (e.ticker || "").toUpperCase();
        const company = (e.company || "").toUpperCase();
        const matchesSearch = ticker.includes(q) || company.includes(q);
        if (!matchesSearch) return false;
      }
      
      // Filter by day
      if (selectedDay !== "All") {
        const earningDate = new Date((e.date ?? 0) * 1000);
        if (isNaN(earningDate.getTime())) return false;
        const dayOfWeek = earningDate.getDay(); 
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const earningDayName = dayNames[dayOfWeek];
        if (earningDayName !== selectedDay) return false;
      }
      
      return true;
    });
  }, [earnings, search, selectedDay]);

const sortedEarnings = useMemo(() => {
  // Backend already calculated DR metrics, just add isNew flag
  const withIsNew = filtered.map(e => {
    const earningId = `${e.ticker}-${e.date}`;
    const isNew = !seenEarningsIds.has(earningId);
    
    return {
      ...e,
      earningId,
      isNew
    };
  });

  let sorted;
  
  if (!sortKey) {
    sorted = withIsNew.sort((a, b) => {
      const dateA = new Date((a.date ?? 0) * 1000);
      const dateB = new Date((b.date ?? 0) * 1000);

      if (dateA.getTime() !== dateB.getTime()) {
        return dateA - dateB; 
      }

      return String(a.ticker ?? "").localeCompare(String(b.ticker ?? ""));
    });
  } else {
    sorted = withIsNew.sort((a, b) => {
      const A = a[sortKey] ?? "";
      const B = b[sortKey] ?? "";

      if (sortKey === "date") {
        return sortOrder === "asc"
          ? new Date(A) - new Date(B)
          : new Date(B) - new Date(A);
      }

      if (sortKey === "popularDR") {
        return sortOrder === "asc"
          ? (a.mostPopularDR?.volume || 0) - (b.mostPopularDR?.volume || 0)
          : (b.mostPopularDR?.volume || 0) - (a.mostPopularDR?.volume || 0);
      }

      if (sortKey === "sensitivityDR") {
        const bidA = a.highSensitivityDR?.bid || Infinity;
        const bidB = b.highSensitivityDR?.bid || Infinity;
        return sortOrder === "asc" ? bidA - bidB : bidB - bidA;
      }

      const numA = parseFloat(String(A).replace(/[^0-9.-]+/g, ""));
      const numB = parseFloat(String(B).replace(/[^0-9.-]+/g, ""));

      if (!isNaN(numA) && !isNaN(numB) && !["ticker", "company", "period"].includes(sortKey)) {
        return sortOrder === "asc" ? numA - numB : numB - numA;
      }

      return sortOrder === "asc"
        ? String(A).localeCompare(String(B))
        : String(B).localeCompare(String(A));
    });
  }
  
  // Separate new and old earnings, then put new ones first
  const newEarnings = sorted.filter(e => e.isNew);
  const oldEarnings = sorted.filter(e => !e.isNew);
  
  return [...newEarnings, ...oldEarnings];
}, [filtered, sortKey, sortOrder, seenEarningsIds]);

// Function to mark earnings as seen
const markAsSeen = (earningId) => {
  setSeenEarningsIds(prev => {
    const updated = new Set(prev);
    updated.add(earningId);
    return updated;
  });
  setNewEarningsCount(prev => Math.max(0, prev - 1));
};

  // Mark all as seen
  const markAllAsSeen = () => {
    const allIds = earnings.map(e => `${e.ticker}-${e.date}`);
    setSeenEarningsIds(new Set(allIds));
    setNewEarningsCount(0);
  };
  

  const SortIndicator = ({ colKey }) => {
    const active = sortKey === colKey;
    const direction = sortOrder;
    const upColor = active && direction === "asc" ? "#FFFFFF" : "rgba(255, 255, 255, 0.4)";
    const downColor = active && direction === "desc" ? "#FFFFFF" : "rgba(255, 255, 255, 0.4)";

    return (
      <div className="flex items-center ml-[0px] flex-shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="w-[10px] sm:w-[12px] h-[10px] sm:h-[12px] transition-all duration-200">
          <path d="M14 2.256V30c-2.209 0-4-1.791-4-4V13H4.714c-.633 0-.949-.765-.502-1.212l9.607-9.607C13.886 2.114 14 2.162 14 2.256z" fill={upColor} />
          <path d="M27.788 20.212l-9.6 9.6C18.118 29.882 18 29.832 18 29.734V2c2.209 0 4 1.791 4 4v13h5.286C27.918 19 28.235 19.765 27.788 20.212z" fill={downColor} />
        </svg>
      </div>
    );
  };

  return (
    <div className="h-screen w-full bg-[#f5f5f5] overflow-hidden flex justify-center">
      <div className="w-full max-w-[1248px] flex flex-col h-full">
        <div className="pt-6 sm:pt-10 pb-0 px-4 sm:px-0 flex-shrink-0" style={{ overflow: 'visible', zIndex: 100 }}>
          <div className="w-full lg:w-[1040px] max-w-full mx-auto lg:scale-[1.2] lg:origin-top" style={{ overflow: 'visible' }}>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 sm:mb-3 text-black">Earnings Calendar</h1>
            <p className="text-[#6B6B6B] mb-4 sm:mb-6 md:mb-8 text-xs sm:text-sm md:text-base">Earnings Schedule for Companies with DRs Traded in Thailand.</p>
            
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 md:gap-4 mb-2">
              <div className="relative z-[200] w-full md:w-auto" ref={countryDropdownRef} style={{ isolation: 'isolate', overflow: 'visible' }}>
                <button type="button" onClick={() => setShowCountryMenu((prev) => !prev)} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#0B102A] w-full md:min-w-[180px] h-[37.33px]">
                  <span className="truncate">{selectedLabel}</span>
                  <svg className={`h-4 w-4 flex-shrink-0 transition-transform text-gray-500 ${showCountryMenu ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {showCountryMenu && (
                  <div className="absolute left-0 top-full z-[9999] mt-2 w-full sm:w-56 max-h-72 overflow-auto rounded-2xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.15)] py-1" style={{ transform: 'translateZ(0)' }}>
                    {countryOptions.map((opt) => (
                      <button 
                        key={opt.code} 
                        onClick={() => { setCountry(opt.code); setShowCountryMenu(false); }} 
                        className={`flex w-full items-center justify-between px-4 py-1.5 text-left text-xs sm:text-sm transition-colors ${country === opt.code ? "bg-[#EEF2FF] text-[#0B102A] font-semibold" : "text-gray-700 hover:bg-gray-50"}`}
                      >
                        <span>{opt.label}</span>
                        {country === opt.code && <i className="bi bi-check-lg text-[#0B102A] text-base"></i>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative w-full md:w-auto">
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search DR..." className="bg-white pl-3 sm:pl-4 pr-10 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#0B102A] focus:border-transparent w-full md:w-64 text-xs sm:text-sm shadow-sm h-[37.33px]" />
                <i className="bi bi-search absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" style={{ fontSize: 14 }} />
              </div>
            </div>
            
            <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-2 gap-2">
              <div className="overflow-x-auto pb-1">
                <div className="inline-flex items-center gap-2 sm:gap-3 bg-white rounded-xl px-2 py-1.5 shadow-sm border border-gray-100 min-w-full sm:min-w-0">
                  <span className="text-xs sm:text-sm font-semibold text-gray-700 whitespace-nowrap">Days</span>
                  <div className="flex justify-between flex-1 sm:gap-2">
                    {["All", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => {
                      const isSelected = selectedDay === day;
                      const shortDay = day === "All" ? "All" : day.substring(0, 3);
                      return (
                        <button
                          key={day}
                          onClick={() => setSelectedDay(day)}
                          className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all whitespace-nowrap ${
                            isSelected
                              ? "bg-[#0B102A] text-white ring-2 ring-offset-1 ring-black/10 shadow-md scale-105"
                              : "text-gray-600 opacity-60 hover:opacity-100"
                          }`}
                        >
                          <span className="hidden sm:inline">{day}</span>
                          <span className="sm:hidden">{shortDay}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5 text-[10px] sm:text-xs text-gray-500 pr-1 mt-0 md:mt-1">
                <div>Found {sortedEarnings.length.toLocaleString()} results</div>
                {lastUpdateTime && (
                  <div className="text-right">Last Updated: {lastUpdateTime.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                )}
              </div>
            </div>
            
            <div className="flex flex-col items-end gap-0.5 text-[10px] sm:text-xs text-gray-500 pr-1 mb-1.5">
              {newEarningsCount > 0 && (
                <button
                  onClick={markAllAsSeen}
                  className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                  title="Mark all as read"
                >
                  Mark all as read ({newEarningsCount})
                </button>
              )}
            </div>
          </div>
        </div>
        
        {/* Main Content - Scrollable */}
        <div className="flex-1 overflow-hidden pb-6 sm:pb-10 -mt-2 md:mt-9 px-4 sm:px-0">
          <div className="h-full bg-white rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-gray-100 overflow-auto hide-scrollbar">
            
            {/* Mobile Card View */}
            <div className="block lg:hidden p-3">
              <div className="space-y-3">
                {loading ? (
                  <div className="py-12 text-center text-gray-500 text-sm">Loading data...</div>
                ) : sortedEarnings.length === 0 ? (
                  <div className="py-12 text-center text-gray-500 italic text-sm">No upcoming earnings scheduled.</div>
                ) : (
                  sortedEarnings.map((e, i) => {
                    const isFuture = (e.date * 1000) > Date.now();
                    const displayEpsRep = isFuture ? "-" : e.epsReported;
                    const displaySurprise = isFuture ? "-" : e.surprise;
                    const displayPctSurprise = isFuture ? "-" : e.pctSurprise;
                    const displayRevAct = isFuture ? "-" : e.revenueActual;
                    
                    const bgColor = e.isNew 
                      ? "bg-blue-50 border-l-4 border-l-blue-600" 
                      : "bg-white";

                    return (
                      <div
                        key={i}
                        onClick={() => e.isNew && markAsSeen(e.earningId)}
                        className={`rounded-xl shadow-sm border border-gray-200 p-3 cursor-pointer hover:shadow-md transition-shadow ${bgColor}`}
                      >
                        {/* Header */}
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
                            <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 overflow-hidden">
                              {!logoErrors[e.ticker] ? (
                                <img 
                                  src={(() => {
                                    const companyName = e.company || '';
                                    const slug = getLogoSlug(companyName);
                                    return `https://s3-symbol-logo.tradingview.com/${slug}.svg`;
                                  })()}
                                  alt={e.ticker}
                                  className="w-full h-full object-contain rounded-lg"
                                  onError={() => setLogoErrors(prev => ({ ...prev, [e.ticker]: true }))}
                                />
                              ) : (
                                <span className="w-8 h-8 rounded-lg bg-slate-600/50 flex items-center justify-center text-xs font-bold text-white">
                                  {e.ticker?.[0] || "?"}
                                </span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-[#2F80ED] text-sm truncate">{e.ticker}</div>
                              <div className="text-xs text-gray-600 truncate">{e.company}</div>
                            </div>
                          </div>
                          <div className="flex-shrink-0">
                            {formatMarketCapValue(e.marketCap, e.currency, true)}
                          </div>
                        </div>

                        {/* Dates */}
                        <div className="grid grid-cols-2 gap-2 mb-2 pb-2 border-b border-gray-100">
                          <div className="text-left">
                            <div className="text-[10px] text-gray-500">Earnings Date</div>
                            <div className="text-xs text-gray-800 font-medium">{formatDate(e.date)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-gray-500">Period End</div>
                            <div className="text-xs text-gray-800 font-medium">{formatDate(e.period)}</div>
                          </div>
                        </div>

                        {/* DR Info */}
                        {(e.mostPopularDR || e.highSensitivityDR) && (
                          <div className="grid grid-cols-2 gap-2 mb-2 pb-2 border-b border-gray-100">
                            {e.mostPopularDR && (
                              <div className="text-left">
                                <div className="text-[10px] text-gray-500">Popular DR</div>
                                <div className="font-bold text-[#50B728] text-xs truncate">{e.mostPopularDR.symbol}</div>
                                {e.mostPopularDR.volume > 0 && (
                                  <div className="text-[10px] text-gray-600">Vol: {formatInt(e.mostPopularDR.volume)}</div>
                                )}
                              </div>
                            )}
                            {e.highSensitivityDR && (
                              <div className="text-right">
                                <div className="text-[10px] text-gray-500">Sensitivity DR</div>
                                <div className="font-bold text-[#0007DE] text-xs truncate">{e.highSensitivityDR.symbol}</div>
                                {e.highSensitivityDR.bid > 0 && (
                                  <div className="text-[10px] text-gray-600">Bid: {formatPrice(e.highSensitivityDR.bid)}</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* EPS & Revenue */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="text-left">
                            <div className="text-[10px] text-gray-500">EPS Est.</div>
                            <div className="flex justify-start">{formatColoredValue(e.epsEstimate, e.currency)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-gray-500">EPS Rep.</div>
                            <div>{formatColoredValue(displayEpsRep, e.currency)}</div>
                          </div>
                          <div className="text-left">
                            <div className="text-[10px] text-gray-500">Surprise</div>
                            <div className="flex justify-start">{formatColoredValue(displaySurprise, "", e.currency)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-gray-500">%Surprise</div>
                            <div>{formatColoredValue(displayPctSurprise, "%")}</div>
                          </div>
                          <div className="text-left">
                            <div className="text-[10px] text-gray-500">Rev Forecast</div>
                            <div className="flex justify-start">{formatValue(e.revenueForecast, e.currency, true)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-gray-500">Rev Actual</div>
                            <div>{formatValue(displayRevAct, e.currency, true)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Desktop Table View */}
            <table className="hidden lg:table min-w-[1300px] w-full text-left border-collapse text-[14.4px]">
              <colgroup>
                <col style={{ width: '250px', maxWidth: '250px' }} />
                <col style={{ minWidth: '150px' }} />
                <col style={{ minWidth: '110px' }} />
                <col style={{ minWidth: '110px' }} />
                <col style={{ minWidth: '90px' }} />
                <col style={{ minWidth: '90px' }} />
                <col style={{ minWidth: '80px' }} />
                <col style={{ minWidth: '80px' }} />
                <col style={{ minWidth: '100px' }} />
                <col style={{ minWidth: '100px' }} />
                <col style={{ minWidth: '90px' }} />
                <col style={{ minWidth: '90px' }} />
              </colgroup>
              <thead className="bg-[#0B102A] text-white font-semibold sticky top-0" style={{ zIndex: 50 }}>
                <tr className="h-[50px]">
                  {[
                    { k: "ticker", l: "Symbol", a: "left" }, 
                    { k: "marketCap", l: "Market Cap", a: "center" },
                    { k: "popularDR", l: "Most Popular DR", a: "center" },
                    { k: "sensitivityDR", l: "High Sensitivity DR", a: "center" },
                    { k: "epsEstimate", l: "EPS Est.", a: "right" }, 
                    { k: "epsReported", l: "EPS Rep.", a: "right" },
                    { k: "surprise", l: "Surprise", a: "right" }, 
                    { k: "pctSurprise", l: "%Surprise", a: "right" },
                    { k: "revenueForecast", l: "Rev Forecast", a: "right" }, 
                    { k: "revenueActual", l: "Rev Actual", a: "right" },
                    { k: "date", l: "Date", a: "right" }, 
                    { k: "period", l: "Period End", a: "right" }
                  ].map((h) => (
                    <th key={h.k} onClick={() => handleSort(h.k)} className="cursor-pointer transition-colors relative whitespace-nowrap px-4">
                      <div className={`flex items-center ${h.a === "right" ? "justify-end" : h.a === "center" ? "justify-center" : "justify-start"} gap-0.5`}>
                        {h.l} <SortIndicator colKey={h.k} />
                      </div>
                      {sortKey === h.k && (
                        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2F80ED] z-50">
                          <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-[#2F80ED]"></div>
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={12} className="py-12 text-center text-gray-500">Loading data...</td></tr>
              ) : sortedEarnings.length === 0 ? (
                <tr><td colSpan={12} className="py-12 text-center text-gray-500 italic">No upcoming earnings scheduled.</td></tr>
              ) : (
                sortedEarnings.map((e, i) => {
                  const isFuture = (e.date * 1000) > Date.now();
                  const displayEpsRep = isFuture ? "-" : e.epsReported;
                  const displaySurprise = isFuture ? "-" : e.surprise;
                  const displayPctSurprise = isFuture ? "-" : e.pctSurprise;
                  const displayRevAct = isFuture ? "-" : e.revenueActual;
                  
                  const bgColor = e.isNew 
                    ? "bg-blue-100 border-l-4 border-l-blue-600" 
                    : i % 2 === 0 ? "bg-white" : "bg-[#F7F8FA]";

                  return (
                    <tr 
                      key={i} 
                      className={`transition-colors ${bgColor} hover:bg-gray-50 cursor-pointer`}
                      style={{ height: "52px" }}
                      onClick={() => e.isNew && markAsSeen(e.earningId)}
                    >
                      <td className="px-4 align-middle overflow-hidden" style={{ width: '250px', maxWidth: '250px' }}>
                        <div className="flex items-center gap-2 overflow-hidden w-full min-w-0">
                          <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {!logoErrors[e.ticker] ? (
                              <img 
                                src={(() => {
                                  const companyName = e.company || '';
                                  const slug = getLogoSlug(companyName);
                                  return `https://s3-symbol-logo.tradingview.com/${slug}.svg`;
                                })()}
                                alt={e.ticker}
                                className="w-full h-full object-contain rounded-xl"
                                onError={() => setLogoErrors(prev => ({ ...prev, [e.ticker]: true }))}
                              />
                            ) : (
                              <span className="w-10 h-10 rounded-xl bg-slate-600/50 flex items-center justify-center text-sm font-bold text-white">
                                {e.ticker?.[0] || "?"}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col overflow-hidden w-full min-w-0">
                            <span className="font-bold text-[#2F80ED] text-[14.4px] leading-tight truncate" title={e.ticker}>{e.ticker}</span>
                            <span className="text-[12.4px] text-gray-600 truncate w-full mt-0.5" title={e.company}>{e.company}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 align-middle text-center text-gray-800 font-medium">{formatMarketCapValue(e.marketCap, e.currency, true)}</td>
                      <td className="px-4 align-middle text-center">
                        {e.mostPopularDR ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-bold text-[#50B728]">{e.mostPopularDR.symbol}</span>
                            {e.mostPopularDR.volume > 0 ? (
                              <span className="text-gray-600 text-[13.4px]">Vol: {formatInt(e.mostPopularDR.volume)}</span>
                            ) : null}
                          </div>
                        ) : <span className="text-gray-600">-</span>}
                      </td>
                      <td className="px-4 align-middle text-center">
                        {e.highSensitivityDR ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-bold text-[#0007DE]">{e.highSensitivityDR.symbol}</span>
                            {e.highSensitivityDR.bid > 0 ? (
                              <span className="text-gray-600 text-[13.4px]">Bid: <span className="font-mono">{formatPrice(e.highSensitivityDR.bid)}</span></span>
                            ) : null}
                          </div>
                        ) : <span className="text-gray-600">-</span>}
                      </td>
                      <td className="px-4 align-middle text-right text-gray-800 font-medium">{formatColoredValue(e.epsEstimate, e.currency)}</td>
                      <td className="px-4 align-middle text-right text-gray-800 font-semibold">{formatColoredValue(displayEpsRep, e.currency)}</td>
                      <td className="px-4 align-middle text-right font-medium">{formatColoredValue(displaySurprise, "", e.currency)}</td>
                      <td className="px-4 align-middle text-right font-medium">{formatColoredValue(displayPctSurprise, "%")}</td>
                      <td className="px-4 align-middle text-right text-gray-800 font-medium">{formatValue(e.revenueForecast, e.currency, true)}</td>
                      <td className="px-4 align-middle text-right text-gray-800 font-semibold">{formatValue(displayRevAct, e.currency, true)}</td>
                      <td className="px-4 align-middle text-right text-gray-800 font-medium whitespace-nowrap">
                        {formatDate(e.date)}
                      </td>
                      <td className="px-4 align-middle text-right text-gray-800 font-medium whitespace-nowrap">
                        {formatDate(e.period)}
                      </td>
                    </tr>
                  );
                })
              )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}