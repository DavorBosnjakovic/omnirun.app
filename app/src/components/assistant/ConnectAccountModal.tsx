// ============================================================
// ConnectAccountModal.tsx
// ============================================================
// Handles the connection flow for all assistant integrations.
// OAuth: Gmail, Outlook, Google Calendar, Outlook Calendar,
//   Slack, Discord, GitHub, Notion, Todoist
// Non-OAuth: Website Watcher (URL input only)
// Calendar providers share OAuth with their email counterpart.
//
// OAuth callback port: 49580 (fixed, in the private port range)
// Rust backend binds to 127.0.0.1:49580 for all OAuth flows.

import { useState, useEffect, useRef } from 'react';
import { X, CheckCircle, AlertCircle, Loader, ExternalLink, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../stores/settingsStore';
import { themes } from '../../config/themes';
import { useAssistantStore, ASSISTANT_PROVIDERS } from '../../stores/assistantStore';
import { getSupabase } from '../../services/supabaseClient';
import {
  resolveOAuthCredentials,
  saveOAuthCredentials,
  type OAuthCredentials,
} from '../../services/oauthCredentialService';
import ProviderIcon from './ProviderIcons';
import type { AssistantAccount } from '../../services/dbService';

// ─── Types ────────────────────────────────────────────────────

interface OAuthResult {
  email: string;
  display_name: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

type Step = 'pick' | 'configure' | 'watcher_setup' | 'connecting' | 'success' | 'error';

interface ConnectAccountModalProps {
  userId: string;
  plan: string;
  initialProvider?: string;
  onClose: () => void;
}

// ─── OAuth scopes per provider ────────────────────────────────

const PROVIDER_SCOPES: Record<string, string[]> = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ],
  outlook: [
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/Mail.Send',
    'https://graph.microsoft.com/User.Read',
    'offline_access',
  ],
  google_calendar: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  outlook_calendar: [
    'https://graph.microsoft.com/Calendars.ReadWrite',
    'https://graph.microsoft.com/User.Read',
    'offline_access',
  ],
  slack: ['channels:read', 'channels:history', 'chat:write', 'users:read', 'im:read', 'im:history'],
  discord: ['identify', 'guilds', 'messages.read'],
  github: ['repo', 'read:user', 'notifications'],
  notion: [],
  todoist: ['data:read_write'],
};

// ─── Tauri command names per provider ─────────────────────────

const OAUTH_COMMANDS: Record<string, string> = {
  gmail: 'start_gmail_oauth',
  outlook: 'start_outlook_oauth',
  google_calendar: 'start_google_calendar_oauth',
  outlook_calendar: 'start_outlook_calendar_oauth',
  slack: 'start_slack_oauth',
  discord: 'start_discord_oauth',
  github: 'start_github_oauth',
  notion: 'start_notion_oauth',
  todoist: 'start_todoist_oauth',
};

// ─── Setup instructions per provider ──────────────────────────
// Written for non-technical users. Each step tells exactly what
// to click and what to type. No jargon, no ambiguity.

