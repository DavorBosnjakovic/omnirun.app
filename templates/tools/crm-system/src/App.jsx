import { useState, useEffect, useMemo } from 'react';

// ── Constants ────────────────────────────────────────────────
const CONTACT_STATUSES = [
  { id: 'lead', label: 'Lead', color: '#3B82F6' },
  { id: 'prospect', label: 'Prospect', color: '#F59E0B' },
  { id: 'customer', label: 'Customer', color: '#10B981' },
  { id: 'churned', label: 'Churned', color: '#EF4444' },
];

const PIPELINE_STAGES = [
  { id: 'lead', label: 'Lead', color: '#3B82F6' },
  { id: 'qualified', label: 'Qualified', color: '#8B5CF6' },
  { id: 'proposal', label: 'Proposal', color: '#F59E0B' },
  { id: 'negotiation', label: 'Negotiation', color: '#EC4899' },
  { id: 'won', label: 'Won', color: '#10B981' },
  { id: 'lost', label: 'Lost', color: '#EF4444' },
];

const PRIORITIES = [
  { id: 'high', label: 'High', color: '#EF4444' },
  { id: 'medium', label: 'Medium', color: '#F59E0B' },
  { id: 'low', label: 'Low', color: '#6B7280' },
];

const TABS = [
  { id: 'contacts', label: 'Contacts', icon: '👥' },
  { id: 'pipeline', label: 'Pipeline', icon: '📊' },
  { id: 'tasks', label: 'Tasks', icon: '✅' },
];

// ── Sample Data ──────────────────────────────────────────────
const SAMPLE_CONTACTS = [
  { id: '1', name: 'Sarah Chen', email: 'sarah@acme.com', company: 'Acme Corp', phone: '+1 555-0101', status: 'customer', value: 12000, avatar: '👩‍💼' },
  { id: '2', name: 'Marcus Johnson', email: 'marcus@globex.com', company: 'Globex Inc', phone: '+1 555-0102', status: 'prospect', value: 8500, avatar: '👨‍💻' },
  { id: '3', name: 'Aisha Patel', email: 'aisha@initech.com', company: 'Initech', phone: '+1 555-0103', status: 'lead', value: 5000, avatar: '👩‍🔬' },
  { id: '4', name: 'Tom Rivera', email: 'tom@stark.com', company: 'Stark Industries', phone: '+1 555-0104', status: 'customer', value: 24000, avatar: '👨‍🎨' },
  { id: '5', name: 'Elena Volkov', email: 'elena@wayne.com', company: 'Wayne Enterprises', phone: '+1 555-0105', status: 'prospect', value: 15000, avatar: '👩‍🚀' },
  { id: '6', name: 'James Wright', email: 'james@oscorp.com', company: 'Oscorp', phone: '+1 555-0106', status: 'lead', value: 3200, avatar: '👨‍🏫' },
  { id: '7', name: 'Priya Sharma', email: 'priya@hooli.com', company: 'Hooli', phone: '+1 555-0107', status: 'churned', value: 7800, avatar: '👩‍⚕️' },
  { id: '8', name: 'David Kim', email: 'david@umbrella.com', company: 'Umbrella Corp', phone: '+1 555-0108', status: 'customer', value: 18500, avatar: '👨‍💼' },
];

const SAMPLE_DEALS = [
  { id: '1', title: 'Acme Annual Contract', company: 'Acme Corp', value: 12000, stage: 'won', contactId: '1' },
  { id: '2', title: 'Globex Consulting', company: 'Globex Inc', value: 8500, stage: 'proposal', contactId: '2' },
  { id: '3', title: 'Initech Starter Package', company: 'Initech', value: 5000, stage: 'lead', contactId: '3' },
  { id: '4', title: 'Stark Enterprise Deal', company: 'Stark Industries', value: 24000, stage: 'won', contactId: '4' },
  { id: '5', title: 'Wayne Security Audit', company: 'Wayne Enterprises', value: 15000, stage: 'negotiation', contactId: '5' },
  { id: '6', title: 'Oscorp Trial', company: 'Oscorp', value: 3200, stage: 'qualified', contactId: '6' },
  { id: '7', title: 'Umbrella Expansion', company: 'Umbrella Corp', value: 18500, stage: 'proposal', contactId: '8' },
];

