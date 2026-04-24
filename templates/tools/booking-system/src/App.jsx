import { useState, useEffect, useMemo } from 'react';

// ── Services ─────────────────────────────────────────────────
const SERVICES = [
  { id: 'consultation', name: 'Consultation', duration: 60, color: '#6366F1', icon: '💬' },
  { id: 'followup', name: 'Follow-up', duration: 30, color: '#10B981', icon: '🔄' },
  { id: 'strategy', name: 'Strategy Session', duration: 90, color: '#F59E0B', icon: '🎯' },
  { id: 'quickcall', name: 'Quick Call', duration: 15, color: '#3B82F6', icon: '📞' },
];

const TIME_SLOTS = [];
for (let h = 9; h < 17; h++) {
  TIME_SLOTS.push(`${h.toString().padStart(2, '0')}:00`);
  TIME_SLOTS.push(`${h.toString().padStart(2, '0')}:30`);
}

const STATUSES = ['confirmed', 'pending', 'cancelled'];

// ── Sample Data ──────────────────────────────────────────────
function getSampleBookings() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const pad = (n) => n.toString().padStart(2, '0');
  const dateStr = (day) => `${y}-${pad(m + 1)}-${pad(day)}`;

  return [
    { id: '1', date: dateStr(d), time: '09:00', service: 'consultation', client: 'Sarah Chen', email: 'sarah@example.com', notes: 'Initial project discussion', status: 'confirmed' },
    { id: '2', date: dateStr(d), time: '11:00', service: 'quickcall', client: 'Marcus Johnson', email: 'marcus@example.com', notes: 'Quick check-in', status: 'confirmed' },
    { id: '3', date: dateStr(d), time: '14:00', service: 'strategy', client: 'Aisha Patel', email: 'aisha@example.com', notes: 'Q2 planning session', status: 'pending' },
    { id: '4', date: dateStr(d + 1 > 28 ? 1 : d + 1), time: '10:00', service: 'followup', client: 'Tom Rivera', email: 'tom@example.com', notes: 'Review deliverables', status: 'confirmed' },
    { id: '5', date: dateStr(d + 2 > 28 ? 2 : d + 2), time: '13:00', service: 'consultation', client: 'Elena Volkov', email: 'elena@example.com', notes: 'New client onboarding', status: 'pending' },
  ];
}

// ── Helpers ───────────────────────────────────────────────────
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

