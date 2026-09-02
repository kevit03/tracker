import React, { useState } from 'react';
import { X, Calendar } from 'lucide-react';
import { toDateStr } from '../utils/dateUtils';

export default function QuickLogModal({
  defaultDate,
  metrics,
  onClose,
  onAddLog
}) {
  const [metricId, setMetricId] = useState(metrics[0]?.id || 'jobs');
  const [date, setDate] = useState(defaultDate ? toDateStr(defaultDate) : toDateStr(new Date()));
  const [count, setCount] = useState(1);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onAddLog({
        metricId,
        date,
        count: parseInt(count, 10) || 1,
        company,
        role,
        notes,
        timestamp: new Date().toISOString()
      });
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedMetric = metrics.find(m => m.id === metricId) || metrics[0];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-google-gray-200 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-google-gray-200 flex items-center justify-between bg-google-gray-50/50">
          <div className="flex items-center space-x-2">
            <span 
              className="w-3.5 h-3.5 rounded-full"
              style={{ backgroundColor: selectedMetric?.color || '#1a73e8' }}
            />
            <h3 className="text-base font-semibold text-google-gray-900">
              Log Activity
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-google-gray-200 text-google-gray-500 hover:text-google-gray-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Tracker selector chips */}
          <div>
            <label className="block text-xs font-semibold text-google-gray-700 uppercase tracking-wider mb-1.5">
              Category
            </label>
            <div className="flex flex-wrap gap-1.5">
              {metrics.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMetricId(m.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                    metricId === m.id
                      ? 'border-transparent text-white font-semibold'
                      : 'border-google-gray-300 text-google-gray-700 bg-white hover:bg-google-gray-100'
                  }`}
                  style={{
                    backgroundColor: metricId === m.id ? m.color : undefined
                  }}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-google-gray-700 uppercase tracking-wider mb-1.5">
                Date
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-google-gray-300 rounded-lg focus:border-google-blue focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-google-gray-700 uppercase tracking-wider mb-1.5">
                Count ({selectedMetric?.unit || 'items'})
              </label>
              <input
                type="number"
                min="1"
                required
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-google-gray-300 rounded-lg focus:border-google-blue focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-google-gray-700 uppercase tracking-wider mb-1.5">
              Company / Title
            </label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Google, Meta, Two Sum"
              className="w-full px-3.5 py-2 text-xs border border-google-gray-300 rounded-lg focus:border-google-blue focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-google-gray-700 uppercase tracking-wider mb-1.5">
              Role / Tag (optional)
            </label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Software Engineer, Medium, Full-time"
              className="w-full px-3.5 py-2 text-xs border border-google-gray-300 rounded-lg focus:border-google-blue focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-google-gray-700 uppercase tracking-wider mb-1.5">
              Notes or Link (optional)
            </label>
            <textarea
              rows="2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add referral notes, job URL, or thoughts..."
              className="w-full px-3.5 py-2 text-xs border border-google-gray-300 rounded-lg focus:border-google-blue focus:outline-none resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-google-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-google-gray-700 hover:bg-google-gray-100 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold text-white rounded-lg transition shadow-sm"
              style={{ backgroundColor: selectedMetric?.color || '#1a73e8' }}
            >
              {submitting ? 'Saving...' : 'Save to Calendar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
