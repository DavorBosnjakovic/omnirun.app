// ============================================================
// Stripe Connection Service
// ============================================================
// API docs: https://stripe.com/docs/api
// Token: Secret Key from https://dashboard.stripe.com/apikeys
// Base URL: https://api.stripe.com/v1

import type { ConnectionService, AccountInfo } from './types';

const BASE = 'https://api.stripe.com/v1';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'omnirun/1.0.0',
  };
}

// Stripe uses form-encoded bodies, not JSON
function toFormBody(obj: Record<string, any>, prefix = ''): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof val === 'object' && !Array.isArray(val)) {
      parts.push(toFormBody(val, fullKey));
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(val)}`);
    }
  }
  return parts.join('&');
}

async function stripeFetch(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(token), ...options.headers },
  });

  const body = await res.json();

  if (!res.ok) {
    const err: any = new Error(body.error?.message || `Stripe API error: ${res.status}`);
    err.status = res.status;
    err.code = body.error?.code;
    throw err;
  }

  return body;
}

// --------------- Actions ---------------

const actions: Record<string, (params: any, token: string) => Promise<any>> = {
  // Products
  async list_products(params, token) {
    const { limit = 10, active } = params;
    let url = `/products?limit=${limit}`;
    if (active !== undefined) url += `&active=${active}`;
    return stripeFetch(url, token);
  },

  async create_product(params, token) {
    const { name, description, metadata } = params;
    return stripeFetch('/products', token, {
      method: 'POST',
      body: toFormBody({ name, description, metadata }),
    });
  },

  // Prices
  async create_price(params, token) {
    const { product, unit_amount, currency = 'usd', recurring } = params;
    return stripeFetch('/prices', token, {
      method: 'POST',
      body: toFormBody({ product, unit_amount, currency, recurring }),
    });
  },

  async list_prices(params, token) {
    const { product, limit = 10 } = params;
    let url = `/prices?limit=${limit}`;
    if (product) url += `&product=${product}`;
    return stripeFetch(url, token);
  },

  // Checkout Sessions
  async create_checkout(params, token) {
    const { line_items, mode = 'payment', success_url, cancel_url } = params;
    return stripeFetch('/checkout/sessions', token, {
      method: 'POST',
      body: toFormBody({ line_items, mode, success_url, cancel_url }),
    });
  },

  // Customers
  async list_customers(params, token) {
    const { limit = 10, email } = params;
    let url = `/customers?limit=${limit}`;
    if (email) url += `&email=${email}`;
    return stripeFetch(url, token);
  },

  async create_customer(params, token) {
    const { name, email, metadata } = params;
    return stripeFetch('/customers', token, {
      method: 'POST',
      body: toFormBody({ name, email, metadata }),
    });
  },

  // Subscriptions
  async list_subscriptions(params, token) {
    const { customer, limit = 10, status } = params;
    let url = `/subscriptions?limit=${limit}`;
    if (customer) url += `&customer=${customer}`;
    if (status) url += `&status=${status}`;
    return stripeFetch(url, token);
  },

  // Balance
  async get_balance(params, token) {
    return stripeFetch('/balance', token);
  },

  // Payments (Payment Intents)
  async list_payments(params, token) {
    const { limit = 10 } = params;
    return stripeFetch(`/payment_intents?limit=${limit}`, token);
  },
};

// --------------- Service Export ---------------

export const stripeService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const account = await stripeFetch('/account', token);
    return {
      id: account.id,
      name: account.business_profile?.name || account.settings?.dashboard?.display_name || account.id,
      email: account.email,
      plan: account.type, // 'standard', 'express', 'custom'
      extra: {
        country: account.country,
        default_currency: account.default_currency,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        livemode: !token.includes('_test_'),
      },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string) {
    const handler = actions[action];
    if (!handler) {
      throw new Error(
        `Unknown Stripe action: "${action}". Available: ${Object.keys(actions).join(', ')}`
      );
    }
    return handler(params, token);
  },
};