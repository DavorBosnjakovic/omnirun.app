// ============================================================
// AccountsPanel.tsx
// ============================================================
// Left panel in the Assistant section.
// Shows connected accounts grouped by category (Email, Calendar,
// Messaging, Development, Productivity, Monitoring), with connect
// buttons for available providers. Plan-gated for account limits.
//
// Only shows providers where available: true (per ASSISTANT_PROVIDERS).
// Coming-soon providers are hidden entirely per spec decision.

import { useState } from 'react';
import { Mail, Plus, Trash2, Pencil, Check, X, AlertCircle, ChevronDown, ChevronRight, Calendar, MessageSquare, GitBranch, BookOpen, Globe } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { themes } from '../../config/themes';
import {
  useAssistantStore,
  ASSISTANT_PROVIDERS,
  selectEmailAccounts,
  selectCanAddEmailAccount,
  getEmailAccountLimit,
  selectTotalActiveAccounts,
  selectCanAddIntegration,
  getIntegrationLimit,
  type ProviderDefinition,
  type ProviderCategory,
} from '../../stores/assistantStore';
import { getSupabase } from '../../services/supabaseClient';
import ProviderIcon from './ProviderIcons';

interface AccountsPanelProps {
  plan: string;
  userId: string;
}

// ─── Category icons ───────────────────────────────────────────
// Maps each category label to its Lucide icon component.

const CATEGORY_ICONS: Record<ProviderCategory, any> = {
  Email: Mail,
  Calendar: Calendar,
  Messaging: MessageSquare,
  Development: GitBranch,
  Productivity: BookOpen,
  Monitoring: Globe,
};

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

  const isWatcher = account.provider === 'website_watcher';
  const displayText = account.accountLabel || (isWatcher ? account.displayName : account.email);
  const subText = account.accountLabel
    ? account.email
    : (isWatcher ? account.email : account.displayName);

  return (
    <div
      className={`group flex items-start gap-2 px-3 py-2 rounded-md mx-2 mb-1 ${t.colors.bgTertiary} hover:opacity-90 transition-opacity`}
    >
      <ProviderIcon providerId={account.provider} size={22} />
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${t.colors.text}`} title={displayText ?? ''}>
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

  // Email-specific gating (emails have their own sub-limit)
  const canAddEmail = selectCanAddEmailAccount(accounts, plan);

  // Total integration gating
  const totalAccounts = selectTotalActiveAccounts(accounts);
  const canAddIntegration = selectCanAddIntegration(accounts, plan);
  const integrationLimit = getIntegrationLimit(plan);

  // Only show providers that are available (built)
  const availableProviders = ASSISTANT_PROVIDERS.filter((p) => p.available);

  // Ordered category list
  const categories: ProviderCategory[] = ['Email', 'Calendar', 'Messaging', 'Development', 'Productivity', 'Monitoring'];

  // Group connected accounts by category for the "connected" section
  const accountsByCategory = categories.map((cat) => {
    const providerIds = ASSISTANT_PROVIDERS.filter((p) => p.category === cat).map((p) => p.id);
    const catAccounts = accounts.filter((a) => a.isActive && providerIds.includes(a.provider));
    return { category: cat, accounts: catAccounts };
  }).filter((g) => g.accounts.length > 0);

  // Group available providers by category for the "connect" section
  const providersByCategory = categories.map((cat) => ({
    category: cat,
    providers: availableProviders.filter((p) => p.category === cat),
  })).filter((g) => g.providers.length > 0);

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

  // Determine if a specific provider can be connected right now
  const canConnectProvider = (provider: ProviderDefinition): boolean => {
    // Check total integration limit first
    if (!canAddIntegration) return false;
    // Email providers have their own additional sub-limit
    if (provider.providerType === 'email' && !canAddEmail) return false;
    return true;
  };

  // Plan limit badge text
  const limitText =
    integrationLimit === Infinity
      ? null
      : `${totalAccounts}/${integrationLimit}`;

  const hasAnyAccounts = accounts.filter((a) => a.isActive).length > 0;

  return (
    <div className="py-2">

      {/* ── Connected accounts (grouped by category) ── */}
      {accountsLoading ? (
        <div className={`px-3 py-2 text-xs ${t.colors.textMuted}`}>Loading...</div>
      ) : !hasAnyAccounts ? (
        <div className={`px-3 py-4 mx-2 rounded-md border border-dashed ${t.colors.border} text-center mb-2`}>
          <Mail size={16} className={`mx-auto mb-1.5 ${t.colors.textMuted}`} />
          <p className={`text-[10px] ${t.colors.textMuted} leading-relaxed`}>No accounts connected yet</p>
        </div>
      ) : (
        accountsByCategory.map(({ category, accounts: catAccounts }) => {
          const Icon = CATEGORY_ICONS[category];
          return (
            <div key={category} className="mb-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5">
                {Icon && <Icon size={10} className={t.colors.textMuted} />}
                <span className={`text-[10px] font-medium uppercase tracking-wider ${t.colors.textMuted}`}>
                  {category}
                </span>
              </div>
              <div>
                {catAccounts.map((account) => (
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
            </div>
          );
        })
      )}

      {/* ── Plan limit warning ── */}
      {!canAddIntegration && integrationLimit !== Infinity && (
        <div className={`mx-3 mb-3 px-2 py-1.5 rounded-md flex items-start gap-1.5`}
          style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}
        >
          <AlertCircle size={11} className="text-yellow-500 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-yellow-600 dark:text-yellow-400 leading-snug">
            {integrationLimit} integration limit on {plan} plan. Upgrade to add more.
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
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${t.colors.textMuted}`}>
                Connect
              </span>
              {limitText && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.colors.bgTertiary} ${t.colors.textMuted}`}>
                  {limitText}
                </span>
              )}
            </div>
            {connectSectionOpen
              ? <ChevronDown size={11} className={t.colors.textMuted} />
              : <ChevronRight size={11} className={t.colors.textMuted} />
            }
          </button>

          {connectSectionOpen && (
            <div className="pb-1">
              {providersByCategory.map(({ category, providers }, idx) => {
                const Icon = CATEGORY_ICONS[category];
                return (
                  <div key={category} className={idx > 0 ? 'mt-3' : ''}>
                    {/* Category sub-header */}
                    <div className="flex items-center gap-1.5 px-3 py-1">
                      {Icon && <Icon size={9} className={`${t.colors.textMuted} opacity-60`} />}
                      <span className={`text-[9px] font-medium uppercase tracking-wider ${t.colors.textMuted} opacity-60`}>
                        {category}
                      </span>
                    </div>

                    {/* Provider buttons */}
                    {providers.map((provider) => {
                      const canConnect = canConnectProvider(provider);

                      return (
                        <button
                          key={provider.id}
                          onClick={() => canConnect && openConnectModal(provider.id)}
                          disabled={!canConnect}
                          className={`flex items-center gap-2 w-full px-3 py-1.5 mx-0 text-left transition-opacity ${
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