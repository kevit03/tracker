import React, { useState, useEffect } from 'react';
import TopNav from './components/TopNav';
import Sidebar from './components/Sidebar';
import MonthView from './components/MonthView';
import WeekView from './components/WeekView';
import DayModal from './components/DayModal';
import QuickLogModal from './components/QuickLogModal';
import CreateMetricModal from './components/CreateMetricModal';
import { api } from './api';

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'week'
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [metrics, setMetrics] = useState([]);
  const [visibleMetrics, setVisibleMetrics] = useState(new Set(['jobs', 'leetcode']));
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  // Modals state
  const [selectedDay, setSelectedDay] = useState(null);
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogDefaultDate, setQuickLogDefaultDate] = useState(new Date());
  const [createMetricOpen, setCreateMetricOpen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [fetchedMetrics, fetchedLogs, fetchedStats] = await Promise.all([
        api.getMetrics(),
        api.getLogs(),
        api.getStats()
      ]);

      setMetrics(fetchedMetrics);
      setLogs(fetchedLogs);
      setStats(fetchedStats);

      // Make sure all metrics are visible by default
      setVisibleMetrics(prev => {
        const next = new Set(prev);
        fetchedMetrics.forEach(m => next.add(m.id));
        return next;
      });
    } catch (err) {
      console.error('Failed to load tracker data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Poll stats occasionally
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  // Navigation handlers
  const handlePrev = () => {
    if (viewMode === 'month') {
      setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    } else {
      setCurrentDate(prev => {
        const next = new Date(prev);
        next.setDate(next.getDate() - 7);
        return next;
      });
    }
  };

  const handleNext = () => {
    if (viewMode === 'month') {
      setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    } else {
      setCurrentDate(prev => {
        const next = new Date(prev);
        next.setDate(next.getDate() + 7);
        return next;
      });
    }
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleSelectDate = (date) => {
    setCurrentDate(new Date(date));
  };

  const handleSelectDay = (date) => {
    setSelectedDay(date);
  };

  const handleQuickLogDay = (date) => {
    setQuickLogDefaultDate(date);
    setQuickLogOpen(true);
  };

  const handleToggleMetric = (id) => {
    setVisibleMetrics(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id); // Don't allow unchecking all
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAddLog = async (data) => {
    await api.addLog(data);
    await loadData();
  };

  const handleDeleteLog = async (id) => {
    await api.deleteLog(id);
    await loadData();
  };

  const handleCreatedMetric = async (data) => {
    const created = await api.addMetric(data);
    setVisibleMetrics(prev => new Set([...prev, created.id]));
    await loadData();
  };

  const handleDeleteMetric = async (id) => {
    await api.deleteMetric(id);
    await loadData();
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-white">
      {/* Top Google Calendar Navigation Bar */}
      <TopNav
        currentDate={currentDate}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        viewMode={viewMode}
        setViewMode={setViewMode}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        stats={stats}
        onRefresh={loadData}
        loading={loading}
      />

      {/* Main Area: Sidebar + Calendar Grid */}
      <div className="flex-1 flex overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            currentDate={currentDate}
            onSelectDate={handleSelectDate}
            metrics={metrics}
            visibleMetrics={visibleMetrics}
            onToggleMetric={handleToggleMetric}
            onOpenCreateMetric={() => setCreateMetricOpen(true)}
            onOpenQuickLog={() => {
              setQuickLogDefaultDate(currentDate);
              setQuickLogOpen(true);
            }}
            onDeleteMetric={handleDeleteMetric}
            stats={stats}
          />
        )}

        <main className="flex-1 flex flex-col overflow-hidden relative">
          {viewMode === 'month' ? (
            <MonthView
              currentDate={currentDate}
              logs={logs}
              metrics={metrics}
              visibleMetrics={visibleMetrics}
              onSelectDay={handleSelectDay}
              onQuickLogDay={handleQuickLogDay}
              searchQuery={searchQuery}
            />
          ) : (
            <WeekView
              currentDate={currentDate}
              logs={logs}
              metrics={metrics}
              visibleMetrics={visibleMetrics}
              onSelectDay={handleSelectDay}
              onQuickLogDay={handleQuickLogDay}
              searchQuery={searchQuery}
            />
          )}
        </main>
      </div>

      {/* Day Details Modal */}
      {selectedDay && (
        <DayModal
          date={selectedDay}
          logs={logs}
          metrics={metrics}
          onClose={() => setSelectedDay(null)}
          onAddLog={handleAddLog}
          onDeleteLog={handleDeleteLog}
        />
      )}

      {/* Quick Log Modal (+ Create button) */}
      {quickLogOpen && (
        <QuickLogModal
          defaultDate={quickLogDefaultDate}
          metrics={metrics}
          onClose={() => setQuickLogOpen(false)}
          onAddLog={handleAddLog}
        />
      )}

      {/* Add Tracker Category Modal */}
      {createMetricOpen && (
        <CreateMetricModal
          onClose={() => setCreateMetricOpen(false)}
          onCreated={handleCreatedMetric}
        />
      )}
    </div>
  );
}
