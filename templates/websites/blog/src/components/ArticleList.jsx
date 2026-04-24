function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });
}

export default function ArticleList({ articles, onArticleClick }) {
  if (articles.length === 0) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <h2>No articles found</h2>
          <p>Try a different search or category.</p>
        </div>
      </div>
    );
  }

  // First article is featured (larger)
  const [featured, ...rest] = articles;

  return (
    <div className="container article-list">
      {/* Featured Article */}
      <article
        className="article-card featured"
        onClick={() => onArticleClick(featured.id)}
      >
        <div className="card-image" style={{ background: featured.gradient }}>
          <span className="card-category">{featured.category}</span>
        </div>
        <div className="card-body">
          <div className="card-meta">
            <span>{formatDate(featured.date)}</span>
            <span className="meta-dot">·</span>
            <span>{featured.readTime} min read</span>
          </div>
          <h2 className="card-title featured-title">{featured.title}</h2>
          <p className="card-excerpt">{featured.excerpt}</p>
          <div className="card-author">
            <div className="author-avatar" style={{ background: featured.gradient }}>{featured.author[0]}</div>
            <span className="author-name">{featured.author}</span>
          </div>
        </div>
      </article>

      {/* Article Grid */}
      {rest.length > 0 && (
        <div className="article-grid">
          {rest.map((article) => (
            <article
              key={article.id}
              className="article-card"
              onClick={() => onArticleClick(article.id)}
            >
              <div className="card-image" style={{ background: article.gradient }}>
                <span className="card-category">{article.category}</span>
              </div>
              <div className="card-body">
                <div className="card-meta">
                  <span>{formatDate(article.date)}</span>
                  <span className="meta-dot">·</span>
                  <span>{article.readTime} min read</span>
                </div>
                <h3 className="card-title">{article.title}</h3>
                <p className="card-excerpt">{article.excerpt}</p>
                <div className="card-author">
                  <div className="author-avatar" style={{ background: article.gradient }}>{article.author[0]}</div>
                  <span className="author-name">{article.author}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
