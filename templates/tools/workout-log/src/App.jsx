import { useState, useEffect, useMemo } from 'react';

// ── Common Exercises ─────────────────────────────────────────
const QUICK_EXERCISES = [
  { name: 'Bench Press', icon: '🏋️', muscle: 'Chest' },
  { name: 'Squat', icon: '🦵', muscle: 'Legs' },
  { name: 'Deadlift', icon: '💪', muscle: 'Back' },
  { name: 'Overhead Press', icon: '🤸', muscle: 'Shoulders' },
  { name: 'Barbell Row', icon: '🚣', muscle: 'Back' },
  { name: 'Pull-Ups', icon: '🧗', muscle: 'Back' },
  { name: 'Bicep Curls', icon: '💪', muscle: 'Arms' },
  { name: 'Tricep Dips', icon: '🏋️', muscle: 'Arms' },
  { name: 'Lunges', icon: '🚶', muscle: 'Legs' },
  { name: 'Plank', icon: '🧘', muscle: 'Core' },
  { name: 'Lat Pulldown', icon: '🏋️', muscle: 'Back' },
  { name: 'Leg Press', icon: '🦵', muscle: 'Legs' },
];

const SAMPLE_WORKOUTS = [
  {
    id: '1', name: 'Push Day', date: '2025-01-20',
    exercises: [
      { name: 'Bench Press', sets: [{ reps: 10, weight: 60 }, { reps: 8, weight: 70 }, { reps: 6, weight: 80 }, { reps: 6, weight: 80 }] },
      { name: 'Overhead Press', sets: [{ reps: 10, weight: 30 }, { reps: 8, weight: 35 }, { reps: 8, weight: 35 }] },
      { name: 'Tricep Dips', sets: [{ reps: 12, weight: 0 }, { reps: 10, weight: 0 }, { reps: 8, weight: 0 }] },
    ],
  },
  {
    id: '2', name: 'Pull Day', date: '2025-01-18',
    exercises: [
      { name: 'Deadlift', sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 110 }, { reps: 3, weight: 120 }] },
      { name: 'Barbell Row', sets: [{ reps: 10, weight: 50 }, { reps: 8, weight: 55 }, { reps: 8, weight: 55 }] },
      { name: 'Bicep Curls', sets: [{ reps: 12, weight: 14 }, { reps: 10, weight: 14 }, { reps: 10, weight: 14 }] },
    ],
  },
  {
    id: '3', name: 'Leg Day', date: '2025-01-16',
    exercises: [
      { name: 'Squat', sets: [{ reps: 8, weight: 80 }, { reps: 6, weight: 90 }, { reps: 6, weight: 90 }, { reps: 4, weight: 100 }] },
      { name: 'Leg Press', sets: [{ reps: 12, weight: 120 }, { reps: 10, weight: 140 }, { reps: 10, weight: 140 }] },
      { name: 'Lunges', sets: [{ reps: 10, weight: 20 }, { reps: 10, weight: 20 }, { reps: 10, weight: 20 }] },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────
function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function totalVolume(workout) {
  return workout.exercises.reduce((sum, ex) =>
    sum + ex.sets.reduce((s, set) => s + (set.reps * set.weight), 0), 0);
}

function totalSets(workout) {
  return workout.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [workouts, setWorkouts] = useState([]);
  const [view, setView] = useState('history'); // 'history' | 'active' | 'detail'
  const [detailId, setDetailId] = useState(null);

  // Active workout state
  const [activeName, setActiveName] = useState('');
  const [activeExercises, setActiveExercises] = useState([]);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [customExName, setCustomExName] = useState('');

  // Load/save
  useEffect(() => {
    const saved = localStorage.getItem('wl-workouts');
    setWorkouts(saved ? JSON.parse(saved) : SAMPLE_WORKOUTS);
  }, []);

  useEffect(() => {
    if (workouts.length > 0 || localStorage.getItem('wl-workouts')) {
      localStorage.setItem('wl-workouts', JSON.stringify(workouts));
    }
  }, [workouts]);

  // ── Stats ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const thisWeek = workouts.filter((w) => new Date(w.date + 'T00:00:00') >= weekAgo).length;
    const totalEx = workouts.reduce((s, w) => s + w.exercises.length, 0);
    const totalVol = workouts.reduce((s, w) => s + totalVolume(w), 0);
    return { total: workouts.length, thisWeek, totalEx, totalVol };
  }, [workouts]);

  // ── Active Workout Actions ─────────────────────────────────
  const startWorkout = () => {
    setActiveName(new Date().toLocaleDateString('en-US', { weekday: 'long' }) + ' Workout');
    setActiveExercises([]);
    setView('active');
  };

  const addExercise = (name) => {
    setActiveExercises((prev) => [...prev, { name, sets: [{ reps: '', weight: '' }] }]);
    setShowQuickAdd(false);
    setCustomExName('');
  };

  const addSet = (exIndex) => {
    setActiveExercises((prev) => {
      const next = [...prev];
      const lastSet = next[exIndex].sets[next[exIndex].sets.length - 1];
      next[exIndex] = {
        ...next[exIndex],
        sets: [...next[exIndex].sets, { reps: lastSet.reps || '', weight: lastSet.weight || '' }],
      };
      return next;
    });
  };

  const updateSet = (exIndex, setIndex, field, value) => {
    setActiveExercises((prev) => {
      const next = [...prev];
      next[exIndex] = {
        ...next[exIndex],
        sets: next[exIndex].sets.map((s, i) => i === setIndex ? { ...s, [field]: value } : s),
      };
      return next;
    });
  };

  const removeSet = (exIndex, setIndex) => {
    setActiveExercises((prev) => {
      const next = [...prev];
      next[exIndex] = {
        ...next[exIndex],
        sets: next[exIndex].sets.filter((_, i) => i !== setIndex),
      };
      if (next[exIndex].sets.length === 0) return next.filter((_, i) => i !== exIndex);
      return next;
    });
  };

  const removeExercise = (exIndex) => {
    setActiveExercises((prev) => prev.filter((_, i) => i !== exIndex));
  };

  const finishWorkout = () => {
    if (activeExercises.length === 0) return;
    const workout = {
      id: Date.now().toString(),
      name: activeName || 'Workout',
      date: new Date().toISOString().split('T')[0],
      exercises: activeExercises.map((ex) => ({
        name: ex.name,
        sets: ex.sets
          .filter((s) => s.reps)
          .map((s) => ({ reps: parseInt(s.reps) || 0, weight: parseFloat(s.weight) || 0 })),
      })).filter((ex) => ex.sets.length > 0),
    };
    if (workout.exercises.length > 0) {
      setWorkouts((prev) => [workout, ...prev]);
    }
    setView('history');
  };

  const cancelWorkout = () => { setView('history'); };

  const deleteWorkout = (id) => {
    setWorkouts((prev) => prev.filter((w) => w.id !== id));
    if (detailId === id) { setDetailId(null); setView('history'); }
  };

  const openDetail = (id) => { setDetailId(id); setView('detail'); };
  const detailWorkout = workouts.find((w) => w.id === detailId);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          {view === 'history' ? (
            <>
              <h1 className="app-title">🏋️ Workout Log</h1>
              <span className="app-subtitle">Track your lifts</span>
            </>
          ) : view === 'detail' ? (
            <button className="back-btn" onClick={() => setView('history')}>← Back</button>
          ) : (
            <h1 className="app-title">Active Workout</h1>
          )}
        </div>
        {view === 'history' && (
          <button className="btn btn-primary" onClick={startWorkout}>+ Start Workout</button>
        )}
        {view === 'active' && (
          <div className="active-actions">
            <button className="btn btn-ghost btn-sm" onClick={cancelWorkout}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={finishWorkout} disabled={activeExercises.length === 0}>
              ✓ Finish
            </button>
          </div>
        )}
      </header>

      {/* ── HISTORY VIEW ── */}
      {view === 'history' && (
        <>
          <div className="stats-row">
            <div className="stat-card"><span className="stat-value">{stats.total}</span><span className="stat-label">Workouts</span></div>
            <div className="stat-card accent"><span className="stat-value">{stats.thisWeek}</span><span className="stat-label">This Week</span></div>
            <div className="stat-card"><span className="stat-value">{stats.totalEx}</span><span className="stat-label">Exercises</span></div>
            <div className="stat-card"><span className="stat-value">{(stats.totalVol / 1000).toFixed(1)}k</span><span className="stat-label">Volume (kg)</span></div>
          </div>

          {workouts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🏋️</div>
              <h2>No workouts yet</h2>
              <p>Start your first workout to begin tracking.</p>
              <button className="btn btn-primary" onClick={startWorkout}>+ Start Workout</button>
            </div>
          ) : (
            <div className="workout-list">
              {workouts.map((w) => (
                <div key={w.id} className="workout-card" onClick={() => openDetail(w.id)}>
                  <div className="workout-card-left">
                    <span className="workout-date">{formatDate(w.date)}</span>
                    <h3 className="workout-name">{w.name}</h3>
                    <span className="workout-summary">
                      {w.exercises.length} exercises · {totalSets(w)} sets · {totalVolume(w).toLocaleString()} kg
                    </span>
                  </div>
                  <div className="workout-card-right">
                    <div className="exercise-tags">
                      {w.exercises.slice(0, 3).map((ex, i) => (
                        <span key={i} className="exercise-tag">{ex.name}</span>
                      ))}
                      {w.exercises.length > 3 && <span className="exercise-tag muted">+{w.exercises.length - 3}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── ACTIVE WORKOUT ── */}
      {view === 'active' && (
        <div className="active-workout">
          <input
            type="text"
            className="workout-name-input"
            value={activeName}
            onChange={(e) => setActiveName(e.target.value)}
            placeholder="Workout name..."
          />

          {activeExercises.map((ex, exI) => (
            <div key={exI} className="exercise-block">
              <div className="exercise-header">
                <h3>{ex.name}</h3>
                <button className="remove-btn" onClick={() => removeExercise(exI)}>✕</button>
              </div>
              <div className="sets-header">
                <span className="set-num-label">Set</span>
                <span>Reps</span>
                <span>Weight (kg)</span>
                <span></span>
              </div>
              {ex.sets.map((set, setI) => (
                <div key={setI} className="set-row">
                  <span className="set-num">{setI + 1}</span>
                  <input
                    type="number" min="0" placeholder="0"
                    value={set.reps}
                    onChange={(e) => updateSet(exI, setI, 'reps', e.target.value)}
                  />
                  <input
                    type="number" min="0" step="0.5" placeholder="0"
                    value={set.weight}
                    onChange={(e) => updateSet(exI, setI, 'weight', e.target.value)}
                  />
                  <button className="remove-set-btn" onClick={() => removeSet(exI, setI)}>✕</button>
                </div>
              ))}
              <button className="add-set-btn" onClick={() => addSet(exI)}>+ Add Set</button>
            </div>
          ))}

          {/* Add Exercise */}
          {showQuickAdd ? (
            <div className="quick-add-panel">
              <div className="quick-add-header">
                <h3>Add Exercise</h3>
                <button className="modal-close" onClick={() => setShowQuickAdd(false)}>✕</button>
              </div>
              <div className="quick-add-grid">
                {QUICK_EXERCISES.map((ex) => (
                  <button key={ex.name} className="quick-ex-btn" onClick={() => addExercise(ex.name)}>
                    <span className="quick-ex-icon">{ex.icon}</span>
                    <span className="quick-ex-name">{ex.name}</span>
                    <span className="quick-ex-muscle">{ex.muscle}</span>
                  </button>
                ))}
              </div>
              <div className="custom-ex-row">
                <input
                  type="text" placeholder="Custom exercise name..."
                  value={customExName}
                  onChange={(e) => setCustomExName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && customExName.trim() && addExercise(customExName.trim())}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => customExName.trim() && addExercise(customExName.trim())}
                  disabled={!customExName.trim()}
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button className="add-exercise-btn" onClick={() => setShowQuickAdd(true)}>
              + Add Exercise
            </button>
          )}
        </div>
      )}

      {/* ── DETAIL VIEW ── */}
      {view === 'detail' && detailWorkout && (
        <div className="detail-view">
          <div className="detail-top">
            <div>
              <span className="workout-date">{formatDate(detailWorkout.date)}</span>
              <h2 className="detail-name">{detailWorkout.name}</h2>
              <span className="workout-summary">
                {detailWorkout.exercises.length} exercises · {totalSets(detailWorkout)} sets · {totalVolume(detailWorkout).toLocaleString()} kg volume
              </span>
            </div>
            <button className="btn btn-danger-sm" onClick={() => deleteWorkout(detailWorkout.id)}>🗑️ Delete</button>
          </div>

          {detailWorkout.exercises.map((ex, i) => (
            <div key={i} className="detail-exercise">
              <h3 className="detail-ex-name">{ex.name}</h3>
              <div className="detail-sets">
                <div className="detail-sets-header">
                  <span>Set</span><span>Reps</span><span>Weight</span><span>Volume</span>
                </div>
                {ex.sets.map((set, j) => (
                  <div key={j} className="detail-set-row">
                    <span className="set-num">{j + 1}</span>
                    <span>{set.reps}</span>
                    <span>{set.weight} kg</span>
                    <span className="set-volume">{(set.reps * set.weight).toLocaleString()} kg</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
