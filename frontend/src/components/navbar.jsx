import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import img from '../assets/logo.png';

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [calendarNotifications, setCalendarNotifications] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isActive = (path) => location.pathname === path;

  // Icon components
  const DRListIcon = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="3" cy="6" r="1.5" fill="currentColor"/>
      <circle cx="3" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="3" cy="18" r="1.5" fill="currentColor"/>
      <rect x="7" y="4" width="14" height="4" rx="0.5" fill="currentColor"/>
      <rect x="7" y="10" width="14" height="4" rx="0.5" fill="currentColor"/>
      <rect x="7" y="16" width="14" height="4" rx="0.5" fill="currentColor"/>
    </svg>
  );

  const CalDRIcon = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 2h14c1.1 0 2 .9 2 2v16c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2z" fill="currentColor"/>
      <rect x="6" y="5" width="12" height="4" rx="1" fill="white"/>
      <rect x="7" y="11" width="2.5" height="2.5" rx="0.3" fill="white"/>
      <rect x="10.75" y="11" width="2.5" height="2.5" rx="0.3" fill="white"/>
      <rect x="14.5" y="11" width="2.5" height="2.5" rx="0.3" fill="white"/>
      <rect x="7" y="14.75" width="2.5" height="2.5" rx="0.3" fill="white"/>
      <rect x="10.75" y="14.75" width="2.5" height="2.5" rx="0.3" fill="white"/>
      <rect x="14.5" y="14.75" width="2.5" height="2.5" rx="0.3" fill="white"/>
      <rect x="7" y="18.5" width="2.5" height="2.5" rx="0.3" fill="white"/>
      <rect x="10.75" y="18.5" width="2.5" height="2.5" rx="0.3" fill="white"/>
      <rect x="14.5" y="18.5" width="2.5" height="2.5" rx="0.3" fill="white"/>
    </svg>
  );

  const SuggestionIcon = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" fill="currentColor"/>
      <path d="M12 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="white"/>
      <path d="M12 19c.55 0 1-.45 1-1v-1h-2v1c0 .55.45 1 1 1z" fill="currentColor"/>
      <path d="M12 1l-1 1v1h2V2l-1-1zM12 23l-1-1v-1h2v1l-1 1zM23 12l-1-1h-1v2h1l1-1zM1 12l1-1h1v2H2l-1-1zM19.07 4.93l-.71.71-1.41-1.41.71-.71 1.41 1.41zM5.64 18.36l-.71.71-1.41-1.41.71-.71 1.41 1.41zM18.36 5.64l.71.71 1.41-1.41-.71-.71-1.41 1.41zM4.93 19.07l.71.71 1.41-1.41-.71-.71-1.41 1.41z" fill="currentColor" opacity="0.3"/>
    </svg>
  );

  const CalendarIcon = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" fill="currentColor"/>
      <path d="M5 3h1v2h2V3h8v2h2V3h1c1.1 0 2 .9 2 2v1H3V5c0-1.1.9-2 2-2z" fill="currentColor" opacity="0.4"/>
      <rect x="7" y="11" width="2" height="2" fill="currentColor"/>
      <rect x="11" y="11" width="2" height="2" fill="currentColor"/>
      <rect x="15" y="11" width="2" height="2" fill="currentColor"/>
      <rect x="7" y="15" width="2" height="2" fill="currentColor"/>
      <rect x="11" y="15" width="2" height="2" fill="currentColor"/>
      <rect x="15" y="15" width="2" height="2" fill="currentColor"/>
    </svg>
  );

  const NewsIcon = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" fill="currentColor"/>
      <path d="M19 3l-4 4h4V3z" fill="currentColor" opacity="0.6"/>
      <line x1="7" y1="9" x2="15" y2="9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="7" y1="12" x2="13" y2="12" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="7" y1="15" x2="11" y2="15" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
  
  // Listen for calendar notification updates
  useEffect(() => {
    const handleNotificationUpdate = (event) => {
      setCalendarNotifications(event.detail.count);
    };
    
    window.addEventListener('calendarNotificationUpdate', handleNotificationUpdate);
    
    return () => {
      window.removeEventListener('calendarNotificationUpdate', handleNotificationUpdate);
    };
  }, []);

  // Close menu when route changes
  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  // Prevent body scroll when menu is open on mobile
  useEffect(() => {
    if (isMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isMenuOpen]);

  return (
    <header className="bg-white sticky top-0 z-[110] shadow-sm border-b border-gray-200">
      {/* Desktop view - inline navigation items */}
      <div className="hidden lg:block w-full px-4 py-5">
        <div className="flex items-center gap-8">
          {/* Logo */}
          <div
            className="cursor-pointer shrink-0"
            onClick={() => navigate('/')}
          >
            <img 
              className="h-10" 
              src={img} 
              alt="Logo" 
            />
          </div>

          {/* Navigation items as inline titles */}
          <div className="flex items-center gap-6 ml-auto pr-4">
            <button
              onClick={() => navigate('/drlist')}
              className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                location.pathname === '/' || isActive('/drlist')
                  ? 'text-blue-500'
                  : 'text-gray-700 hover:text-gray-900'
              }`}
            >
              <DRListIcon className="w-5 h-5" />
              DR List
            </button>

            <button
              onClick={() => navigate('/caldr')}
              className={`flex items-center gap-2 text-sm font-medium transition-colors ${isActive('/caldr') ? 'text-blue-500' : 'text-gray-700 hover:text-gray-900'}`}
            >
              <CalDRIcon className="w-5 h-5" />
              Calculation DR
            </button>

            <button
              onClick={() => navigate('/suggestion')}
              className={`flex items-center gap-2 text-sm font-medium transition-colors ${isActive('/suggestion') ? 'text-blue-500' : 'text-gray-700 hover:text-gray-900'}`}
            >
              <SuggestionIcon className="w-5 h-5" />
              Suggestion
            </button>

            <button
              onClick={() => navigate('/calendar')}
              className={`flex items-center gap-2 text-sm font-medium transition-colors relative ${isActive('/calendar') ? 'text-blue-500' : 'text-gray-700 hover:text-gray-900'}`}
            >
              <CalendarIcon className="w-5 h-5" />
              Calendar
              {calendarNotifications > 0 && (
                <span className="absolute -top-0.5 -right-1.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
              )}
            </button>

            <button
              onClick={() => navigate('/news')}
              className={`flex items-center gap-2 text-sm font-medium transition-colors ${isActive('/news') ? 'text-blue-500' : 'text-gray-700 hover:text-gray-900'}`}
            >
              <NewsIcon className="w-5 h-5" />
              News
            </button>
          </div>
        </div>
      </div>

      {/* Mobile view - hamburger menu */}
      <div className="lg:hidden w-full px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div
            className="cursor-pointer shrink-0"
            onClick={() => navigate('/')}
          >
            <img 
              className="h-8" 
              src={img} 
              alt="Logo" 
            />
          </div>

          {/* Hamburger button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-3 -mr-3 text-gray-700 hover:text-gray-900 rounded-lg relative z-[102]"
            aria-label="Toggle menu"
          >
            {isMenuOpen ? (
              // Close icon (X)
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            ) : (
              // Hamburger icon
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile menu dropdown */}
        {isMenuOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] top-[57px]"
              onClick={() => setIsMenuOpen(false)}
            />
            
            {/* Menu panel */}
            <nav className="fixed left-0 right-0 top-[57px] bg-white border-b border-gray-200 shadow-lg z-[101] max-h-[calc(100vh-57px)] overflow-y-auto">
              <div className="py-2">
                <Link
                  to="/drlist"
                  className={`flex items-center gap-3 px-4 py-3 text-base font-medium transition-colors ${
                    location.pathname === '/' || isActive('/drlist')
                      ? 'text-blue-500 bg-blue-50'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <DRListIcon className="w-5 h-5" />
                  DR List
                </Link>

                <Link
                  to="/caldr"
                  className={`flex items-center gap-3 px-4 py-3 text-base font-medium transition-colors ${
                    isActive('/caldr')
                      ? 'text-blue-500 bg-blue-50'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <CalDRIcon className="w-5 h-5" />
                  Calculation DR
                </Link>

                <Link
                  to="/suggestion"
                  className={`flex items-center gap-3 px-4 py-3 text-base font-medium transition-colors ${
                    isActive('/suggestion')
                      ? 'text-blue-500 bg-blue-50'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <SuggestionIcon className="w-5 h-5" />
                  Suggestion
                </Link>

                <Link
                  to="/calendar"
                  className={`flex items-center gap-3 px-4 py-3 text-base font-medium transition-colors relative ${
                    isActive('/calendar')
                      ? 'text-blue-500 bg-blue-50'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <CalendarIcon className="w-5 h-5" />
                  <span className="relative">
                    Calendar
                    {calendarNotifications > 0 && (
                      <span className="absolute -top-1 -right-3 flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                      </span>
                    )}
                  </span>
                </Link>

                <Link
                  to="/news"
                  className={`flex items-center gap-3 px-4 py-3 text-base font-medium transition-colors ${
                    isActive('/news')
                      ? 'text-blue-500 bg-blue-50'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <NewsIcon className="w-5 h-5" />
                  News
                </Link>
              </div>
            </nav>
          </>
        )}
      </div>
    </header>
  );
};

export default Navbar;