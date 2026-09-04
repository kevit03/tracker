// Shared storage manager for Job & Activity Tracker
const TrackerStorage = (() => {
  const STORAGE_KEYS = {
    LOGS: 'logs',
    METRICS: 'metrics',
    AUTH: 'pt_auth_user',
    VISIBLE_METRICS: 'pt_visible_metrics'
  };

  const DEFAULT_METRICS = [
    {
      id: 'jobs',
      name: 'Job Applications',
      color: '#1a73e8',
      icon: 'briefcase',
      unit: 'jobs',
      dailyGoal: 5,
      isDefault: true,
      createdAt: '2026-09-01T00:00:00.000Z'
    },
    {
      id: 'leetcode',
      name: 'LeetCode',
      color: '#1e8e3e',
      icon: 'code',
      unit: 'problems',
      dailyGoal: 2,
      isDefault: true,
      createdAt: '2026-09-01T00:00:00.000Z'
    }
  ];

  // Write queue mutex to serialize concurrent writes to chrome.storage.local
  let writeLock = Promise.resolve();

  function enqueueWrite(fn) {
    const next = writeLock.then(() => fn(), () => fn());
    writeLock = next.catch(() => {});
    return next;
  }

  function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return null;
    const trimmed = email.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
  }

  function getLocalDateStr(d = new Date()) {
    const date = new Date(d);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseLocalDateToNoon(dateStr) {
    if (!dateStr) return new Date();
    const parts = dateStr.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }

  function addDays(dateStrOrDate, n) {
    const d = typeof dateStrOrDate === 'string'
      ? parseLocalDateToNoon(dateStrOrDate)
      : new Date(dateStrOrDate.getFullYear(), dateStrOrDate.getMonth(), dateStrOrDate.getDate(), 12, 0, 0);
    d.setDate(d.getDate() + n);
    return getLocalDateStr(d);
  }

  function getStorageArea() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return {
      get: (keys, cb) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        keyList.forEach(k => {
          if (typeof localStorage !== 'undefined') {
            const val = localStorage.getItem(k);
            if (val !== null && val !== undefined) {
              try { result[k] = JSON.parse(val); } catch (e) { result[k] = val; }
            }
          }
        });
        if (cb) cb(result);
      },
      set: (items, cb) => {
        if (typeof localStorage !== 'undefined') {
          Object.entries(items).forEach(([k, v]) => {
            localStorage.setItem(k, JSON.stringify(v));
          });
        }
        if (cb) cb();
      }
    };
  }

  function safeGetLogs(result) {
    return Array.isArray(result && result[STORAGE_KEYS.LOGS]) ? result[STORAGE_KEYS.LOGS] : [];
  }

  function safeGetMetrics(result) {
    return Array.isArray(result && result[STORAGE_KEYS.METRICS]) ? result[STORAGE_KEYS.METRICS] : [];
  }

  async function getCurrentUserEmail() {
    if (typeof TrackerAuth !== 'undefined' && TrackerAuth && typeof TrackerAuth.getCurrentUser === 'function') {
      try {
        const u = await TrackerAuth.getCurrentUser();
        return u && u.email ? normalizeEmail(u.email) : null;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  return {
    STORAGE_KEYS,
    DEFAULT_METRICS,
    getLocalDateStr,
    parseLocalDateToNoon,
    addDays,
    normalizeEmail,

    async getMetrics(userEmailOverride) {
      const targetEmail = normalizeEmail(userEmailOverride !== undefined ? userEmailOverride : await getCurrentUserEmail());
      return new Promise(resolve => {
        getStorageArea().get([STORAGE_KEYS.METRICS], result => {
          let allMetrics = safeGetMetrics(result);
          if (allMetrics.length === 0) {
            allMetrics = [...DEFAULT_METRICS];
            getStorageArea().set({ [STORAGE_KEYS.METRICS]: DEFAULT_METRICS });
          }
          const filtered = allMetrics.map(m => {
            let dailyGoal = m.dailyGoal;
            if (!dailyGoal) {
              dailyGoal = m.id === 'jobs' ? 5 : (m.id === 'leetcode' ? 2 : 1);
            }
            return { ...m, dailyGoal };
          }).filter(m => {
            if (m.isDefault || m.id === 'jobs' || m.id === 'leetcode') return true;
            const owner = normalizeEmail(m.userEmail);
            if (!targetEmail) {
              return !owner;
            }
            return owner === targetEmail;
          });
          resolve(filtered);
        });
      });
    },

    async saveMetrics(metrics) {
      return enqueueWrite(async () => {
        return new Promise(resolve => {
          getStorageArea().set({ [STORAGE_KEYS.METRICS]: Array.isArray(metrics) ? metrics : [] }, () => resolve(true));
        });
      });
    },

    async setMetricGoal(metricId, goalNumber) {
      const goal = Math.max(1, parseInt(goalNumber, 10) || 1);
      return enqueueWrite(async () => {
        return new Promise(resolve => {
          getStorageArea().get([STORAGE_KEYS.METRICS], result => {
            let allMetrics = safeGetMetrics(result);
            if (allMetrics.length === 0) allMetrics = [...DEFAULT_METRICS];
            const updated = allMetrics.map(m => {
              if (m.id === metricId) {
                return { ...m, dailyGoal: goal };
              }
              return m;
            });
            getStorageArea().set({ [STORAGE_KEYS.METRICS]: updated }, () => resolve(true));
          });
        });
      });
    },

    async addMetric(metricOptions = {}, userEmailOverride) {
      return enqueueWrite(async () => {
        const options = typeof metricOptions === 'string' ? { name: metricOptions } : (metricOptions || {});
        const customEmail = options.userEmail !== undefined ? options.userEmail : userEmailOverride;
        const userEmail = normalizeEmail(customEmail !== undefined ? customEmail : await getCurrentUserEmail());
        const cleanName = (options.name || '').trim();
        const id = (cleanName || 'metric')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-') + '-' + Math.random().toString(36).substring(2, 6);

        const newMetric = {
          id,
          name: cleanName || 'Custom Metric',
          unit: (options.unit || 'items').trim(),
          color: options.color || '#1a73e8',
          icon: options.icon || 'target',
          dailyGoal: Math.max(1, parseInt(options.dailyGoal, 10) || 1),
          userEmail: userEmail || null,
          isDefault: false,
          createdAt: new Date().toISOString()
        };

        return new Promise(resolve => {
          getStorageArea().get([STORAGE_KEYS.METRICS], result => {
            let allMetrics = safeGetMetrics(result);
            if (allMetrics.length === 0) {
              allMetrics = [...DEFAULT_METRICS];
            }
            allMetrics.push(newMetric);
            getStorageArea().set({ [STORAGE_KEYS.METRICS]: allMetrics }, () => resolve(newMetric));
          });
        });
      });
    },

    async getActivityHistory(daysCount = 30, userEmailOverride) {
      const days = Math.max(1, Math.min(90, parseInt(daysCount, 10) || 30));
      const targetEmail = normalizeEmail(userEmailOverride !== undefined ? userEmailOverride : await getCurrentUserEmail());
      const [metrics, logs] = await Promise.all([
        this.getMetrics(targetEmail),
        this.getLogs({}, targetEmail)
      ]);

      const now = new Date();
      const todayStr = getLocalDateStr(now);

      const dailyMap = {};
      logs.forEach(l => {
        if (!dailyMap[l.date]) dailyMap[l.date] = { total: 0, byMetric: {} };
        const cnt = l.count || 1;
        dailyMap[l.date].total += cnt;
        dailyMap[l.date].byMetric[l.metricId] = (dailyMap[l.date].byMetric[l.metricId] || 0) + cnt;
      });

      const historyDays = [];
      let totalCount = 0;
      let activeDaysCount = 0;
      let bestDay = { date: todayStr, count: 0 };

      for (let i = days - 1; i >= 0; i--) {
        const dStr = addDays(todayStr, -i);
        const dayData = dailyMap[dStr] || { total: 0, byMetric: {} };
        const dayTotal = dayData.total;
        totalCount += dayTotal;
        if (dayTotal > 0) activeDaysCount++;
        if (dayTotal > bestDay.count) {
          bestDay = { date: dStr, count: dayTotal };
        }

        const dateParts = dStr.split('-');
        const monthNum = parseInt(dateParts[1], 10);
        const dayNum = parseInt(dateParts[2], 10);
        const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthNum - 1];

        historyDays.push({
          date: dStr,
          label: `${monthShort} ${dayNum}`,
          count: dayTotal,
          byMetric: dayData.byMetric
        });
      }

      const dailyAverage = days > 0 ? (totalCount / days).toFixed(1) : '0.0';

      return {
        days: historyDays,
        totalCount,
        dailyAverage: parseFloat(dailyAverage),
        activeDaysCount,
        bestDay,
        metrics
      };
    },

    async deleteMetric(id, userEmailOverride) {
      if (!id || id === 'jobs' || id === 'leetcode') {
        return false;
      }
      return enqueueWrite(async () => {
        const targetEmail = normalizeEmail(userEmailOverride !== undefined ? userEmailOverride : await getCurrentUserEmail());
        return new Promise(resolve => {
          getStorageArea().get([STORAGE_KEYS.METRICS], result => {
            const allMetrics = safeGetMetrics(result);
            const targetIndex = allMetrics.findIndex(m => m.id === id);
            if (targetIndex === -1) {
              resolve(false);
              return;
            }
            const target = allMetrics[targetIndex];
            if (target.isDefault || target.id === 'jobs' || target.id === 'leetcode') {
              resolve(false);
              return;
            }
            const owner = normalizeEmail(target.userEmail);
            const isAuthorized = (!targetEmail && !owner) || (targetEmail && owner === targetEmail);
            if (!isAuthorized) {
              resolve(false);
              return;
            }
            const filtered = allMetrics.filter(m => m.id !== id);
            getStorageArea().set({ [STORAGE_KEYS.METRICS]: filtered }, () => resolve(true));
          });
        });
      });
    },

    async getLogs(filter = {}, userEmailOverride) {
      let metricId = null;
      let startDate = null;
      let endDate = null;
      let targetUserEmail = undefined;

      if (typeof filter === 'string') {
        metricId = filter;
        if (userEmailOverride !== undefined) {
          targetUserEmail = userEmailOverride;
        }
      } else if (filter && typeof filter === 'object') {
        metricId = filter.metricId || null;
        startDate = filter.startDate || null;
        endDate = filter.endDate || null;
        if (filter.userEmail !== undefined) {
          targetUserEmail = filter.userEmail;
        } else if (userEmailOverride !== undefined) {
          targetUserEmail = userEmailOverride;
        }
      }

      if (targetUserEmail === undefined) {
        targetUserEmail = await getCurrentUserEmail();
      }
      const normalizedTarget = normalizeEmail(targetUserEmail);

      return new Promise(resolve => {
        getStorageArea().get([STORAGE_KEYS.LOGS], result => {
          const rawLogs = safeGetLogs(result);
          const indexed = rawLogs.map((l, index) => ({ log: l, originalIndex: index }));
          const filtered = indexed.filter(item => {
            const l = item.log;
            if (!l) return false;
            const logEmail = normalizeEmail(l.userEmail);
            if (!normalizedTarget) {
              if (logEmail) return false;
            } else {
              if (logEmail !== normalizedTarget) return false;
            }
            if (metricId && l.metricId !== metricId) return false;
            if (startDate && l.date < startDate) return false;
            if (endDate && l.date > endDate) return false;
            return true;
          });

          // Sort by timestamp descending; tie-breaker: reverse original insertion order (LIFO)
          filtered.sort((a, b) => {
            const timeA = new Date(a.log.timestamp || a.log.date || 0).getTime();
            const timeB = new Date(b.log.timestamp || b.log.date || 0).getTime();
            const diff = timeB - timeA;
            if (diff !== 0) return diff;
            return b.originalIndex - a.originalIndex;
          });

          resolve(filtered.map(item => item.log));
        });
      });
    },

    async addLog(logData = {}, userEmailOverride) {
      return enqueueWrite(async () => {
        const customEmail = logData.userEmail !== undefined ? logData.userEmail : userEmailOverride;
        const userEmail = normalizeEmail(customEmail !== undefined ? customEmail : await getCurrentUserEmail());
        return new Promise(resolve => {
          getStorageArea().get([STORAGE_KEYS.LOGS], result => {
            const logs = safeGetLogs(result);
            const now = new Date();
            const logDate = logData.date || getLocalDateStr(now);

            const newLog = {
              id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
              metricId: logData.metricId || 'jobs',
              userEmail: userEmail || null,
              count: Math.max(1, parseInt(logData.count, 10) || 1),
              date: logDate,
              timestamp: now.toISOString(),
              company: (logData.company || '').trim(),
              role: (logData.role || '').trim(),
              notes: (logData.notes || '').trim(),
            };

            logs.push(newLog);
            getStorageArea().set({ [STORAGE_KEYS.LOGS]: logs }, () => resolve(newLog));
          });
        });
      });
    },

    async deleteLog(id, userEmailOverride) {
      if (!id) return false;
      return enqueueWrite(async () => {
        const targetEmail = normalizeEmail(userEmailOverride !== undefined ? userEmailOverride : await getCurrentUserEmail());
        return new Promise(resolve => {
          getStorageArea().get([STORAGE_KEYS.LOGS], result => {
            const logs = safeGetLogs(result);
            const targetIndex = logs.findIndex(l => l.id === id);
            if (targetIndex === -1) {
              resolve(false);
              return;
            }
            const log = logs[targetIndex];
            const logEmail = normalizeEmail(log.userEmail);
            const isAuthorized = (!targetEmail && !logEmail) || (targetEmail && logEmail === targetEmail);
            if (!isAuthorized) {
              resolve(false);
              return;
            }
            const filtered = logs.filter(l => l.id !== id);
            getStorageArea().set({ [STORAGE_KEYS.LOGS]: filtered }, () => resolve(true));
          });
        });
      });
    },

    async undoLastLog(metricId = 'jobs', date, userEmailOverride) {
      return enqueueWrite(async () => {
        const targetDate = date || getLocalDateStr();
        const targetEmail = normalizeEmail(userEmailOverride !== undefined ? userEmailOverride : await getCurrentUserEmail());
        return new Promise(resolve => {
          getStorageArea().get([STORAGE_KEYS.LOGS], result => {
            const logs = safeGetLogs(result);
            const indexed = logs.map((l, index) => ({ log: l, originalIndex: index }));
            const filtered = indexed.filter(item => {
              const l = item.log;
              if (!l || l.metricId !== metricId || l.date !== targetDate) return false;
              const logEmail = normalizeEmail(l.userEmail);
              if (!targetEmail) return !logEmail;
              return logEmail === targetEmail;
            });

            if (filtered.length === 0) {
              resolve(false);
              return;
            }

            filtered.sort((a, b) => {
              const timeA = new Date(a.log.timestamp || a.log.date || 0).getTime();
              const timeB = new Date(b.log.timestamp || b.log.date || 0).getTime();
              const diff = timeB - timeA;
              if (diff !== 0) return diff;
              return b.originalIndex - a.originalIndex;
            });

            const newestId = filtered[0].log.id;
            const remaining = logs.filter(l => l.id !== newestId);
            getStorageArea().set({ [STORAGE_KEYS.LOGS]: remaining }, () => resolve(true));
          });
        });
      });
    },

    async getStats(metricIdOrEmail, userEmailOverride) {
      let targetEmail = undefined;
      if (typeof metricIdOrEmail === 'string' && metricIdOrEmail.includes('@')) {
        targetEmail = metricIdOrEmail;
      } else if (userEmailOverride !== undefined) {
        targetEmail = userEmailOverride;
      } else {
        targetEmail = await getCurrentUserEmail();
      }

      const [metrics, logs] = await Promise.all([
        this.getMetrics(targetEmail),
        this.getLogs({}, targetEmail)
      ]);
      const now = new Date();
      const todayStr = getLocalDateStr(now);
      const weekAgoStr = addDays(todayStr, -6);
      const startOfMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      const today = {};
      const thisWeek = {};
      const thisMonth = {};
      const totals = {};
      const dailyMap = {};

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

      const jobDates = Object.keys(dailyMap)
        .filter(d => (dailyMap[d]['jobs'] || 0) > 0)
        .sort();

      const jobDateSet = new Set(jobDates);
      let currentStreak = 0;
      let checkDateStr = todayStr;

      if (!jobDateSet.has(checkDateStr)) {
        checkDateStr = addDays(checkDateStr, -1);
      }

      while (jobDateSet.has(checkDateStr)) {
        currentStreak++;
        checkDateStr = addDays(checkDateStr, -1);
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
          if (area === 'local' && (changes.logs || changes.metrics || changes.pt_auth_user || changes.pt_visible_metrics)) {
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
