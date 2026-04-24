export default function Navbar({
  categories, activeCategory, onCategoryChange,
  searchQuery, onSearchChange, onLogoClick, showSearch
}) {
  return (
    <nav className="nav">
      <div className="nav-inner container">
        <button className="nav-logo" onClick={onLogoClick}>
          The<span>Margin</span>
        </button>

        {showSearch && (
          <div className="nav-center">
            <div className="category-pills">
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`pill ${activeCategory === cat ? 'active' : ''}`}
                  onClick={() => onCategoryChange(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="nav-right">
          {showSearch && (
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search articles..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="search-input"
              />
              {searchQuery && (
                <button className="search-clear" onClick={() => onSearchChange('')}>✕</button>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
