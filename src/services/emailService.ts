// ============================================================
// emailService.ts
// ============================================================
// Gmail API service for the Assistant section.
// Fetches, searches, and sends emails through the Rust
// gmail_api_proxy command (bypasses CORS).
//
// Token source: Supabase assistant_email_accounts table.
// Tokens are fetched on demand, not cached locally.
//
// Usage:
//   import { fetchRecentEmails, searchEmails, sendEmail } from './emailService';
//   const emails = await fetchRecentEmails(userId, 'gmail');

import { invoke } from '@tauri-apps/api/core';
import { getSupabase } from './supabaseClient';

// ─── Types ────────────────────────────────────────────────────

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
  isUnread: boolean;
  labels: string[];
}

export interface EmailSendRequest {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;   // Message-ID header for threading
  threadId?: string;     // Gmail thread ID for threading
}

interface ProxyResponse {
  status: number;
  body: string;
}

// ─── Token retrieval ─────────────────────────────────────────
// Fetches the access token from Supabase for a given provider.
// Called on every API request — keeps tokens fresh without local caching.

async function getAccessToken(userId: string, provider: string): Promise<string> {
  const { data, error } = await getSupabase()
    .from('assistant_email_accounts')
    .select('access_token, refresh_token, token_expires_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('is_active', true)
    .single();

  if (error || !data?.access_token) {
    throw new Error(`No ${provider} account connected. Connect it in the Assistant panel.`);
  }

  // Check if token is expired and needs refresh
  if (data.token_expires_at && data.refresh_token) {
    const expiresAt = new Date(data.token_expires_at);
    const now = new Date();
    // Refresh if expiring within 5 minutes
    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      try {
        const newToken = await refreshGmailToken(userId, data.refresh_token);
        return newToken;
      } catch (err) {
        console.warn('[emailService] Token refresh failed, using existing token:', err);
      }
    }
  }

  return data.access_token;
}

// ─── Token refresh ───────────────────────────────────────────
// Uses the refresh token to get a new access token from Google.
// Updates the token in Supabase.

