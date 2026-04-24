import { useState, useEffect, useMemo } from 'react';

// ── Categories ───────────────────────────────────────────────
const CATEGORIES = {
  income: [
    { id: 'salary', name: 'Salary', icon: '💼', color: '#10B981' },
    { id: 'freelance', name: 'Freelance', icon: '💻', color: '#34D399' },
    { id: 'investment', name: 'Investment', icon: '📈', color: '#6EE7B7' },
    { id: 'other-income', name: 'Other', icon: '💵', color: '#A7F3D0' },
  ],
  expense: [
    { id: 'food', name: 'Food & Dining', icon: '🍔', color: '#F59E0B' },
    { id: 'transport', name: 'Transport', icon: '🚗', color: '#3B82F6' },
    { id: 'housing', name: 'Housing', icon: '🏠', color: '#8B5CF6' },
    { id: 'utilities', name: 'Utilities', icon: '⚡', color: '#EC4899' },
    { id: 'entertainment', name: 'Entertainment', icon: '🎬', color: '#F97316' },
    { id: 'shopping', name: 'Shopping', icon: '🛒', color: '#14B8A6' },
    { id: 'health', name: 'Health', icon: '🏥', color: '#EF4444' },
    { id: 'education', name: 'Education', icon: '📚', color: '#6366F1' },
    { id: 'other-expense', name: 'Other', icon: '📦', color: '#64748B' },
  ],
};

const ALL_CATEGORIES = [...CATEGORIES.income, ...CATEGORIES.expense];
const getCat = (id) => ALL_CATEGORIES.find((c) => c.id === id) || { name: id, icon: '📦', color: '#64748B' };

// ── Sample Data ──────────────────────────────────────────────
const SAMPLE_TRANSACTIONS = [
  { id: '1', type: 'income', category: 'salary', amount: 4200, description: 'Monthly salary', date: '2025-01-28' },
  { id: '2', type: 'expense', category: 'housing', amount: 1200, description: 'Rent', date: '2025-01-01' },
  { id: '3', type: 'expense', category: 'food', amount: 85.50, description: 'Grocery run', date: '2025-01-03' },
  { id: '4', type: 'expense', category: 'transport', amount: 45, description: 'Gas', date: '2025-01-05' },
  { id: '5', type: 'expense', category: 'entertainment', amount: 15.99, description: 'Netflix', date: '2025-01-06' },
  { id: '6', type: 'income', category: 'freelance', amount: 800, description: 'Logo design project', date: '2025-01-10' },
  { id: '7', type: 'expense', category: 'food', amount: 42, description: 'Dinner out', date: '2025-01-12' },
  { id: '8', type: 'expense', category: 'shopping', amount: 65, description: 'New headphones', date: '2025-01-14' },
  { id: '9', type: 'expense', category: 'utilities', amount: 120, description: 'Electric bill', date: '2025-01-15' },
  { id: '10', type: 'expense', category: 'health', amount: 30, description: 'Gym membership', date: '2025-01-18' },
  { id: '11', type: 'expense', category: 'food', amount: 55, description: 'Weekly groceries', date: '2025-01-20' },
  { id: '12', type: 'expense', category: 'transport', amount: 52, description: 'Uber rides', date: '2025-01-22' },
];

