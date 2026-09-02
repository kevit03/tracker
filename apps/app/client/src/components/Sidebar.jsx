import React from 'react';
import { 
  Plus, 
  Check, 
  Trash2, 
  TrendingUp, 
  Briefcase, 
  Code, 
  Layers, 
  Calendar as CalendarIcon,
  HelpCircle
} from 'lucide-react';
import MiniCalendar from './MiniCalendar';

export default function Sidebar({
  currentDate,
  onSelectDate,
  metrics,
  visibleMetrics,
  onToggleMetric,
  onOpenCreateMetric,
  onOpenQuickLog,
  onDeleteMetric,
  stats
}) {
  return (
    <aside className="w-64 flex-shrink-0 h-[calc(100vh-4rem)] border-r border-google-gray-200 bg-white flex flex-col justify-between overflow-y-auto select-none p-3">
      <div>
        {/* Google "+ Create" Pill Button */}
        <div className="px-2 pt-1 pb-4">
          <button
            onClick={onOpenQuickLog}
            className="group flex items-center space-x-3 px-5 py-3 rounded-full bg-white hover:bg-[#f8fafd] border border-google-gray-200 shadow-sm hover:shadow-md transition-all duration-200"
          >
            {/* Google Multi-Color Plus SVG */}
            <svg width="24" height="24" viewBox="0 0 36 36">
              <path fill="#4285F4" d="M16 16v14h4V16h14v-4H20V-2h-4v14H2v4z"/>
              <path fill="#34A853" d="M30 16H20l-4-4h14z"/>
              <path fill="#FBBC05" d="M6 16h10l4 4H6z"/>
              <path fill="#EA4335" d="M20 16V6l-4-4v14z"/>
            </svg>
            <span className="text-sm font-medium text-google-gray-700 tracking-wide">
              Quick Log
            </span>
          </button>
        </div>

        {/* Mini Calendar */}
        <MiniCalendar 
          currentDate={currentDate} 
          onSelectDate={onSelectDate} 
        />

        <div className="h-[1px] bg-google-gray-200 my-3 mx-2"></div>

        {/* My Trackers Section */}
        <div className="px-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-google-gray-600">
              My Trackers
            </span>
            <button
              onClick={onOpenCreateMetric}
              className="p-1 rounded-full hover:bg-google-gray-100 text-google-gray-600 hover:text-google-blue transition"
              title="Add another tracker (e.g. LeetCode, Cold Email)"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="space-y-1">
            {metrics.map((metric) => {
              const isChecked = visibleMetrics.has(metric.id);
              const countThisMonth = (stats?.thisMonth && stats.thisMonth[metric.id]) || 0;

              return (
                <div
                  key={metric.id}
                  className="group flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-google-gray-100 transition cursor-pointer"
                  onClick={() => onToggleMetric(metric.id)}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    {/* Google Style Colored Square Checkbox */}
                    <div
                      className="w-4 h-4 rounded-[4px] flex items-center justify-center transition"
                      style={{
                        backgroundColor: isChecked ? metric.color : 'transparent',
                        borderColor: metric.color,
                        borderWidth: '2px'
                      }}
                    >
                      {isChecked && <Check size={11} className="text-white stroke-[3.5]" />}
                    </div>

                    <span className="text-xs font-medium text-google-gray-800 truncate">
                      {metric.name}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <span className="text-[11px] font-medium text-google-gray-500 tabular-nums">
                      {countThisMonth}
                    </span>

                    {!metric.isDefault && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete tracker "${metric.name}"?`)) {
                            onDeleteMetric(metric.id);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-google-gray-400 hover:text-google-red transition"
                        title="Delete Tracker"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={onOpenCreateMetric}
            className="w-full mt-2 py-1.5 px-2 text-left text-xs font-medium text-google-blue hover:bg-google-blueLight rounded-md transition flex items-center space-x-1.5"
          >
            <Plus size={14} />
            <span>Add other metric...</span>
          </button>
        </div>
      </div>

      {/* Bottom Summary Stats Box */}
      <div className="p-3 bg-google-gray-50 rounded-xl border border-google-gray-200 mt-4">
        <div className="flex items-center space-x-1.5 text-xs font-semibold text-google-gray-700 mb-2">
          <TrendingUp size={14} className="text-google-blue" />
          <span>Stats Summary</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-white p-2 rounded-lg border border-google-gray-200">
            <div className="text-[10px] text-google-gray-500 uppercase font-medium">This Week</div>
            <div className="text-base font-bold text-google-gray-900 mt-0.5">
              {stats?.thisWeek?.jobs || 0} <span className="text-[10px] font-normal text-google-gray-500">jobs</span>
            </div>
          </div>

          <div className="bg-white p-2 rounded-lg border border-google-gray-200">
            <div className="text-[10px] text-google-gray-500 uppercase font-medium">This Month</div>
            <div className="text-base font-bold text-google-gray-900 mt-0.5">
              {stats?.thisMonth?.jobs || 0} <span className="text-[10px] font-normal text-google-gray-500">jobs</span>
            </div>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-google-gray-500 flex items-center justify-between pt-2 border-t border-google-gray-200">
          <span>Total Applications</span>
          <span className="font-semibold text-google-gray-800">{stats?.totals?.jobs || 0}</span>
        </div>

        {/* LeetCode count if available */}
        {stats?.totals?.leetcode !== undefined && (
          <div className="mt-1 text-[11px] text-google-gray-500 flex items-center justify-between">
            <span>Total LeetCode</span>
            <span className="font-semibold text-google-gray-800">{stats?.totals?.leetcode || 0}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
