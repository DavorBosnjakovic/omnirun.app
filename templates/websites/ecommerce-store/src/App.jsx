import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import ProductCard from './components/ProductCard';
import Cart from './components/Cart';
import Checkout from './components/Checkout';

// ── Mock Product Data ────────────────────────────────────────
// Replace these with real data from your backend/CMS
const PRODUCTS = [
  {
    id: 1,
    name: 'Merino Wool Beanie',
    price: 38,
    category: 'accessories',
    description: 'Soft, breathable merino wool. One size fits all.',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    badge: null,
  },
  {
    id: 2,
    name: 'Canvas Weekender Bag',
    price: 128,
    category: 'bags',
    description: 'Waxed canvas, leather straps, brass hardware. Built to last.',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    badge: 'Popular',
  },
  {
    id: 3,
    name: 'Ceramic Pour-Over Set',
    price: 54,
    category: 'home',
    description: 'Hand-thrown dripper and carafe. Makes 2 cups of perfect coffee.',
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    badge: null,
  },
  {
    id: 4,
    name: 'Leather Card Wallet',
    price: 42,
    category: 'accessories',
    description: 'Full-grain leather, 4 card slots, center cash pocket.',
    gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    badge: null,
  },
  {
    id: 5,
    name: 'Linen Camp Shirt',
    price: 86,
    category: 'clothing',
    description: 'Relaxed fit, breathable linen. Perfect for warm days.',
    gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    badge: 'New',
  },
  {
    id: 6,
    name: 'Brass Desk Lamp',
    price: 165,
    category: 'home',
    description: 'Adjustable arm, warm LED bulb included. Patinas with age.',
    gradient: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
    badge: null,
  },
  {
    id: 7,
    name: 'Waxed Canvas Backpack',
    price: 148,
    category: 'bags',
    description: '15" laptop sleeve, water-resistant, roll-top closure.',
    gradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    badge: 'Popular',
  },
  {
    id: 8,
    name: 'Wool Blend Scarf',
    price: 52,
    category: 'accessories',
    description: 'Herringbone weave, fringed ends. Warm without bulk.',
    gradient: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)',
    badge: null,
  },
];

const CATEGORIES = ['all', 'clothing', 'accessories', 'bags', 'home'];

export default function App() {
  // ── State ──────────────────────────────────────────────────
  const [view, setView] = useState('shop'); // shop | cart | checkout | confirmation
  const [cart, setCart] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [toast, setToast] = useState('');
  const [lastOrder, setLastOrder] = useState(null);

  // Load cart from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('nomad-cart');
    if (saved) setCart(JSON.parse(saved));
  }, []);

  // Save cart to localStorage on change
  useEffect(() => {
    localStorage.setItem('nomad-cart', JSON.stringify(cart));
  }, [cart]);

  // ── Cart Actions ───────────────────────────────────────────
  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { ...product, qty: 1 }];
    });
    showToast(`${product.name} added to cart`);
  };

  const updateQty = (productId, newQty) => {
    if (newQty < 1) return removeFromCart(productId);
    setCart((prev) =>
      prev.map((item) =>
        item.id === productId ? { ...item, qty: newQty } : item
      )
    );
  };

  const removeFromCart = (productId) => {
    setCart((prev) => prev.filter((item) => item.id !== productId));
  };

  const clearCart = () => setCart([]);

  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  // ── Place Order ────────────────────────────────────────────
  const placeOrder = (shippingInfo) => {
    const order = {
      id: `ORD-${Date.now()}`,
      items: [...cart],
      total: cartTotal,
      shipping: shippingInfo,
      date: new Date().toISOString(),
    };

    // Save to localStorage
    const orders = JSON.parse(localStorage.getItem('nomad-orders') || '[]');
    orders.push(order);
    localStorage.setItem('nomad-orders', JSON.stringify(orders));

    setLastOrder(order);
    clearCart();
    setView('confirmation');
  };

  // ── Toast ──────────────────────────────────────────────────
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(''), 2500);
  };

  // ── Filter Products ────────────────────────────────────────
  const filteredProducts =
    activeCategory === 'all'
      ? PRODUCTS
      : PRODUCTS.filter((p) => p.category === activeCategory);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="app">
      <Navbar
        cartCount={cartCount}
        onCartClick={() => setView('cart')}
        onLogoClick={() => setView('shop')}
        currentView={view}
      />

      <main className="main">
        {/* ── Shop View ── */}
        {view === 'shop' && (
          <>
            {/* Hero */}
            <section className="shop-hero">
              <div className="container">
                <span className="hero-badge">Free shipping on orders over $100</span>
                <h1 className="hero-title">Curated essentials for<br /><span className="highlight">everyday living</span></h1>
                <p className="hero-subtitle">Thoughtfully designed goods made from quality materials. Less stuff, better stuff.</p>
              </div>
            </section>

            {/* Filters */}
            <section className="container">
              <div className="filters">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    className={`filter-btn ${activeCategory === cat ? 'active' : ''}`}
                    onClick={() => setActiveCategory(cat)}
                  >
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>

              {/* Product Grid */}
              <div className="product-grid">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onAddToCart={() => addToCart(product)}
                  />
                ))}
              </div>

              {filteredProducts.length === 0 && (
                <p className="empty-state">No products in this category yet.</p>
              )}
            </section>
          </>
        )}

        {/* ── Cart View ── */}
        {view === 'cart' && (
          <Cart
            items={cart}
            total={cartTotal}
            onUpdateQty={updateQty}
            onRemove={removeFromCart}
            onCheckout={() => setView('checkout')}
            onContinueShopping={() => setView('shop')}
          />
        )}

        {/* ── Checkout View ── */}
        {view === 'checkout' && (
          <Checkout
            items={cart}
            total={cartTotal}
            onPlaceOrder={placeOrder}
            onBack={() => setView('cart')}
          />
        )}

        {/* ── Confirmation View ── */}
        {view === 'confirmation' && lastOrder && (
          <section className="container confirmation">
            <div className="confirmation-card">
              <div className="confirmation-icon">✓</div>
              <h2>Order Confirmed!</h2>
              <p className="confirmation-id">Order {lastOrder.id}</p>
              <p className="confirmation-text">
                Thank you, {lastOrder.shipping.firstName}! We've saved your order.
                In a real store, you'd receive a confirmation email at {lastOrder.shipping.email}.
              </p>
              <div className="confirmation-summary">
                <div className="confirmation-row">
                  <span>Items</span>
                  <span>{lastOrder.items.reduce((s, i) => s + i.qty, 0)}</span>
                </div>
                <div className="confirmation-row total">
                  <span>Total</span>
                  <span>${lastOrder.total.toFixed(2)}</span>
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => setView('shop')}>
                Continue Shopping
              </button>
            </div>
          </section>
        )}
      </main>

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Footer */}
      <footer className="footer">
        <div className="container footer-inner">
          <span className="footer-logo">Nomad<span>Goods</span></span>
          <span className="footer-copy">© 2025 Nomad Goods. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
