import React, { useState } from 'react';
import { X, Trash2, Plus, Clock, ExternalLink, Briefcase, Code } from 'lucide-react';
import { formatDayHeader, formatTime, toDateStr } from '../utils/dateUtils';

export default function DayModal({
  date,
  logs,
  metrics,
  onClose,
  onAddLog,
  onDeleteLog
}) {
  const [selectedMetricId, setSelectedMetricId] = useState(metrics[0]?.id || 'jobs');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  const [count, setCount] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dateStr = toDateStr(date);
  const dayLogs = logs.filter(l => l.date === dateStr);

  const metricsMap = {};
  metrics.forEach(m => {
    metricsMap[m.id] = m;
  });

  // Calculate totals for this day
  const dailyTotals = {};
  dayLogs.forEach(l => {
    dailyTotals[l.metricId] = (dailyTotals[l.metricId] || 0) + (l.count || 1);
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onAddLog({
        metricId: selectedMetricId,
        count: parseInt(count, 10) || 1,
        date: dateStr,
        timestamp: new Date().toISOString(),
        company,
        role,
        notes
      });
      // Reset form
      setCompany('');
      setRole('');
      setNotes('');
      setCount(1);
      setShowAddForm(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-google-gray-200 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-google-gray-200 flex items-center justify-between bg-google-gray-50/50">
          <div>
            <h3 className="text-lg font-semibold text-google-gray-900">
              {formatDayHeader(date)}
            </h3>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(dailyTotals).map(([mId, cnt]) => {
                const metric = metricsMap[mId] || { name: mId, color: '#1a73e8' };
                return (
                  <span
                    key={mId}
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${metric.color}15`,
                      color: metric.color
                    }}
                  >
                    {cnt} {metric.name}
                  </span>
                );
              })}
              {dayLogs.length === 0 && (
                <span className="text-xs text-google-gray-500 italic">
                  No activity recorded for this day
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-google-gray-200 text-google-gray-500 hover:text-google-gray-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content: List of entries */}
        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {dayLogs.map((log) => {
            const metric = metricsMap[log.metricId];
            return (
              <div
                key={log.id}
                className="p-3.5 rounded-xl border border-google-gray-200 hover:border-google-gray-300 bg-white transition flex items-start justify-between group shadow-sm"
              >
                <div className="flex items-start space-x-3">
                  <div
                    className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0"
                    style={{ backgroundColor: metric?.color || '#1a73e8' }}
                  />
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-sm text-google-gray-900">
                        {log.company || metric?.name || 'Logged Entry'}
                      </span>
                      {log.count > 1 && (
                        <span className="text-xs bg-google-gray-100 text-google-gray-700 px-1.5 py-0.5 rounded font-medium">
                          +{log.count}
                        </span>
                      )}
                    </div>

                    {log.role && (
                      <div className="text-xs text-google-gray-600 mt-0.5">
                        {log.role}
                      </div>
                    )}

                    {log.notes && (
                      <div className="text-xs text-google-gray-500 mt-1 bg-google-gray-50 p-2 rounded border border-google-gray-100">
                        {log.notes}
                      </div>
                    )}

                    <div className="flex items-center space-x-3 text-[11px] text-google-gray-400 mt-1.5">
                      <span className="flex items-center space-x-1">
                        <Clock size={11} />
                        <span>{formatTime(log.timestamp)}</span>
                      </span>
                      <span>•</span>
                      <span className="font-medium" style={{ color: metric?.color }}>
                        {metric?.name}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => onDeleteLog(log.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-50 text-google-gray-400 hover:text-google-red transition"
                  title="Delete Entry"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}

          {dayLogs.length === 0 && !showAddForm && (
            <div className="py-8 text-center text-google-gray-400 text-sm">
              Nothing logged yet. Click below to add an application or problem.
            </div>
          )}

          {/* Inline Add Form */}
          {showAddForm ? (
            <form onSubmit={handleSubmit} className="p-4 bg-google-gray-50 rounded-xl border border-google-gray-200 mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-google-gray-700 uppercase tracking-wider">
                  New Log Entry
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-xs text-google-gray-500 hover:text-google-gray-800"
                >
                  Cancel
                </button>
              </div>

              {/* Metric Picker */}
              <div>
                <label className="block text-xs font-medium text-google-gray-600 mb-1">Tracker</label>
                <div className="flex flex-wrap gap-1.5">
                  {metrics.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMetricId(m.id)}
                      className={`px-3 py-1 text-xs font-medium rounded-full border transition ${
                        selectedMetricId === m.id
                          ? 'border-transparent text-white font-semibold'
                          : 'border-google-gray-300 text-google-gray-700 bg-white hover:bg-google-gray-100'
                      }`}
                      style={{
                        backgroundColor: selectedMetricId === m.id ? m.color : undefined
                      }}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-google-gray-600 mb-1">Company / Problem</label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. Google, Two Sum"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-google-gray-300 rounded-md focus:border-google-blue focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-google-gray-600 mb-1">Role / Tag</label>
                  <input
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="e.g. SWE, Medium"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-google-gray-300 rounded-md focus:border-google-blue focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-google-gray-600 mb-1">Notes or Link</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes or job posting URL"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-google-gray-300 rounded-md focus:border-google-blue focus:outline-none"
                />
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 bg-google-blue text-white rounded-md text-xs font-medium hover:bg-google-blueHover transition shadow-sm"
                >
                  {submitting ? 'Saving...' : 'Add to Calendar'}
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-2.5 rounded-xl border border-dashed border-google-gray-300 hover:border-google-blue text-xs font-medium text-google-gray-600 hover:text-google-blue transition flex items-center justify-center space-x-1.5 bg-google-gray-50/50 hover:bg-google-blueLight/30"
            >
              <Plus size={15} />
              <span>Log activity for this day</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
