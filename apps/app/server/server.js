const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow CORS from any origin so the browser extension and local dev servers can connect
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// API Endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'job-tracker-calendar-api', timestamp: new Date().toISOString() });
});

// Metrics
app.get('/api/metrics', (req, res) => {
  try {
    const metrics = db.getMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/metrics', (req, res) => {
  try {
    const { name, color, icon, unit } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const metric = db.addMetric({ name, color, icon, unit });
    res.status(201).json(metric);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/metrics/:id', (req, res) => {
  try {
    const success = db.deleteMetric(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Metric not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Logs
app.get('/api/logs', (req, res) => {
  try {
    const { startDate, endDate, metricId } = req.query;
    const logs = db.getLogs({ startDate, endDate, metricId });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logs', (req, res) => {
  try {
    const { metricId, count, date, timestamp, company, role, url, notes, status } = req.body;
    const log = db.addLog({ metricId, count, date, timestamp, company, role, url, notes, status });
    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/logs/:id', (req, res) => {
  try {
    const updated = db.updateLog(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Log not found' });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/logs/:id', (req, res) => {
  try {
    const success = db.deleteLog(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Log not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats summary
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static frontend build if available
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.join(clientDistPath, 'index.html');
  res.sendFile(indexPath, err => {
    if (err) {
      res.status(200).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Job Tracker API</title></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center;">
            <h2>Job Tracker API Server Running</h2>
            <p>API is listening on port ${PORT}. Run client frontend build or vite dev server to see the Google Calendar dashboard.</p>
          </body>
        </html>
      `);
    }
  });
});

app.listen(PORT, () => {
  console.log(`[Job Tracker Server] Running at http://localhost:${PORT}`);
  console.log(`[Job Tracker Server] API endpoints available at http://localhost:${PORT}/api/`);
});
