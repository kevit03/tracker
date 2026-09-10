// Shared storage manager for Job & Activity Tracker
const TrackerStorage = (() => {
  const STORAGE_KEYS = {
    LOGS: 'logs',
    METRICS: 'metrics',
    AUTH: 'pt_auth_user',
    VISIBLE_METRICS: 'pt_visible_metrics',
    THEME: 'pt_theme'
  };

  function formatSecondsToMMSS(totalSeconds) {
    const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // Upper bound for the solve timer. A free-text field must never be able to
  // arm a countdown longer than a day (or a negative one).
  const MAX_TIMER_SECONDS = 86400;

  function parseStringToSeconds(str) {
    if (!str || typeof str !== 'string') return 0;
    const trimmed = str.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      return Math.min(MAX_TIMER_SECONDS, n <= 300 ? n * 60 : n);
    }
    // Every component must be a plain unsigned integer. "-5:30" or "1:2:3:4"
    // are rejected outright rather than silently producing a negative duration.
    const rawParts = trimmed.split(':');
    if (rawParts.length !== 2 && rawParts.length !== 3) return 0;
    if (!rawParts.every(p => /^\d+$/.test(p.trim()))) return 0;
    const parts = rawParts.map(p => parseInt(p.trim(), 10));
    const total = parts.length === 2
      ? parts[0] * 60 + parts[1]
      : parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (!isFinite(total) || total <= 0) return 0;
    return Math.min(MAX_TIMER_SECONDS, total);
  }

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

  function readRaw(key) {
    return new Promise(resolve => {
      getStorageArea().get([key], result => resolve(result));
    });
  }

  function writeRaw(key, value) {
    return new Promise(resolve => {
      getStorageArea().set({ [key]: value }, () => resolve(true));
    });
  }

  // The mutex above only serializes writers inside a single JS context, and the
  // popup and the content script each load their own copy of this module against
  // one shared chrome.storage.local. chrome.storage has no compare-and-swap, so
  // a read-modify-write here can still be clobbered by the other context.
  // Re-read after every write and re-apply the mutation when that happens.
  const MAX_WRITE_ATTEMPTS = 5;

  // apply(currentValue, alreadyWrote) must return either
  //   { write: false, result }                       -> nothing to do
  //   { write: true, value, verify(readBack), result } -> write and confirm
  async function mutateVerified(key, readValue, apply) {
    let lastResult;
    let wrote = false;
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const plan = apply(readValue(await readRaw(key)), wrote);
      lastResult = plan.result;
      if (!plan.write) return plan.result;
      await writeRaw(key, plan.value);
      wrote = true;
      if (plan.verify(readValue(await readRaw(key)))) return plan.result;
    }
    return lastResult;
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

  // Seeding the defaults used to be an unlocked set() straight out of getMetrics,
  // which could overwrite an addMetric that was mid-flight in another context and
  // silently drop the new tracker. Route it through the queue and re-check first.
  function seedDefaultMetrics() {
    return enqueueWrite(async () => {
      const existing = safeGetMetrics(await readRaw(STORAGE_KEYS.METRICS));
      if (existing.length > 0) return false;
      await writeRaw(STORAGE_KEYS.METRICS, DEFAULT_METRICS.map(m => ({ ...m })));
      return true;
    });
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
            seedDefaultMetrics();
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
      const hasGoal = list => {
        const found = list.find(m => m && m.id === metricId);
        return !found || found.dailyGoal === goal;
      };
      return enqueueWrite(async () => {
        return mutateVerified(STORAGE_KEYS.METRICS, safeGetMetrics, current => {
          const allMetrics = current.length === 0 ? [...DEFAULT_METRICS] : current;
          const updated = allMetrics.map(m => (m && m.id === metricId ? { ...m, dailyGoal: goal } : m));
          return { write: true, value: updated, verify: hasGoal, result: true };
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

        const hasMetric = list => list.some(m => m && m.id === newMetric.id);
        return mutateVerified(STORAGE_KEYS.METRICS, safeGetMetrics, current => {
          if (hasMetric(current)) return { write: false, result: newMetric };
          const allMetrics = current.length === 0 ? [...DEFAULT_METRICS] : current;
          return {
            write: true,
            value: allMetrics.concat([newMetric]),
            verify: hasMetric,
            result: newMetric
          };
        });
      });
    },

    async getActivityHistory(daysCount = 30, metricId = null, userEmailOverride) {
      const days = Math.max(1, Math.min(90, parseInt(daysCount, 10) || 30));
      let targetMetricId = null;
      let targetEmailOverride = userEmailOverride;
      if (typeof metricId === 'string' && metricId.includes('@')) {
        targetEmailOverride = metricId;
        targetMetricId = null;
      } else {
        targetMetricId = metricId;
      }

      const targetEmail = normalizeEmail(targetEmailOverride !== undefined ? targetEmailOverride : await getCurrentUserEmail());
      const [metrics, logs] = await Promise.all([
        this.getMetrics(targetEmail),
        this.getLogs(targetMetricId ? { metricId: targetMetricId } : {}, targetEmail)
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
        const dayTotal = targetMetricId ? (dayData.byMetric[targetMetricId] || 0) : dayData.total;
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
        const isGone = list => !list.some(m => m && m.id === id);
        return mutateVerified(STORAGE_KEYS.METRICS, safeGetMetrics, (allMetrics, alreadyWrote) => {
          const target = allMetrics.find(m => m && m.id === id);
          if (!target) return { write: false, result: alreadyWrote };
          if (target.isDefault || target.id === 'jobs' || target.id === 'leetcode') {
            return { write: false, result: false };
          }
          const owner = normalizeEmail(target.userEmail);
          const isAuthorized = (!targetEmail && !owner) || (targetEmail && owner === targetEmail);
          if (!isAuthorized) return { write: false, result: false };
          return {
            write: true,
            value: allMetrics.filter(m => !m || m.id !== id),
            verify: isGone,
            result: true
          };
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
        const now = new Date();

        const newLog = {
          id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
          metricId: logData.metricId || 'jobs',
          userEmail: userEmail || null,
          count: Math.max(1, parseInt(logData.count, 10) || 1),
          date: logData.date || getLocalDateStr(now),
          timestamp: now.toISOString(),
          company: (logData.company || '').trim(),
          role: (logData.role || '').trim(),
          notes: (logData.notes || '').trim(),
          solveTimeSeconds: Math.max(0, parseInt(logData.solveTimeSeconds, 10) || 0),
        };

        const hasLog = list => list.some(l => l && l.id === newLog.id);
        return mutateVerified(STORAGE_KEYS.LOGS, safeGetLogs, logs => {
          if (hasLog(logs)) return { write: false, result: newLog };
          return { write: true, value: logs.concat([newLog]), verify: hasLog, result: newLog };
        });
      });
    },

    async deleteLog(id, userEmailOverride) {
      if (!id) return false;
      return enqueueWrite(async () => {
        const targetEmail = normalizeEmail(userEmailOverride !== undefined ? userEmailOverride : await getCurrentUserEmail());
        const isGone = list => !list.some(l => l && l.id === id);
        return mutateVerified(STORAGE_KEYS.LOGS, safeGetLogs, (logs, alreadyWrote) => {
          const log = logs.find(l => l && l.id === id);
          if (!log) return { write: false, result: alreadyWrote };
          const logEmail = normalizeEmail(log.userEmail);
          const isAuthorized = (!targetEmail && !logEmail) || (targetEmail && logEmail === targetEmail);
          if (!isAuthorized) return { write: false, result: false };
          return {
            write: true,
            value: logs.filter(l => !l || l.id !== id),
            verify: isGone,
            result: true
          };
        });
      });
    },

    async undoLastLog(metricId = 'jobs', date, userEmailOverride) {
      return enqueueWrite(async () => {
        const targetDate = date || getLocalDateStr();
        const targetEmail = normalizeEmail(userEmailOverride !== undefined ? userEmailOverride : await getCurrentUserEmail());
        return mutateVerified(STORAGE_KEYS.LOGS, safeGetLogs, (logs, alreadyWrote) => {
          const indexed = logs.map((l, index) => ({ log: l, originalIndex: index }));
          const filtered = indexed.filter(item => {
            const l = item.log;
            if (!l || l.metricId !== metricId || l.date !== targetDate) return false;
            const logEmail = normalizeEmail(l.userEmail);
            if (!targetEmail) return !logEmail;
            return logEmail === targetEmail;
          });

          // Nothing left to undo. Counts must never be driven negative.
          if (filtered.length === 0) return { write: false, result: alreadyWrote };

          filtered.sort((a, b) => {
            const timeA = new Date(a.log.timestamp || a.log.date || 0).getTime();
            const timeB = new Date(b.log.timestamp || b.log.date || 0).getTime();
            const diff = timeB - timeA;
            if (diff !== 0) return diff;
            return b.originalIndex - a.originalIndex;
          });

          const newestId = filtered[0].log.id;
          return {
            write: true,
            value: logs.filter(l => !l || l.id !== newestId),
            verify: list => !list.some(l => l && l.id === newestId),
            result: true
          };
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

    formatSecondsToMMSS,
    parseStringToSeconds,

    formatTimeHMS(totalSeconds) {
      const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
      const hrs = Math.floor(s / 3600);
      const mins = Math.floor((s % 3600) / 60);
      const secs = s % 60;
      if (hrs > 0) {
        return hrs + 'h ' + mins + 'm';
      }
      if (mins > 0 && secs > 0) {
        return mins + 'm ' + secs + 's';
      }
      if (mins > 0) {
        return mins + 'm';
      }
      return secs + 's';
    },

    async getLeetcodeTimeStats(userEmailOverride) {
      const logs = await this.getLogs({ metricId: 'leetcode' }, userEmailOverride);
      const today = getLocalDateStr();
      let totalSeconds = 0;
      let todaySeconds = 0;
      let sessionCount = 0;
      let todaySessionCount = 0;

      logs.forEach(l => {
        const sec = parseInt(l.solveTimeSeconds, 10) || 0;
        if (sec > 0) {
          totalSeconds += sec;
          sessionCount++;
          if (l.date === today) {
            todaySeconds += sec;
            todaySessionCount++;
          }
        }
      });

      const avgSeconds = sessionCount > 0 ? Math.round(totalSeconds / sessionCount) : 0;

      return {
        totalSeconds,
        todaySeconds,
        sessionCount,
        todaySessionCount,
        avgSeconds
      };
    },

    async getTheme() {
      return new Promise(resolve => {
        getStorageArea().get([STORAGE_KEYS.THEME], result => {
          const theme = result && result[STORAGE_KEYS.THEME];
          resolve(theme === 'dark' ? 'dark' : 'light');
        });
      });
    },

    async setTheme(theme) {
      const cleanTheme = theme === 'dark' ? 'dark' : 'light';
      return enqueueWrite(async () => {
        return new Promise(resolve => {
          getStorageArea().set({ [STORAGE_KEYS.THEME]: cleanTheme }, () => resolve(cleanTheme));
        });
      });
    },

    onChanged(cb) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && (changes.logs || changes.metrics || changes.pt_auth_user || changes.pt_visible_metrics || changes.pt_theme)) {
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
