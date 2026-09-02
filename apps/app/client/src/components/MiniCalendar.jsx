import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMonthGrid, formatMonthYear, isToday, isSameDay } from '../utils/dateUtils';

export default function MiniCalendar({ currentDate, onSelectDate }) {
  // Mini calendar can navigate independently or follow currentDate
  const [viewDate, setViewDate] = useState(new Date(currentDate));

  useEffect(() => {
    setViewDate(new Date(currentDate));
  }, [currentDate]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const handlePrev = () => {
    setViewDate(new Date(year, month - 1, 1));
  };

  const handleNext = () => {
    setViewDate(new Date(year, month + 1, 1));
  };

  const days = getMonthGrid(year, month);
  const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="select-none px-2 py-3">
      {/* Header */}
      <div className="flex items-center justify-between px-2 mb-2">
        <span className="text-xs font-semibold text-google-gray-700">
          {formatMonthYear(viewDate)}
        </span>
        <div className="flex items-center space-x-1">
          <button
            onClick={handlePrev}
            className="p-1 rounded-full hover:bg-google-gray-200 text-google-gray-600 transition"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={handleNext}
            className="p-1 rounded-full hover:bg-google-gray-200 text-google-gray-600 transition"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 text-center mb-1">
        {weekDays.map((d, idx) => (
          <span key={idx} className="text-[10px] font-medium text-google-gray-500 py-1">
            {d}
          </span>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {days.map((item, idx) => {
          const selected = isSameDay(item.date, currentDate);
          const today = item.isToday;

          let cellClass = "w-6 h-6 mx-auto flex items-center justify-center text-[11px] rounded-full transition cursor-pointer ";
          if (today) {
            cellClass += "bg-google-blue text-white font-bold ";
          } else if (selected) {
            cellClass += "bg-google-blueLight text-google-blue font-semibold ";
          } else if (!item.isCurrentMonth) {
            cellClass += "text-google-gray-400 hover:bg-google-gray-100 ";
          } else {
            cellClass += "text-google-gray-800 hover:bg-google-gray-100 ";
          }

          return (
            <div key={idx} className="py-0.5">
              <button
                onClick={() => onSelectDate(item.date)}
                className={cellClass}
              >
                {item.dayNumber}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