async function refreshGmailToken(userId: string, refreshToken: string): Promise<string> {
  // Get client credentials from local storage (saved by oauthCredentialService)
  const savedStore = localStorage.getItem('oauth-credentials');
  if (!savedStore) throw new Error('No Gmail OAuth credentials found locally');

  const creds = JSON.parse(savedStore)['gmail'];
  if (!creds) throw new Error('No Gmail OAuth credentials found locally');

  const { clientId, clientSecret } = creds;

  // Use fetch directly for token refresh (different endpoint)
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Token refresh failed: ${tokenResponse.status}`);
  }

  const tokenData = await tokenResponse.json();
  const newAccessToken = tokenData.access_token;
  const expiresIn = tokenData.expires_in || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Update token in Supabase
  await getSupabase()
    .from('assistant_email_accounts')
    .update({ access_token: newAccessToken, token_expires_at: expiresAt })
    .eq('user_id', userId)
    .eq('provider', 'gmail');

  return newAccessToken;
}

// ─── Gmail API proxy helper ──────────────────────────────────

async function gmailRequest(
  accessToken: string,
  path: string,
  method: string = 'GET',
  body?: any,
): Promise<any> {
  const result = await invoke<ProxyResponse>('gmail_api_proxy', {
    path,
    accessToken,
    method,
    body: body ? JSON.stringify(body) : null,
  });

  if (result.status === 401) {
    throw new Error('Gmail token expired. Please reconnect your Gmail account.');
  }

  if (result.status >= 400) {
    const errBody = JSON.parse(result.body || '{}');
    const msg = errBody?.error?.message || `Gmail API error ${result.status}`;
    throw new Error(msg);
  }

  return JSON.parse(result.body);
}

// ─── Parse email headers ─────────────────────────────────────

function getHeader(headers: any[], name: string): string {
  const h = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

function parseGmailMessage(msg: any): EmailMessage {
  const headers = msg.payload?.headers || [];
  const labels = msg.labelIds || [];

  // Extract body — try plain text first, then HTML
  let body = '';
  const payload = msg.payload;

  if (payload?.body?.data) {
    body = decodeBase64Url(payload.body.data);
  } else if (payload?.parts) {
    // Multipart — find text/plain or text/html
    const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
    const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
    const part = textPart || htmlPart;
    if (part?.body?.data) {
      body = decodeBase64Url(part.body.data);
    }
    // Handle nested multipart (e.g. multipart/alternative inside multipart/mixed)
    if (!body) {
      for (const p of payload.parts) {
        if (p.parts) {
          const nested = p.parts.find((np: any) => np.mimeType === 'text/plain');
          if (nested?.body?.data) {
            body = decodeBase64Url(nested.body.data);
            break;
          }
        }
      }
    }
  }

  // Strip HTML tags for a clean text version
  if (body.includes('<')) {
    body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    body = body.replace(/<[^>]+>/g, ' ');
    body = body.replace(/&nbsp;/g, ' ');
    body = body.replace(/&amp;/g, '&');
    body = body.replace(/&lt;/g, '<');
    body = body.replace(/&gt;/g, '>');
    body = body.replace(/&quot;/g, '"');
    body = body.replace(/\s+/g, ' ').trim();
  }

  // Truncate very long bodies to save tokens
  if (body.length > 2000) {
    body = body.slice(0, 2000) + '... [truncated]';
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject'),
    snippet: msg.snippet || '',
    body,
    date: getHeader(headers, 'Date'),
    isUnread: labels.includes('UNREAD'),
    labels,
  };
}

function decodeBase64Url(data: string): string {
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    return '';
  }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Fetch recent emails from the user's Gmail inbox.
 * Returns up to `maxResults` messages (default 10).
 */
export async function fetchRecentEmails(
  userId: string,
  provider: string = 'gmail',
  maxResults: number = 10,
): Promise<EmailMessage[]> {
  const token = await getAccessToken(userId, provider);

  // List message IDs
  const listData = await gmailRequest(
    token,
    `/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX`,
  );

  if (!listData.messages || listData.messages.length === 0) {
    return [];
  }

  // Fetch full message details for each (in parallel, batched)
  const messageIds: string[] = listData.messages.map((m: any) => m.id);
  const emails = await Promise.all(
    messageIds.map(async (id) => {
      const msgData = await gmailRequest(
        token,
        `/gmail/v1/users/me/messages/${id}?format=full`,
      );
      return parseGmailMessage(msgData);
    }),
  );

  return emails;
}

/**
 * Fetch only unread emails from inbox.
 */
export async function fetchUnreadEmails(
  userId: string,
  provider: string = 'gmail',
  maxResults: number = 10,
): Promise<EmailMessage[]> {
  const token = await getAccessToken(userId, provider);

  const listData = await gmailRequest(
    token,
    `/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX&q=is:unread`,
  );

  if (!listData.messages || listData.messages.length === 0) {
    return [];
  }

  const emails = await Promise.all(
    listData.messages.map(async (m: any) => {
      const msgData = await gmailRequest(
        token,
        `/gmail/v1/users/me/messages/${m.id}?format=full`,
      );
      return parseGmailMessage(msgData);
    }),
  );

  return emails;
}

/**
 * Search emails by query (Gmail search syntax).
 * Examples: "from:john subject:invoice", "newer_than:7d", "has:attachment"
 */
export async function searchEmails(
  userId: string,
  query: string,
  provider: string = 'gmail',
  maxResults: number = 10,
): Promise<EmailMessage[]> {
  const token = await getAccessToken(userId, provider);

  const encodedQuery = encodeURIComponent(query);
  const listData = await gmailRequest(
    token,
    `/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodedQuery}`,
  );

  if (!listData.messages || listData.messages.length === 0) {
    return [];
  }

  const emails = await Promise.all(
    listData.messages.map(async (m: any) => {
      const msgData = await gmailRequest(
        token,
        `/gmail/v1/users/me/messages/${m.id}?format=full`,
      );
      return parseGmailMessage(msgData);
    }),
  );

  return emails;
}

/**
 * Send an email via Gmail.
 * Supports replies (pass inReplyTo and threadId).
 */
export async function sendEmail(
  userId: string,
  email: EmailSendRequest,
  provider: string = 'gmail',
): Promise<{ id: string; threadId: string }> {
  const token = await getAccessToken(userId, provider);

  // Build RFC 2822 email
  const lines: string[] = [
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ];

  if (email.inReplyTo) {
    lines.push(`In-Reply-To: ${email.inReplyTo}`);
    lines.push(`References: ${email.inReplyTo}`);
  }

  lines.push('', email.body);

  const rawMessage = lines.join('\r\n');
  const encoded = btoa(unescape(encodeURIComponent(rawMessage)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const sendBody: any = { raw: encoded };
  if (email.threadId) sendBody.threadId = email.threadId;

  const result = await gmailRequest(
    token,
    '/gmail/v1/users/me/messages/send',
    'POST',
    sendBody,
  );

  return { id: result.id, threadId: result.threadId };
}

/**
 * Get a single email by ID (full details).
 */
export async function getEmailById(
  userId: string,
  messageId: string,
  provider: string = 'gmail',
): Promise<EmailMessage> {
  const token = await getAccessToken(userId, provider);
  const msgData = await gmailRequest(
    token,
    `/gmail/v1/users/me/messages/${messageId}?format=full`,
  );
  return parseGmailMessage(msgData);
}

// ─── Email data formatting for AI ────────────────────────────
// Converts email objects into a readable text block that gets
// injected into the AI system prompt.

export function formatEmailsForAI(emails: EmailMessage[], label: string = 'Recent emails'): string {
  if (emails.length === 0) return `${label}: No emails found.`;

  const lines = [`${label} (${emails.length}):\n`];

  for (const email of emails) {
    const unreadTag = email.isUnread ? ' [UNREAD]' : '';
    lines.push(`--- Email${unreadTag} ---`);
    lines.push(`From: ${email.from}`);
    lines.push(`To: ${email.to}`);
    lines.push(`Subject: ${email.subject}`);
    lines.push(`Date: ${email.date}`);
    lines.push(`Body: ${email.body || email.snippet}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Email query detection ───────────────────────────────────