function formatTime(time) {
  const [h, m] = time.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function getMonthLabel(year, month) {
  return new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function toDateStr(year, month, day) {
  return `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [bookings, setBookings] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [showModal, setShowModal] = useState(false);
  const [newBooking, setNewBooking] = useState({
    time: '09:00', service: 'consultation', client: '', email: '', notes: '',
  });

  // Load/Save
  useEffect(() => {
    const saved = localStorage.getItem('bs-bookings');
    setBookings(saved ? JSON.parse(saved) : getSampleBookings());
  }, []);

  useEffect(() => {
    if (bookings.length > 0 || localStorage.getItem('bs-bookings')) {
      localStorage.setItem('bs-bookings', JSON.stringify(bookings));
    }
  }, [bookings]);

  const today = new Date();
  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  // Bookings for selected date
  const dayBookings = useMemo(() => {
    return bookings
      .filter((b) => b.date === selectedDate)
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [bookings, selectedDate]);

  // Dates that have bookings (for dot indicator)
  const bookedDates = useMemo(() => {
    const set = new Set();
    bookings.forEach((b) => { if (b.status !== 'cancelled') set.add(b.date); });
    return set;
  }, [bookings]);

  // Calendar grid
  const calendarDays = useMemo(() => {
    const { year, month } = currentMonth;
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  }, [currentMonth]);

  // Booked time slots for selected date (to disable)
  const bookedTimes = useMemo(() => {
    const set = new Set();
    bookings.forEach((b) => {
      if (b.date === selectedDate && b.status !== 'cancelled') set.add(b.time);
    });
    return set;
  }, [bookings, selectedDate]);

  // Actions
  const addBooking = () => {
    if (!newBooking.client.trim() || !newBooking.email.trim()) return;
    const booking = {
      id: Date.now().toString(),
      date: selectedDate,
      time: newBooking.time,
      service: newBooking.service,
      client: newBooking.client.trim(),
      email: newBooking.email.trim(),
      notes: newBooking.notes.trim(),
      status: 'pending',
    };
    setBookings((prev) => [...prev, booking]);
    setNewBooking({ time: '09:00', service: 'consultation', client: '', email: '', notes: '' });
    setShowModal(false);
  };

  const updateStatus = (id, status) => {
    setBookings((prev) => prev.map((b) => b.id === id ? { ...b, status } : b));
  };

  const deleteBooking = (id) => {
    setBookings((prev) => prev.filter((b) => b.id !== id));
  };

  const prevMonth = () => {
    setCurrentMonth((m) => {
      const d = new Date(m.year, m.month - 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const nextMonth = () => {
    setCurrentMonth((m) => {
      const d = new Date(m.year, m.month + 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const selectedDateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1 className="app-title">📅 Booking System</h1>
          <span className="app-subtitle">Manage appointments and schedules</span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Booking</button>
      </header>

      <div className="content-grid">
        {/* Calendar */}
        <div className="section">
          <div className="cal-header">
            <button className="month-btn" onClick={prevMonth}>←</button>
            <span className="month-label">{getMonthLabel(currentMonth.year, currentMonth.month)}</span>
            <button className="month-btn" onClick={nextMonth}>→</button>
          </div>
          <div className="cal-weekdays">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <span key={d} className="cal-weekday">{d}</span>
            ))}
          </div>
          <div className="cal-grid">
            {calendarDays.map((day, i) => {
              if (day === null) return <span key={`e-${i}`} className="cal-day empty" />;
              const dateStr = toDateStr(currentMonth.year, currentMonth.month, day);
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const hasBookings = bookedDates.has(dateStr);
              return (
                <button
                  key={day}
                  className={`cal-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedDate(dateStr)}
                >
                  {day}
                  {hasBookings && <span className="cal-dot" />}
                </button>
              );
            })}
          </div>

          {/* Services legend */}
          <div className="services-legend">
            {SERVICES.map((s) => (
              <div key={s.id} className="legend-item">
                <span className="legend-dot" style={{ background: s.color }} />
                <span className="legend-name">{s.icon} {s.name}</span>
                <span className="legend-dur">{s.duration}m</span>
              </div>
            ))}
          </div>
        </div>

        {/* Day View */}
        <div className="section">
          <div className="day-header">
            <h2 className="section-title">{selectedDateLabel}</h2>
            <span className="booking-count">{dayBookings.length} booking{dayBookings.length !== 1 ? 's' : ''}</span>
          </div>

          {dayBookings.length === 0 ? (
            <div className="empty-state">
              <p>No bookings for this day</p>
              <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ Book a slot</button>
            </div>
          ) : (
            <div className="booking-list">
              {dayBookings.map((b) => {
                const service = SERVICES.find((s) => s.id === b.service) || SERVICES[0];
                return (
                  <div key={b.id} className="booking-card">
                    <div className="booking-time-bar" style={{ background: service.color }} />
                    <div className="booking-body">
                      <div className="booking-top">
                        <span className="booking-time">{formatTime(b.time)}</span>
                        <span className={`status-badge ${b.status}`}>{b.status}</span>
                      </div>
                      <div className="booking-service">{service.icon} {service.name} · {service.duration}min</div>
                      <div className="booking-client">{b.client}</div>
                      <div className="booking-email">{b.email}</div>
                      {b.notes && <div className="booking-notes">"{b.notes}"</div>}
                      <div className="booking-actions">
                        {b.status === 'pending' && (
                          <button className="action-btn confirm" onClick={() => updateStatus(b.id, 'confirmed')}>Confirm</button>
                        )}
                        {b.status !== 'cancelled' && (
                          <button className="action-btn cancel" onClick={() => updateStatus(b.id, 'cancelled')}>Cancel</button>
                        )}
                        <button className="action-btn delete" onClick={() => deleteBooking(b.id)}>Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* New Booking Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Booking — {selectedDateLabel}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Time Slot</label>
                <div className="time-grid">
                  {TIME_SLOTS.map((t) => {
                    const taken = bookedTimes.has(t);
                    return (
                      <button
                        key={t}
                        className={`time-btn ${newBooking.time === t ? 'active' : ''} ${taken ? 'taken' : ''}`}
                        onClick={() => !taken && setNewBooking({ ...newBooking, time: t })}
                        disabled={taken}
                      >
                        {formatTime(t)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <label>Service</label>
                <div className="service-grid">
                  {SERVICES.map((s) => (
                    <button
                      key={s.id}
                      className={`service-btn ${newBooking.service === s.id ? 'active' : ''}`}
                      onClick={() => setNewBooking({ ...newBooking, service: s.id })}
                      style={newBooking.service === s.id ? { borderColor: s.color, background: s.color + '15' } : {}}
                    >
                      <span className="service-icon">{s.icon}</span>
                      <span className="service-name">{s.name}</span>
                      <span className="service-dur">{s.duration}m</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Client Name</label>
                <input
                  type="text"
                  value={newBooking.client}
                  onChange={(e) => setNewBooking({ ...newBooking, client: e.target.value })}
                  placeholder="Full name"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={newBooking.email}
                  onChange={(e) => setNewBooking({ ...newBooking, email: e.target.value })}
                  placeholder="client@example.com"
                />
              </div>

              <div className="form-group">
                <label>Notes (optional)</label>
                <input
                  type="text"
                  value={newBooking.notes}
                  onChange={(e) => setNewBooking({ ...newBooking, notes: e.target.value })}
                  placeholder="Any special requests..."
                  onKeyDown={(e) => e.key === 'Enter' && addBooking()}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={addBooking}
                disabled={!newBooking.client.trim() || !newBooking.email.trim()}
              >
                Book Appointment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