const SAMPLE_TASKS = [
  { id: '1', title: 'Follow up with Sarah on renewal', contactId: '1', priority: 'high', done: false, due: '2025-02-01' },
  { id: '2', title: 'Send proposal to Globex', contactId: '2', priority: 'high', done: false, due: '2025-01-30' },
  { id: '3', title: 'Schedule demo for Initech', contactId: '3', priority: 'medium', done: false, due: '2025-02-03' },
  { id: '4', title: 'Review Wayne contract terms', contactId: '5', priority: 'medium', done: true, due: '2025-01-28' },
  { id: '5', title: 'Check in with Oscorp trial', contactId: '6', priority: 'low', done: false, due: '2025-02-05' },
  { id: '6', title: 'Prepare quarterly report', contactId: null, priority: 'medium', done: false, due: '2025-02-10' },
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
  const [activeTab, setActiveTab] = useState('contacts');
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(null); // 'contact' | 'deal' | 'task' | null

  // Form states
  const [newContact, setNewContact] = useState({ name: '', email: '', company: '', phone: '', status: 'lead', value: '' });
  const [newDeal, setNewDeal] = useState({ title: '', company: '', value: '', stage: 'lead', contactId: '' });
  const [newTask, setNewTask] = useState({ title: '', contactId: '', priority: 'medium', due: '' });

  // Load/Save
  useEffect(() => {
    const sc = localStorage.getItem('crm-contacts');
    const sd = localStorage.getItem('crm-deals');
    const st = localStorage.getItem('crm-tasks');
    setContacts(sc ? JSON.parse(sc) : SAMPLE_CONTACTS);
    setDeals(sd ? JSON.parse(sd) : SAMPLE_DEALS);
    setTasks(st ? JSON.parse(st) : SAMPLE_TASKS);
  }, []);

  useEffect(() => {
    if (contacts.length > 0 || localStorage.getItem('crm-contacts')) localStorage.setItem('crm-contacts', JSON.stringify(contacts));
  }, [contacts]);
  useEffect(() => {
    if (deals.length > 0 || localStorage.getItem('crm-deals')) localStorage.setItem('crm-deals', JSON.stringify(deals));
  }, [deals]);
  useEffect(() => {
    if (tasks.length > 0 || localStorage.getItem('crm-tasks')) localStorage.setItem('crm-tasks', JSON.stringify(tasks));
  }, [tasks]);

  // Stats
  const stats = useMemo(() => {
    const totalValue = deals.filter((d) => d.stage === 'won').reduce((s, d) => s + d.value, 0);
    const pipelineValue = deals.filter((d) => !['won', 'lost'].includes(d.stage)).reduce((s, d) => s + d.value, 0);
    const activeTasks = tasks.filter((t) => !t.done).length;
    const wonDeals = deals.filter((d) => d.stage === 'won').length;
    const totalDeals = deals.filter((d) => d.stage !== 'lost').length;
    const convRate = totalDeals > 0 ? Math.round((wonDeals / totalDeals) * 100) : 0;
    return { totalContacts: contacts.length, totalValue, pipelineValue, activeTasks, convRate };
  }, [contacts, deals, tasks]);

  // Filtered contacts
  const filteredContacts = useMemo(() => {
    let list = contacts;
    if (statusFilter !== 'all') list = list.filter((c) => c.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    }
    return list;
  }, [contacts, statusFilter, searchQuery]);

  // Pipeline grouped
  const pipelineData = useMemo(() => {
    return PIPELINE_STAGES.map((stage) => ({
      ...stage,
      deals: deals.filter((d) => d.stage === stage.id),
      total: deals.filter((d) => d.stage === stage.id).reduce((s, d) => s + d.value, 0),
    }));
  }, [deals]);

  // Actions
  const addContact = () => {
    if (!newContact.name.trim() || !newContact.email.trim()) return;
    const avatars = ['👩‍💼', '👨‍💻', '👩‍🔬', '👨‍🎨', '👩‍🚀', '👨‍🏫', '👩‍⚕️', '👨‍💼'];
    const c = { ...newContact, id: Date.now().toString(), value: parseFloat(newContact.value) || 0, avatar: avatars[Math.floor(Math.random() * avatars.length)] };
    setContacts((prev) => [c, ...prev]);
    setNewContact({ name: '', email: '', company: '', phone: '', status: 'lead', value: '' });
    setShowModal(null);
  };

  const deleteContact = (id) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    setDeals((prev) => prev.filter((d) => d.contactId !== id));
    setTasks((prev) => prev.filter((t) => t.contactId !== id));
  };

  const addDeal = () => {
    if (!newDeal.title.trim()) return;
    const d = { ...newDeal, id: Date.now().toString(), value: parseFloat(newDeal.value) || 0 };
    setDeals((prev) => [...prev, d]);
    setNewDeal({ title: '', company: '', value: '', stage: 'lead', contactId: '' });
    setShowModal(null);
  };

  const moveDeal = (dealId, newStage) => {
    setDeals((prev) => prev.map((d) => d.id === dealId ? { ...d, stage: newStage } : d));
  };

  const addTask = () => {
    if (!newTask.title.trim()) return;
    const t = { ...newTask, id: Date.now().toString(), done: false };
    setTasks((prev) => [...prev, t]);
    setNewTask({ title: '', contactId: '', priority: 'medium', due: '' });
    setShowModal(null);
  };

  const toggleTask = (id) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  };

  const deleteTask = (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const getContact = (id) => contacts.find((c) => c.id === id);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1 className="app-title">🤝 CRM System</h1>
          <span className="app-subtitle">Manage contacts, deals, and tasks</span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(activeTab === 'contacts' ? 'contact' : activeTab === 'pipeline' ? 'deal' : 'task')}>
          + Add {activeTab === 'contacts' ? 'Contact' : activeTab === 'pipeline' ? 'Deal' : 'Task'}
        </button>
      </header>

      {/* Stats */}
      <div className="stat-row">
        <div className="stat-card"><span className="stat-label">Contacts</span><span className="stat-value">{stats.totalContacts}</span></div>
        <div className="stat-card"><span className="stat-label">Won Revenue</span><span className="stat-value">{formatCurrency(stats.totalValue)}</span></div>
        <div className="stat-card"><span className="stat-label">Pipeline</span><span className="stat-value">{formatCurrency(stats.pipelineValue)}</span></div>
        <div className="stat-card"><span className="stat-label">Active Tasks</span><span className="stat-value">{stats.activeTasks}</span></div>
        <div className="stat-card"><span className="stat-label">Win Rate</span><span className="stat-value">{stats.convRate}%</span></div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map((tab) => (
          <button key={tab.id} className={`tab ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Contacts Tab ── */}
      {activeTab === 'contacts' && (
        <div className="section">
          <div className="section-header">
            <input type="text" className="table-search" placeholder="Search contacts…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            <div className="filter-row">
              <button className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>All</button>
              {CONTACT_STATUSES.map((s) => (
                <button key={s.id} className={`filter-btn ${statusFilter === s.id ? 'active' : ''}`} onClick={() => setStatusFilter(s.id)}>{s.label}</button>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Value</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((c) => {
                  const st = CONTACT_STATUSES.find((s) => s.id === c.status);
                  return (
                    <tr key={c.id}>
                      <td><div className="user-cell"><span className="cell-avatar">{c.avatar}</span><span>{c.name}</span></div></td>
                      <td>{c.company}</td>
                      <td className="td-muted">{c.email}</td>
                      <td><span className="status-badge" style={{ background: st.color + '20', color: st.color }}>{st.label}</span></td>
                      <td className="td-mono">{formatCurrency(c.value)}</td>
                      <td><button className="delete-btn" onClick={() => deleteContact(c.id)}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredContacts.length === 0 && <div className="empty-state"><p>No contacts found</p></div>}
          </div>
        </div>
      )}

      {/* ── Pipeline Tab ── */}
      {activeTab === 'pipeline' && (
        <div className="pipeline-grid">
          {pipelineData.map((stage) => (
            <div key={stage.id} className="pipeline-col">
              <div className="pipeline-header">
                <span className="pipeline-dot" style={{ background: stage.color }} />
                <span className="pipeline-label">{stage.label}</span>
                <span className="pipeline-count">{stage.deals.length}</span>
              </div>
              <div className="pipeline-total">{formatCurrency(stage.total)}</div>
              <div className="pipeline-cards">
                {stage.deals.map((deal) => (
                  <div key={deal.id} className="deal-card">
                    <div className="deal-title">{deal.title}</div>
                    <div className="deal-company">{deal.company}</div>
                    <div className="deal-value">{formatCurrency(deal.value)}</div>
                    <div className="deal-actions">
                      {stage.id !== 'won' && stage.id !== 'lost' && (
                        <>
                          {PIPELINE_STAGES.findIndex((s) => s.id === stage.id) < PIPELINE_STAGES.length - 2 && (
                            <button className="move-btn forward" onClick={() => moveDeal(deal.id, PIPELINE_STAGES[PIPELINE_STAGES.findIndex((s) => s.id === stage.id) + 1].id)}>→</button>
                          )}
                          <button className="move-btn won" onClick={() => moveDeal(deal.id, 'won')}>✓ Won</button>
                          <button className="move-btn lost" onClick={() => moveDeal(deal.id, 'lost')}>✕ Lost</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {stage.deals.length === 0 && <div className="pipeline-empty">No deals</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tasks Tab ── */}
      {activeTab === 'tasks' && (
        <div className="section">
          <div className="task-list">
            {tasks.length === 0 && <div className="empty-state"><p>No tasks yet</p></div>}
            {tasks.map((task) => {
              const contact = getContact(task.contactId);
              const pri = PRIORITIES.find((p) => p.id === task.priority);
              return (
                <div key={task.id} className={`task-row ${task.done ? 'done' : ''}`}>
                  <button className={`task-check ${task.done ? 'checked' : ''}`} onClick={() => toggleTask(task.id)}>
                    {task.done ? '✓' : ''}
                  </button>
                  <div className="task-info">
                    <span className="task-title">{task.title}</span>
                    <span className="task-meta">
                      {contact && <>{contact.avatar} {contact.name} · </>}
                      {task.due && formatDate(task.due)}
                    </span>
                  </div>
                  <span className="priority-badge" style={{ background: pri.color + '20', color: pri.color }}>{pri.label}</span>
                  <button className="delete-btn" onClick={() => deleteTask(task.id)}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Add Contact Modal ── */}
      {showModal === 'contact' && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>Add Contact</h2><button className="modal-close" onClick={() => setShowModal(null)}>✕</button></div>
            <div className="modal-body">
              <div className="form-group"><label>Name</label><input type="text" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} placeholder="Full name" autoFocus /></div>
              <div className="form-group"><label>Email</label><input type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} placeholder="email@company.com" /></div>
              <div className="form-group"><label>Company</label><input type="text" value={newContact.company} onChange={(e) => setNewContact({ ...newContact, company: e.target.value })} placeholder="Company name" /></div>
              <div className="form-group"><label>Phone</label><input type="text" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} placeholder="+1 555-0100" /></div>
              <div className="form-group"><label>Status</label>
                <div className="filter-row">
                  {CONTACT_STATUSES.map((s) => (
                    <button key={s.id} className={`filter-btn ${newContact.status === s.id ? 'active' : ''}`} style={newContact.status === s.id ? { borderColor: s.color, color: s.color, background: s.color + '15' } : {}} onClick={() => setNewContact({ ...newContact, status: s.id })}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div className="form-group"><label>Deal Value ($)</label><input type="number" value={newContact.value} onChange={(e) => setNewContact({ ...newContact, value: e.target.value })} placeholder="0" /></div>
            </div>
            <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setShowModal(null)}>Cancel</button><button className="btn btn-primary" onClick={addContact} disabled={!newContact.name.trim() || !newContact.email.trim()}>Add Contact</button></div>
          </div>
        </div>
      )}

      {/* ── Add Deal Modal ── */}
      {showModal === 'deal' && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>Add Deal</h2><button className="modal-close" onClick={() => setShowModal(null)}>✕</button></div>
            <div className="modal-body">
              <div className="form-group"><label>Deal Title</label><input type="text" value={newDeal.title} onChange={(e) => setNewDeal({ ...newDeal, title: e.target.value })} placeholder="e.g. Annual Contract" autoFocus /></div>
              <div className="form-group"><label>Company</label><input type="text" value={newDeal.company} onChange={(e) => setNewDeal({ ...newDeal, company: e.target.value })} placeholder="Company name" /></div>
              <div className="form-group"><label>Value ($)</label><input type="number" value={newDeal.value} onChange={(e) => setNewDeal({ ...newDeal, value: e.target.value })} placeholder="0" /></div>
              <div className="form-group"><label>Stage</label>
                <select value={newDeal.stage} onChange={(e) => setNewDeal({ ...newDeal, stage: e.target.value })}>
                  {PIPELINE_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Contact</label>
                <select value={newDeal.contactId} onChange={(e) => setNewDeal({ ...newDeal, contactId: e.target.value })}>
                  <option value="">None</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.company}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setShowModal(null)}>Cancel</button><button className="btn btn-primary" onClick={addDeal} disabled={!newDeal.title.trim()}>Add Deal</button></div>
          </div>
        </div>
      )}

      {/* ── Add Task Modal ── */}
      {showModal === 'task' && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>Add Task</h2><button className="modal-close" onClick={() => setShowModal(null)}>✕</button></div>
            <div className="modal-body">
              <div className="form-group"><label>Task</label><input type="text" value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="What needs to be done?" autoFocus onKeyDown={(e) => e.key === 'Enter' && addTask()} /></div>
              <div className="form-group"><label>Priority</label>
                <div className="filter-row">
                  {PRIORITIES.map((p) => (
                    <button key={p.id} className={`filter-btn ${newTask.priority === p.id ? 'active' : ''}`} style={newTask.priority === p.id ? { borderColor: p.color, color: p.color, background: p.color + '15' } : {}} onClick={() => setNewTask({ ...newTask, priority: p.id })}>{p.label}</button>
                  ))}
                </div>
              </div>
              <div className="form-group"><label>Due Date</label><input type="date" value={newTask.due} onChange={(e) => setNewTask({ ...newTask, due: e.target.value })} /></div>
              <div className="form-group"><label>Contact (optional)</label>
                <select value={newTask.contactId} onChange={(e) => setNewTask({ ...newTask, contactId: e.target.value })}>
                  <option value="">None</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.company}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setShowModal(null)}>Cancel</button><button className="btn btn-primary" onClick={addTask} disabled={!newTask.title.trim()}>Add Task</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
