import { useState, useMemo } from 'react';

// ── Sample Data ──────────────────────────────────────────────
const USERS = [
  { id: '1', name: 'Sarah Chen', email: 'sarah@example.com', role: 'Admin', status: 'active', joined: '2024-11-02', avatar: '👩‍💼' },
  { id: '2', name: 'Marcus Johnson', email: 'marcus@example.com', role: 'Editor', status: 'active', joined: '2024-12-15', avatar: '👨‍💻' },
  { id: '3', name: 'Aisha Patel', email: 'aisha@example.com', role: 'Viewer', status: 'active', joined: '2025-01-03', avatar: '👩‍🔬' },
  { id: '4', name: 'Tom Rivera', email: 'tom@example.com', role: 'Editor', status: 'inactive', joined: '2024-09-20', avatar: '👨‍🎨' },
  { id: '5', name: 'Elena Volkov', email: 'elena@example.com', role: 'Admin', status: 'active', joined: '2024-08-10', avatar: '👩‍🚀' },
  { id: '6', name: 'James Wright', email: 'james@example.com', role: 'Viewer', status: 'active', joined: '2025-01-18', avatar: '👨‍🏫' },
  { id: '7', name: 'Priya Sharma', email: 'priya@example.com', role: 'Editor', status: 'active', joined: '2024-10-05', avatar: '👩‍⚕️' },
  { id: '8', name: 'David Kim', email: 'david@example.com', role: 'Viewer', status: 'inactive', joined: '2024-07-22', avatar: '👨‍💼' },
];

const ORDERS = [
  { id: 'ORD-1041', customer: 'Sarah Chen', product: 'Pro Plan — Annual', amount: 299, status: 'completed', date: '2025-01-28' },
  { id: 'ORD-1040', customer: 'Marcus Johnson', product: 'Starter Plan — Monthly', amount: 19, status: 'completed', date: '2025-01-27' },
  { id: 'ORD-1039', customer: 'Aisha Patel', product: 'Pro Plan — Monthly', amount: 29, status: 'pending', date: '2025-01-26' },
  { id: 'ORD-1038', customer: 'Tom Rivera', product: 'Business Plan — Annual', amount: 599, status: 'completed', date: '2025-01-25' },
  { id: 'ORD-1037', customer: 'Elena Volkov', product: 'Pro Plan — Annual', amount: 299, status: 'refunded', date: '2025-01-24' },
  { id: 'ORD-1036', customer: 'James Wright', product: 'Starter Plan — Monthly', amount: 19, status: 'completed', date: '2025-01-23' },
  { id: 'ORD-1035', customer: 'Priya Sharma', product: 'Pro Plan — Monthly', amount: 29, status: 'pending', date: '2025-01-22' },
  { id: 'ORD-1034', customer: 'David Kim', product: 'Business Plan — Monthly', amount: 59, status: 'completed', date: '2025-01-21' },
];

