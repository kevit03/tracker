const API_BASE = '/api';

export const api = {
  async getMetrics() {
    const res = await fetch(`${API_BASE}/metrics`);
    if (!res.ok) throw new Error('Failed to fetch metrics');
    return res.json();
  },

  async addMetric(data) {
    const res = await fetch(`${API_BASE}/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create metric');
    }
    return res.json();
  },

  async deleteMetric(id) {
    const res = await fetch(`${API_BASE}/metrics/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete metric');
    return res.json();
  },

  async getLogs(params = {}) {
    const query = new URLSearchParams();
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);
    if (params.metricId) query.append('metricId', params.metricId);

    const res = await fetch(`${API_BASE}/logs?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch logs');
    return res.json();
  },

  async addLog(data) {
    const res = await fetch(`${API_BASE}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to add log');
    }
    return res.json();
  },

  async updateLog(id, data) {
    const res = await fetch(`${API_BASE}/logs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update log');
    return res.json();
  },

  async deleteLog(id) {
    const res = await fetch(`${API_BASE}/logs/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete log');
    return res.json();
  },

  async getStats() {
    const res = await fetch(`${API_BASE}/stats`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  }
};
