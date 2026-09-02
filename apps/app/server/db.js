const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_METRICS = [
  {
    id: 'jobs',
    name: 'Job Applications',
    color: '#1a73e8', // Google Calendar Blue
    icon: 'briefcase',
    unit: 'jobs',
    isDefault: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'leetcode',
    name: 'LeetCode Problems',
    color: '#1e8e3e', // Google Calendar Green
    icon: 'code',
    unit: 'problems',
    isDefault: true,
    createdAt: new Date().toISOString()
  }
];

function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      metrics: DEFAULT_METRICS,
      logs: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
  }
}

function readDb() {
  initDb();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.metrics || !Array.isArray(data.metrics)) {
      data.metrics = DEFAULT_METRICS;
    }
    if (!data.logs || !Array.isArray(data.logs)) {
      data.logs = [];
    }
    return data;
  } catch (err) {
    console.error('Error reading db:', err);
    return { metrics: DEFAULT_METRICS, logs: [] };
  }
}

function writeDb(data) {
  initDb();
  const tmpFile = `${DB_FILE}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

// Format Date YYYY-MM-DD in local time
function getLocalDateStr(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const db = {
  getMetrics() {
    const data = readDb();
    return data.metrics;
  },

  addMetric({ name, color, icon, unit }) {
    const data = readDb();
    const id = (name || 'metric')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
    
    const newMetric = {
      id,
      name: name.trim(),
      color: color || '#1a73e8',
      icon: icon || 'target',
      unit: unit ? unit.trim() : 'items',
      isDefault: false,
      createdAt: new Date().toISOString()
    };
    data.metrics.push(newMetric);
    writeDb(data);
    return newMetric;
  },

  deleteMetric(id) {
    const data = readDb();
    const metricIndex = data.metrics.findIndex(m => m.id === id);
    if (metricIndex === -1) return false;
    if (data.metrics[metricIndex].isDefault) {
      throw new Error('Default metrics cannot be deleted.');
    }
    data.metrics.splice(metricIndex, 1);
    // Optionally also cascade or keep logs
    writeDb(data);
    return true;
  },

  getLogs({ startDate, endDate, metricId } = {}) {
    const data = readDb();
    let results = data.logs;

    if (metricId) {
      results = results.filter(l => l.metricId === metricId);
    }
    if (startDate) {
      results = results.filter(l => l.date >= startDate);
    }
    if (endDate) {
      results = results.filter(l => l.date <= endDate);
    }

    // Sort descending by timestamp
    return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  addLog({ metricId = 'jobs', count = 1, date, timestamp, company, role, url, notes, status }) {
    const data = readDb();
    const now = new Date();
    const logDate = date || getLocalDateStr(now);
    const logTimestamp = timestamp || now.toISOString();

    const newLog = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'),
      metricId,
      count: Math.max(1, parseInt(count, 10) || 1),
      date: logDate,
      timestamp: logTimestamp,
      company: (company || '').trim(),
      role: (role || '').trim(),
      url: (url || '').trim(),
      notes: (notes || '').trim(),
      status: status || 'applied',
      createdAt: now.toISOString()
    };

    data.logs.push(newLog);
    writeDb(data);
    return newLog;
  },

  updateLog(id, fields) {
    const data = readDb();
    const index = data.logs.findIndex(l => l.id === id);
    if (index === -1) return null;

    const allowed = ['count', 'date', 'company', 'role', 'url', 'notes', 'status', 'metricId'];
    allowed.forEach(field => {
      if (fields[field] !== undefined) {
        if (field === 'count') {
          data.logs[index].count = Math.max(1, parseInt(fields.count, 10) || 1);
        } else {
          data.logs[index][field] = fields[field];
        }
      }
    });
    data.logs[index].updatedAt = new Date().toISOString();
    writeDb(data);
    return data.logs[index];
  },

  deleteLog(id) {
    const data = readDb();
    const index = data.logs.findIndex(l => l.id === id);
    if (index === -1) return false;
    data.logs.splice(index, 1);
    writeDb(data);
    return true;
  },

  getStats() {
    const data = readDb();
    const now = new Date();
    const todayStr = getLocalDateStr(now);

    // 7 days ago
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 6);
    const weekAgoStr = getLocalDateStr(weekAgo);

    // Start of current month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfMonthStr = getLocalDateStr(startOfMonth);

    // Aggregate by metric
    const metricTotals = {};
    const metricToday = {};
    const metricThisWeek = {};
    const metricThisMonth = {};

    data.metrics.forEach(m => {
      metricTotals[m.id] = 0;
      metricToday[m.id] = 0;
      metricThisWeek[m.id] = 0;
      metricThisMonth[m.id] = 0;
    });

    // Daily activity map: { 'YYYY-MM-DD': { 'jobs': 3, 'leetcode': 2 } }
    const dailyMap = {};

    data.logs.forEach(log => {
      const mId = log.metricId;
      const cnt = log.count || 1;

      if (!metricTotals[mId]) metricTotals[mId] = 0;
      metricTotals[mId] += cnt;

      if (log.date === todayStr) {
        metricToday[mId] = (metricToday[mId] || 0) + cnt;
      }
      if (log.date >= weekAgoStr && log.date <= todayStr) {
        metricThisWeek[mId] = (metricThisWeek[mId] || 0) + cnt;
      }
      if (log.date >= startOfMonthStr && log.date <= todayStr) {
        metricThisMonth[mId] = (metricThisMonth[mId] || 0) + cnt;
      }

      if (!dailyMap[log.date]) dailyMap[log.date] = {};
      dailyMap[log.date][mId] = (dailyMap[log.date][mId] || 0) + cnt;
    });

    // Calculate streak for job applications
    const jobDates = Object.keys(dailyMap)
      .filter(d => (dailyMap[d]['jobs'] || 0) > 0)
      .sort();

    const jobDateSet = new Set(jobDates);

    let currentStreak = 0;
    let checkDate = new Date(now);

    // If no jobs today, streak might still be intact from yesterday
    const todayHasJob = jobDateSet.has(getLocalDateStr(checkDate));
    if (!todayHasJob) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (jobDateSet.has(getLocalDateStr(checkDate))) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    return {
      todayStr,
      metrics: data.metrics,
      today: metricToday,
      thisWeek: metricThisWeek,
      thisMonth: metricThisMonth,
      totals: metricTotals,
      totalLogsCount: data.logs.length,
      currentStreak,
      dailyMap
    };
  }
};

module.exports = db;