const PROVIDER_SETUP: Record<string, {
  name: string;
  consoleName: string;
  consoleUrl: string;
  instructions: string[];
}> = {
  gmail: {
    name: 'Gmail',
    consoleName: 'Google Cloud Console',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    instructions: [
      'Sign in with your Google account and click "Create Project" at the top',
      'Once created, go to "APIs & Services" \u2192 "Library" in the left menu',
      'Search for "Gmail API", click it, then click "Enable"',
      'Go back to "Credentials" in the left menu \u2192 click "Create Credentials" \u2192 "OAuth client ID"',
      'For Application type, choose "Desktop app" and click Create',
      'You\u2019ll see your Client ID and Client Secret \u2014 paste them below',
    ],
  },
  outlook: {
    name: 'Outlook',
    consoleName: 'Azure Portal',
    consoleUrl: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    instructions: [
      'Sign in with your Microsoft account and click "New registration"',
      'Give it any name (e.g. "Omnirun") and click Register',
      'On the app\u2019s overview page, copy the "Application (client) ID" \u2014 that\u2019s your Client ID',
      'In the left menu, click "Certificates & secrets" \u2192 "New client secret"',
      'Give it any description, click Add, then copy the "Value" column \u2014 that\u2019s your Client Secret',
      'Paste both below',
    ],
  },
  google_calendar: {
    name: 'Google Calendar',
    consoleName: 'Google Cloud Console',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    instructions: [
      'If you already connected Gmail, use the same project \u2014 otherwise create a new one',
      'Go to "APIs & Services" \u2192 "Library", search for "Google Calendar API" and enable it',
      'If you already have a Desktop app credential from Gmail, reuse the same Client ID and Secret',
      'If not, go to "Credentials" \u2192 "Create Credentials" \u2192 "OAuth client ID" \u2192 "Desktop app"',
      'Paste your Client ID and Client Secret below',
    ],
  },
  outlook_calendar: {
    name: 'Outlook Calendar',
    consoleName: 'Azure Portal',
    consoleUrl: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    instructions: [
      'If you already connected Outlook, use the same app \u2014 otherwise create a new registration',
      'Open your app, go to "API permissions" in the left menu',
      'Click "Add a permission" \u2192 "Microsoft Graph" \u2192 "Delegated permissions"',
      'Search for "Calendars.ReadWrite", check it, and click "Add permissions"',
      'Use the same Client ID and Client Secret from your Outlook setup \u2014 paste them below',
    ],
  },
  slack: {
    name: 'Slack',
    consoleName: 'Slack API Dashboard',
    consoleUrl: 'https://api.slack.com/apps',
    instructions: [
      'Click "Create New App" \u2192 choose "From scratch"',
      'Give it a name (e.g. "Omnirun") and pick your Slack workspace',
      'In the left menu, go to "OAuth & Permissions"',
      'Under "Redirect URLs", click "Add New Redirect URL" and enter exactly: http://127.0.0.1:49580',
      'Go to "Basic Information" in the left menu \u2014 you\u2019ll find your Client ID and Client Secret there',
      'Paste both below',
    ],
  },
  discord: {
    name: 'Discord',
    consoleName: 'Discord Developer Portal',
    consoleUrl: 'https://discord.com/developers/applications',
    instructions: [
      'Click "New Application", give it a name (e.g. "Omnirun"), and click Create',
      'In the left menu, click "OAuth2"',
      'Under "Redirects", click "Add Redirect" and enter exactly: http://127.0.0.1:49580',
      'Click "Save Changes" at the bottom',
      'On the same page, copy the Client ID and Client Secret',
      'Paste both below',
    ],
  },
  github: {
    name: 'GitHub',
    consoleName: 'GitHub Developer Settings',
    consoleUrl: 'https://github.com/settings/developers',
    instructions: [
      'Click "New OAuth App"',
      'For "Application name" enter anything (e.g. "Omnirun")',
      'For "Homepage URL" enter: https://omnirun.app',
      'For "Authorization callback URL" enter exactly: http://127.0.0.1:49580',
      'Click "Register application", then click "Generate a new client secret"',
      'Copy the Client ID and the generated Client Secret \u2014 paste them below',
    ],
  },
  notion: {
    name: 'Notion',
    consoleName: 'Notion Integrations',
    consoleUrl: 'https://www.notion.so/my-integrations',
    instructions: [
      'Click "New integration" and give it a name (e.g. "Omnirun")',
      'Under "Integration type", select "Public"',
      'In the "OAuth Domain & URIs" section, set the redirect URI to exactly: http://127.0.0.1:49580',
      'Go to the "Secrets" tab \u2014 copy the OAuth Client ID and Client Secret',
      'Paste both below',
    ],
  },
  todoist: {
    name: 'Todoist',
    consoleName: 'Todoist App Management',
    consoleUrl: 'https://developer.todoist.com/appconsole.html',
    instructions: [
      'Click "Create a new app" and give it a name (e.g. "Omnirun")',
      'In the "OAuth redirect URL" field, enter exactly: http://127.0.0.1:49580',
      'Copy the Client ID and Client Secret shown on the app page',
      'Paste both below',
    ],
  },
};

