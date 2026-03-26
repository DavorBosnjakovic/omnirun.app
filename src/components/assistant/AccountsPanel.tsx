// ============================================================
// AccountsPanel.tsx
// ============================================================
// Left panel in the Assistant section.
// Shows connected accounts grouped by type, with connect buttons
// for available providers. Plan-gated for email account limits.
//
// Only shows providers where available: true (per ASSISTANT_PROVIDERS).
// Coming-soon providers are hidden entirely per spec decision.

import { useState } from 'react';
import { Mail, Plus, Trash2, Pencil, Check, X, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { themes } from '../../config/themes';
import {
  useAssistantStore,
  ASSISTANT_PROVIDERS,
  selectEmailAccounts,
  selectCanAddEmailAccount,
  selectEmailAccountsRemaining,
  getEmailAccountLimit,
  type ProviderDefinition,
} from '../../stores/assistantStore';
import { getSupabase } from '../../services/supabaseClient';

interface AccountsPanelProps {
  plan: string;
  userId: string;
}

// ─── Provider icon ────────────────────────────────────────────
// Simple colored initials badge per provider.
// Replace with real SVG logos when available.

function ProviderIcon({ providerId, size = 22 }: { providerId: string; size?: number }) {
  const configs: Record<string, { bg: string; text: string; label: string }> = {
    gmail: { bg: 'rgba(234,72,41,0.15)', text: '#EA4829', label: 'G' },
    outlook: { bg: 'rgba(0,114,239,0.15)', text: '#0072EF', label: 'O' },
    google_calendar: { bg: 'rgba(52,168,83,0.15)', text: '#34A853', label: 'C' },
    outlook_calendar: { bg: 'rgba(0,114,239,0.15)', text: '#0072EF', label: 'C' },
    slack: { bg: 'rgba(74,21,75,0.15)', text: '#4A154B', label: 'S' },
  };
  const cfg = configs[providerId] ?? { bg: 'rgba(100,100,100,0.15)', text: '#888', label: '?' };

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        background: cfg.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size * 0.5,
        fontWeight: 600,
        color: cfg.text,
      }}
    >
      {cfg.label}
    </div>
  );
}

// ─── Single connected account row ─────────────────────────────

