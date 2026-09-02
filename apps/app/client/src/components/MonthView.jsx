import React from 'react';
import { Plus } from 'lucide-react';
import { getMonthGrid } from '../utils/dateUtils';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export default function MonthView({
  currentDate,
  logs,
  metrics,
  visibleMetrics,
  onSelectDay,
  onQuickLogDay,
  searchQuery
}) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = getMonthGrid(year, month);

  // Group logs by date
  const logsByDate = {};
  logs.forEach(log => {
    if (!visibleMetrics.has(log.metricId)) return;

    // Filter by search query if present
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match = (log.company && log.company.toLowerCase().includes(q)) ||
                    (log.role && log.role.toLowerCase().includes(q)) ||
                    (log.notes && log.notes.toLowerCase().includes(q));
      if (!match) return;
    }

    if (!logsByDate[log.date]) {
      logsByDate[log.date] = [];
    }
    logsByDate[log.date].push(log);
  });

  const metricsMap = {};
  metrics.forEach(m => {
    metricsMap[m.id] = m;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-white select-none overflow-hidden">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-google-gray-200 bg-white">
        {WEEKDAYS.map((day, idx) => (
          <div 
            key={idx} 
            className="py-2 text-center text-[11px] font-medium text-google-gray-600 tracking-wider"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="flex-1 grid grid-cols-7 auto-rows-fr bg-google-gray-200 gap-[1px] overflow-y-auto">
        {days.map((item, idx) => {
          const dateLogs = logsByDate[item.dateStr] || [];

          // Group by metric for this day
          const metricCounts = {};
          dateLogs.forEach(l => {
            metricCounts[l.metricId] = (metricCounts[l.metricId] || 0) + (l.count || 1);
          });

          return (
            <div
              key={idx}
              onClick={() => onSelectDay(item.date)}
              className={`group relative p-1.5 flex flex-col transition cursor-pointer min-h-[95px] ${
                item.isCurrentMonth ? 'bg-white hover:bg-[#fbfcfe]' : 'bg-google-gray-50/70 text-google-gray-400'
              }`}
            >
              {/* Day Header */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center justify-center">
                  {item.isToday ? (
                    <span className="w-6 h-6 rounded-full bg-google-blue text-white font-semibold text-xs flex items-center justify-center shadow-sm">
                      {item.dayNumber}
                    </span>
                  ) : (
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                      item.isCurrentMonth ? 'text-google-gray-700' : 'text-google-gray-400'
                    }`}>
                      {item.dayNumber === 1 
                        ? `${item.date.toLocaleDateString(undefined, { month: 'short' })} 1` 
                        : item.dayNumber}
                    </span>
                  )}
                </div>

                {/* Hover + Quick Add Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuickLogDay(item.date);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-google-gray-200 text-google-gray-600 transition"
                  title="Log application on this day"
                >
                  <Plus size={13} />
                </button>
              </div>

              {/* Event Pills (Google Calendar Style) */}
              <div className="flex-1 flex flex-col space-y-1 overflow-hidden">
                {/* Aggregate metric chips */}
                {Object.entries(metricCounts).map(([metricId, count]) => {
                  const metric = metricsMap[metricId] || {
                    name: metricId,
                    color: '#1a73e8',
                    unit: 'items'
                  };

                  return (
                    <div
                      key={metricId}
                      className="px-2 py-0.5 rounded text-[11px] font-medium truncate flex items-center space-x-1.5 shadow-sm transition hover:opacity-90"
                      style={{
                        backgroundColor: `${metric.color}15`,
                        color: metric.color,
                        borderLeft: `3px solid ${metric.color}`
                      }}
                      title={`${count} ${metric.unit || metric.name} on ${item.dateStr}`}
                    >
                      <span className="font-bold tabular-nums">{count}</span>
                      <span className="truncate">{metric.name}</span>
                    </div>
                  );
                })}

                {/* Individual named logs preview (e.g. specific companies) */}
                {dateLogs
                  .filter(l => l.company)
                  .slice(0, 2)
                  .map((log) => {
                    const metric = metricsMap[log.metricId];
                    return (
                      <div
                        key={log.id}
                        className="text-[10px] text-google-gray-600 truncate px-1 flex items-center space-x-1"
                      >
                        <span 
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: metric?.color || '#1a73e8' }}
                        />
                        <span className="font-medium text-google-gray-800">{log.company}</span>
                        {log.role && <span className="text-google-gray-500">· {log.role}</span>}
                      </div>
                    );
                  })}

                {/* More indicator */}
                {dateLogs.length > 3 && (
                  <span className="text-[10px] text-google-gray-500 font-medium px-1">
                    +{dateLogs.length - 2} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