// ─── Copyable inline text ─────────────────────────────────────
// Click-to-copy for URLs, values, etc. in setup instructions.

function CopyableText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono transition-all cursor-pointer"
      style={{
        background: copied ? 'rgba(45,184,122,0.15)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${copied ? 'rgba(45,184,122,0.3)' : 'rgba(255,255,255,0.1)'}`,
        color: copied ? '#2DB87A' : 'inherit',
      }}
      title={copied ? 'Copied!' : 'Click to copy'}
    >
      <span>{text}</span>
      {copied ? <Check size={9} /> : <Copy size={9} className="opacity-40" />}
    </button>
  );
}

// Values that should be rendered as click-to-copy in instructions
const COPYABLE_VALUES = [
  'http://127.0.0.1:49580',
  'https://omnirun.app',
];

// Parse instruction text and wrap copyable values with CopyableText
function renderInstruction(text: string): React.ReactNode {
  // Check if this instruction contains any copyable value
  const match = COPYABLE_VALUES.find((v) => text.includes(v));
  if (!match) return text;

  const parts = text.split(match);
  return (
    <>
      {parts[0]}
      <CopyableText text={match} />
      {parts[1]}
    </>
  );
}

// ─── Main modal ───────────────────────────────────────────────

function ConnectAccountModal({ userId, plan, initialProvider, onClose }: ConnectAccountModalProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { addAccount } = useAssistantStore();

  const [step, setStep] = useState<Step>('pick');
  const [selectedProvider, setSelectedProvider] = useState<string>(initialProvider ?? '');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [connectedEmail, setConnectedEmail] = useState<string>('');

  const [configClientId, setConfigClientId] = useState('');
  const [configClientSecret, setConfigClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const [watcherUrl, setWatcherUrl] = useState('');
  const [watcherLabel, setWatcherLabel] = useState('');

  const availableProviders = ASSISTANT_PROVIDERS.filter((p) => p.available);

  // ── Handle provider selection ───────────────────────────────

  const handleProviderPick = (providerId: string) => {
    setSelectedProvider(providerId);
    setErrorMessage('');

    const providerDef = ASSISTANT_PROVIDERS.find((p) => p.id === providerId);

    if (!providerDef?.oauthBased) {
      setWatcherUrl('');
      setWatcherLabel('');
      setStep('watcher_setup');
      return;
    }

    const credentialProviderId = providerDef.sharesAuthWith || providerId;
    const creds = resolveOAuthCredentials(credentialProviderId);
    if (creds) {
      startOAuth(providerId, creds);
    } else {
      setConfigClientId('');
      setConfigClientSecret('');
      setShowSecret(false);
      setStep('configure');
    }
  };

  // ── Save credentials & start OAuth ──────────────────────────

  const handleSaveCredentials = () => {
    const trimmedId = configClientId.trim();
    const trimmedSecret = configClientSecret.trim();
    if (!trimmedId || !trimmedSecret) return;

    const providerDef = ASSISTANT_PROVIDERS.find((p) => p.id === selectedProvider);
    const credentialProviderId = providerDef?.sharesAuthWith || selectedProvider;

    saveOAuthCredentials(credentialProviderId, { clientId: trimmedId, clientSecret: trimmedSecret });
    startOAuth(selectedProvider, { clientId: trimmedId, clientSecret: trimmedSecret });
  };

  // ── Save website watcher ────────────────────────────────────

  const handleSaveWatcher = async () => {
    const url = watcherUrl.trim();
    if (!url) return;

    try { new URL(url); } catch {
      setErrorMessage('Please enter a valid URL (e.g. https://example.com/pricing)');
      setStep('error');
      return;
    }

    try {
      const account: AssistantAccount = {
        id: `watcher_${Date.now()}`,
        userId,
        provider: 'website_watcher',
        providerType: 'monitor',
        email: url,
        displayName: watcherLabel.trim() || new URL(url).hostname,
        accountLabel: watcherLabel.trim() || null,
        isActive: true,
        connectedAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
      };

      await addAccount(account);
      setConnectedEmail(url);
      setStep('success');
    } catch (err: any) {
      setErrorMessage(err?.message ?? 'Failed to save. Please try again.');
      setStep('error');
    }
  };

  // ── Start OAuth flow ────────────────────────────────────────

  const startOAuth = async (providerId: string, creds: OAuthCredentials) => {
    setSelectedProvider(providerId);
    setStep('connecting');
    setErrorMessage('');

    try {
      const command = OAUTH_COMMANDS[providerId];
      if (!command) throw new Error(`No OAuth command for provider: ${providerId}`);

      const scopes = PROVIDER_SCOPES[providerId] || [];

      const result = await invoke<OAuthResult>(command, {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        scopes,
      });

      const providerDef = ASSISTANT_PROVIDERS.find((p) => p.id === providerId);
      const { data, error: supabaseError } = await getSupabase()
        .from('assistant_email_accounts')
        .upsert(
          {
            user_id: userId,
            provider: providerId,
            provider_type: providerDef?.providerType ?? 'email',
            email: result.email,
            display_name: result.display_name,
            access_token: result.access_token,
            refresh_token: result.refresh_token,
            token_expires_at: result.expires_at,
            scopes,
            is_active: true,
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,email' }
        )
        .select('id')
        .single();

      if (supabaseError) throw supabaseError;
      if (!data?.id) throw new Error('Failed to save account \u2014 no ID returned from Supabase');

      const account: AssistantAccount = {
        id: data.id,
        userId,
        provider: providerId,
        providerType: providerDef?.providerType ?? 'email',
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

  const hasAutoStarted = useRef(false);
  useEffect(() => {
    if (initialProvider && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      handleProviderPick(initialProvider);
    }
  }, []);

  const providerDef = ASSISTANT_PROVIDERS.find((p) => p.id === selectedProvider);
  const providerName = providerDef?.label ?? selectedProvider;
  const setupInfo = PROVIDER_SETUP[providerDef?.sharesAuthWith || selectedProvider] ?? PROVIDER_SETUP[selectedProvider];

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`relative w-full max-w-sm mx-4 ${t.colors.bg} ${t.colors.border} border rounded-xl shadow-2xl overflow-hidden`}
        style={{ maxHeight: '85vh', overflowY: 'auto' }}
      >
        <button onClick={onClose} className={`absolute top-3 right-3 p-1.5 ${t.colors.textMuted} hover:${t.colors.text} transition-colors rounded-md z-10`}>
          <X size={16} />
        </button>

        {/* ── Pick provider ── */}
        {step === 'pick' && (
          <div className="p-6">
            <div className="mb-5">
              <h2 className={`text-base font-semibold ${t.colors.text} mb-1`}>Connect an integration</h2>
              <p className={`text-xs ${t.colors.textMuted} leading-relaxed`}>
                Give your assistant access to your accounts so it can help you manage them.
              </p>
            </div>
            <div className="space-y-1.5" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
              {availableProviders.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => handleProviderPick(provider.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 ${t.colors.bgSecondary} ${t.colors.border} border rounded-lg hover:opacity-80 transition-opacity text-left`}
                >
                  <ProviderIcon providerId={provider.id} size={26} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${t.colors.text}`}>{provider.label}</p>
                    <p className={`text-[11px] ${t.colors.textMuted}`}>{provider.description}</p>
                  </div>
                </button>
              ))}
            </div>
            <p className={`text-[10px] ${t.colors.textMuted} mt-4 text-center leading-relaxed`}>
              Credentials are stored on this device only. We never store passwords.
            </p>
          </div>
        )}

        {/* ── Configure OAuth credentials ── */}
        {step === 'configure' && setupInfo && (
          <div className="p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <ProviderIcon providerId={selectedProvider} size={28} />
              <div>
                <h2 className={`text-sm font-semibold ${t.colors.text}`}>Set up {providerName}</h2>
                <p className={`text-[11px] ${t.colors.textMuted}`}>One-time setup — credentials stored locally</p>
              </div>
            </div>

            <div className={`rounded-lg px-3 py-2.5 mb-4 ${t.colors.bgSecondary} ${t.colors.border} border`}>
              <p className={`text-[11px] font-medium ${t.colors.text} mb-2`}>
                Get your credentials from the {setupInfo.consoleName}:
              </p>
              <ol className="space-y-1 mb-2.5">
                {setupInfo.instructions.map((instr, i) => (
                  <li key={i} className={`text-[11px] ${t.colors.textMuted} leading-relaxed flex gap-1.5`}>
                    <span className="flex-shrink-0 opacity-50">{i + 1}.</span>
                    <span>{renderInstruction(instr)}</span>
                  </li>
                ))}
              </ol>
              <a
                href={setupInfo.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-80"
                style={{ color: '#2DB87A' }}
                onClick={(e) => {
                  e.preventDefault();
                  import('@tauri-apps/plugin-opener')
                    .then((mod) => mod.openUrl(setupInfo.consoleUrl))
                    .catch(() => window.open(setupInfo.consoleUrl, '_blank'));
                }}
              >
                Open {setupInfo.consoleName}
                <ExternalLink size={10} />
              </a>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className={`block text-[11px] font-medium ${t.colors.textMuted} mb-1`}>Client ID</label>
                <input
                  type="text" value={configClientId} onChange={(e) => setConfigClientId(e.target.value)}
                  placeholder="Paste your client ID"
                  className={`w-full text-xs px-3 py-2 ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2DB87A]`}
                  autoFocus spellCheck={false} autoComplete="off"
                />
              </div>
              <div>
                <label className={`block text-[11px] font-medium ${t.colors.textMuted} mb-1`}>Client Secret</label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={configClientSecret} onChange={(e) => setConfigClientSecret(e.target.value)}
                    placeholder="Paste your client secret"
                    className={`w-full text-xs px-3 py-2 pr-8 ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2DB87A]`}
                    spellCheck={false} autoComplete="off"
                    onKeyDown={(e) => { if (e.key === 'Enter' && configClientId.trim() && configClientSecret.trim()) handleSaveCredentials(); }}
                  />
                  <button type="button" onClick={() => setShowSecret(!showSecret)}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`} tabIndex={-1}>
                    {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={handleSaveCredentials} disabled={!configClientId.trim() || !configClientSecret.trim()}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-40" style={{ background: '#2DB87A' }}>
                Connect
              </button>
              <button onClick={() => setStep('pick')} className={`px-4 py-2 rounded-lg text-sm ${t.colors.textMuted} ${t.colors.bgSecondary} ${t.colors.border} border`}>
                Back
              </button>
            </div>
            <p className={`text-[10px] ${t.colors.textMuted} mt-3 leading-relaxed text-center`}>
              Credentials are saved on this device only and never uploaded to our servers.
            </p>
          </div>
        )}

        {/* ── Website Watcher setup ── */}
        {step === 'watcher_setup' && (
          <div className="p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <ProviderIcon providerId="website_watcher" size={28} />
              <div>
                <h2 className={`text-sm font-semibold ${t.colors.text}`}>Watch a website</h2>
                <p className={`text-[11px] ${t.colors.textMuted}`}>Get notified when a page changes</p>
              </div>
            </div>

            <div className={`rounded-lg px-3 py-2.5 mb-4 ${t.colors.bgSecondary} ${t.colors.border} border`}>
              <p className={`text-[11px] ${t.colors.textMuted} leading-relaxed`}>
                Enter a URL and your assistant will check it periodically for changes. Great for tracking competitor pricing, product availability, policy updates, and more.
              </p>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className={`block text-[11px] font-medium ${t.colors.textMuted} mb-1`}>URL to watch</label>
                <input type="url" value={watcherUrl} onChange={(e) => setWatcherUrl(e.target.value)}
                  placeholder="https://example.com/pricing"
                  className={`w-full text-xs px-3 py-2 ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2DB87A]`}
                  autoFocus spellCheck={false} autoComplete="off"
                />
              </div>
              <div>
                <label className={`block text-[11px] font-medium ${t.colors.textMuted} mb-1`}>
                  Label <span className="opacity-50">(optional)</span>
                </label>
                <input type="text" value={watcherLabel} onChange={(e) => setWatcherLabel(e.target.value)}
                  placeholder="e.g. Competitor pricing page"
                  className={`w-full text-xs px-3 py-2 ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2DB87A]`}
                  spellCheck={false}
                  onKeyDown={(e) => { if (e.key === 'Enter' && watcherUrl.trim()) handleSaveWatcher(); }}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={handleSaveWatcher} disabled={!watcherUrl.trim()}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-40" style={{ background: '#2DB87A' }}>
                Start watching
              </button>
              <button onClick={() => setStep('pick')} className={`px-4 py-2 rounded-lg text-sm ${t.colors.textMuted} ${t.colors.bgSecondary} ${t.colors.border} border`}>
                Back
              </button>
            </div>
          </div>
        )}

        {/* ── Connecting ── */}
        {step === 'connecting' && (
          <div className="p-6 flex flex-col items-center text-center">
            <div className="mb-4 mt-2"><ProviderIcon providerId={selectedProvider} size={40} /></div>
            <Loader size={20} className="animate-spin mb-4" style={{ color: '#2DB87A' }} />
            <h2 className={`text-sm font-semibold ${t.colors.text} mb-1`}>Connecting {providerName}...</h2>
            <p className={`text-xs ${t.colors.textMuted} leading-relaxed max-w-[220px]`}>
              A browser window has opened. Sign in and grant access.
            </p>
            <button onClick={() => setStep('pick')} className={`mt-5 text-xs ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}>Cancel</button>
          </div>
        )}

        {/* ── Success ── */}
        {step === 'success' && (
          <div className="p-6 flex flex-col items-center text-center">
            <CheckCircle size={36} className="mb-3 mt-1" style={{ color: '#2DB87A' }} />
            <h2 className={`text-sm font-semibold ${t.colors.text} mb-1`}>
              {selectedProvider === 'website_watcher' ? 'Watcher added' : 'Account connected'}
            </h2>
            <p className={`text-xs ${t.colors.textMuted} mb-1 break-all max-w-[260px]`}>{connectedEmail}</p>
            <p className={`text-xs ${t.colors.textMuted} leading-relaxed max-w-[240px] mb-5`}>
              {selectedProvider === 'website_watcher'
                ? 'Your assistant will monitor this page for changes and notify you.'
                : 'Your assistant can now access this account. Ask it anything in the chat.'}
            </p>
            <button onClick={onClose} className="px-5 py-2 rounded-lg text-sm font-medium text-white" style={{ background: '#2DB87A' }}>Done</button>
          </div>
        )}

        {/* ── Error ── */}
        {step === 'error' && (
          <div className="p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className={`text-sm font-semibold ${t.colors.text} mb-1`}>Connection failed</h2>
                <p className={`text-xs ${t.colors.textMuted} leading-relaxed`}>{errorMessage}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleProviderPick(selectedProvider)}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white" style={{ background: '#2DB87A' }}>Try again</button>
              <button onClick={() => setStep('pick')}
                className={`flex-1 py-2 rounded-lg text-sm ${t.colors.textMuted} ${t.colors.bgSecondary} ${t.colors.border} border`}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConnectAccountModal;