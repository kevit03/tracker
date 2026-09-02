// Shared storage manager for Job & Activity Tracker
const TrackerStorage = (() => {
  const DEFAULT_METRICS = [
    {
      id: 'jobs',
      name: 'Job Applications',
      color: '#1a73e8', // Google Blue
      icon: '🎯',
      unit: 'jobs',
      isDefault: true,
      createdAt: '2026-09-01T00:00:00.000Z'
    },
    {
      id: 'leetcode',
      name: 'LeetCode Problems',
      color: '#1e8e3e', // Google Green
      icon: '💡',
      unit: 'problems',
      isDefault: true,
      createdAt: '2026-09-01T00:00:00.000Z'
    }
  ];

  function getLocalDateStr(d = new Date()) {
    const date = new Date(d);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getStorageArea() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    // Fallback for non-extension context
    return {
      get: (keys, cb) => {
        const result = {};
        keys.forEach(k => {
          const val = localStorage.getItem(k);
          if (val) {
            try { result[k] = JSON.parse(val); } catch (e) { result[k] = val; }
          }
        });
        cb(result);
      },
      set: (items, cb) => {
        Object.entries(items).forEach(([k, v]) => {
          localStorage.setItem(k, JSON.stringify(v));
        });
        if (cb) cb();
      }
    };
  }

  return {
    getLocalDateStr,

    async getMetrics() {
      return new Promise(resolve => {
        getStorageArea().get(['metrics'], result => {
          if (result.metrics && Array.isArray(result.metrics) && result.metrics.length > 0) {
            resolve(result.metrics);
          } else {
            // Seed default
            getStorageArea().set({ metrics: DEFAULT_METRICS }, () => {
              resolve(DEFAULT_METRICS);
            });
          }
        });
      });
    },

    async addMetric({ name, unit, color, icon }) {
      const metrics = await this.getMetrics();
      const id = (name || 'metric')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-') + '-' + Math.random().toString(36).substring(2, 6);

      const newMetric = {
        id,
        name: name.trim(),
        unit: (unit || 'items').trim(),
        color: color || '#1a73e8',
        icon: icon || '🎯',
        isDefault: false,
        createdAt: new Date().toISOString()
      };

      metrics.push(newMetric);
      return new Promise(resolve => {
        getStorageArea().set({ metrics }, () => resolve(newMetric));
      });
    },

    async deleteMetric(id) {
      const metrics = await this.getMetrics();
      const filtered = metrics.filter(m => m.id !== id || m.isDefault);
      return new Promise(resolve => {
        getStorageArea().set({ metrics: filtered }, () => resolve(true));
      });
    },

    async getLogs(filter = {}) {
      return new Promise(resolve => {
        getStorageArea().get(['logs'], result => {
          let logs = result.logs || [];
          if (filter.startDate) logs = logs.filter(l => l.date >= filter.startDate);
          if (filter.endDate) logs = logs.filter(l => l.date <= filter.endDate);
          if (filter.metricId) logs = logs.filter(l => l.metricId === filter.metricId);
          // Sort newest first
          logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          resolve(logs);
        });
      });
    },

    async addLog({ metricId = 'jobs', count = 1, date, company = '', role = '', notes = '' }) {
      return new Promise(resolve => {
        getStorageArea().get(['logs'], result => {
          const logs = result.logs || [];
          const now = new Date();
          const logDate = date || getLocalDateStr(now);

          const newLog = {
            id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
            metricId,
            count: Math.max(1, parseInt(count, 10) || 1),
            date: logDate,
            timestamp: now.toISOString(),
            company: company.trim(),
            role: role.trim(),
            notes: notes.trim(),
          };

          logs.push(newLog);
          getStorageArea().set({ logs }, () => resolve(newLog));
        });
      });
    },

    async deleteLog(id) {
      return new Promise(resolve => {
        getStorageArea().get(['logs'], result => {
          const logs = result.logs || [];
          const filtered = logs.filter(l => l.id !== id);
          getStorageArea().set({ logs: filtered }, () => resolve(true));
        });
      });
    },

    async undoLastLog(metricId, date) {
      const targetDate = date || getLocalDateStr();
      const logs = await this.getLogs();
      const match = logs.find(l => l.metricId === metricId && l.date === targetDate);
      if (match) {
        await this.deleteLog(match.id);
        return true;
      }
      return false;
    },

    async getStats() {
      const [metrics, logs] = await Promise.all([this.getMetrics(), this.getLogs()]);
      const now = new Date();
      const todayStr = getLocalDateStr(now);

      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 6);
      const weekAgoStr = getLocalDateStr(weekAgo);

      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfMonthStr = getLocalDateStr(startOfMonth);

      const today = {};
      const thisWeek = {};
      const thisMonth = {};
      const totals = {};
      const dailyMap = {}; // dateStr -> { metricId -> count }

      metrics.forEach(m => {
        today[m.id] = 0;
        thisWeek[m.id] = 0;
        thisMonth[m.id] = 0;
        totals[m.id] = 0;
      });

      logs.forEach(l => {
        const mId = l.metricId;
        const cnt = l.count || 1;

        totals[mId] = (totals[mId] || 0) + cnt;

        if (l.date === todayStr) {
          today[mId] = (today[mId] || 0) + cnt;
        }
        if (l.date >= weekAgoStr && l.date <= todayStr) {
          thisWeek[mId] = (thisWeek[mId] || 0) + cnt;
        }
        if (l.date >= startOfMonthStr && l.date <= todayStr) {
          thisMonth[mId] = (thisMonth[mId] || 0) + cnt;
        }

        if (!dailyMap[l.date]) dailyMap[l.date] = {};
        dailyMap[l.date][mId] = (dailyMap[l.date][mId] || 0) + cnt;
      });

      // Calculate streak for job applications
      const jobDates = Object.keys(dailyMap)
        .filter(d => (dailyMap[d]['jobs'] || 0) > 0)
        .sort();

      const jobDateSet = new Set(jobDates);
      let currentStreak = 0;
      let checkDate = new Date(now);

      if (!jobDateSet.has(getLocalDateStr(checkDate))) {
        checkDate.setDate(checkDate.getDate() - 1);
      }

      while (jobDateSet.has(getLocalDateStr(checkDate))) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      }

      return {
        todayStr,
        metrics,
        today,
        thisWeek,
        thisMonth,
        totals,
        totalLogs: logs.length,
        currentStreak,
        dailyMap
      };
    },

    onChanged(cb) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && (changes.logs || changes.metrics)) {
            cb(changes);
          }
        });
      }
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TrackerStorage;
}
