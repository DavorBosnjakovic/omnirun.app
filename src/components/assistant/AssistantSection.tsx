// ============================================================
// AssistantSection.tsx
// ============================================================
// Top-level layout for the Assistant section.
// Option B layout: collapsible accounts panel on the left,
// chat area on the right.
//
// Responsible for:
// - Loading + syncing accounts on mount
// - Passing plan info down to AccountsPanel for gating
// - Rendering ConnectAccountModal when open
// - Panel collapse/expand state

import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeft, Brain } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { themes } from '../../config/themes';
import {
  useAssistantStore,
} from '../../stores/assistantStore';
import AccountsPanel from './AccountsPanel';
import AssistantChatArea from './AssistantChatArea';
import ConnectAccountModal from './ConnectAccountModal';
import AboutMePanel from './AboutMePanel';

function AssistantSection() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeView, setActiveView] = useState<'chat' | 'aboutme'>('chat');

  const { theme } = useSettingsStore();
  const t = themes[theme];

  const { user, profile } = useAuthStore();
  const plan = profile?.plan ?? 'starter';

  const {
    loadAccounts,
    syncAccountsFromSupabase,
    connectModalOpen,
    closeConnectModal,
    connectingProvider,
  } = useAssistantStore();

  // Load cached accounts instantly, then sync from Supabase in background
  useEffect(() => {
    if (!user?.id) return;

    loadAccounts(user.id).then(() => {
      syncAccountsFromSupabase(user.id);
    });
  }, [user?.id]);

  return (
    <div className={`flex-1 flex overflow-hidden ${t.colors.bg}`}>

      {/* ── Accounts panel ── */}
      {panelOpen ? (
        <div
          className={`flex flex-col flex-shrink-0 ${t.colors.bgSecondary} ${t.colors.border} border-r`}
          style={{ width: 220 }}
        >
          {/* Panel header */}
          <div className={`flex items-center justify-between px-3 py-3 ${t.colors.border} border-b flex-shrink-0`}>
            <span className={`text-xs font-medium uppercase tracking-wider ${t.colors.textMuted}`}>
              Integrations
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveView(activeView === 'chat' ? 'aboutme' : 'chat')}
                className={`p-1 ${activeView === 'aboutme' ? t.colors.text : t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                title={activeView === 'aboutme' ? 'Back to chat' : 'About me — what AI knows about you'}
              >
                <Brain size={15} />
              </button>
              <button
                onClick={() => setPanelOpen(false)}
                className={`p-1 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                title="Collapse panel"
              >
                <PanelLeftClose size={15} />
              </button>
            </div>
          </div>

          {/* Scrollable accounts list */}
          <div className="flex-1 overflow-y-auto">
            <AccountsPanel plan={plan} userId={user?.id ?? ''} />
          </div>
        </div>
      ) : (
        /* Collapsed panel — thin strip with re-open button */
        <div
          className={`flex flex-col items-center flex-shrink-0 ${t.colors.bgSecondary} ${t.colors.border} border-r`}
          style={{ width: 40 }}
        >
          <button
            onClick={() => setPanelOpen(true)}
            className={`h-10 w-full flex items-center justify-center ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
            title="Open integrations panel"
          >
            <PanelLeft size={15} />
          </button>
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeView === 'chat' ? (
          <AssistantChatArea plan={plan} />
        ) : (
          <AboutMePanel onClose={() => setActiveView('chat')} />
        )}
      </div>

      {/* ── Connect account modal ── */}
      {connectModalOpen && (
        <ConnectAccountModal
          userId={user?.id ?? ''}
          plan={plan}
          initialProvider={connectingProvider ?? undefined}
          onClose={closeConnectModal}
        />
      )}
    </div>
  );
}

export default AssistantSection;