// Checks if a user message is asking about email so the
// AssistantChatArea can prefetch data before sending to AI.

const EMAIL_PATTERNS = [
  /\b(email|emails|mail|mails|inbox|unread|message|messages)\b/i,
  /\b(morning brief|morning update|daily brief|daily update)\b/i,
  /\bfrom\s+[\w.@]+/i,
  /\b(reply|respond|answer|write back|send|forward)\b.*\b(email|mail|message)\b/i,
  /\b(check|read|show|get|fetch|list|find|search|look)\b.*\b(email|mail|inbox|message)\b/i,
  /\bwhat('s| is| are)\b.*\b(new|unread|latest|recent)\b/i,
  /\bany\s+(new\s+)?(email|mail|message)/i,
  /\bneed(s)?\s+my\s+attention\b/i,
];

const EMAIL_SEARCH_PATTERNS = [
  /\bfrom\s+([\w.@\s]+)/i,
  /\babout\s+["']?(.+?)["']?\s*(\?|$)/i,
  /\bsubject\s+["']?(.+?)["']?/i,
  /\bsearch\s+(for\s+)?["']?(.+?)["']?\s*(in\s+)?(email|mail|inbox)?/i,
];

export function isEmailQuery(message: string): boolean {
  return EMAIL_PATTERNS.some((p) => p.test(message));
}

/**
 * Extract a Gmail search query from the user's natural language.
 * Returns null if no specific search is detected (just fetch recent).
 */
export function extractEmailSearchQuery(message: string): string | null {
  // "from Davor" → "from:Davor"
  const fromMatch = message.match(/\b(?:from|by)\s+([\w.\s@]+?)(?:\s*\?|\s*$|\s+(?:about|subject|regarding|today|this|last))/i);
  if (fromMatch) {
    const name = fromMatch[1].trim();
    const aboutMatch = message.match(/\b(?:about|subject|regarding)\s+["']?(.+?)["']?\s*(\?|$)/i);
    if (aboutMatch) {
      return `from:${name} subject:${aboutMatch[1].trim()}`;
    }
    return `from:${name}`;
  }

  // "about invoices" → "subject:invoices"
  const aboutMatch = message.match(/\b(?:about|regarding|subject)\s+["']?(.+?)["']?\s*(\?|$)/i);
  if (aboutMatch) return `subject:${aboutMatch[1].trim()}`;

  // "unread emails" → just fetch unread
  if (/\bunread\b/i.test(message)) return 'is:unread';

  return null;
}