// ── Helpers ───────────────────────────────────────────────────
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getMonthLabel(year, month) {
  return new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [newTx, setNewTx] = useState({
    type: 'expense', category: 'food', amount: '', description: '', date: new Date().toISOString().split('T')[0],
  });

  // Load/Save localStorage
  useEffect(() => {
    const saved = localStorage.getItem('bt-transactions');
    setTransactions(saved ? JSON.parse(saved) : SAMPLE_TRANSACTIONS);
  }, []);

  useEffect(() => {
    if (transactions.length > 0 || localStorage.getItem('bt-transactions')) {
      localStorage.setItem('bt-transactions', JSON.stringify(transactions));
    }
  }, [transactions]);

  // ── Monthly Filtered Data ──────────────────────────────────
  const monthTx = useMemo(() => {
    return transactions.filter((tx) => {
      const d = new Date(tx.date + 'T00:00:00');
      return d.getFullYear() === currentMonth.year && d.getMonth() === currentMonth.month;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, currentMonth]);

  const summary = useMemo(() => {
    const income = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expenses = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expenses, balance: income - expenses };
  }, [monthTx]);

  // ── Category Breakdown ─────────────────────────────────────
  const categoryBreakdown = useMemo(() => {
    const expenseTx = monthTx.filter((t) => t.type === 'expense');
    const totals = {};
    expenseTx.forEach((tx) => {
      totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
    });
    return Object.entries(totals)
      .map(([catId, amount]) => ({ ...getCat(catId), amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthTx]);

  const maxCatAmount = categoryBreakdown.length > 0 ? categoryBreakdown[0].amount : 0;

  // ── Actions ────────────────────────────────────────────────
  const addTransaction = () => {
    const amount = parseFloat(newTx.amount);
    if (!amount || amount <= 0 || !newTx.description.trim()) return;
    const tx = {
      id: Date.now().toString(),
      type: newTx.type,
      category: newTx.category,
      amount,
      description: newTx.description.trim(),
      date: newTx.date,
    };
    setTransactions((prev) => [tx, ...prev]);
    setNewTx({ type: 'expense', category: 'food', amount: '', description: '', date: new Date().toISOString().split('T')[0] });
    setShowAdd(false);
  };

  const deleteTransaction = (id) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
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

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="app-title">💰 Budget Tracker</h1>
          <span className="app-subtitle">Know where your money goes</span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + Add Transaction
        </button>
      </header>

      {/* Month Navigation */}
      <div className="month-nav">
        <button className="month-btn" onClick={prevMonth}>← Prev</button>
        <span className="month-label">{getMonthLabel(currentMonth.year, currentMonth.month)}</span>
        <button className="month-btn" onClick={nextMonth}>Next →</button>
      </div>

      {/* Summary Cards */}
      <div className="summary-row">
        <div className="summary-card income">
          <span className="summary-label">Income</span>
          <span className="summary-value">{formatCurrency(summary.income)}</span>
        </div>
        <div className="summary-card expense">
          <span className="summary-label">Expenses</span>
          <span className="summary-value">{formatCurrency(summary.expenses)}</span>
        </div>
        <div className={`summary-card balance ${summary.balance >= 0 ? 'positive' : 'negative'}`}>
          <span className="summary-label">Balance</span>
          <span className="summary-value">{formatCurrency(summary.balance)}</span>
        </div>
      </div>

      <div className="content-grid">
        {/* Transaction List */}
        <div className="section">
          <h2 className="section-title">Transactions <span className="section-count">{monthTx.length}</span></h2>
          {monthTx.length === 0 ? (
            <div className="empty-state">
              <p>No transactions this month</p>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add one</button>
            </div>
          ) : (
            <div className="tx-list">
              {monthTx.map((tx) => {
                const cat = getCat(tx.category);
                return (
                  <div key={tx.id} className="tx-row">
                    <div className="tx-icon" style={{ background: cat.color + '20', color: cat.color }}>
                      {cat.icon}
                    </div>
                    <div className="tx-info">
                      <span className="tx-desc">{tx.description}</span>
                      <span className="tx-meta">{cat.name} · {formatDate(tx.date)}</span>
                    </div>
                    <div className="tx-right">
                      <span className={`tx-amount ${tx.type}`}>
                        {tx.type === 'income' ? '+' : '−'}{formatCurrency(tx.amount)}
                      </span>
                      <button className="tx-delete" onClick={() => deleteTransaction(tx.id)} title="Delete">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="section">
          <h2 className="section-title">Spending by Category</h2>
          {categoryBreakdown.length === 0 ? (
            <div className="empty-state">
              <p>No expenses this month</p>
            </div>
          ) : (
            <div className="breakdown-list">
              {categoryBreakdown.map((cat) => (
                <div key={cat.id} className="breakdown-row">
                  <div className="breakdown-info">
                    <span className="breakdown-icon">{cat.icon}</span>
                    <span className="breakdown-name">{cat.name}</span>
                    <span className="breakdown-amount">{formatCurrency(cat.amount)}</span>
                  </div>
                  <div className="breakdown-bar-bg">
                    <div
                      className="breakdown-bar-fill"
                      style={{
                        width: `${(cat.amount / maxCatAmount) * 100}%`,
                        background: cat.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Transaction Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Transaction</h2>
              <button className="modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Type Toggle */}
              <div className="type-toggle">
                <button
                  className={`type-btn ${newTx.type === 'expense' ? 'active expense' : ''}`}
                  onClick={() => setNewTx({ ...newTx, type: 'expense', category: 'food' })}
                >
                  Expense
                </button>
                <button
                  className={`type-btn ${newTx.type === 'income' ? 'active income' : ''}`}
                  onClick={() => setNewTx({ ...newTx, type: 'income', category: 'salary' })}
                >
                  Income
                </button>
              </div>

              <div className="form-group">
                <label>Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newTx.amount}
                  onChange={(e) => setNewTx({ ...newTx, amount: e.target.value })}
                  placeholder="0.00"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={newTx.description}
                  onChange={(e) => setNewTx({ ...newTx, description: e.target.value })}
                  placeholder="What was this for?"
                  onKeyDown={(e) => e.key === 'Enter' && addTransaction()}
                />
              </div>

              <div className="form-group">
                <label>Category</label>
                <div className="category-grid">
                  {CATEGORIES[newTx.type].map((cat) => (
                    <button
                      key={cat.id}
                      className={`cat-btn ${newTx.category === cat.id ? 'active' : ''}`}
                      onClick={() => setNewTx({ ...newTx, category: cat.id })}
                      style={newTx.category === cat.id ? { borderColor: cat.color, background: cat.color + '15' } : {}}
                    >
                      <span className="cat-btn-icon">{cat.icon}</span>
                      <span className="cat-btn-name">{cat.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Date</label>
                <input
                  type="date"
                  value={newTx.date}
                  onChange={(e) => setNewTx({ ...newTx, date: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={addTransaction}
                disabled={!newTx.amount || !newTx.description.trim()}
              >
                Add {newTx.type === 'income' ? 'Income' : 'Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
