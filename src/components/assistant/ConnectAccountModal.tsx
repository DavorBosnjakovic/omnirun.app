// ============================================================
// ConnectAccountModal.tsx
// ============================================================
// Handles the OAuth connection flow for email accounts.
//
// Flow:
// 1. User picks a provider (Gmail or Outlook)
// 2. App calls a Tauri command that:
//    a. Spins up a temporary localhost HTTP server on a random port
//    b. Opens the system browser with the OAuth URL
//    c. Waits for Google/Microsoft to redirect to localhost/callback
//    d. Exchanges the auth code for access + refresh tokens
//    e. Returns the tokens + user email to the frontend
// 3. Frontend saves tokens to Supabase assistant_email_accounts
// 4. Account added to local SQLite cache + store
// 5. Modal closes
//
// ── Tauri commands required (not yet built) ──────────────────
// These need to be implemented in src-tauri/src/lib.rs:
//
//   start_gmail_oauth(client_id: String, client_secret: String, scopes: Vec<String>)
//     -> OAuthResult { email, display_name, access_token, refresh_token, expires_at }
//
//   start_outlook_oauth(client_id: String, client_secret: String, scopes: Vec<String>)
//     -> OAuthResult { email, display_name, access_token, refresh_token, expires_at }
//
// Both commands:
//   - Start a local HTTP server on a random available port
//   - Open the system browser via shell::open()
//   - Wait for the OAuth callback (with a 5-minute timeout)
//   - Exchange the code for tokens using reqwest
//   - Return the result to the frontend
//
// See: https://github.com/tauri-apps/tauri-plugin-oauth (recommended)
// Or implement manually with tiny_http crate.
//
// ── Environment variables required ───────────────────────────
// Add to app/.env:
//   VITE_GMAIL_CLIENT_ID=your_google_client_id
//   VITE_GMAIL_CLIENT_SECRET=your_google_client_secret
//   VITE_OUTLOOK_CLIENT_ID=your_microsoft_client_id
//   VITE_OUTLOOK_CLIENT_SECRET=your_microsoft_client_secret

