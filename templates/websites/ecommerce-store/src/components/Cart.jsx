export default function Cart({ items, total, onUpdateQty, onRemove, onCheckout, onContinueShopping }) {
  if (items.length === 0) {
    return (
      <section className="container page-section">
        <div className="empty-cart">
          <div className="empty-cart-icon">🛒</div>
          <h2>Your cart is empty</h2>
          <p>Looks like you haven't added anything yet.</p>
          <button className="btn btn-primary" onClick={onContinueShopping}>
            Browse Products
          </button>
        </div>
      </section>
    );
  }

  const shipping = total >= 100 ? 0 : 8.95;
  const grandTotal = total + shipping;

  return (
    <section className="container page-section">
      <h2 className="page-title">Shopping Cart</h2>
      <div className="cart-layout">
        {/* Cart Items */}
        <div className="cart-items">
          {items.map((item) => (
            <div key={item.id} className="cart-item">
              <div
                className="cart-item-image"
                style={{ background: item.gradient }}
              />
              <div className="cart-item-details">
                <h3 className="cart-item-name">{item.name}</h3>
                <span className="cart-item-price">${item.price}</span>
              </div>
              <div className="cart-item-actions">
                <div className="qty-control">
                  <button
                    className="qty-btn"
                    onClick={() => onUpdateQty(item.id, item.qty - 1)}
                  >
                    −
                  </button>
                  <span className="qty-value">{item.qty}</span>
                  <button
                    className="qty-btn"
                    onClick={() => onUpdateQty(item.id, item.qty + 1)}
                  >
                    +
                  </button>
                </div>
                <span className="cart-item-total">
                  ${(item.price * item.qty).toFixed(2)}
                </span>
                <button
                  className="remove-btn"
                  onClick={() => onRemove(item.id)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Order Summary */}
        <div className="cart-summary card">
          <h3 className="summary-title">Order Summary</h3>
          <div className="summary-row">
            <span>Subtotal</span>
            <span>${total.toFixed(2)}</span>
          </div>
          <div className="summary-row">
            <span>Shipping</span>
            <span>{shipping === 0 ? 'Free' : `$${shipping.toFixed(2)}`}</span>
          </div>
          {shipping > 0 && (
            <p className="shipping-note">
              Add ${(100 - total).toFixed(2)} more for free shipping
            </p>
          )}
          <div className="summary-divider" />
          <div className="summary-row total">
            <span>Total</span>
            <span>${grandTotal.toFixed(2)}</span>
          </div>
          <button className="btn btn-primary btn-full" onClick={onCheckout}>
            Proceed to Checkout
          </button>
          <button className="btn btn-ghost btn-full" onClick={onContinueShopping}>
            Continue Shopping
          </button>
        </div>
      </div>
    </section>
  );
}
