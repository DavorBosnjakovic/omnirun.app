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

import { useEffect, useState, useCallback, useRef } from 'react';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { themes } from '../../config/themes';
import {
  useAssistantStore,
} from '../../stores/assistantStore';
import { loadScreenControlSettings } from '../../services/screenControlService';
import AccountsPanel from './AccountsPanel';
import AssistantChatArea from './AssistantChatArea';
import ConnectAccountModal from './ConnectAccountModal';
import AboutMePanel from './AboutMePanel';
import ScreenControlOverlay from './ScreenControlOverlay';
import type { ScreenControlStatus } from './ScreenControlOverlay';

function AssistantSection() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeView, setActiveView] = useState<'chat' | 'aboutme'>('chat');

  // Screen control state — driven by AssistantChatArea during control loop
  const [screenControlActive, setScreenControlActive] = useState(false);
  const [screenControlMode, setScreenControlMode] = useState(false);
  const [screenControlStatus, setScreenControlStatus] = useState<ScreenControlStatus>('idle');
  const [screenControlStep, setScreenControlStep] = useState(0);
  const [screenControlAction, setScreenControlAction] = useState('');
  const screenControlStopRef = useRef(false);

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

  // Check if screen control feature is enabled
  const screenControlEnabled = loadScreenControlSettings().enabled;

  // Load cached accounts instantly, then sync from Supabase in background
  useEffect(() => {
    if (!user?.id) return;

    loadAccounts(user.id).then(() => {
      syncAccountsFromSupabase(user.id);
    });
  }, [user?.id]);

  // Stop handler for the overlay — exits screen control mode entirely
  const handleScreenControlStop = useCallback(() => {
    screenControlStopRef.current = true;
    setScreenControlActive(false);
    setScreenControlMode(false);
    setScreenControlStatus('idle');
    setScreenControlStep(0);
    setScreenControlAction('');
  }, []);

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
            <button
              onClick={() => setPanelOpen(false)}
              className={`p-1 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
              title="Collapse panel"
            >
              <PanelLeftClose size={15} />
            </button>
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
          <AssistantChatArea
            plan={plan}
            onToggleAboutMe={() => setActiveView(activeView === 'chat' ? 'aboutme' : 'chat')}
            activeView={activeView}
            screenControlEnabled={screenControlEnabled}
            screenControlMode={screenControlMode}
            onScreenControlModeChange={(active) => { setScreenControlMode(active); setScreenControlActive(active); }}
            onScreenControlStart={() => { screenControlStopRef.current = false; setScreenControlActive(true); }}
            onScreenControlEnd={() => { setScreenControlActive(false); setScreenControlMode(false); setScreenControlStatus('idle'); setScreenControlStep(0); setScreenControlAction(''); }}
            onScreenControlStatus={(status, step, action) => { setScreenControlStatus(status); if (step !== undefined) setScreenControlStep(step); if (action !== undefined) setScreenControlAction(action); }}
            screenControlStopRef={screenControlStopRef}
          />
        ) : (
          <AboutMePanel onClose={() => setActiveView('chat')} />
        )}
      </div>

      {/* ── Screen control overlay (floating bar when in screen control mode) ── */}
      {(screenControlActive || screenControlMode) && (
        <ScreenControlOverlay
          status={screenControlStatus}
          stepCount={screenControlStep}
          currentAction={screenControlAction}
          onStop={handleScreenControlStop}
        />
      )}

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