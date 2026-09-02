import React from 'react';
import { 
  Menu, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Flame, 
  RotateCw,
  X
} from 'lucide-react';
import { formatMonthYear } from '../utils/dateUtils';

export default function TopNav({
  currentDate,
  onPrev,
  onNext,
  onToday,
  viewMode,
  setViewMode,
  sidebarOpen,
  setSidebarOpen,
  searchQuery,
  setSearchQuery,
  stats,
  onRefresh,
  loading
}) {
  const todayDayNumber = new Date().getDate();
  const jobsToday = stats?.today?.jobs || 0;
  const streak = stats?.currentStreak || 0;

  return (
    <header className="h-16 border-b border-google-gray-200 px-4 flex items-center justify-between bg-white select-none z-20">
      {/* Left section: Hamburger, Brand, Navigation */}
      <div className="flex items-center space-x-3 sm:space-x-6">
        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-full hover:bg-google-gray-100 text-google-gray-700 transition"
          title="Main menu"
        >
          <Menu size={20} />
        </button>

        {/* Brand Logo */}
        <div className="flex items-center space-x-2">
          <div className="w-9 h-9 rounded-lg bg-google-blue flex flex-col items-center justify-center text-white shadow-sm font-sans">
            <span className="text-[9px] uppercase tracking-wider font-semibold opacity-90">SEP</span>
            <span className="text-[15px] font-bold leading-none">{todayDayNumber}</span>
          </div>
          <span className="text-xl font-medium text-google-gray-800 tracking-tight hidden md:inline">
            Job Calendar
          </span>
        </div>

        {/* Date Nav Stepper */}
        <div className="flex items-center space-x-2 pl-2">
          <button
            onClick={onToday}
            className="px-4 py-2 text-sm font-medium text-google-gray-700 hover:bg-google-gray-100 border border-google-gray-300 rounded-md transition"
          >
            Today
          </button>

          <div className="flex items-center space-x-1">
            <button
              onClick={onPrev}
              className="p-2 rounded-full hover:bg-google-gray-100 text-google-gray-700 transition"
              title="Previous"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={onNext}
              className="p-2 rounded-full hover:bg-google-gray-100 text-google-gray-700 transition"
              title="Next"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <h2 className="text-lg sm:text-xl font-normal text-google-gray-800 min-w-[160px]">
            {formatMonthYear(currentDate)}
          </h2>
        </div>
      </div>

      {/* Center section: Search */}
      <div className="hidden lg:flex items-center flex-1 max-w-md mx-6">
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-google-gray-500">
            <Search size={18} />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search companies, roles, notes..."
            className="w-full pl-10 pr-10 py-2 bg-google-gray-100 hover:bg-google-gray-200 focus:bg-white text-sm rounded-lg border border-transparent focus:border-google-blue focus:shadow-sm focus:outline-none transition"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-google-gray-500 hover:text-google-gray-700"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Right section: Quick Stats & View Mode Toggle */}
      <div className="flex items-center space-x-3">
        {/* Streak Pill */}
        <div 
          className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-full text-xs font-semibold"
          title={`${streak} consecutive days with job applications`}
        >
          <Flame size={15} className="text-amber-600 fill-amber-500" />
          <span>{streak} Day Streak</span>
        </div>

        {/* Today's Jobs Pill */}
        <div className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 bg-google-blueLight border border-google-blueBorder text-google-blue rounded-full text-xs font-semibold">
          <span>🎯 {jobsToday} Jobs Today</span>
        </div>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          className={`p-2 rounded-full hover:bg-google-gray-100 text-google-gray-600 transition ${loading ? 'animate-spin text-google-blue' : ''}`}
          title="Refresh Data"
        >
          <RotateCw size={17} />
        </button>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-google-gray-100 p-1 rounded-lg border border-google-gray-200 text-xs font-medium">
          <button
            onClick={() => setViewMode('month')}
            className={`px-3 py-1.5 rounded-md transition ${viewMode === 'month' ? 'bg-white text-google-blue shadow-sm font-semibold' : 'text-google-gray-700 hover:text-google-gray-900'}`}
          >
            Month
          </button>
          <button
            onClick={() => setViewMode('week')}
            className={`px-3 py-1.5 rounded-md transition ${viewMode === 'week' ? 'bg-white text-google-blue shadow-sm font-semibold' : 'text-google-gray-700 hover:text-google-gray-900'}`}
          >
            Week
          </button>
        </div>
      </div>
    </header>
  );
}
