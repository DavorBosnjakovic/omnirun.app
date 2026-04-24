import { useState, useEffect, useMemo } from 'react';

// ── Constants ────────────────────────────────────────────────
const STATUSES = ['want', 'reading', 'finished'];
const STATUS_LABELS = { want: 'Want to Read', reading: 'Currently Reading', finished: 'Finished' };
const STATUS_ICONS = { want: '📚', reading: '📖', finished: '✅' };
const GENRES = ['All', 'Fiction', 'Non-Fiction', 'Sci-Fi', 'Fantasy', 'Self-Help', 'Business', 'History', 'Biography'];

const DEFAULT_BOOKS = [
  { id: '1', title: 'Project Hail Mary', author: 'Andy Weir', genre: 'Sci-Fi', status: 'finished', rating: 5, notes: 'Incredible. Couldn\'t put it down. The science is fascinating and Ryland Grace is a great character.', dateAdded: '2024-11-01' },
  { id: '2', title: 'Atomic Habits', author: 'James Clear', genre: 'Self-Help', status: 'finished', rating: 4, notes: 'Practical and well-structured. The 1% improvement concept really stuck with me.', dateAdded: '2024-10-15' },
  { id: '3', title: 'The Midnight Library', author: 'Matt Haig', genre: 'Fiction', status: 'reading', rating: 0, notes: 'About halfway through. Love the concept of parallel lives.', dateAdded: '2025-01-05' },
  { id: '4', title: 'Dune', author: 'Frank Herbert', genre: 'Sci-Fi', status: 'want', rating: 0, notes: '', dateAdded: '2025-01-10' },
  { id: '5', title: 'Sapiens', author: 'Yuval Noah Harari', genre: 'History', status: 'want', rating: 0, notes: '', dateAdded: '2025-01-12' },
];

