export default function Navbar({ cartCount, onCartClick, onLogoClick, currentView }) {
  return (
    <nav className="nav">
      <div className="nav-inner container">
        <button className="nav-logo" onClick={onLogoClick}>
          Nomad<span>Goods</span>
        </button>
        <div className="nav-right">
          <button
            className={`nav-link ${currentView === 'shop' ? 'active' : ''}`}
            onClick={onLogoClick}
          >
            Shop
          </button>
          <button
            className={`nav-link cart-btn ${currentView === 'cart' ? 'active' : ''}`}
            onClick={onCartClick}
          >
            Cart
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
        </div>
      </div>
    </nav>
  );
}
