function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });
}

export default function ArticleView({ article, related, onBack, onArticleClick }) {
  return (
    <div className="container">
      <button className="back-link" onClick={onBack}>← All Articles</button>

      <article className="article-view">
        {/* Hero */}
        <div className="article-hero" style={{ background: article.gradient }}>
          <span className="article-category-badge">{article.category}</span>
        </div>

        {/* Header */}
        <div className="article-header">
          <h1 className="article-title">{article.title}</h1>
          <div className="article-meta">
            <div className="article-author-info">
              <div className="author-avatar-lg" style={{ background: article.gradient }}>
                {article.author[0]}
              </div>
              <div>
                <span className="author-name-lg">{article.author}</span>
                <span className="article-date">
                  {formatDate(article.date)} · {article.readTime} min read
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="article-body">
          {article.body.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>

        {/* Divider */}
        <div className="article-divider" />

        {/* Author Card */}
        <div className="author-card">
          <div className="author-avatar-xl" style={{ background: article.gradient }}>
            {article.author[0]}
          </div>
          <div className="author-card-info">
            <span className="author-card-label">Written by</span>
            <span className="author-card-name">{article.author}</span>
            <span className="author-card-bio">Writer, builder, and occasional optimist. More articles coming soon.</span>
          </div>
        </div>
      </article>

      {/* Related Articles */}
      {related.length > 0 && (
        <div className="related-section">
          <h3 className="related-heading">More in {article.category}</h3>
          <div className="related-grid">
            {related.map((rel) => (
              <article
                key={rel.id}
                className="article-card"
                onClick={() => onArticleClick(rel.id)}
              >
                <div className="card-image small" style={{ background: rel.gradient }}>
                  <span className="card-category">{rel.category}</span>
                </div>
                <div className="card-body">
                  <div className="card-meta">
                    <span>{formatDate(rel.date)}</span>
                    <span className="meta-dot">·</span>
                    <span>{rel.readTime} min read</span>
                  </div>
                  <h3 className="card-title">{rel.title}</h3>
                  <p className="card-excerpt">{rel.excerpt}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