import { useState, useEffect } from 'react';
import { X, Mail, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../stores/settingsStore';
import { themes } from '../../config/themes';
import { useAssistantStore, ASSISTANT_PROVIDERS } from '../../stores/assistantStore';
import { getSupabase } from '../../services/supabaseClient';
import type { AssistantAccount } from '../../services/dbService';

// ─── Types ────────────────────────────────────────────────────

interface OAuthResult {
  email: string;
  display_name: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null; // ISO string
}

type Step = 'pick' | 'connecting' | 'success' | 'error';

interface ConnectAccountModalProps {
  userId: string;
  plan: string;
  initialProvider?: string;
  onClose: () => void;
}

// ─── Provider icon (same as AccountsPanel) ────────────────────

function ProviderIcon({ providerId, size = 28 }: { providerId: string; size?: number }) {
  const configs: Record<string, { bg: string; text: string; label: string }> = {
    gmail:   { bg: 'rgba(234,72,41,0.15)',  text: '#EA4829', label: 'G' },
    outlook: { bg: 'rgba(0,114,239,0.15)',  text: '#0072EF', label: 'O' },
  };
  const cfg = configs[providerId] ?? { bg: 'rgba(100,100,100,0.15)', text: '#888', label: '?' };

  return (
    <div style={{
      width: size, height: size, borderRadius: 7,
      background: cfg.bg, display: 'flex', alignItems: 'center',
      justifyContent: 'center', flexShrink: 0,
      fontSize: size * 0.45, fontWeight: 700, color: cfg.text,
    }}>
      {cfg.label}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────

function ConnectAccountModal({
  userId,
  plan,
  initialProvider,
  onClose,
}: ConnectAccountModalProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const { addAccount, accounts } = useAssistantStore();

  const [step, setStep] = useState<Step>(initialProvider ? 'connecting' : 'pick');
  const [selectedProvider, setSelectedProvider] = useState<string>(initialProvider ?? '');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [connectedEmail, setConnectedEmail] = useState<string>('');

  // Only show available (built) providers
  const availableProviders = ASSISTANT_PROVIDERS.filter((p) => p.available);

  // ── Start OAuth flow ────────────────────────────────────────
  const startOAuth = async (providerId: string) => {
    setSelectedProvider(providerId);
    setStep('connecting');
    setErrorMessage('');

    try {
      let result: OAuthResult;

      if (providerId === 'gmail') {
        const clientId = import.meta.env.VITE_GMAIL_CLIENT_ID;
        const clientSecret = import.meta.env.VITE_GMAIL_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          throw new Error(
            'Gmail credentials not configured. Add VITE_GMAIL_CLIENT_ID and VITE_GMAIL_CLIENT_SECRET to your .env file.'
          );
        }

        result = await invoke<OAuthResult>('start_gmail_oauth', {
          clientId,
          clientSecret,
          scopes: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ],
        });

      } else if (providerId === 'outlook') {
        const clientId = import.meta.env.VITE_OUTLOOK_CLIENT_ID;
        const clientSecret = import.meta.env.VITE_OUTLOOK_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          throw new Error(
            'Outlook credentials not configured. Add VITE_OUTLOOK_CLIENT_ID and VITE_OUTLOOK_CLIENT_SECRET to your .env file.'
          );
        }

        result = await invoke<OAuthResult>('start_outlook_oauth', {
          clientId,
          clientSecret,
          scopes: [
            'https://graph.microsoft.com/Mail.Read',
            'https://graph.microsoft.com/Mail.Send',
            'https://graph.microsoft.com/User.Read',
            'offline_access',
          ],
        });

      } else {
        throw new Error(`Unknown provider: ${providerId}`);
      }

      // ── Save to Supabase ──────────────────────────────────
      const { data, error: supabaseError } = await getSupabase()
        .from('assistant_email_accounts')
        .upsert(
          {
            user_id: userId,
            provider: providerId,
            provider_type: 'email',
            email: result.email,
            display_name: result.display_name,
            access_token: result.access_token,
            refresh_token: result.refresh_token,
            token_expires_at: result.expires_at,
            scopes: providerId === 'gmail'
              ? ['gmail.readonly', 'gmail.send']
              : ['Mail.Read', 'Mail.Send'],
            is_active: true,
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,email' }
        )
        .select('id')
        .single();

      if (supabaseError) throw supabaseError;
      if (!data?.id) throw new Error('Failed to save account — no ID returned from Supabase');

      // ── Add to local cache + store ────────────────────────
      const account: AssistantAccount = {
        id: data.id,
        userId,
        provider: providerId,
        providerType: 'email',
        email: result.email,
        displayName: result.display_name,
        accountLabel: null,
        isActive: true,
        connectedAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
      };

      await addAccount(account);
      setConnectedEmail(result.email);
      setStep('success');

    } catch (err: any) {
      console.error('[ConnectAccountModal] OAuth failed:', err);

      // User cancelled the browser window — don't show an error
      if (
        err?.message?.includes('cancelled') ||
        err?.message?.includes('canceled') ||
        err?.message?.includes('closed')
      ) {
        setStep('pick');
        return;
      }

      setErrorMessage(err?.message ?? 'Connection failed. Please try again.');
      setStep('error');
    }
  };

  // Auto-start if initialProvider was passed
  useEffect(() => {
    if (initialProvider) {
      startOAuth(initialProvider);
    }
  }, []);

  // ── Render ────────────────────────────────────────────────

  return (
    // Backdrop
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`relative w-full max-w-sm mx-4 ${t.colors.bg} ${t.colors.border} border rounded-xl shadow-2xl overflow-hidden`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 ${t.colors.textMuted} hover:${t.colors.text} transition-colors rounded-md`}
        >
          <X size={16} />
        </button>

        {/* ── Step: Pick provider ── */}
        {step === 'pick' && (
          <div className="p-6">
            <div className="mb-5">
              <h2 className={`text-base font-semibold ${t.colors.text} mb-1`}>
                Connect an account
              </h2>
              <p className={`text-xs ${t.colors.textMuted} leading-relaxed`}>
                Your assistant will be able to read, summarize, and reply to emails on your behalf.
              </p>
            </div>

            <div className="space-y-2">
              {availableProviders.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => startOAuth(provider.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 ${t.colors.bgSecondary} ${t.colors.border} border rounded-lg hover:opacity-80 transition-opacity text-left`}
                >
                  <ProviderIcon providerId={provider.id} size={28} />
                  <div>
                    <p className={`text-sm font-medium ${t.colors.text}`}>{provider.label}</p>
                    <p className={`text-xs ${t.colors.textMuted}`}>{provider.description}</p>
                  </div>
                </button>
              ))}
            </div>

            <p className={`text-[10px] ${t.colors.textMuted} mt-4 text-center leading-relaxed`}>
              Your credentials are stored securely. We never store passwords — only OAuth tokens.
            </p>
          </div>
        )}

        {/* ── Step: Connecting ── */}
        {step === 'connecting' && (
          <div className="p-6 flex flex-col items-center text-center">
            <div className="mb-4 mt-2">
              {selectedProvider && <ProviderIcon providerId={selectedProvider} size={40} />}
            </div>
            <Loader size={20} className="animate-spin mb-4" style={{ color: '#2DB87A' }} />
            <h2 className={`text-sm font-semibold ${t.colors.text} mb-1`}>
              Connecting {selectedProvider === 'gmail' ? 'Gmail' : 'Outlook'}...
            </h2>
            <p className={`text-xs ${t.colors.textMuted} leading-relaxed max-w-[220px]`}>
              A browser window has opened. Sign in to your account and grant access.
            </p>
            <button
              onClick={() => setStep('pick')}
              className={`mt-5 text-xs ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── Step: Success ── */}
        {step === 'success' && (
          <div className="p-6 flex flex-col items-center text-center">
            <CheckCircle size={36} className="mb-3 mt-1" style={{ color: '#2DB87A' }} />
            <h2 className={`text-sm font-semibold ${t.colors.text} mb-1`}>
              Account connected
            </h2>
            <p className={`text-xs ${t.colors.textMuted} mb-1`}>
              {connectedEmail}
            </p>
            <p className={`text-xs ${t.colors.textMuted} leading-relaxed max-w-[220px] mb-5`}>
              Your assistant can now read and reply to your emails. Ask it anything in the chat.
            </p>
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: '#2DB87A' }}
            >
              Done
            </button>
          </div>
        )}

        {/* ── Step: Error ── */}
        {step === 'error' && (
          <div className="p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className={`text-sm font-semibold ${t.colors.text} mb-1`}>
                  Connection failed
                </h2>
                <p className={`text-xs ${t.colors.textMuted} leading-relaxed`}>
                  {errorMessage}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => startOAuth(selectedProvider)}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: '#2DB87A' }}
              >
                Try again
              </button>
              <button
                onClick={() => setStep('pick')}
                className={`flex-1 py-2 rounded-lg text-sm ${t.colors.textMuted} ${t.colors.bgSecondary} ${t.colors.border} border`}
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConnectAccountModal;