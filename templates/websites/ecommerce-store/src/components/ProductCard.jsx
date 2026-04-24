export default function ProductCard({ product, onAddToCart }) {
  return (
    <div className="product-card">
      <div
        className="product-image"
        style={{ background: product.gradient }}
      >
        {product.badge && <span className="product-badge">{product.badge}</span>}
      </div>
      <div className="product-info">
        <span className="product-category">{product.category}</span>
        <h3 className="product-name">{product.name}</h3>
        <p className="product-desc">{product.description}</p>
        <div className="product-footer">
          <span className="product-price">${product.price}</span>
          <button className="btn btn-sm" onClick={onAddToCart}>
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
}
