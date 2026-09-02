import React from 'react';
import { Plus, Clock, ExternalLink } from 'lucide-react';
import { getWeekDays, formatTime } from '../utils/dateUtils';

export default function WeekView({
  currentDate,
  logs,
  metrics,
  visibleMetrics,
  onSelectDay,
  onQuickLogDay,
  searchQuery
}) {
  const weekDays = getWeekDays(currentDate);

  // Group logs by date
  const logsByDate = {};
  logs.forEach(log => {
    if (!visibleMetrics.has(log.metricId)) return;

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
      {/* 7-Column Header */}
      <div className="grid grid-cols-7 border-b border-google-gray-200 bg-white">
        {weekDays.map((day, idx) => (
          <div 
            key={idx} 
            className="py-3 px-2 text-center border-r last:border-r-0 border-google-gray-200"
          >
            <div className="text-[11px] font-medium text-google-gray-500 uppercase tracking-wider">
              {day.dayName}
            </div>
            <div className="mt-1 flex items-center justify-center">
              {day.isToday ? (
                <span className="w-8 h-8 rounded-full bg-google-blue text-white font-bold text-sm flex items-center justify-center shadow-sm">
                  {day.dayNumber}
                </span>
              ) : (
                <span className="text-base font-semibold text-google-gray-800">
                  {day.dayNumber}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Week Columns */}
      <div className="flex-1 grid grid-cols-7 bg-google-gray-100 gap-[1px] overflow-y-auto">
        {weekDays.map((day, idx) => {
          const dateLogs = logsByDate[day.dateStr] || [];

          // Group counts by metric
          const metricCounts = {};
          dateLogs.forEach(l => {
            metricCounts[l.metricId] = (metricCounts[l.metricId] || 0) + (l.count || 1);
          });

          return (
            <div
              key={idx}
              className="bg-white p-2 flex flex-col space-y-2 overflow-y-auto"
            >
              {/* Top Quick Add */}
              <button
                onClick={() => onQuickLogDay(day.date)}
                className="w-full py-1 text-center text-xs font-medium text-google-gray-500 hover:text-google-blue hover:bg-google-blueLight/50 rounded border border-dashed border-google-gray-300 hover:border-google-blue transition flex items-center justify-center space-x-1"
              >
                <Plus size={13} />
                <span>Log</span>
              </button>

              {/* Summary Badges */}
              <div className="flex flex-wrap gap-1">
                {Object.entries(metricCounts).map(([mId, count]) => {
                  const m = metricsMap[mId] || { name: mId, color: '#1a73e8' };
                  return (
                    <div
                      key={mId}
                      className="px-2 py-0.5 rounded text-[10px] font-bold"
                      style={{
                        backgroundColor: `${m.color}15`,
                        color: m.color
                      }}
                    >
                      {count} {m.name}
                    </div>
                  );
                })}
              </div>

              {/* Entries list */}
              <div className="space-y-1.5 flex-1">
                {dateLogs.map((log) => {
                  const metric = metricsMap[log.metricId];
                  return (
                    <div
                      key={log.id}
                      onClick={() => onSelectDay(day.date)}
                      className="p-2 rounded-lg border border-google-gray-200 bg-white hover:border-google-blue hover:shadow-sm transition cursor-pointer text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span 
                          className="font-semibold truncate max-w-[100px]"
                          style={{ color: metric?.color || '#1a73e8' }}
                        >
                          {log.company || metric?.name || 'Entry'}
                        </span>
                        <span className="text-[10px] text-google-gray-400 flex items-center space-x-0.5">
                          <Clock size={10} />
                          <span>{formatTime(log.timestamp)}</span>
                        </span>
                      </div>

                      {log.role && (
                        <div className="text-[11px] text-google-gray-600 truncate mt-0.5">
                          {log.role}
                        </div>
                      )}

                      {log.notes && (
                        <div className="text-[10px] text-google-gray-500 line-clamp-2 mt-1 italic">
                          "{log.notes}"
                        </div>
                      )}
                    </div>
                  );
                })}

                {dateLogs.length === 0 && (
                  <div className="h-32 flex flex-col items-center justify-center text-google-gray-400 text-xs italic">
                    No entries
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