// ── Star Rating Component ────────────────────────────────────
function StarRating({ rating, onRate, readonly = false }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          className={`star ${star <= (hover || rating) ? 'filled' : ''} ${readonly ? 'readonly' : ''}`}
          onClick={() => !readonly && onRate(star)}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          disabled={readonly}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [books, setBooks] = useState([]);
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('All');
  const [showAdd, setShowAdd] = useState(false);
  const [editingBook, setEditingBook] = useState(null);
  const [newBook, setNewBook] = useState({ title: '', author: '', genre: 'Fiction' });

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('rl-books');
    setBooks(saved ? JSON.parse(saved) : DEFAULT_BOOKS);
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (books.length > 0 || localStorage.getItem('rl-books')) {
      localStorage.setItem('rl-books', JSON.stringify(books));
    }
  }, [books]);

  // ── Filter Books ───────────────────────────────────────────
  const filtered = useMemo(() => {
    return books.filter((b) => {
      const matchesSearch = !search ||
        b.title.toLowerCase().includes(search.toLowerCase()) ||
        b.author.toLowerCase().includes(search.toLowerCase());
      const matchesGenre = genreFilter === 'All' || b.genre === genreFilter;
      return matchesSearch && matchesGenre;
    });
  }, [books, search, genreFilter]);

  const columns = useMemo(() => {
    return STATUSES.reduce((acc, status) => {
      acc[status] = filtered.filter((b) => b.status === status);
      return acc;
    }, {});
  }, [filtered]);

  // ── Stats ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const finished = books.filter((b) => b.status === 'finished');
    const rated = finished.filter((b) => b.rating > 0);
    return {
      total: books.length,
      reading: books.filter((b) => b.status === 'reading').length,
      finished: finished.length,
      avgRating: rated.length > 0
        ? (rated.reduce((sum, b) => sum + b.rating, 0) / rated.length).toFixed(1)
        : '—',
    };
  }, [books]);

  // ── Actions ────────────────────────────────────────────────
  const addBook = () => {
    if (!newBook.title.trim()) return;
    const book = {
      id: Date.now().toString(),
      title: newBook.title.trim(),
      author: newBook.author.trim() || 'Unknown',
      genre: newBook.genre,
      status: 'want',
      rating: 0,
      notes: '',
      dateAdded: new Date().toISOString().split('T')[0],
    };
    setBooks((prev) => [book, ...prev]);
    setNewBook({ title: '', author: '', genre: 'Fiction' });
    setShowAdd(false);
  };

  const moveBook = (id, newStatus) => {
    setBooks((prev) => prev.map((b) =>
      b.id === id ? { ...b, status: newStatus, rating: newStatus !== 'finished' ? 0 : b.rating } : b
    ));
  };

  const rateBook = (id, rating) => {
    setBooks((prev) => prev.map((b) => b.id === id ? { ...b, rating } : b));
  };

  const updateNotes = (id, notes) => {
    setBooks((prev) => prev.map((b) => b.id === id ? { ...b, notes } : b));
  };

  const deleteBook = (id) => {
    setBooks((prev) => prev.filter((b) => b.id !== id));
    if (editingBook?.id === id) setEditingBook(null);
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="app-title">📚 Reading List</h1>
          <span className="app-subtitle">Track what you read</span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + Add Book
        </button>
      </header>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Total Books</span>
        </div>
        <div className="stat-card accent">
          <span className="stat-value">{stats.reading}</span>
          <span className="stat-label">Reading</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.finished}</span>
          <span className="stat-label">Finished</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.avgRating} ★</span>
          <span className="stat-label">Avg Rating</span>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="filters-bar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search by title or author..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>
        <div className="genre-pills">
          {GENRES.map((g) => (
            <button
              key={g}
              className={`pill ${genreFilter === g ? 'active' : ''}`}
              onClick={() => setGenreFilter(g)}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban Board */}
      <div className="board">
        {STATUSES.map((status) => (
          <div key={status} className="column">
            <div className="column-header">
              <span className="column-icon">{STATUS_ICONS[status]}</span>
              <span className="column-title">{STATUS_LABELS[status]}</span>
              <span className="column-count">{columns[status].length}</span>
            </div>
            <div className="column-body">
              {columns[status].length === 0 && (
                <div className="column-empty">No books here yet</div>
              )}
              {columns[status].map((book) => (
                <div
                  key={book.id}
                  className={`book-card ${editingBook?.id === book.id ? 'active' : ''}`}
                  onClick={() => setEditingBook(editingBook?.id === book.id ? null : book)}
                >
                  <div className="book-genre-tag">{book.genre}</div>
                  <h3 className="book-title">{book.title}</h3>
                  <p className="book-author">by {book.author}</p>
                  {book.status === 'finished' && book.rating > 0 && (
                    <StarRating rating={book.rating} readonly />
                  )}
                  {book.notes && (
                    <p className="book-notes-preview">{book.notes.slice(0, 60)}{book.notes.length > 60 ? '...' : ''}</p>
                  )}

                  {/* Move buttons */}
                  <div className="book-actions" onClick={(e) => e.stopPropagation()}>
                    {status !== 'want' && (
                      <button
                        className="move-btn"
                        onClick={() => moveBook(book.id, status === 'finished' ? 'reading' : 'want')}
                        title={status === 'finished' ? 'Move to Reading' : 'Move to Want to Read'}
                      >
                        ←
                      </button>
                    )}
                    {status !== 'finished' && (
                      <button
                        className="move-btn"
                        onClick={() => moveBook(book.id, status === 'want' ? 'reading' : 'finished')}
                        title={status === 'want' ? 'Start Reading' : 'Mark as Finished'}
                      >
                        →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Book Detail Panel */}
      {editingBook && (
        <div className="detail-panel">
          <div className="detail-header">
            <h2 className="detail-title">{editingBook.title}</h2>
            <button className="detail-close" onClick={() => setEditingBook(null)}>✕</button>
          </div>
          <p className="detail-author">by {editingBook.author}</p>
          <div className="detail-meta">
            <span className="detail-genre">{editingBook.genre}</span>
            <span className="detail-date">Added {editingBook.dateAdded}</span>
          </div>

          {editingBook.status === 'finished' && (
            <div className="detail-section">
              <label className="detail-label">Your Rating</label>
              <StarRating
                rating={editingBook.rating}
                onRate={(r) => {
                  rateBook(editingBook.id, r);
                  setEditingBook({ ...editingBook, rating: r });
                }}
              />
            </div>
          )}

          <div className="detail-section">
            <label className="detail-label">Notes</label>
            <textarea
              className="detail-notes"
              value={editingBook.notes}
              onChange={(e) => {
                updateNotes(editingBook.id, e.target.value);
                setEditingBook({ ...editingBook, notes: e.target.value });
              }}
              placeholder="Your thoughts on this book..."
            />
          </div>

          <div className="detail-section">
            <label className="detail-label">Status</label>
            <div className="detail-status-btns">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  className={`status-btn ${editingBook.status === s ? 'active' : ''}`}
                  onClick={() => {
                    moveBook(editingBook.id, s);
                    setEditingBook({ ...editingBook, status: s });
                  }}
                >
                  {STATUS_ICONS[s]} {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-danger" onClick={() => deleteBook(editingBook.id)}>
            Delete Book
          </button>
        </div>
      )}

      {/* Add Book Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add a Book</h2>
              <button className="modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={newBook.title}
                  onChange={(e) => setNewBook({ ...newBook, title: e.target.value })}
                  placeholder="Book title"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && addBook()}
                />
              </div>
              <div className="form-group">
                <label>Author</label>
                <input
                  type="text"
                  value={newBook.author}
                  onChange={(e) => setNewBook({ ...newBook, author: e.target.value })}
                  placeholder="Author name"
                  onKeyDown={(e) => e.key === 'Enter' && addBook()}
                />
              </div>
              <div className="form-group">
                <label>Genre</label>
                <select
                  value={newBook.genre}
                  onChange={(e) => setNewBook({ ...newBook, genre: e.target.value })}
                >
                  {GENRES.filter((g) => g !== 'All').map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addBook} disabled={!newBook.title.trim()}>
                Add Book
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
