import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

// Read API base from Vite environment variables. Support multiple names
// (some projects use VITE_NEWS_API, others VITE_NEWS_API_URL or VITE_API_BASE)
const API_BASE = import.meta.env.VITE_NEWS_API || import.meta.env.VITE_NEWS_API_URL || import.meta.env.VITE_API_BASE || '';
const TH_QUERY = "ตลาดหุ้น OR หุ้น OR ดัชนี";
const EN_QUERY = "stock market";
const DEFAULT_SYMBOLS = ["NVDA", "TSLA", "GOOG", "AAPL", "MSFT", "AMZN", "META", "BABA"];

function timeAgo(ts) {
  try {
    let d;
    if (typeof ts === "number") {
      d = new Date(ts * 1000); // finnhub epoch seconds
    } else {
      d = new Date(ts);
    }
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleString();
  } catch {
    return "";
  }
}

const NewsCard = ({ ticker, quote, news }) => {
  const isPositive = quote && quote.change_pct >= 0;

  return (
    <a href={news.url} target="_blank" rel="noreferrer" className="block group">
      <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow flex flex-col md:flex-row gap-6 items-start">
        {ticker && quote && (
          <div className="flex-shrink-0 w-full md:w-[120px] bg-[#F9FAFB] rounded-lg border border-gray-100 p-3 flex flex-col items-center justify-center text-center gap-2">
            <div className="w-10 h-10 rounded-full bg-white/80 flex items-center justify-center overflow-hidden">
              {quote.logo_url ? (
                <img src={quote.logo_url} alt={ticker} className="w-full h-full object-contain" />
              ) : (
                <span className="text-sm font-bold text-gray-900">{ticker[0]}</span>
              )}
            </div>
            <div className="text-sm font-bold text-gray-900">{ticker}</div>
            <div className={`text-xs font-bold ${isPositive ? 'text-[#137333]' : 'text-[#C5221F]'}`}>
              {isPositive ? '+' : ''}{quote.change_pct?.toFixed(2)}%
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
            {news.title}
          </h3>
          <p className="text-sm text-gray-600 mb-3 line-clamp-2">
            {news.summary}
          </p>
          <div className="text-xs text-gray-400">
            {timeAgo(news.published_at)}
          </div>
        </div>
      </div>
    </a>
  );
};

const News = () => {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [allSymbols, setAllSymbols] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Data for "Home" view
  const [marketNews, setMarketNews] = useState([]);
  const [defaultUpdates, setDefaultUpdates] = useState([]);
  const [loadingHome, setLoadingHome] = useState(false);

  // Data for "Search" view
  const [symbolNews, setSymbolNews] = useState([]);
  const [quote, setQuote] = useState(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [errorSearch, setErrorSearch] = useState("");

  // Fetch available symbols for suggestions
  useEffect(() => {
    async function loadSymbols() {
      try {
        const res = await axios.get(`${API_BASE}/api/symbols`);
        if (res.data && Array.isArray(res.data)) {
          setAllSymbols(res.data);
        }
      } catch (e) {
        console.error("Failed to load symbols", e);
      }
    }
    loadSymbols();
  }, []);

  // Fetch Market News (Top Stories)
  useEffect(() => {
    let mounted = true;
    async function loadMarket() {
      setLoadingHome(true);
      try {
        const [enRes, thRes] = await Promise.all([
          axios.get(`${API_BASE}/api/news/${encodeURIComponent(EN_QUERY)}`, { params: { limit: 20, language: "en", hours: 72 } }),
          axios.get(`${API_BASE}/api/news/${encodeURIComponent(TH_QUERY)}`, { params: { limit: 20, language: "th", hours: 72 } })
        ]);
        if (!mounted) return;
        const enNews = enRes.data?.news || [];
        const thNews = thRes.data?.news || [];
        const merged = [...enNews, ...thNews].sort((a, b) => {
          const da = a.published_at ? new Date(a.published_at) : new Date(0);
          const db = b.published_at ? new Date(b.published_at) : new Date(0);
          return db - da;
        });

        // Load Default Updates (Mocking the "Latest Updates" list with specific tickers)
        // We fetch quote + news for DEFAULT_SYMBOLS in Parallel
        const updatesPromises = DEFAULT_SYMBOLS.map(async (sym) => {
          try {
            const [qRes, nRes] = await Promise.all([
              axios.get(`${API_BASE}/api/finnhub/quote/${sym}`),
              axios.get(`${API_BASE}/api/finnhub/company-news/${sym}`, { params: { hours: 72, limit: 2 } })
            ]);

            const articles = nRes.data?.news || [];
            return articles.slice(0, 2).map(art => ({
              ticker: sym,
              quote: qRes.data,
              news: art
            }));
          } catch (e) {
            console.error(`Failed to load default data for ${sym}`, e);
            return [];
          }
        });

        const updatesResults = await Promise.all(updatesPromises);
        const updates = updatesResults.flat();

        const toMs = (v) => typeof v === "number" ? v * 1000 : (new Date(v).getTime() || 0);
        updates.sort((a, b) => toMs(b.news.published_at) - toMs(a.news.published_at));

        if (mounted) setDefaultUpdates(updates);

        // Merge general news and company updates for "Top Stories"
        const combinedNews = [
          ...merged.map(item => ({ news: item })), // Wrap general news
          ...updates // Company news already has { news, ticker, quote }
        ];

        combinedNews.sort((a, b) => toMs(b.news.published_at) - toMs(a.news.published_at));

        setMarketNews(combinedNews);

      } catch (e) {
        console.error("Failed to load market news", e);
      } finally {
        if (mounted) setLoadingHome(false);
      }
    }

    if (!selected) {
      loadMarket();
    }

    return () => { mounted = false; };
  }, [selected]);

  // Fetch Search Data
  useEffect(() => {
    if (!selected) return;

    let mounted = true;
    async function loadSymbol() {
      setLoadingSearch(true);
      setErrorSearch("");

      // Determine query symbol (append .BK for Thai stocks)
      let querySymbol = selected;
      const match = allSymbols.find(s => s.symbol === selected);
      if (match && (match.exchange === 'SET' || match.exchange === 'mai')) {
        querySymbol = selected + ".BK";
      }

      try {
        const [qRes, nRes] = await Promise.all([
          axios.get(`${API_BASE}/api/finnhub/quote/${encodeURIComponent(querySymbol)}`),
          axios.get(`${API_BASE}/api/finnhub/company-news/${encodeURIComponent(querySymbol)}`, { params: { hours: 168, limit: 30 } }),
        ]);
        if (!mounted) return;
        setQuote(qRes.data || null);
        setSymbolNews(nRes.data?.news || []);
      } catch (e) {
        console.error("Search error:", e);
        if (!mounted) return;
        setErrorSearch("ไม่สามารถดึงข้อมูลได้ หรือ Symbol ไม่ถูกต้อง");
        setQuote(null);
        setSymbolNews([]);
      } finally {
        if (mounted) setLoadingSearch(false);
      }
    }
    loadSymbol();
    return () => { mounted = false; };
  }, [selected]);

  const topStory = useMemo(() => marketNews.find(item => item.ticker), [marketNews]);


  const onSearchKey = (e) => {
    if (e.key === "Enter") {
      if (suggestions.length > 0) {
        selectSuggestion(suggestions[0]);
        return;
      }

      const raw = search.trim();
      if (!raw) {
        setSelected("");
        setErrorSearch("");
        return;
      }
      const isValid = /^[A-Za-z0-9]+$/.test(raw);
      if (!isValid) {
        setSelected("");
        setErrorSearch("กรุณากรอกรหัส Underlying หรือ Ticker เป็นตัวอักษร/ตัวเลขเท่านั้น");
        return;
      }
      setErrorSearch("");
      setSelected(raw.toUpperCase());
      setShowSuggestions(false);
    }
  };

  const updateSuggestions = (value) => {
    if (value.length > 0) {
      const filtered = allSymbols.filter(s => s.symbol.startsWith(value));
      setSuggestions(filtered.slice(0, 100));
    } else {
      setSuggestions(allSymbols.slice(0, 100));
    }
    setShowSuggestions(true);
  };

  const handleSearchChange = (e) => {
    const newSearch = e.target.value.toUpperCase();
    setSearch(newSearch);
    updateSuggestions(newSearch);
  };

  const handleSearchFocus = () => {
    updateSuggestions(search);
  };

  // Close suggestions when clicking outside would be ideal, 
  // but for now we'll rely on selection or blur (careful with blur vs click)
  // A simple way is to delay hiding on blur to allow click to register
  const handleSearchBlur = () => {
    // Delay hiding to allow item click to register
    setTimeout(() => {
      setShowSuggestions(false);
    }, 200);
  };

  const selectSuggestion = (s) => {
    setSearch(s.symbol);
    setSelected(s.symbol);
    setShowSuggestions(false);
    setErrorSearch("");
  };

  const clearSearch = () => {
    setSearch("");
    setSelected("");
    setSuggestions(allSymbols.slice(0, 100)); // Reset to default suggestions
    setShowSuggestions(true); // Keep open or close? Usually close if cleared via X, but maybe user wants to search again.
    // Let's close it if they click X, or maybe keep it open if they want to pick another?
    // User said "Search" button clears it. 
    // If I click clear, I probably want to reset.
    // Let's keep it closed for now unless they focus again.
    setShowSuggestions(false);
  };

  let suggestionsContent = null;
  if (showSuggestions && suggestions.length > 0) {
    suggestionsContent = (
      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl mt-1 shadow-lg z-50 max-h-60 overflow-y-auto">
        {suggestions.map((s, i) => (
          <div
            key={i}
            className="px-4 py-2 hover:bg-gray-50 cursor-pointer flex justify-between items-center border-b border-gray-50 last:border-0"
            onClick={() => selectSuggestion(s)}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                {s.logo ? (
                  <img
                    src={s.logo}
                    alt={s.symbol}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'block';
                    }}
                  />
                ) : null}
                <span
                  className="text-xs font-bold text-gray-500"
                  style={{ display: s.logo ? 'none' : 'block' }}
                >
                  {s.symbol[0]}
                </span>
              </div>
              <span className="font-bold text-[#0B102A]">{s.symbol}</span>
              {s.exchange && (
                <span className="text-xs font-medium text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50">
                  {s.exchange}
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500 truncate max-w-[150px]">{s.name}</span>
          </div>
        ))}
      </div>
    );
  }

  console.log('suggestionsContent', suggestionsContent);

  return (
    <div className="min-h-screen w-full bg-[#F5F5F5] flex justify-center">
      <div className="w-full max-w-[1248px] px-4 md:px-8 flex flex-col h-full py-10">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2 text-[#0B102A]">News</h1>
            <p className="text-[#6B6B6B] text-sm">Latest market updates, earnings reports, and insights for Underlying Assets</p>
          </div>
          <div className="relative w-full md:w-[300px]">
            <input
              type="text"
              value={search}
              onChange={handleSearchChange}
              onKeyDown={onSearchKey}
              onFocus={handleSearchFocus}
              onBlur={handleSearchBlur}
              placeholder="Search"
              className="w-full bg-white pl-4 pr-10 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#0B102A] text-sm shadow-sm"
            />
            {selected ? (
              <button onClick={clearSearch} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <i className="bi bi-x-lg"></i>
              </button>
            ) : (
              <i className="bi bi-search absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            )}

            {/* Suggestions Dropdown */}
            {suggestionsContent}

          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 pb-10">

          {selected ? (
            /* Search Result View */
            <div className="space-y-6">
              {loadingSearch ? (
                <div className="animate-pulse h-32 bg-gray-200 rounded-xl" />
              ) : errorSearch ? (
                <div className="p-4 bg-red-50 text-red-600 rounded-xl">{errorSearch}</div>
              ) : (
                <>
                  {/* Symbol Banner */}
                  {quote && (
                    <div className="bg-[#0B102A] rounded-2xl p-6 text-white flex items-center justify-between shadow-lg relative overflow-hidden">
                      <div className="relative z-10 flex items-center gap-4">
                        <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center text-xl font-bold overflow-hidden">
                          {quote.logo_url ? (
                            <img src={quote.logo_url} alt={selected} className="w-full h-full object-contain" />
                          ) : (
                            <span>{selected[0]}</span>
                          )}
                        </div>
                        <div>
                          <div className="text-2xl font-bold">{selected}</div>
                        </div>
                      </div>
                      <div className="relative z-10 text-right">
                        <div className="text-3xl font-bold">${quote.price?.toFixed(2)}</div>
                        <div className={`text-sm font-medium ${quote.change_pct >= 0 ? 'text-[#4ADE80]' : 'text-[#F87171]'}`}>
                          {quote.change_pct >= 0 ? '+' : ''}{quote.change_pct?.toFixed(2)}%
                        </div>
                      </div>
                      {/* Decoration */}
                      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2"></div>
                    </div>
                  )}

                  {/* News List */}
                  <div>
                    <h2 className="text-lg font-bold text-[#0B102A] mb-4">Latest News for {selected}</h2>
                    <div className="flex flex-col gap-4">
                      {symbolNews.length > 0 ? (
                        symbolNews.map((news, idx) => (
                          <NewsCard key={idx} news={news} />
                        ))
                      ) : (
                        <div className="text-gray-500 text-center py-10">No news available</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Home View */
            <div className="space-y-8">
              {/* Top Stories Banner */}
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-[#0B102A]">Top Stories</h2>
                {loadingHome ? (
                  <div className="animate-pulse h-48 bg-gray-200 rounded-2xl" />
                ) : topStory ? (
                  <a href={topStory.news.url} target="_blank" rel="noreferrer" className="block group">
                    <div className="bg-[#0B102A] rounded-2xl px-8 py-6 text-white relative overflow-hidden shadow-lg">
                      <div className="relative z-10 max-w-3xl">
                        {topStory.ticker && topStory.quote && (
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center overflow-hidden">
                              {topStory.quote.logo_url ? (
                                <img src={topStory.quote.logo_url} alt={topStory.ticker} className="w-full h-full object-contain" />
                              ) : (
                                <span className="text-sm font-bold text-white">{topStory.ticker[0]}</span>
                              )}
                            </div>
                            <div>
                              <div className="text-sm font-bold text-blue-200">{topStory.ticker}</div>
                            </div>
                          </div>
                        )}
                        <h3 className="text-lg md:text-xl font-semibold leading-snug mb-2 group-hover:text-blue-200 transition-colors">
                          {topStory.news.title}
                        </h3>
                        <div className="text-xs text-blue-200/80">
                          {timeAgo(topStory.news.published_at)}
                        </div>
                      </div>
                      <div className="absolute right-8 top-1/2 transform -translate-y-1/2">
                        {topStory.quote && topStory.quote.logo_url ? (
                          <img src={topStory.quote.logo_url} alt="background" className="w-[96px] h-[96px] object-contain" />
                        ) : (
                          <i className="bi bi-newspaper text-[72px] md:text-[96px]"></i>
                        )}
                      </div>
                    </div>
                  </a>
                ) : (
                  <div className="text-gray-500">No top stories available</div>
                )}
              </div>

              {/* Latest Updates */}
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-[#0B102A]">Latest Updates</h2>
                <div className="flex flex-col gap-4">
                  {loadingHome ? (
                    Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-24 bg-gray-100 rounded-xl" />)
                  ) : defaultUpdates.length > 0 ? (
                    defaultUpdates.map((item, idx) => (
                      <NewsCard
                        key={idx}
                        ticker={item.ticker}
                        quote={item.quote}
                        news={item.news}
                      />
                    ))
                  ) : (
                    <div className="text-gray-500">No updates available</div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default News;