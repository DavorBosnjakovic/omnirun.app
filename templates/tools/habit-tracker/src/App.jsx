import { useState, useEffect, useMemo } from 'react';

// ── Helpers ──────────────────────────────────────────────────
const DAY_MS = 86400000;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EMOJIS = ['💪', '📖', '🧘', '💧', '🏃', '✍️', '🎵', '💤', '🥗', '🧹', '💊', '🌅'];

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toKey(date) {
  return date.toISOString().split('T')[0];
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatWeekRange(monday) {
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  const mMonth = monday.toLocaleDateString('en-US', { month: 'short' });
  const sMonth = sunday.toLocaleDateString('en-US', { month: 'short' });
  if (mMonth === sMonth) {
    return `${mMonth} ${monday.getDate()} – ${sunday.getDate()}`;
  }
  return `${mMonth} ${monday.getDate()} – ${sMonth} ${sunday.getDate()}`;
}

// ── Default Habits ───────────────────────────────────────────
const DEFAULT_HABITS = [
  { id: '1', name: 'Morning workout', emoji: '💪' },
  { id: '2', name: 'Read 20 pages', emoji: '📖' },
  { id: '3', name: 'Meditate 10 min', emoji: '🧘' },
  { id: '4', name: 'Drink 8 glasses of water', emoji: '💧' },
  { id: '5', name: 'No phone before bed', emoji: '💤' },
];

// ── Main Component ───────────────────────────────────────────
export default function App() {
  const [habits, setHabits] = useState([]);
  const [completions, setCompletions] = useState({});
  const [weekOffset, setWeekOffset] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('💪');

  // Load from localStorage
  useEffect(() => {
    const savedHabits = localStorage.getItem('ht-habits');
    const savedCompletions = localStorage.getItem('ht-completions');
    setHabits(savedHabits ? JSON.parse(savedHabits) : DEFAULT_HABITS);
    setCompletions(savedCompletions ? JSON.parse(savedCompletions) : {});
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (habits.length > 0 || localStorage.getItem('ht-habits')) {
      localStorage.setItem('ht-habits', JSON.stringify(habits));
    }
  }, [habits]);

  useEffect(() => {
    if (Object.keys(completions).length > 0 || localStorage.getItem('ht-completions')) {
      localStorage.setItem('ht-completions', JSON.stringify(completions));
    }
  }, [completions]);

  // ── Week Dates ─────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toKey(today);
  const currentMonday = getMonday(today);

  const weekMonday = useMemo(() => {
    const d = new Date(currentMonday);
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekMonday);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekMonday]);

  const isCurrentWeek = weekOffset === 0;
  const isFutureWeek = weekMonday > currentMonday;

  // ── Toggle Completion ──────────────────────────────────────
  const toggle = (habitId, dateKey) => {
    // Don't allow toggling future dates
    if (new Date(dateKey) > today) return;

    setCompletions((prev) => {
      const key = `${habitId}:${dateKey}`;
      const next = { ...prev };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = true;
      }
      return next;
    });
  };

  const isCompleted = (habitId, dateKey) => {
    return !!completions[`${habitId}:${dateKey}`];
  };

  // ── Streak Calculator ──────────────────────────────────────
  const getStreak = (habitId) => {
    let streak = 0;
    let d = new Date(today);
    // If not completed today, start from yesterday
    if (!isCompleted(habitId, toKey(d))) {
      d.setDate(d.getDate() - 1);
    }
    while (isCompleted(habitId, toKey(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  };

  // ── Stats ──────────────────────────────────────────────────
  const todayCompleted = habits.filter((h) => isCompleted(h.id, todayKey)).length;
  const todayPercent = habits.length > 0 ? Math.round((todayCompleted / habits.length) * 100) : 0;
  const bestStreak = habits.length > 0 ? Math.max(...habits.map((h) => getStreak(h.id))) : 0;

  // Week completion rate
  const weekStats = useMemo(() => {
    let total = 0;
    let done = 0;
    habits.forEach((h) => {
      weekDates.forEach((d) => {
        if (d <= today) {
          total++;
          if (isCompleted(h.id, toKey(d))) done++;
        }
      });
    });
    return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [habits, weekDates, completions]);

  // ── Add Habit ──────────────────────────────────────────────
  const addHabit = () => {
    if (!newName.trim()) return;
    const habit = {
      id: Date.now().toString(),
      name: newName.trim(),
      emoji: newEmoji,
    };
    setHabits((prev) => [...prev, habit]);
    setNewName('');
    setNewEmoji('💪');
    setShowAdd(false);
  };

  const deleteHabit = (id) => {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    // Clean up completions
    setCompletions((prev) => {
      const next = {};
      for (const key in prev) {
        if (!key.startsWith(`${id}:`)) next[key] = prev[key];
      }
      return next;
    });
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="app-title">Habit Tracker</h1>
          <span className="app-subtitle">Build better routines, one day at a time</span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + New Habit
        </button>
      </header>

      {/* Stats Row */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-value">{habits.length}</span>
          <span className="stat-label">Habits</span>
        </div>
        <div className="stat-card accent">
          <span className="stat-value">{todayPercent}%</span>
          <span className="stat-label">Today</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{weekStats.percent}%</span>
          <span className="stat-label">This Week</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{bestStreak}🔥</span>
          <span className="stat-label">Best Streak</span>
        </div>
      </div>

      {/* Week Navigation */}
      <div className="week-nav">
        <button className="week-btn" onClick={() => setWeekOffset((w) => w - 1)}>
          ← Prev
        </button>
        <div className="week-label">
          <span className="week-range">{formatWeekRange(weekMonday)}</span>
          {isCurrentWeek && <span className="week-badge">Current Week</span>}
        </div>
        <button
          className="week-btn"
          onClick={() => setWeekOffset((w) => w + 1)}
          disabled={isFutureWeek}
        >
          Next →
        </button>
      </div>

      {/* Habit Grid */}
      {habits.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <h2>No habits yet</h2>
          <p>Add your first habit to start tracking your progress.</p>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + Add a Habit
          </button>
        </div>
      ) : (
        <div className="habit-table">
          {/* Day Headers */}
          <div className="habit-row header-row">
            <div className="habit-name-col">Habit</div>
            {weekDates.map((d) => {
              const key = toKey(d);
              const isToday = key === todayKey;
              const isFuture = d > today;
              return (
                <div
                  key={key}
                  className={`day-col ${isToday ? 'today' : ''} ${isFuture ? 'future' : ''}`}
                >
                  <span className="day-name">{DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}</span>
                  <span className="day-date">{d.getDate()}</span>
                </div>
              );
            })}
            <div className="streak-col">Streak</div>
          </div>

          {/* Habit Rows */}
          {habits.map((habit) => {
            const streak = getStreak(habit.id);
            return (
              <div key={habit.id} className="habit-row">
                <div className="habit-name-col">
                  <span className="habit-emoji">{habit.emoji}</span>
                  <span className="habit-name">{habit.name}</span>
                  <button
                    className="delete-btn"
                    onClick={() => deleteHabit(habit.id)}
                    title="Delete habit"
                  >
                    ✕
                  </button>
                </div>
                {weekDates.map((d) => {
                  const key = toKey(d);
                  const done = isCompleted(habit.id, key);
                  const isFuture = d > today;
                  return (
                    <div
                      key={key}
                      className={`day-col ${key === todayKey ? 'today' : ''} ${isFuture ? 'future' : ''}`}
                    >
                      <button
                        className={`check-btn ${done ? 'checked' : ''}`}
                        onClick={() => toggle(habit.id, key)}
                        disabled={isFuture}
                      >
                        {done ? '✓' : ''}
                      </button>
                    </div>
                  );
                })}
                <div className="streak-col">
                  <span className={`streak-value ${streak >= 3 ? 'hot' : ''}`}>
                    {streak > 0 ? `${streak}🔥` : '—'}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Week Completion Bar */}
          <div className="week-progress">
            <div className="week-progress-label">
              <span>Week Progress</span>
              <span>{weekStats.done}/{weekStats.total} completed ({weekStats.percent}%)</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${weekStats.percent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Add Habit Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Habit</h2>
              <button className="modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Habit Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Morning run, Read 20 pages..."
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && addHabit()}
                />
              </div>
              <div className="form-group">
                <label>Icon</label>
                <div className="emoji-grid">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      className={`emoji-btn ${newEmoji === e ? 'active' : ''}`}
                      onClick={() => setNewEmoji(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addHabit} disabled={!newName.trim()}>
                Add Habit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