function AccountRow({
  account,
  onEdit,
  onRemove,
}: {
  account: { id: string; provider: string; email: string; accountLabel: string | null; displayName: string | null };
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const [confirmDelete, setConfirmDelete] = useState(false);

  const displayText = account.accountLabel || account.email;
  const subText = account.accountLabel ? account.email : account.displayName;

  return (
    <div
      className={`group flex items-start gap-2 px-3 py-2 rounded-md mx-2 mb-1 ${t.colors.bgTertiary} hover:opacity-90 transition-opacity`}
    >
      <ProviderIcon providerId={account.provider} size={22} />
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${t.colors.text}`} title={displayText}>
          {displayText}
        </p>
        {subText && (
          <p className={`text-[10px] truncate ${t.colors.textMuted}`} title={subText}>
            {subText}
          </p>
        )}
      </div>

      {/* Action buttons — show on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {confirmDelete ? (
          <>
            <button
              onClick={() => onRemove(account.id)}
              className="p-0.5 text-red-400 hover:text-red-300 transition-colors"
              title="Confirm remove"
            >
              <Check size={12} />
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className={`p-0.5 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
              title="Cancel"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onEdit(account.id)}
              className={`p-0.5 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
              title="Edit label"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className={`p-0.5 ${t.colors.textMuted} hover:text-red-400 transition-colors`}
              title="Remove account"
            >
              <Trash2 size={11} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Inline label editor ──────────────────────────────────────

function LabelEditor({
  accountId,
  currentLabel,
  onDone,
}: {
  accountId: string;
  currentLabel: string | null;
  onDone: () => void;
}) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { updateAccountLabel } = useAssistantStore();
  const [value, setValue] = useState(currentLabel ?? '');

  const handleSave = async () => {
    if (value.trim()) {
      await updateAccountLabel(accountId, value.trim());
    }
    onDone();
  };

  return (
    <div className="px-3 py-2 mx-2 mb-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') onDone();
        }}
        placeholder="Account label..."
        className={`w-full text-xs px-2 py-1 ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} rounded focus:outline-none focus:ring-1 focus:ring-blue-500`}
      />
      <div className="flex gap-1 mt-1">
        <button
          onClick={handleSave}
          className="flex-1 text-[10px] py-0.5 rounded text-white"
          style={{ background: '#2DB87A' }}
        >
          Save
        </button>
        <button
          onClick={onDone}
          className={`flex-1 text-[10px] py-0.5 rounded ${t.colors.textMuted} ${t.colors.bgSecondary}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────

function AccountsPanel({ plan, userId }: AccountsPanelProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const {
    accounts,
    accountsLoading,
    removeAccount,
    openConnectModal,
    editingAccountId,
    setEditingAccount,
  } = useAssistantStore();

  const [connectSectionOpen, setConnectSectionOpen] = useState(true);

  const emailAccounts = selectEmailAccounts(accounts);
  const canAddEmail = selectCanAddEmailAccount(accounts, plan);
  const emailLimit = getEmailAccountLimit(plan);
  const emailRemaining = selectEmailAccountsRemaining(accounts, plan);

  // Only show providers that are available (built)
  const availableProviders = ASSISTANT_PROVIDERS.filter((p) => p.available);

  // Group available providers by type for future expansion
  const emailProviders = availableProviders.filter((p) => p.providerType === 'email');

  const handleRemove = async (id: string) => {
    // Delete from Supabase first
    try {
      await getSupabase()
        .from('assistant_email_accounts')
        .update({ is_active: false })
        .eq('id', id);
    } catch (err) {
      console.error('[AccountsPanel] Failed to deactivate account in Supabase:', err);
    }
    // Then remove from local cache + store
    await removeAccount(id, userId);
  };

  // Filter to providers not yet connected (to show in "Add" section)
  const connectedProviderIds = new Set(accounts.map((a) => a.provider));
  const unconnectedEmailProviders = emailProviders.filter(
    (p) => !accounts.some((a) => a.provider === p.id)
  );

  // Whether to show the "add more" section
  // Show if: there are unconnected providers AND user hasn't hit their limit
  const showAddSection = unconnectedEmailProviders.length > 0 && canAddEmail;

  // Plan limit badge text
  const limitText =
    emailLimit === Infinity
      ? null
      : `${emailAccounts.length}/${emailLimit}`;

  return (
    <div className="py-2">

      {/* ── Email accounts section ── */}
      <div className="mb-1">
        <div className={`flex items-center justify-between px-3 py-1.5`}>
          <span className={`text-[10px] font-medium uppercase tracking-wider ${t.colors.textMuted}`}>
            Email
          </span>
          {limitText && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.colors.bgTertiary} ${t.colors.textMuted}`}>
              {limitText}
            </span>
          )}
        </div>

        {accountsLoading ? (
          <div className={`px-3 py-2 text-xs ${t.colors.textMuted}`}>Loading...</div>
        ) : emailAccounts.length === 0 ? (
          <div className={`px-3 py-2 mx-2 rounded-md border border-dashed ${t.colors.border} text-center`}>
            <Mail size={16} className={`mx-auto mb-1 ${t.colors.textMuted}`} />
            <p className={`text-[10px] ${t.colors.textMuted}`}>No accounts connected</p>
          </div>
        ) : (
          <div>
            {emailAccounts.map((account) => (
              editingAccountId === account.id ? (
                <LabelEditor
                  key={account.id}
                  accountId={account.id}
                  currentLabel={account.accountLabel}
                  onDone={() => setEditingAccount(null)}
                />
              ) : (
                <AccountRow
                  key={account.id}
                  account={account}
                  onEdit={(id) => setEditingAccount(id)}
                  onRemove={handleRemove}
                />
              )
            ))}
          </div>
        )}
      </div>

      {/* ── Plan limit warning ── */}
      {!canAddEmail && emailLimit !== Infinity && (
        <div className={`mx-3 mb-3 px-2 py-1.5 rounded-md flex items-start gap-1.5`}
          style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}
        >
          <AlertCircle size={11} className="text-yellow-500 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-yellow-600 dark:text-yellow-400 leading-snug">
            {emailLimit} account limit on {plan} plan. Upgrade to add more.
          </p>
        </div>
      )}

      {/* ── Connect section ── */}
      {availableProviders.length > 0 && (
        <div>
          <button
            onClick={() => setConnectSectionOpen(!connectSectionOpen)}
            className={`flex items-center justify-between w-full px-3 py-1.5 text-left`}
          >
            <span className={`text-[10px] font-medium uppercase tracking-wider ${t.colors.textMuted}`}>
              Connect
            </span>
            {connectSectionOpen
              ? <ChevronDown size={11} className={t.colors.textMuted} />
              : <ChevronRight size={11} className={t.colors.textMuted} />
            }
          </button>

          {connectSectionOpen && (
            <div className="pb-1">
              {emailProviders.map((provider) => {
                const isConnected = connectedProviderIds.has(provider.id);
                // Users can connect multiple accounts of the same provider
                // as long as they haven't hit the plan limit
                const canConnect = canAddEmail;

                return (
                  <button
                    key={provider.id}
                    onClick={() => canConnect && openConnectModal(provider.id)}
                    disabled={!canConnect}
                    className={`flex items-center gap-2 w-full px-3 py-2 mx-0 text-left transition-opacity ${
                      canConnect
                        ? `hover:${t.colors.bgTertiary} cursor-pointer`
                        : 'opacity-40 cursor-not-allowed'
                    }`}
                    title={
                      !canConnect
                        ? `Upgrade your plan to connect more accounts`
                        : `Connect ${provider.label}`
                    }
                  >
                    <ProviderIcon providerId={provider.id} size={20} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${t.colors.text}`}>{provider.label}</p>
                      <p className={`text-[10px] ${t.colors.textMuted} truncate`}>
                        {provider.description}
                      </p>
                    </div>
                    {canConnect && (
                      <Plus size={13} className={t.colors.textMuted} />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AccountsPanel;