const MONTHLY_REVENUE = [
  { month: 'Aug', amount: 4200 },
  { month: 'Sep', amount: 5800 },
  { month: 'Oct', amount: 5100 },
  { month: 'Nov', amount: 7200 },
  { month: 'Dec', amount: 6800 },
  { month: 'Jan', amount: 8400 },
];

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'orders', label: 'Orders', icon: '🛒' },
  { id: 'users', label: 'Users', icon: '👥' },
  { id: 'analytics', label: 'Analytics', icon: '📈' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

// ── Helpers ───────────────────────────────────────────────────
function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}
function formatDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [activePage, setActivePage] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState('all');

  const maxRevenue = Math.max(...MONTHLY_REVENUE.map((m) => m.amount));

  const stats = useMemo(() => ({
    totalUsers: USERS.length,
    activeUsers: USERS.filter((u) => u.status === 'active').length,
    totalRevenue: ORDERS.filter((o) => o.status === 'completed').reduce((s, o) => s + o.amount, 0),
    totalOrders: ORDERS.length,
    pendingOrders: ORDERS.filter((o) => o.status === 'pending').length,
    conversionRate: 68.4,
  }), []);

  const filteredUsers = useMemo(() => {
    if (!userSearch) return USERS;
    const q = userSearch.toLowerCase();
    return USERS.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [userSearch]);

  const filteredOrders = useMemo(() => {
    if (orderFilter === 'all') return ORDERS;
    return ORDERS.filter((o) => o.status === orderFilter);
  }, [orderFilter]);

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">⚡</span>
          <span className="brand-name">AdminPanel</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activePage === item.id ? 'active' : ''}`}
              onClick={() => setActivePage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-pill">
            <span className="user-avatar">👩‍💼</span>
            <div className="user-info">
              <span className="user-name">Sarah Chen</span>
              <span className="user-role">Admin</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            <h1 className="page-title">
              {NAV_ITEMS.find((n) => n.id === activePage)?.icon}{' '}
              {NAV_ITEMS.find((n) => n.id === activePage)?.label}
            </h1>
          </div>
          <div className="topbar-right">
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button className="icon-btn">🔔<span className="badge">3</span></button>
          </div>
        </header>

        <div className="page-body">
          {/* ── Overview ── */}
          {activePage === 'overview' && (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <span className="stat-label">Total Users</span>
                  <span className="stat-value">{stats.totalUsers}</span>
                  <span className="stat-sub active">{stats.activeUsers} active</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Revenue (this month)</span>
                  <span className="stat-value">{formatCurrency(stats.totalRevenue)}</span>
                  <span className="stat-sub positive">+12.5% vs last month</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Orders</span>
                  <span className="stat-value">{stats.totalOrders}</span>
                  <span className="stat-sub pending">{stats.pendingOrders} pending</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Conversion Rate</span>
                  <span className="stat-value">{stats.conversionRate}%</span>
                  <span className="stat-sub positive">+2.1% vs last month</span>
                </div>
              </div>

              {/* Revenue Chart */}
              <div className="section">
                <h2 className="section-title">Monthly Revenue</h2>
                <div className="chart-container">
                  {MONTHLY_REVENUE.map((m) => (
                    <div key={m.month} className="chart-col">
                      <span className="chart-val">{formatCurrency(m.amount)}</span>
                      <div className="chart-bar-wrap">
                        <div
                          className="chart-bar"
                          style={{ height: `${(m.amount / maxRevenue) * 100}%` }}
                        />
                      </div>
                      <span className="chart-label">{m.month}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Orders */}
              <div className="section">
                <h2 className="section-title">Recent Orders</h2>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Customer</th>
                        <th>Product</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ORDERS.slice(0, 5).map((o) => (
                        <tr key={o.id}>
                          <td className="td-mono">{o.id}</td>
                          <td>{o.customer}</td>
                          <td>{o.product}</td>
                          <td className="td-mono">{formatCurrency(o.amount)}</td>
                          <td><span className={`status-badge ${o.status}`}>{o.status}</span></td>
                          <td className="td-muted">{formatDate(o.date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ── Orders Page ── */}
          {activePage === 'orders' && (
            <div className="section">
              <div className="section-header">
                <h2 className="section-title">All Orders</h2>
                <div className="filter-row">
                  {['all', 'completed', 'pending', 'refunded'].map((f) => (
                    <button
                      key={f}
                      className={`filter-btn ${orderFilter === f ? 'active' : ''}`}
                      onClick={() => setOrderFilter(f)}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Customer</th>
                      <th>Product</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((o) => (
                      <tr key={o.id}>
                        <td className="td-mono">{o.id}</td>
                        <td>{o.customer}</td>
                        <td>{o.product}</td>
                        <td className="td-mono">{formatCurrency(o.amount)}</td>
                        <td><span className={`status-badge ${o.status}`}>{o.status}</span></td>
                        <td className="td-muted">{formatDate(o.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Users Page ── */}
          {activePage === 'users' && (
            <div className="section">
              <div className="section-header">
                <h2 className="section-title">User Management</h2>
                <input
                  type="text"
                  className="table-search"
                  placeholder="Search users…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="user-cell">
                            <span className="cell-avatar">{u.avatar}</span>
                            <span>{u.name}</span>
                          </div>
                        </td>
                        <td className="td-muted">{u.email}</td>
                        <td><span className={`role-badge ${u.role.toLowerCase()}`}>{u.role}</span></td>
                        <td><span className={`status-dot ${u.status}`} />{u.status}</td>
                        <td className="td-muted">{formatDate(u.joined)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Analytics Page ── */}
          {activePage === 'analytics' && (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <span className="stat-label">Page Views</span>
                  <span className="stat-value">24,521</span>
                  <span className="stat-sub positive">+8.3% vs last week</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Unique Visitors</span>
                  <span className="stat-value">3,847</span>
                  <span className="stat-sub positive">+5.1%</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Avg Session</span>
                  <span className="stat-value">4m 32s</span>
                  <span className="stat-sub negative">−12s vs last week</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Bounce Rate</span>
                  <span className="stat-value">34.2%</span>
                  <span className="stat-sub positive">−1.8%</span>
                </div>
              </div>
              <div className="section">
                <h2 className="section-title">Revenue Trend</h2>
                <div className="chart-container">
                  {MONTHLY_REVENUE.map((m) => (
                    <div key={m.month} className="chart-col">
                      <span className="chart-val">{formatCurrency(m.amount)}</span>
                      <div className="chart-bar-wrap">
                        <div className="chart-bar" style={{ height: `${(m.amount / maxRevenue) * 100}%` }} />
                      </div>
                      <span className="chart-label">{m.month}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Settings Page ── */}
          {activePage === 'settings' && (
            <div className="section">
              <h2 className="section-title">Settings</h2>
              <div className="settings-body">
                <div className="setting-group">
                  <label className="setting-label">App Name</label>
                  <input type="text" className="setting-input" defaultValue="AdminPanel" />
                </div>
                <div className="setting-group">
                  <label className="setting-label">Admin Email</label>
                  <input type="email" className="setting-input" defaultValue="sarah@example.com" />
                </div>
                <div className="setting-group">
                  <label className="setting-label">Timezone</label>
                  <select className="setting-input">
                    <option>UTC</option>
                    <option>America/New_York</option>
                    <option>Europe/London</option>
                    <option>Asia/Tokyo</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label className="setting-label">Notifications</label>
                  <div className="toggle-row">
                    <span className="toggle-text">Email notifications for new orders</span>
                    <input type="checkbox" defaultChecked className="toggle-check" />
                  </div>
                  <div className="toggle-row">
                    <span className="toggle-text">Weekly analytics digest</span>
                    <input type="checkbox" defaultChecked className="toggle-check" />
                  </div>
                </div>
                <button className="btn btn-primary">Save Changes</button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
