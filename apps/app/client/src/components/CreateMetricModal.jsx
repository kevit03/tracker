import React, { useState } from 'react';
import { X, Check } from 'lucide-react';

const PRESET_COLORS = [
  '#1a73e8', // Google Blue
  '#1e8e3e', // Google Green
  '#d93025', // Google Red
  '#f9ab00', // Google Yellow
  '#9334e6', // Purple
  '#007b83', // Teal
  '#e52592', // Pink
  '#e37400', // Orange
];

export default function CreateMetricModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('items');
  const [color, setColor] = useState('#9334e6');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      await onCreated({
        name: name.trim(),
        unit: unit.trim() || 'items',
        color,
        icon: 'target'
      });
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-google-gray-200 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-google-gray-200 flex items-center justify-between bg-google-gray-50/50">
          <h3 className="text-base font-semibold text-google-gray-900">
            Add New Tracker Category
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-google-gray-200 text-google-gray-500 hover:text-google-gray-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-google-gray-700 uppercase tracking-wider mb-1.5">
              Tracker Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. LeetCode, Cold Emails, Online Assessment"
              className="w-full px-3.5 py-2 text-sm border border-google-gray-300 rounded-lg focus:border-google-blue focus:ring-1 focus:ring-google-blue focus:outline-none transition"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-google-gray-700 uppercase tracking-wider mb-1.5">
              Unit / Action Label
            </label>
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. problems, emails, calls, assessments"
              className="w-full px-3.5 py-2 text-sm border border-google-gray-300 rounded-lg focus:border-google-blue focus:ring-1 focus:ring-google-blue focus:outline-none transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-google-gray-700 uppercase tracking-wider mb-2">
              Color Theme
            </label>
            <div className="flex flex-wrap gap-2.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition hover:scale-110 shadow-sm"
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check size={14} className="text-white stroke-[3]" />}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-2 pt-4 border-t border-google-gray-100">
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
              className="px-5 py-2 text-xs font-semibold bg-google-blue hover:bg-google-blueHover text-white rounded-lg transition shadow-sm"
            >
              {submitting ? 'Creating...' : 'Create Tracker'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
