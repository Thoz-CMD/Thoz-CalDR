  import React, { useState, useEffect, useMemo, useRef } from "react";


  const API_URL = import.meta.env.VITE_DR_LIST_API;
  const RATINGS_API = import.meta.env.VITE_RATINGS_API;

  // 🔧 MOCK DATA FLAG - ตั้งเป็น true เพื่อใช้ mock data สำหรับทดสอบ winrate
  // เมื่อต้องการใช้ข้อมูลจริง ให้เปลี่ยนกลับเป็น false
  const USE_MOCK_DATA = false;
  const MOCK_RATINGS_API = "http://172.18.1.56:8335/api/mock-rating-history/aapl";

  // --- Constants & Helpers ---
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

  const RATING_SCORE = {
    "strong buy": 5,
    "buy": 4,
    "neutral": 3,
    "sell": 2,
    "strong sell": 1,
    "unknown": 0
  };

  const getCountryFromExchange = (exchange = "") => {
    if (!exchange) return "OTHER";
    const ex = exchange.toUpperCase();
    if (ex.includes("MILAN")) return "IT";
    if (ex.includes("COPENHAGEN")) return "DK";
    if (ex.includes("EURONEXT") || ex.includes("PARIS") || ex.includes("AMSTERDAM")) {
      if (ex.includes("PARIS")) return "FR";
      if (ex.includes("AMSTERDAM")) return "NL";
      return "FR";
    }
    if (ex.includes("HONG KONG")) return "HK";
    if (ex.includes("VIETNAM") || ex.includes("HOCHIMINH")) return "VN";
    if (ex.includes("TOKYO") || ex.includes("JAPAN")) return "JP";
    if (ex.includes("SINGAPORE")) return "SG";
    if (ex.includes("TAIWAN")) return "TW";
    if (ex.includes("CHINA") || ex.includes("SHENZHEN")) return "CN";
    return "US";
  };

  const getRatingStyle = (rating) => {
    if (!rating) return "bg-gray-100 text-gray-400";
    const r = rating.toLowerCase();
    if (r === "strong buy") return "bg-[#E6F4EA] text-[#137333]";
    if (r === "buy") return "text-[#137333]";
    if (r === "neutral") return "text-[#3C4043]";
    if (r === "sell") return "text-[#A50E0E]";
    if (r === "strong sell") return "bg-[#FCE8E6] text-[#A50E0E]";
    return "bg-transparent text-gray-400";
  };

  const getRatingTextColor = (rating) => {
    if (!rating) return "text-[#9CA3AF]";
    const r = rating.toLowerCase();
    if (r === "strong buy" || r === "buy") return "text-[#137333]";
    if (r === "neutral") return "text-[#5F6368]";
    if (r === "sell" || r === "strong sell") return "text-[#A50E0E]";
    return "text-[#9CA3AF]";
  };

  // Helper function to filter out Neutral and Unknown from history
  const filterNeutralFromHistory = (history) => {
    if (!history || history.length === 0) return [];
    return history.filter(item => {
      const rating = item.rating?.toLowerCase();
      const prev = item.prev?.toLowerCase();
      // Skip Neutral or Unknown ratings
      if (rating === "neutral" || rating === "unknown" || prev === "unknown") {
        return false;
      }
      return true;
    });
  };

  const formatSmartTime = (isoString) => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    if (isNaN(date)) return "-";

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}-${month}-${year}`;
  };

  const getShortName = (item) => {
    let name = item.underlyingName && item.underlyingName !== "-" ? item.underlyingName : (item.name || "");
    name = name.replace(/[\u0E00-\u0E7F]/g, "").replace(/\s*\(.*?\)/g, "").replace(/Depositary Receipt on /i, "").split(" Issued by")[0].replace(/[-.]+$/, "");
    return name.replace(/\s+/g, " ").trim();
  };

  const formatPrice = (n) => {
    const num = Number(n);
    if (!isFinite(num)) return "0.00";
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatPct = (n) => {
    const num = Number(n);
    if (!isFinite(num)) return "0.00";
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatInt = (n) => {
    const num = Number(n);
    if (!isFinite(num)) return "0";
    return Math.round(num).toLocaleString();
  };

  const renderPriceWithCurrency = (price, currency) => {
    return (
      <div className="flex items-baseline justify-end gap-0.5">
        <span className="font-medium text-gray-800 text-xs sm:text-[14.4px] font-mono">{formatPrice(price)}</span>
        <span className="text-xs sm:text-[14.4px] text-gray-600 font-normal uppercase">{currency}</span>
      </div>
    );
  };

  // --- Components ---

  const FilterDropdown = ({ label, value, options, onSelect }) => {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
      const handleClickOutside = (event) => { if (ref.current && !ref.current.contains(event.target)) setIsOpen(false); };
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);
    const currentLabel = options.find(o => o.val === value)?.label || value;
    return (
      <div className="relative z-[60] flex-1 sm:flex-initial sm:w-auto" ref={ref}>
        <button onClick={() => setIsOpen(!isOpen)} className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm w-full sm:min-w-[140px] md:min-w-[180px] hover:border-gray-300 transition-colors shadow-sm h-[37.33px]">
          <span className="text-gray-800 font-medium truncate">{currentLabel}</span>
          <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-full bg-white border border-gray-100 rounded-xl shadow-lg z-[100] py-1 overflow-hidden">
            {options.map((opt) => (
              <button key={opt.val} onClick={() => { onSelect(opt.val); setIsOpen(false); }} className={`w-full text-left px-4 py-1.5 text-xs sm:text-sm flex items-center gap-2 hover:bg-gray-50 ${value === opt.val ? "text-[#0B102A] font-semibold bg-gray-50" : "text-gray-800"}`}>
                {opt.color && <span className={`w-2 h-2 rounded-full ${opt.color}`}></span>}{opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const RatingChangeCell = ({ prev, current, showChange }) => {
    if (!current || current === "Unknown") return <span className="text-gray-300 text-xs sm:text-sm">-</span>;
    const prevDisplay = prev && prev !== "Unknown" ? prev : "-";
    const prevTextColor = prev && prev !== "Unknown" ? getRatingTextColor(prev) : "text-gray-400";
    const shouldShowPrev = showChange;

    return (
      <div className="flex items-center justify-center h-full relative">
        <div className={`flex items-center gap-1.5 sm:gap-2.5 transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${shouldShowPrev ? "opacity-100" : "opacity-0 w-0 overflow-hidden"}`}>
          <div className={`text-[11px] sm:text-[14.4px] font-bold text-center ${prevTextColor}`} style={{ minWidth: '80px', width: '80px' }}>
            <span className="whitespace-nowrap text-[10px] sm:text-sm">
              {prevDisplay}
            </span>
          </div>
          <div className="flex items-center justify-center mx-1 sm:mx-1.5" style={{ minWidth: '20px', width: '20px' }}>
            <svg className="w-3 h-3 sm:w-4 sm:h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
        </div>
        <div className="flex justify-center ml-1.5 sm:ml-2.5" style={{ minWidth: '80px', width: '80px' }}>
          <span className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[10px] sm:text-[14.4px] font-bold whitespace-nowrap text-center transition-all duration-500 ${getRatingStyle(current)}`}>
            {current}
          </span>
        </div>
      </div>
    );
  };

  // --- Tooltip Component ---
  const Tooltip = ({ show, position, children }) => {
    if (!show || !position) return null;

    return (
      <div
        className="fixed z-[5000] pointer-events-none transition-opacity duration-200 hidden sm:block"
        style={{
          left: `${position.x}px`,
          top: `${position.y - 10}px`,
          transform: 'translate(-50%, -100%)',
          opacity: show ? 1 : 0
        }}
      >
        <div className="bg-[#0B102A] text-white text-xs font-medium px-3 py-2 rounded-lg shadow-xl border border-white/10 backdrop-blur-sm whitespace-nowrap relative">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-blue-50">{children}</span>
          </div>
          <div className="absolute bottom-[-6px] left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-[#0B102A]"></div>
        </div>
      </div>
    );
  };

  // --- RatingHistoryModal ---
  const RatingHistoryModal = ({ item, timeframe, onClose }) => {
    const [filterRating, setFilterRating] = useState(null);
    const [historyData, setHistoryData] = useState([]);
    const [accuracy, setAccuracy] = useState({ accuracy: 0, correct: 0, incorrect: 0, total: 0 });
    const [loading, setLoading] = useState(true);
    const [currentPrice, setCurrentPrice] = useState(item?.last || 0);
    const [currentChange, setCurrentChange] = useState(item?.change || 0);
    const [currentChangePercent, setCurrentChangePercent] = useState(item?.percentChange || 0);
    const [currentRating, setCurrentRating] = useState(timeframe === "1W" ? (item?.ratingWeek || "Unknown") : (item?.ratingDay || "Unknown"));
    const [logoError, setLogoError] = useState(false);

    // Store raw history data (unfiltered)
    const [rawHistoryData, setRawHistoryData] = useState([]);

    // Function to convert company name to TradingView logo format
    const getLogoSlug = (name) => {
      if (!name) return '';
      
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

    useEffect(() => {
      if (!item) return;

      async function fetchHistoryWithAccuracy() {
        setLoading(true);
        try {
          const ticker = item.displaySymbol || item.symbol;
          const tf = timeframe === "1W" ? "1W" : "1D";

          // Use local API for development
          const baseUrl = "http://172.18.1.56:8335";
          const url = `${baseUrl}/ratings/history-with-accuracy/${ticker}?timeframe=${tf}`;
          console.log("🔍 Fetching from URL:", url);

          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data = await response.json();
          console.log("📦 API Response:", data);
          console.log("📊 History items count:", data.history?.length || 0);

          if (data.history && Array.isArray(data.history)) {
            // Store raw data (unfiltered)
            setRawHistoryData(data.history);
            setAccuracy(data.accuracy || { accuracy: 0, correct: 0, incorrect: 0, total: 0 });
            setCurrentPrice(data.price || 0);
            setCurrentChange(data.change || 0);
            setCurrentChangePercent(data.changePercent || 0);
            setCurrentRating(data.current_rating || "Unknown");
          } else {
            // Handle empty or no data response
            console.log("ℹ️ No history data available for this ticker");
            setRawHistoryData([]);
            setAccuracy({ accuracy: 0, correct: 0, incorrect: 0, total: 0 });
            // Use item data as fallback
            setCurrentPrice(data.price || item?.last || 0);
            setCurrentChange(data.change || item?.change || 0);
            setCurrentChangePercent(data.changePercent || item?.percentChange || 0);
            setCurrentRating(data.current_rating || (timeframe === "1W" ? (item?.ratingWeek || "Unknown") : (item?.ratingDay || "Unknown")));
          }
        } catch (error) {
          console.error("Error fetching history with accuracy:", error);
        } finally {
          setLoading(false);
        }
      }

      fetchHistoryWithAccuracy();
    }, [item, timeframe]);

    // Filter history data based on filterRating (client-side filtering)
    useEffect(() => {
      if (!rawHistoryData || rawHistoryData.length === 0) {
        setHistoryData([]);
        setAccuracy({ accuracy: 0, correct: 0, incorrect: 0, total: 0 });
        return;
      }

      let filtered = filterNeutralFromHistory(rawHistoryData);

      if (filterRating) {
        filtered = filtered.filter(item => item.rating === filterRating);
      }

      setHistoryData(filtered);

      // คำนวณ accuracy จาก filtered data (ต้องคำนวณใหม่เพราะมี filter)
      if (filtered.length > 0) {
        let correct = 0;
        let incorrect = 0;

        filtered.forEach((item) => {
          const ratingPrev = item.prev?.toLowerCase() || "";
          const ratingCurr = item.rating?.toLowerCase() || "";
          const changePct = item.change_pct || 0;

          if (!ratingPrev || !ratingCurr) {
            return;
          }

          // ข้ามถ้า rating ไม่เปลี่ยนและ price ไม่เปลี่ยน
          const ratingNotChanged = (ratingCurr === ratingPrev);
          const priceNotChanged = (Math.abs(changePct) < 0.01);

          if (ratingNotChanged && priceNotChanged) {
            return; // ไม่นับ
          }

          // ตรวจสอบความถูกต้อง
          let isCorrect = false;

          if (ratingPrev === "sell" || ratingPrev === "strong sell") {
            if (ratingCurr === "buy" || ratingCurr === "strong buy") {
              isCorrect = changePct > 0;
            }
          } else if (ratingPrev === "buy" || ratingPrev === "strong buy") {
            if (ratingCurr === "sell" || ratingCurr === "strong sell") {
              isCorrect = changePct < 0;
            }
          }
          
          // กรณี rating ไม่เปลี่ยน (แต่ price เปลี่ยน)
          if (ratingNotChanged) {
            if (ratingCurr === "buy" || ratingCurr === "strong buy") {
              isCorrect = changePct > 0;
            } else if (ratingCurr === "sell" || ratingCurr === "strong sell") {
              isCorrect = changePct < 0;
            }
          }

          if (isCorrect) {
            correct += 1;
          } else {
            incorrect += 1;
          }
        });

        const total = correct + incorrect;
        const accuracy_pct = total > 0 ? (correct / total * 100) : 0;

        setAccuracy({
          accuracy: Math.round(accuracy_pct),
          correct: correct,
          incorrect: incorrect,
          total: total
        });
      } else {
        setAccuracy({ accuracy: 0, correct: 0, incorrect: 0, total: 0 });
      }
    }, [rawHistoryData, filterRating]);

    if (!item) return null;

    const handleRatingFilterClick = (rating) => {
      setFilterRating(filterRating === rating ? null : rating);
    };

    const formatModalDate = (dateStr) => {
      if (!dateStr) return "";
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;

        const day = d.getDate();
        const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const year = d.getFullYear();
        const today = new Date();
        const isToday = d.toDateString() === today.toDateString();

        return `${day} ${month} ${year}${isToday ? " • Today" : ""}`;
      } catch {
        return dateStr;
      }
    };

    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center p-2 sm:p-4">
        <div className="absolute inset-0 bg-[#0B102A]/40 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
        <div className="relative bg-white w-full max-w-[600px] rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">

          {/* Header Section - Dark Theme */}
          <div className="bg-[#0B102A] px-3 sm:px-6 py-3 sm:py-5">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 sm:w-14 sm:h-14 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {!logoError ? (
                    <img 
                      src={(() => {
                        const companyName = item.underlyingName || item.displayName || item.description || '';
                        const slug = getLogoSlug(companyName);
                        const url = `https://s3-symbol-logo.tradingview.com/${slug}.svg`;
                        console.log('📸 Company:', companyName);
                        console.log('📸 Logo Slug:', slug);
                        console.log('📸 Logo URL:', url);
                        return url;
                      })()}
                      alt={item.displaySymbol}
                      className="w-full h-full object-contain rounded-xl"
                      onError={() => {
                        console.log('❌ Logo failed to load for:', item.displaySymbol);
                        setLogoError(true);
                      }}
                      onLoad={() => console.log('✅ Logo loaded successfully for:', item.displaySymbol)}
                    />
                  ) : (
                    <span className="text-white text-base sm:text-xl font-bold">{item.displaySymbol?.[0] || "?"}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg sm:text-[26px] font-bold text-white truncate">{item.displaySymbol}</h3>
                  <p className="text-[11px] sm:text-sm text-gray-400 mt-0 truncate">{item.displayName}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-2">
                <div className="text-base sm:text-[22px] font-bold text-white">${formatPrice(currentPrice)}</div>
                <div className={`text-[10px] sm:text-sm font-medium mt-0 ${currentChangePercent >= 0 ? "text-[#27AE60]" : "text-[#EB5757]"}`}>
                  {currentChange >= 0 ? "+" : ""}{formatPrice(currentChange)} ({currentChangePercent >= 0 ? "+" : ""}{formatPct(currentChangePercent)}%)
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center mb-1 mt-0">
              <p className="text-[10px] sm:text-xs text-gray-400">Filter Accuracy</p>
              <p className="text-[10px] sm:text-xs text-gray-400 text-right">Auto-selected : Current Signal</p>
            </div>

            {/* Filter Accuracy Section */}
            <div>

              {/* Rating Buttons */}
              <div className="flex gap-1.5 sm:gap-2 mb-2 overflow-x-auto pb-1">
                {["Strong Sell", "Sell", "Buy", "Strong Buy"].map((rating) => {
                  const isSelected = filterRating === rating;
                  const isSell = rating === "Sell" || rating === "Strong Sell";
                  const isBuy = rating === "Buy" || rating === "Strong Buy";

                  let selectedClasses = "";
                  if (isSelected) {
                    if (isSell) {
                      selectedClasses = "bg-[#EB5757]/20 border-[#EB5757] text-[#EB5757]";
                    } else if (isBuy) {
                      selectedClasses = "bg-[#27AE60]/20 border-[#27AE60] text-[#27AE60]";
                    }
                  } else {
                    selectedClasses = "bg-transparent border-gray-600 text-gray-300 hover:border-gray-500";
                  }

                  return (
                    <button
                      key={rating}
                      onClick={() => handleRatingFilterClick(rating)}
                      className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-bold border-2 transition-all whitespace-nowrap ${selectedClasses}`}
                    >
                      {rating}
                    </button>
                  );
                })}
              </div>

              {/* Accuracy Metrics */}
              <div className="border border-gray-600 rounded-lg p-2 sm:p-3 bg-gray-800/50">
                <div className="flex items-center gap-4 sm:gap-8">
                  <div className="flex items-center gap-2 sm:gap-4">
                    <div className="text-center px-2 sm:px-4">
                      <div className="text-2xl sm:text-3xl font-bold text-[#EB5757]">{Math.round(accuracy.accuracy)}%</div>
                      <div className="text-[10px] sm:text-xs text-white mt-0.5 sm:mt-1">accuracy</div>
                    </div>
                    <div className="h-8 sm:h-12 w-px bg-gray-500"></div>
                  </div>
                  <div className="flex flex-col gap-1.5 sm:gap-2 text-xs sm:text-sm">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-[#27AE60]"></div>
                      <span className="text-white font-medium text-[11px] sm:text-sm">Correct : {accuracy.correct}</span>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-[#EB5757]"></div>
                      <span className="text-white font-medium text-[11px] sm:text-sm">Incorrect : {accuracy.incorrect}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline Section - Light Theme */}
          <div className="bg-white p-3 sm:p-6 max-h-[50vh] sm:max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="py-12 sm:py-20 text-center">
                <div className="animate-spin rounded-full h-10 w-10 sm:h-12 sm:w-12 border-b-2 border-[#0B102A] mx-auto"></div>
                <p className="text-gray-400 mt-3 sm:mt-4 text-sm">Loading history...</p>
              </div>
            ) : historyData.length > 0 ? (
              <div className="relative">
                <div className="absolute left-[13px] sm:left-[15px] top-0 w-[2px] bg-gray-200" style={{ height: `${(historyData.length - 1) * 160 + 18}px` }}></div>

                <div className="space-y-4 sm:space-y-6">
                  {historyData.map((log, idx) => {
                    const scorePrev = RATING_SCORE[(log.prev || "").toLowerCase()] || 0;
                    const scoreCurr = RATING_SCORE[(log.rating || "").toLowerCase()] || 0;
                    const isPositive = (scoreCurr > scorePrev);
                    const isNegative = (scoreCurr < scorePrev);

                    let dotColor = "bg-gray-400";
                    if (isPositive) dotColor = "bg-[#27AE60]";
                    else if (isNegative) dotColor = "bg-[#EB5757]";

                    const changePct = log.change_pct || 0;

                    return (
                      <div key={idx} className="relative pl-9 sm:pl-12">
                        {/* Timeline Dot and Date */}
                        <div className="flex items-center mb-1.5 sm:mb-2">
                          <div className={`absolute left-[14px] sm:left-[16px] w-7 h-7 sm:w-9 sm:h-9 rounded-full ${dotColor} flex items-center justify-center`} style={{ transform: 'translateX(-50%)' }}>
                            <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-white"></div>
                          </div>
                          <span className="text-xs sm:text-sm font-semibold text-gray-900">{formatModalDate(log.timestamp || log.date)}</span>
                        </div>

                        {/* Content Card */}
                        <div className="bg-white rounded-lg sm:rounded-xl p-3 sm:p-4 shadow-lg">
                          {/* Signal Change */}
                          <div className="mb-2 sm:mb-3 flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-gray-100 rounded text-[10px] sm:text-xs text-gray-600 font-medium">Signal</div>
                            <span className={`text-xs sm:text-sm font-bold ${getRatingTextColor(log.prev)}`}>{log.prev || "Unknown"}</span>
                            <svg className="w-3 h-3 sm:w-4 sm:h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                            <span className={`text-xs sm:text-sm font-bold ${getRatingTextColor(log.rating)}`}>{log.rating}</span>
                          </div>

                          {/* Horizontal Divider */}
                          <div className="border-b border-gray-300 mb-1.5 sm:mb-2"></div>

                          {/* Price Info */}
                          <div className="flex items-start justify-between text-xs sm:text-base">
                            <div className="flex flex-col">
                              <div className="text-[10px] sm:text-sm text-gray-500 mb-0">Prev Close</div>
                              <div className="text-sm sm:text-lg font-semibold text-gray-900 font-mono">${formatPrice(log.prev_close || 0)}</div>
                            </div>
                            <div className="flex items-center -space-x-2 sm:-space-x-3 text-gray-500 pt-3 sm:pt-5">
                              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                            <div className="text-right flex flex-col">
                              <div className="text-[10px] sm:text-sm text-gray-500 mb-0">Result</div>
                              <div className="text-sm sm:text-lg font-semibold text-gray-900 font-mono">${formatPrice(log.result_price || 0)}</div>
                              <div className={`text-xs sm:text-sm font-semibold mt-0 font-mono ${changePct >= 0 ? "text-[#27AE60]" : "text-[#EB5757]"}`}>
                                ({changePct >= 0 ? "+" : ""}{formatPct(changePct)}%)
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="py-12 sm:py-20 text-center">
                <div className="bg-blue-50 w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
                  <svg className="w-8 h-8 sm:w-10 sm:h-10 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h4 className="text-gray-900 font-bold text-base sm:text-lg">No signal changes yet</h4>
                <p className="text-gray-400 text-xs sm:text-sm mt-2">We'll notify you as soon as the technical trend shifts.</p>
              </div>
            )}

            {/* Close Button */}
            <div className="mt-4 sm:mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 sm:px-6 py-1.5 sm:py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs sm:text-sm font-medium transition-colors"
              >
                close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  export default function Suggestion() {
    const [timeframe, setTimeframe] = useState("1D");
    const [country, setCountry] = useState("All");
    const [searchTerm, setSearchTerm] = useState("");
    const [data, setData] = useState([]);
    const [filterRating, setFilterRating] = useState(null);
    const [changeFilter, setChangeFilter] = useState("All");
    const [selectedItem, setSelectedItem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
    const [lastUpdateTime, setLastUpdateTime] = useState(null);

    const [showCountryMenu, setShowCountryMenu] = useState(false);
    const countryDropdownRef = useRef(null);
    const selectedCountryLabel = useMemo(() => countryOptions.find((c) => c.code === country)?.label || "All Markets", [country]);

    const [hoveredRow, setHoveredRow] = useState(null);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const tableRef = useRef(null);

    useEffect(() => {
      const handler = (e) => { if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target)) setShowCountryMenu(false); };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);

    useEffect(() => {
      let isMounted = true;
      async function fetchData() {
        try {
          const ratingsApiUrl = USE_MOCK_DATA ? MOCK_RATINGS_API : RATINGS_API;
          const [resDR, resRating] = await Promise.all([fetch(API_URL), fetch(ratingsApiUrl)]);

          if (!resDR.ok) {
            throw new Error(`DR API error: ${resDR.status} ${resDR.statusText}`);
          }
          if (!resRating.ok) {
            throw new Error(`Ratings API error: ${resRating.status} ${resRating.statusText}`);
          }

          const jsonDR = await resDR.json();
          const jsonRating = await resRating.json();
          if (!isMounted) return;

          // Get updated_at from API response
          if (jsonRating.updated_at) {
            const apiDate = new Date(jsonRating.updated_at);
            if (!isNaN(apiDate.getTime())) {
              setLastUpdateTime(apiDate);
            } else {
              // Fallback to current time if API date is invalid
              setLastUpdateTime(new Date());
            }
          } else {
            // Fallback to current time if API doesn't provide updated_at
            setLastUpdateTime(new Date());
          }

          const ratingMap = {};
          (jsonRating.rows || []).forEach((r) => { if (r.ticker) ratingMap[r.ticker.toUpperCase()] = r; });

          // Build a map of all DRs grouped by underlying
          const drByUnderlying = new Map();
          (jsonDR.rows || []).forEach((item) => {
            let uName = item.underlying || (item.symbol || "").toUpperCase().replace(/\d+$/, "").toUpperCase().trim();

            if (USE_MOCK_DATA && uName !== "AAPL") {
              return;
            }

            if (!drByUnderlying.has(uName)) {
              drByUnderlying.set(uName, []);
            }
            drByUnderlying.get(uName).push(item);
          });

          const underlyingMap = new Map();
          drByUnderlying.forEach((drList, uName) => {

            let mostPopularDR = null;
            let maxVolume = -1;
            drList.forEach((dr) => {
              const vol = Number(dr.totalVolume) || 0;
              if (vol > maxVolume) {
                maxVolume = vol;
                mostPopularDR = {
                  symbol: dr.symbol || "",
                  volume: vol
                };
              }
            });

            if (!mostPopularDR && drList.length > 0) {
              mostPopularDR = {
                symbol: drList[0].symbol || "",
                volume: 0
              };
            }

            let highSensitivityDR = null;
            let minBid = Infinity;
            drList.forEach((dr) => {
              const bid = Number(dr.bidPrice) || 0;
              if (bid > 0 && bid < minBid) {
                minBid = bid;
                highSensitivityDR = {
                  symbol: dr.symbol || "",
                  bid: bid
                };
              }
            });

            if (drList.length === 1 && drList[0]) {
              const singleDR = drList[0];
              const vol = Number(singleDR.totalVolume) || 0;
              const bid = Number(singleDR.bidPrice) || 0;

              if (!mostPopularDR) {
                mostPopularDR = { symbol: singleDR.symbol || "", volume: vol };
              }
              if (!highSensitivityDR && bid > 0) {
                highSensitivityDR = { symbol: singleDR.symbol || "", bid: bid };
              }
            }

            const firstItem = drList[0];
            const rt = ratingMap[uName];
            underlyingMap.set(uName, {
              ...firstItem,
              last: rt?.price || 0,
              percentChange: rt?.changePercent || 0,
              change: rt?.change || 0,
              high: rt?.high || 0,
              low: rt?.low || 0,
              displaySymbol: uName,
              displayName: getShortName(firstItem),
              ratingDay: rt?.daily?.rating ?? "Unknown",
              prevDay: rt?.daily?.prev ?? "Unknown",
              timeDay: rt?.daily?.changed_at,
              ratingWeek: rt?.weekly?.rating ?? "Unknown",
              prevWeek: rt?.weekly?.prev ?? "Unknown",
              timeWeek: rt?.weekly?.changed_at,
              ratingDayHistory: rt?.daily?.history || [],
              ratingWeekHistory: rt?.weekly?.history || [],
              currency: rt?.currency || "",
              exchangeCountry: getCountryFromExchange(firstItem.underlyingExchange),
              mostPopularDR: mostPopularDR,
              highSensitivityDR: highSensitivityDR
            });
          });
          setData(Array.from(underlyingMap.values()));
          setLoading(false);
        } catch (err) {
          if (isMounted) {
            console.error('Error fetching data:', err);
            setLoading(false);
          }
        }
      }
      fetchData();
      const intervalId = setInterval(fetchData, 60000);
      return () => { isMounted = false; clearInterval(intervalId); };
    }, []);

    const handleSort = (key) => {
      setSortConfig((prev) => {
        if (prev.key === key) {
          if (prev.direction === "asc") return { key, direction: "desc" };
          return { key: null, direction: "asc" };
        }
        return { key, direction: "asc" };
      });
    };

    const handleRatingCellMouseEnter = (e, row) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltipPosition({
        x: rect.left + rect.width / 2,
        y: rect.top
      });
      setHoveredRow(row);
    };

    const handleRatingCellMouseLeave = () => {
      setHoveredRow(null);
    };

    const processedData = useMemo(() => {
      const term = searchTerm.toLowerCase();
      let mapped = data.map((row) => {
        let currentRating = timeframe === "1W" ? row.ratingWeek : row.ratingDay;
        let prevRating = timeframe === "1W" ? row.prevWeek : row.prevDay;
        let changeTime = timeframe === "1W" ? row.timeWeek : row.timeDay;

        const currScore = RATING_SCORE[currentRating.toLowerCase()] || 0;
        const prevScore = RATING_SCORE[prevRating.toLowerCase()] || 0;
        return {
          ...row,
          displayPct: row.percentChange,
          displayChange: row.change,
          technicalRating: currentRating,
          prevTechnicalRating: prevRating,
          displayTime: formatSmartTime(changeTime),
          changeDirection: currScore > prevScore ? "Positive" : currScore < prevScore ? "Negative" : "Neutral",
          sortPrice: Number(row.last) || 0,
          hasData: row.percentChange !== undefined
        };
      });

      if (term) mapped = mapped.filter(row =>
        row.displaySymbol.toLowerCase().includes(term) ||
        row.displayName.toLowerCase().startsWith(term)
      );

      if (filterRating) mapped = mapped.filter(row => row.technicalRating.toLowerCase() === filterRating.toLowerCase());
      if (changeFilter !== "All") {
        if (changeFilter === "Positive") mapped = mapped.filter(row => row.changeDirection === "Positive");
        else if (changeFilter === "Negative") mapped = mapped.filter(row => row.changeDirection === "Negative");
      }
      if (country !== "All") mapped = mapped.filter(row => row.exchangeCountry === country);

      mapped = mapped.filter(row => {
        const rating = row.technicalRating.toLowerCase();
        return rating !== "neutral";
      });
      if (sortConfig.key) {
        mapped.sort((a, b) => {
          const key = sortConfig.key;
          let valA, valB;
          switch (key) {
            case "symbol": valA = a.displaySymbol; valB = b.displaySymbol; break;
            case "rating": valA = RATING_SCORE[a.technicalRating.toLowerCase()]; valB = RATING_SCORE[b.technicalRating.toLowerCase()]; break;
            case "time": valA = new Date(a.timeDay || a.timeWeek).getTime(); valB = new Date(b.timeDay || b.timeWeek).getTime(); break;
            case "popularDR": valA = a.mostPopularDR?.volume || 0; valB = b.mostPopularDR?.volume || 0; break;
            case "sensitivityDR": valA = a.highSensitivityDR?.bid || Infinity; valB = b.highSensitivityDR?.bid || Infinity; break;
            case "price": valA = a.sortPrice; valB = b.sortPrice; break;
            case "pct": valA = a.displayPct; valB = b.displayPct; break;
            case "chg": valA = a.displayChange; valB = b.displayChange; break;
            case "high": valA = a.high; valB = b.high; break;
            case "low": valA = a.low; valB = b.low; break;
            default: return 0;
          }
          const dir = sortConfig.direction === "asc" ? 1 : -1;
          return (typeof valA === "string" ? valA.localeCompare(valB) : valA - valB) * dir;
        });
      }
      return mapped;
    }, [data, searchTerm, timeframe, sortConfig, filterRating, changeFilter, country]);

    const SortIndicator = ({ colKey }) => {
      const active = sortConfig.key === colKey;
      const direction = sortConfig.direction;
      const upColor = active && direction === "asc" ? "#FFFFFF" : "rgba(255, 255, 255, 0.4)";
      const downColor = active && direction === "desc" ? "#FFFFFF" : "rgba(255, 255, 255, 0.4)";
      return (
        <div className="flex items-center ml-0 flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="w-[10px] sm:w-[12px] h-[10px] sm:h-[12px] transition-all duration-200">
            <path d="M14 2.256V30c-2.209 0-4-1.791-4-4V13H4.714c-.633 0-.949-.765-.502-1.212l9.607-9.607C13.886 2.114 14 2.162 14 2.256z" fill={upColor} />
            <path d="M27.788 20.212l-9.6 9.6C18.118 29.882 18 29.832 18 29.734V2c2.209 0 4 1.791 4 4v13h5.286C27.918 19 28.235 19.765 27.788 20.212z" fill={downColor} />
          </svg>
        </div>
      );
    };

    const handleRatingFilterClick = (rating) => { if (filterRating === rating) setFilterRating(null); else setFilterRating(rating); };
    const RATINGS_OPTIONS = ["Strong Buy", "Buy", "Sell", "Strong Sell"];
    const CHANGE_OPTIONS = [{ label: "Latest Only", val: "All" }, { label: "Show Changes", val: "ShowChanges", color: "bg-blue-500" }, { label: "Positive", val: "Positive", color: "bg-[#137333]" }, { label: "Negative", val: "Negative", color: "bg-[#C5221F]" }];
    const shouldShowChange = filterRating !== null || changeFilter !== "All";

    return (
      <div className="h-screen w-full bg-[#f5f5f5] overflow-hidden flex justify-center">
        <div className="w-full max-w-[1248px] flex flex-col h-full">
          <div className="pt-6 md:pt-10 pb-0 px-4 md:px-0 flex-shrink-0" style={{ overflow: 'visible', zIndex: 100 }}>
            <div className="w-full md:w-[1040px] max-w-full mx-auto md:scale-[1.2] md:origin-top" style={{ overflow: 'visible' }}>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 md:mb-3 text-black">Suggestion</h1>
              <p className="text-[#6B6B6B] mb-4 sm:mb-6 md:mb-8 text-xs sm:text-sm md:text-base">Technical Ratings (Underlying Assets)</p>

              {/* Filters Row */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4 mb-2">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto">
                  <div className="flex bg-white p-1 rounded-xl border border-gray-200 shadow-sm h-[37.33px] w-full sm:w-auto">
                    <button onClick={() => setTimeframe("1D")} className={`flex-1 sm:flex-none px-3 py-1 rounded-lg text-xs sm:text-sm font-medium transition-all h-full ${timeframe === "1D" ? "bg-[#0B102A] text-white shadow-md" : "text-gray-800 hover:bg-gray-50"}`}>1 Day</button>
                    <button onClick={() => setTimeframe("1W")} className={`flex-1 sm:flex-none px-3 py-1 rounded-lg text-xs sm:text-sm font-medium transition-all h-full ${timeframe === "1W" ? "bg-[#0B102A] text-white shadow-md" : "text-gray-800 hover:bg-gray-50"}`}>1 Week</button>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative z-[200] flex-1 sm:flex-initial" ref={countryDropdownRef} style={{ isolation: 'isolate', overflow: 'visible' }}>
                      <button type="button" onClick={() => setShowCountryMenu((prev) => !prev)} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 w-full sm:min-w-[180px] h-[37.33px]">
                        <span className="truncate">{selectedCountryLabel}</span>
                        <svg className={`h-4 w-4 flex-shrink-0 transition-transform text-gray-500 ${showCountryMenu ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {showCountryMenu && (
                        <div className="absolute left-0 top-full z-[9999] mt-2 w-full sm:w-56 max-h-72 overflow-auto rounded-2xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.15)] py-1" style={{ transform: 'translateZ(0)' }}>
                          {countryOptions.map((opt) => (
                            <button key={opt.code} onClick={() => { setCountry(opt.code); setShowCountryMenu(false); }} className={`flex w-full items-center justify-between px-4 py-1.5 text-left text-xs sm:text-sm transition-colors ${country === opt.code ? "bg-[#EEF2FF] text-[#0B102A] font-semibold" : "text-gray-700 hover:bg-gray-50"}`}>
                              <span>{opt.label}</span>
                              {country === opt.code && <i className="bi bi-check-lg text-[#0B102A] text-base"></i>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <FilterDropdown label="Rating change" value={changeFilter} options={CHANGE_OPTIONS} onSelect={setChangeFilter} />
                  </div>
                </div>
                <div className="relative w-full md:w-auto">
                  <input type="text" placeholder="Search DR..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="bg-white pl-4 pr-10 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#0B102A] w-full md:w-64 text-sm shadow-sm h-[37.33px]" />
                  <i className="bi bi-search absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" style={{ fontSize: 14 }} />
                </div>
              </div>

              {/* Rating Select Row */}
              <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-2 gap-0 md:gap-2">
                <div className="overflow-x-auto pb-1 w-full md:w-auto">
                  <div className="flex md:inline-flex items-center gap-3 bg-white rounded-xl px-2 py-1.5 shadow-sm border border-gray-100 w-full md:w-auto h-[37.33px]">
                    <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">Ratings</span>
                    <div className="flex gap-2 flex-1 md:flex-initial h-full">
                      {RATINGS_OPTIONS.map((rating) => (
                        <button key={rating} onClick={() => handleRatingFilterClick(rating)} className={`px-2 py-1 rounded-lg text-xs font-bold transition-all flex-1 md:flex-initial h-full whitespace-nowrap ${getRatingStyle(rating)} ${filterRating === rating ? "ring-2 ring-offset-1 ring-black/10 shadow-md scale-105" : "opacity-60 hover:opacity-100"}`}>{rating}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5 text-xs text-gray-500 pr-1 mt-1">
                  <div>Found {processedData.length.toLocaleString()} results</div>
                  {lastUpdateTime && (
                    <div>Last Updated: {lastUpdateTime.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Main Content - Scrollable */}
          <div className="flex-1 overflow-hidden pb-6 md:pb-10 mt-0 md:mt-9 px-4 md:px-0">
            <div className="h-full bg-white rounded-xl shadow border border-gray-100 overflow-auto hide-scrollbar">
              
              {/* Mobile Card View */}
              <div className="block lg:hidden p-3">
                <div className="space-y-3">
                  {processedData.map((row, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedItem(row)}
                      className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 cursor-pointer hover:shadow-md transition-shadow"
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0 mr-2">
                          <div className="font-bold text-[#2F80ED] text-sm truncate">{row.displaySymbol}</div>
                          <div className="text-xs text-gray-600 truncate">{row.displayName}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="flex items-baseline justify-end gap-0.5">
                            <span className="font-medium text-gray-800 text-sm font-mono">{formatPrice(row.sortPrice)}</span>
                            <span className="text-xs text-gray-600 uppercase">{row.currency}</span>
                          </div>
                          <div className={`text-xs font-medium ${row.displayPct > 0 ? "text-[#27AE60]" : row.displayPct < 0 ? "text-[#EB5757]" : "text-gray-800"}`}>
                            {row.hasData ? <span className="font-mono">{row.displayPct > 0 ? "+" : ""}{formatPct(row.displayPct)}%</span> : "-"}
                          </div>
                        </div>
                      </div>

                      {/* Rating */}
                      <div className="mb-2 py-2 border-y border-gray-100">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[10px] text-gray-500">Technical Rating</div>
                          <div className="ml-2">
                            <RatingChangeCell prev={row.prevTechnicalRating} current={row.technicalRating} showChange={shouldShowChange} />
                          </div>
                        </div>
                      </div>

                      {/* Details Grid */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-gray-500 text-[10px]">Last Update</div>
                          <div className="text-gray-800 font-medium">{row.displayTime}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-gray-500 text-[10px]">Change</div>
                          <div className={`font-medium ${row.displayChange > 0 ? "text-[#27AE60]" : row.displayChange < 0 ? "text-[#EB5757]" : "text-gray-800"}`}>
                            {row.hasData ? (row.displayChange > 0 ? `+${formatPrice(row.displayChange)}` : formatPrice(row.displayChange)) : "-"}
                          </div>
                        </div>
                        {row.mostPopularDR && (
                          <div>
                            <div className="text-gray-500 text-[10px]">Popular DR</div>
                            <div className="font-bold text-[#50B728] truncate">{row.mostPopularDR.symbol}</div>
                          </div>
                        )}
                        {row.highSensitivityDR && (
                          <div className="text-right">
                            <div className="text-gray-500 text-[10px]">Sensitivity DR</div>
                            <div className="font-bold text-[#0007DE] truncate">{row.highSensitivityDR.symbol}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Desktop Table View */}
              <table className="hidden lg:table w-full text-left border-collapse text-[14.4px]">
                <thead className="bg-[#0B102A] text-white font-semibold sticky top-0" style={{ zIndex: 50 }}>
                  <tr className="h-[50px]">
                    {[{ key: 'symbol', label: 'Symbol', align: 'left' }, { key: 'rating', label: 'Technical Rating', align: 'center', width: '240px' }, { key: 'time', label: 'Last Update', align: 'center' }, { key: 'popularDR', label: 'Most Popular DR', align: 'center' }, { key: 'sensitivityDR', label: 'High Sensitivity DR', align: 'center' }, { key: 'price', label: 'Price', align: 'right' }, { key: 'pct', label: '%Change', align: 'right' }, { key: 'chg', label: 'Change', align: 'right' }, { key: 'high', label: 'High', align: 'right' }, { key: 'low', label: 'Low', align: 'right' }].map(h => (
                      <th
                        key={h.key}
                        className={`px-4 cursor-pointer text-${h.align} whitespace-nowrap relative`}
                        style={h.width ? { minWidth: h.width, width: h.width } : {}}
                        onClick={() => handleSort(h.key)}
                      >
                        <div className={`flex items-center justify-${h.align === 'left' ? 'start' : h.align === 'center' ? 'center' : 'end'} gap-0.5`}>{h.label} <SortIndicator colKey={h.key} /></div>
                        {sortConfig.key === h.key && (
                          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2F80ED] z-50">
                            <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-[#2F80ED]"></div>
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100" ref={tableRef}>
                  {processedData.map((row, idx) => (
                    <tr
                      key={idx}
                      onClick={() => setSelectedItem(row)}
                      className={`transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-[#F7F8FA]"} hover:bg-gray-50 cursor-pointer relative`}
                      style={{ height: "52px" }}
                    >
                      <td className="px-4 align-middle overflow-hidden max-w-[130px]">
                        <div className="flex flex-col w-full">
                          <span className="font-bold text-[#2F80ED] truncate block">{row.displaySymbol}</span>
                          <span className="text-[12.4px] text-gray-600 truncate block" title={row.displayName}>{row.displayName}</span>
                        </div>
                      </td>
                      <td
                        className="px-3 align-middle text-center"
                        style={{ minWidth: '190px', width: '190px' }}
                        onMouseEnter={(e) => {
                          e.stopPropagation();
                          handleRatingCellMouseEnter(e, row);
                        }}
                        onMouseLeave={(e) => {
                          e.stopPropagation();
                          handleRatingCellMouseLeave();
                        }}
                      >
                        <RatingChangeCell prev={row.prevTechnicalRating} current={row.technicalRating} showChange={shouldShowChange} />
                      </td>
                      <td className="px-4 align-middle text-center whitespace-nowrap text-gray-800 font-medium">{row.displayTime}</td>
                      <td className="px-4 align-middle text-center">
                        {row.mostPopularDR ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-bold text-[#50B728]">{row.mostPopularDR.symbol}</span>
                            <span className="text-gray-600 text-[13.4px]">Vol: <span className="font-mono">{formatInt(row.mostPopularDR.volume)}</span></span>
                          </div>
                        ) : <span className="text-gray-600">-</span>}
                      </td>
                      <td className="px-4 align-middle text-center">
                        {row.highSensitivityDR ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-bold text-[#0007DE]">{row.highSensitivityDR.symbol}</span>
                            <span className="text-gray-600 text-[13.4px]">Bid: <span className="font-mono">{formatPrice(row.highSensitivityDR.bid)}</span></span>
                          </div>
                        ) : <span className="text-gray-600">-</span>}
                      </td>
                      <td className="px-4 align-middle text-right">{renderPriceWithCurrency(row.sortPrice, row.currency)}</td>
                      <td className={`px-4 align-middle text-right font-medium ${row.displayPct > 0 ? "text-[#27AE60]" : row.displayPct < 0 ? "text-[#EB5757]" : "text-gray-800"}`}>{row.hasData ? <span className="font-mono">{row.displayPct > 0 ? "+" : ""}{formatPct(row.displayPct)}%</span> : "-"}</td>
                      <td className={`px-4 align-middle text-right font-medium ${row.displayChange > 0 ? "text-[#27AE60]" : row.displayChange < 0 ? "text-[#EB5757]" : "text-gray-800"}`}>
                        <div className="flex items-baseline justify-end gap-0.5">
                          <span className="font-mono">{row.hasData ? (row.displayChange > 0 ? `+${formatPrice(row.displayChange)}` : formatPrice(row.displayChange)) : "-"}</span>
                        </div>
                      </td>
                      <td className="px-4 align-middle text-right">{renderPriceWithCurrency(row.high, row.currency)}</td>
                      <td className="px-4 align-middle text-right">{renderPriceWithCurrency(row.low, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Tooltip */}
        {/* Desktop: hover, Mobile: click */}
        <Tooltip
          show={window.innerWidth >= 640 ? hoveredRow !== null : mobileTooltipRow !== null}
          position={tooltipPosition}
          tooltipRef={tooltipRef}
        >
          Click to view rating history
        </Tooltip>

        {/* Rating History Modal */}
        {selectedItem && <RatingHistoryModal item={selectedItem} timeframe={timeframe} onClose={() => setSelectedItem(null)} />}
      </div>
    );
  }