import { useState } from 'react';

export default function Checkout({ items, total, onPlaceOrder, onBack }) {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
  });
  const [errors, setErrors] = useState({});

  const shipping = total >= 100 ? 0 : 8.95;
  const grandTotal = total + shipping;

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (errors[e.target.name]) {
      setErrors({ ...errors, [e.target.name]: '' });
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!form.firstName.trim()) newErrors.firstName = 'Required';
    if (!form.lastName.trim()) newErrors.lastName = 'Required';
    if (!form.email.trim() || !form.email.includes('@')) newErrors.email = 'Valid email required';
    if (!form.address.trim()) newErrors.address = 'Required';
    if (!form.city.trim()) newErrors.city = 'Required';
    if (!form.state.trim()) newErrors.state = 'Required';
    if (!form.zip.trim()) newErrors.zip = 'Required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) {
      onPlaceOrder(form);
    }
  };

  return (
    <section className="container page-section">
      <button className="back-link" onClick={onBack}>← Back to Cart</button>
      <h2 className="page-title">Checkout</h2>
      <div className="checkout-layout">
        {/* Shipping Form */}
        <div className="checkout-form">
          <h3 className="form-section-title">Shipping Information</h3>
          <div className="form-row">
            <div className="form-group">
              <label>First Name</label>
              <input
                name="firstName"
                value={form.firstName}
                onChange={handleChange}
                placeholder="Jane"
                className={errors.firstName ? 'error' : ''}
              />
              {errors.firstName && <span className="form-error">{errors.firstName}</span>}
            </div>
            <div className="form-group">
              <label>Last Name</label>
              <input
                name="lastName"
                value={form.lastName}
                onChange={handleChange}
                placeholder="Smith"
                className={errors.lastName ? 'error' : ''}
              />
              {errors.lastName && <span className="form-error">{errors.lastName}</span>}
            </div>
          </div>
          <div className="form-group">
            <label>Email</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="jane@email.com"
              className={errors.email ? 'error' : ''}
            />
            {errors.email && <span className="form-error">{errors.email}</span>}
          </div>
          <div className="form-group">
            <label>Address</label>
            <input
              name="address"
              value={form.address}
              onChange={handleChange}
              placeholder="123 Main Street"
              className={errors.address ? 'error' : ''}
            />
            {errors.address && <span className="form-error">{errors.address}</span>}
          </div>
          <div className="form-row form-row-3">
            <div className="form-group">
              <label>City</label>
              <input
                name="city"
                value={form.city}
                onChange={handleChange}
                placeholder="Portland"
                className={errors.city ? 'error' : ''}
              />
              {errors.city && <span className="form-error">{errors.city}</span>}
            </div>
            <div className="form-group">
              <label>State</label>
              <input
                name="state"
                value={form.state}
                onChange={handleChange}
                placeholder="OR"
                className={errors.state ? 'error' : ''}
              />
              {errors.state && <span className="form-error">{errors.state}</span>}
            </div>
            <div className="form-group">
              <label>ZIP Code</label>
              <input
                name="zip"
                value={form.zip}
                onChange={handleChange}
                placeholder="97201"
                className={errors.zip ? 'error' : ''}
              />
              {errors.zip && <span className="form-error">{errors.zip}</span>}
            </div>
          </div>

          <div className="payment-placeholder">
            <div className="payment-icon">💳</div>
            <p>Payment integration goes here</p>
            <span>Connect Stripe, PayPal, or another payment provider</span>
          </div>

          <button className="btn btn-primary btn-full" onClick={handleSubmit}>
            Place Order — ${grandTotal.toFixed(2)}
          </button>
        </div>

        {/* Order Summary */}
        <div className="checkout-summary card">
          <h3 className="summary-title">Order Summary</h3>
          <div className="checkout-items">
            {items.map((item) => (
              <div key={item.id} className="checkout-item">
                <div
                  className="checkout-item-image"
                  style={{ background: item.gradient }}
                />
                <div className="checkout-item-details">
                  <span className="checkout-item-name">{item.name}</span>
                  <span className="checkout-item-qty">Qty: {item.qty}</span>
                </div>
                <span className="checkout-item-price">
                  ${(item.price * item.qty).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <div className="summary-divider" />
          <div className="summary-row">
            <span>Subtotal</span>
            <span>${total.toFixed(2)}</span>
          </div>
          <div className="summary-row">
            <span>Shipping</span>
            <span>{shipping === 0 ? 'Free' : `$${shipping.toFixed(2)}`}</span>
          </div>
          <div className="summary-divider" />
          <div className="summary-row total">
            <span>Total</span>
            <span>${grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
