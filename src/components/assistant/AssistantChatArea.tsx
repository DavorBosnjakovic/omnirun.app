// ============================================================
// AssistantChatArea.tsx
// ============================================================
// Chat interface for the Assistant section.
// Screen control loop with smart monitor handling, omni-files
// app launching, playlist creation, kill switch.

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, Bot, Trash2, MessageSquarePlus, Zap, Brain, Monitor } from 'lucide-react';
import { fetch } from '@tauri-apps/plugin-http';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { themes } from '../../config/themes';
import {
  useAssistantStore,
  ASSISTANT_PROVIDERS,
} from '../../stores/assistantStore';
import { sendMessage } from '../../services/aiService';
import { buildScreenControlPrompt } from '../../services/aiService';
import { useUsageStore } from '../../stores/usageStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { buildMemoryBlock, extractObservations } from '../../services/memoryService';
import { buildRoutinesPromptBlock } from '../../stores/routineStore';
import {
  takeScreenshot,
  loadScreenControlSettings,
  parseScreenAction,
  executeScreenAction,
  getActiveWindow,
  getScreenSize,
  buildUserContextPrompt,
  isBlockedApp,
  matchFileFromOmniFiles,
  getOmniFilesPath,
  launchApp,
  createPlaylist,
  listMonitors,
  getAppsMonitorIndex,
  isSingleMonitor,
} from '../../services/screenControlService';
import type { ScreenControlStatus } from './ScreenControlOverlay';
import MarkdownRenderer from '../chat/MarkdownRenderer';
import OmnirunSpinner from '../chat/OmnirunSpinner';
import VoiceButton from '../voice/VoiceButton';
import VoiceTranscriptOverlay from '../voice/VoiceTranscriptOverlay';
import elipseDark from '../../assets/elipse_transparent_dark.svg';
import elipseLight from '../../assets/elipse_transparent_light.svg';

let globalShortcutRegistered = false;

interface AssistantChatAreaProps {
  plan: string;
  onToggleAboutMe: () => void;
  activeView: 'chat' | 'aboutme';
  screenControlEnabled?: boolean;
  screenControlMode?: boolean;
  onScreenControlModeChange?: (active: boolean) => void;
  onScreenControlStart?: () => void;
  onScreenControlEnd?: () => void;
  onScreenControlStatus?: (status: ScreenControlStatus, step?: number, action?: string) => void;
  screenControlStopRef?: { current: boolean };
}

// ─── System prompt ────────────────────────────────────────────

function buildSystemPrompt(
  accounts: { provider: string; email: string; accountLabel: string | null; providerType: string }[]
): string {
  const byType = (type: string) => accounts.filter((a) => {
    const def = ASSISTANT_PROVIDERS.find((p) => p.id === a.provider);
    return def?.providerType === type;
  });

  const emailAccounts = byType('email');
  const calendarAccounts = byType('calendar');
  const messagingAccounts = byType('messaging');
  const devAccounts = byType('dev');
  const knowledgeAccounts = byType('knowledge');
  const taskAccounts = byType('tasks');
  const watchers = accounts.filter((a) => a.provider === 'website_watcher');

  const formatList = (items: typeof accounts) =>
    items.map((a) => `- ${a.accountLabel || a.email} (${a.provider}: ${a.email})`).join('\n');

  let connectionsBlock = '';

  if (accounts.length > 0) {
    connectionsBlock += '\nThe user has connected the following integrations:\n';
    if (emailAccounts.length > 0) connectionsBlock += `\nEmail accounts:\n${formatList(emailAccounts)}`;
    if (calendarAccounts.length > 0) connectionsBlock += `\nCalendars:\n${formatList(calendarAccounts)}`;
    if (messagingAccounts.length > 0) connectionsBlock += `\nMessaging:\n${formatList(messagingAccounts)}`;
    if (devAccounts.length > 0) connectionsBlock += `\nDevelopment:\n${formatList(devAccounts)}`;
    if (knowledgeAccounts.length > 0) connectionsBlock += `\nKnowledge:\n${formatList(knowledgeAccounts)}`;
    if (taskAccounts.length > 0) connectionsBlock += `\nTask management:\n${formatList(taskAccounts)}`;
    if (watchers.length > 0) connectionsBlock += `\nWebsite watchers:\n${watchers.map((w) => `- ${w.accountLabel || w.email}`).join('\n')}`;
  } else {
    connectionsBlock = '\nThe user has not connected any accounts yet. If they ask about emails, calendar, or other integrations, encourage them to connect an account using the panel on the left.';
  }

  const capabilities: string[] = [];
  if (emailAccounts.length > 0) capabilities.push('Summarize unread or important emails', 'Draft and send email replies in the user\'s voice', 'Flag urgent emails and suggest actions');
  if (calendarAccounts.length > 0) capabilities.push('Show today\'s schedule and upcoming events', 'Warn about scheduling conflicts', 'Help schedule or reschedule meetings');
  if (messagingAccounts.length > 0) capabilities.push('Surface important Slack/Discord messages the user missed', 'Summarize busy channels', 'Draft and send replies');
  if (devAccounts.length > 0) capabilities.push('Notify about new PRs, issues, and review requests', 'Summarize repo activity');
  if (knowledgeAccounts.length > 0) capabilities.push('Search and reference the user\'s Notion pages');
  if (taskAccounts.length > 0) capabilities.push('Show and manage Todoist tasks', 'Create, complete, or reschedule tasks');
  if (watchers.length > 0) capabilities.push('Report on changes detected on watched websites');
  if (capabilities.length === 0) capabilities.push('Help the user once they connect their accounts', 'Answer general questions');

  return `You are a personal AI assistant integrated into Omnirun, a desktop productivity app.

Your role is to help the user manage their personal communications, schedule, and productivity tools — not to write code or build software (that is handled in the Projects section).
${connectionsBlock}

Your capabilities:
${capabilities.map((c) => `- ${c}`).join('\n')}

Guidelines:
- Be concise and direct — the user is busy
- When drafting emails, match the user's tone from their existing messages
- Always confirm before sending anything on behalf of the user
- If you cannot take an action yet (e.g. a service is not connected), say so clearly and suggest connecting it
- Never make up content — only work with what the user tells you or what the APIs return
- For morning briefs, prioritize: urgent emails, today's calendar, failed tasks, then everything else`;
}

// ─── Suggestions ──────────────────────────────────────────────

function getSuggestions(accounts: any[]): string[] {
  const hasEmail = accounts.some((a) => ['gmail', 'outlook'].includes(a.provider));
  const hasCalendar = accounts.some((a) => ['google_calendar', 'outlook_calendar'].includes(a.provider));
  const hasMessaging = accounts.some((a) => ['slack', 'discord'].includes(a.provider));
  const hasDev = accounts.some((a) => a.provider === 'github');
  const hasTasks = accounts.some((a) => a.provider === 'todoist');
  const hasWatcher = accounts.some((a) => a.provider === 'website_watcher');

  const suggestions: string[] = [];
  if (hasEmail || hasCalendar) suggestions.push('Give me a morning brief');
  if (hasEmail) suggestions.push('What emails need my attention today?');
  if (hasCalendar) suggestions.push("What's on my calendar today?");
  if (hasMessaging) suggestions.push('What did I miss on Slack?');
  if (hasDev) suggestions.push('Any new PRs or issues?');
  if (hasTasks) suggestions.push("What's on my to-do list?");
  if (hasWatcher) suggestions.push('Any changes on my watched pages?');
  return suggestions.slice(0, 4);
}

// ─── Screen control patterns ─────────────────────────────────

const SCREEN_CONTROL_PATTERNS = [
  /\b(open|launch|start|run)\s+(app|application|program|software|notepad|terminal|finder|explorer|photoshop|figma|excel|word|outlook|slack|discord|spotify|chrome|firefox|safari|edge|brave|vscode|code|sublime|atom)\b/i,
  /\b(close|quit|exit|kill)\s+(all\s+)?(tabs?|windows?|app|application|browser)\b/i,
  /\b(click|press|tap)\s+(on|the)\b/i,
  /\bset\s+(my\s+)?(system\s+)?(volume|brightness|display|resolution)\b/i,
  /\b(enable|disable|turn\s+on|turn\s+off)\s+(do\s+not\s+disturb|dark\s+mode|night\s+mode|wifi|bluetooth|airplane)\b/i,
  /\b(minimize|maximize|resize|move|arrange|snap)\s+(the\s+)?(window|app)\b/i,
  /\b(take\s+a\s+)?screenshot\b/i,
  /\bcontrol\s+(my\s+)?(screen|computer|desktop)\b/i,
  /\bwhat('s| is)\s+on\s+(my\s+)?screen\b/i,
  /\bwhat\s+am\s+i\s+looking\s+at\b/i,
  /\b(scroll|drag|swipe)\s+(up|down|left|right)/i,
  /\b(go\s+to|navigate\s+to|switch\s+to|focus)\s+/i,
  /\b(copy|paste|cut|undo|redo|save|select\s+all)\b/i,
  /\b(right[- ]?click|double[- ]?click)\b/i,
];

function isScreenControlRequest(message: string): boolean {
  return SCREEN_CONTROL_PATTERNS.some((p) => p.test(message));
}

// ─── Screen control system prompt ─────────────────────────────

const SCREEN_CONTROL_SYSTEM_PROMPT = `You are a desktop automation agent. You see the user's screen via screenshots and control it.

RESPONSE FORMAT — EXACT, every time:

OBSERVATION: [one sentence about what you see]
ACTION: [one action]

Actions: CLICK x y | DOUBLE_CLICK x y | RIGHT_CLICK x y | TYPE text | KEY combo | SCROLL up/down amount | WAIT seconds | DONE | FAIL reason

CRITICAL RULES:
- Exactly two lines: OBSERVATION + ACTION. Nothing else.
- No explanations, questions, or commentary.
- Coordinates are screenshot pixel space.
- ONE action per response. Never combine multiple actions.

CLICKING AND TYPING:
- When you need to type in a text field: CLICK it ONCE, then in the NEXT step use TYPE.
- NEVER click the same area more than twice. If two clicks didn't work, try a different approach (KEY tab, CLICK a different spot, etc).
- If you clicked an input field and it looks focused (cursor visible or field highlighted), TYPE immediately. Do not click again.
- After using TYPE, do NOT retype. Move to the next step of the task.

MULTI-MONITOR:
- Screenshots may show MULTIPLE monitors combined into one wide image.
- The full image represents the entire virtual desktop across all screens.
- Apps can appear on any part of the image — left side, right side, or spanning both.
- Use coordinates relative to the full screenshot image.

APP HANDLING:
- We attempted to pre-launch the app for you. Check the screenshot to see if it's open.
- If you can see the app window, click directly on the WINDOW. Do NOT click taskbar icons — they are tiny and you will misclick the wrong app.
- If the app is not visible, use KEY alt+tab to cycle windows and find it.
- Do NOT open Start menu, search, or try to launch any app yourself. We handle app launching.
- After task is done: ACTION: DONE

SAFETY:
- You MAY click send/submit buttons for messages and chats.
- NEVER enter passwords or interact with payment/banking screens.
- If unexpected popup/error: ACTION: FAIL with reason.

Examples:

OBSERVATION: Desktop with Notepad in taskbar at (450, 1060).
ACTION: CLICK 450 1060

OBSERVATION: Notepad is open with empty document and cursor blinking in the text area.
ACTION: TYPE hello world

OBSERVATION: Text "hello world" has been typed in Notepad.
ACTION: DONE

OBSERVATION: Viber chat with contact open. Message input field at bottom shows "Type a message..." placeholder.
ACTION: CLICK 1800 674

OBSERVATION: Message input field is now active with cursor blinking.
ACTION: TYPE ovo ti omnirun salje bre

OBSERVATION: Message "ovo ti omnirun salje bre" is typed in the input field. I can see the send button.
ACTION: CLICK 400 674

OBSERVATION: Message has been sent successfully. The chat shows the sent message.
ACTION: DONE

OBSERVATION: Error dialog "Application not responding" appeared.
ACTION: FAIL Application not responding.`;

async function sendScreenControlMessage(
  messages: { role: 'user' | 'assistant'; content: any }[],
  apiKey: string,
  model: string,
  systemPrompt: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      model,
      max_tokens: 150,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API Error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return {
    text: data.content?.[0]?.text || '',
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}

// ─── Clean AI response ────────────────────────────────────────

function cleanAiResponse(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
  cleaned = cleaned.replace(/<tool_call>[\s\S]*$/g, '').trim();
  cleaned = cleaned.replace(/<screenshot_base64>[\s\S]*?<\/screenshot_base64>/g, '').trim();
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

// ─── Empty state ──────────────────────────────────────────────

function EmptyState({
  hasAccounts,
  onConnect,
  accounts,
  onSuggestion,
  theme: t,
  screenControlEnabled,
  onScreenControlEnable,
}: {
  hasAccounts: boolean;
  onConnect: () => void;
  accounts: any[];
  onSuggestion: (text: string) => void;
  theme: any;
  screenControlEnabled?: boolean;
  onScreenControlEnable?: () => void;
}) {
  if (hasAccounts) {
    const suggestions = getSuggestions(accounts);
    return (
      <div className={`${t.colors.textMuted} text-center mt-12 px-6`}>
        <Bot size={32} className="mx-auto mb-3 opacity-40" />
        <p className="text-sm font-medium mb-1">Your personal assistant is ready</p>
        <p className="text-xs leading-relaxed opacity-70">
          Ask about your emails, calendar, messages, tasks, or anything else you've connected.
        </p>
        {suggestions.length > 0 && (
          <div className="mt-6 text-left mx-auto max-w-xs space-y-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => onSuggestion(suggestion)}
                className={`w-full text-left text-xs px-3 py-2 rounded-lg ${t.colors.bgSecondary} ${t.colors.border} border hover:opacity-80 transition-opacity ${t.colors.textMuted}`}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="text-center mt-12 px-6 max-w-sm mx-auto">
      <div
        className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
        style={{ background: 'rgba(45,184,122,0.12)', border: '1px solid rgba(45,184,122,0.25)' }}
      >
        <Zap size={24} style={{ color: '#2DB87A' }} />
      </div>
      <p className={`text-sm font-medium mb-2 ${t.colors.text}`}>Connect your first account</p>
      <p className={`text-xs leading-relaxed mb-5 ${t.colors.textMuted}`}>
        Connect Gmail, Calendar, Slack, GitHub, or any of your accounts and your assistant will help you manage them all from one place.
      </p>
      <button
        onClick={onConnect}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: '#2DB87A' }}
      >
        Connect an account
      </button>

      {/* Screen control option */}
      {screenControlEnabled && onScreenControlEnable && (
        <div className="mt-8">
          <div className={`flex items-center gap-3 mb-3`}>
            <div className={`flex-1 h-px ${t.colors.border}`} style={{ borderTop: '1px solid' }} />
            <span className={`text-[10px] uppercase tracking-wider ${t.colors.textMuted}`}>or</span>
            <div className={`flex-1 h-px ${t.colors.border}`} style={{ borderTop: '1px solid' }} />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <Monitor size={16} style={{ color: '#2DB87A' }} />
            <span className={`text-sm font-medium ${t.colors.text}`}>Control your desktop</span>
          </div>
          <p className={`text-xs leading-relaxed mb-4 ${t.colors.textMuted}`}>
            Let AI see your screen and control apps with mouse and keyboard. Open apps, click buttons, type text — hands free.
          </p>
          <button
            onClick={onScreenControlEnable}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text}`}
          >
            <span className="flex items-center gap-2 justify-center">
              <Monitor size={14} />
              Turn on Screen Control
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────

function AssistantChatArea({
  plan,
  onToggleAboutMe,
  activeView,
  screenControlEnabled,
  screenControlMode,
  onScreenControlModeChange,
  onScreenControlStart,
  onScreenControlEnd,
  onScreenControlStatus,
  screenControlStopRef,
}: AssistantChatAreaProps) {
  const [input, setInput] = useState('');
  const stoppedRef = useRef(false);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { theme, timeFormat, fontSize } = useSettingsStore();
  const t = themes[theme];

  const {
    messages,
    isLoading,
    accounts,
    addMessage,
    setLoading,
    clearMessages,
    openConnectModal,
  } = useAssistantStore();

  const activeAccounts = accounts.filter((a) => a.isActive);
  const hasAccounts = activeAccounts.length > 0;

  const { user, profile } = useAuthStore();
  const [avatarError, setAvatarError] = useState(false);
  const avatarUrl = profile?.avatar_url || null;
  const showAvatar = avatarUrl && !avatarError;

  useEffect(() => { setAvatarError(false); }, [profile?.avatar_url]);

  const getInitials = () => {
    const name = user?.displayName || profile?.display_name || user?.email || '';
    if (!name) return '?';
    const parts = name.split(/[\s@]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Kill switch ─────────────────────────────────────────────
  useEffect(() => {
    if (!screenControlEnabled) return;
    let cleanedUp = false;

    const registerKillSwitch = async () => {
      try {
        const { register, unregister } = await import('@tauri-apps/plugin-global-shortcut');
        const hotkey = loadScreenControlSettings().killSwitchKey || 'F10';
        try { await unregister(hotkey); } catch {}
        await register(hotkey, (event: any) => {
          if (event.state === 'Pressed' && !cleanedUp) {
            if (screenControlStopRef) screenControlStopRef.current = true;
            onScreenControlModeChange?.(false);
            onScreenControlEnd?.();
          }
        });
        globalShortcutRegistered = true;
      } catch (err) {
        console.warn('[ScreenControl] Kill switch failed:', err);
      }
    };
    registerKillSwitch();
    return () => {
      cleanedUp = true;
      if (globalShortcutRegistered) {
        import('@tauri-apps/plugin-global-shortcut').then(({ unregister }) => {
          unregister(loadScreenControlSettings().killSwitchKey || 'F10').catch(() => {});
          globalShortcutRegistered = false;
        }).catch(() => {});
      }
    };
  }, [screenControlEnabled]);

  // ── Screen control provider ─────────────────────────────────
  const getScreenControlProvider = () => {
    const activeProviderId = localStorage.getItem('ai-active-provider') || 'anthropic';
    const savedProviders = localStorage.getItem('ai-providers');
    if (!savedProviders) return null;
    const providers = JSON.parse(savedProviders);
    const config = providers.find((p: any) => p.providerId === activeProviderId);
    if (!config || !config.apiKey) return null;

    const scSettings = loadScreenControlSettings();
    let model = config.selectedModel;
    if (activeProviderId === 'anthropic') {
      if (scSettings.modelPreference === 'opus') model = 'claude-opus-4-6';
      else if (scSettings.modelPreference === 'sonnet') model = 'claude-sonnet-4-5-20250929';
      else if (scSettings.modelPreference === 'haiku') model = 'claude-haiku-4-5-20251001';
      else model = 'claude-sonnet-4-5-20250929';
    }
    return { id: activeProviderId, apiKey: config.apiKey, model };
  };

  // ── Normal chat provider (Haiku) ────────────────────────────
  const getActiveProvider = () => {
    const activeProviderId = localStorage.getItem('ai-active-provider') || 'anthropic';
    const savedProviders = localStorage.getItem('ai-providers');
    if (!savedProviders) return null;
    const providers = JSON.parse(savedProviders);
    const config = providers.find((p: any) => p.providerId === activeProviderId);
    if (!config || !config.apiKey) return null;
    let model = config.selectedModel;
    if (activeProviderId === 'anthropic' && model && !/haiku/i.test(model)) model = 'claude-haiku-4-5-20251001';
    return { id: activeProviderId, apiKey: config.apiKey, model };
  };

  const getActiveProviderDisplay = () => {
    const activeProviderId = localStorage.getItem('ai-active-provider') || 'anthropic';
    const savedProviders = localStorage.getItem('ai-providers');
    if (!savedProviders) return 'No provider';
    const providers = JSON.parse(savedProviders);
    const config = providers.find((p: any) => p.providerId === activeProviderId);
    if (!config) return 'No provider';
    const names: Record<string, string> = { anthropic: 'Claude', groq: 'Groq', openai: 'OpenAI', google: 'Gemini', ollama: 'Ollama' };
    let selectedModel = config.selectedModel ?? '';
    if (activeProviderId === 'anthropic' && !/haiku/i.test(selectedModel)) selectedModel = 'claude-haiku-4-5-20251001';
    const model = selectedModel.split('-').slice(0, 2).join(' ') || '';
    return `${names[activeProviderId] || activeProviderId} \u2022 ${model}`;
  };

  const handleStop = () => {
    if (screenControlMode && screenControlStopRef) {
      screenControlStopRef.current = true;
      onScreenControlModeChange?.(false);
      onScreenControlEnd?.();
    } else {
      stoppedRef.current = true;
      readerRef.current?.cancel().catch(() => {});
      readerRef.current = null;
      setLoading(false);
    }
  };

  // ── Screen Control Loop ─────────────────────────────────────

  // ── Move window to apps monitor if it opened on the wrong one ──
  // Uses Win+Shift+Arrow to move the active window between monitors.
  const moveWindowToAppsMonitor = async (
    mons: any[],
    omniMonIndex: number,
    log: (line: string) => void,
  ) => {
    try {
      // Wait for the launched app to gain focus (retry up to 5 times)
      let win = await getActiveWindow();
      const omniNames = ['omnirun', 'omni-run', 'tauri'];
      let attempts = 0;
      while (omniNames.some(n => win.app_name.toLowerCase().includes(n) || win.title.toLowerCase().includes(n)) && attempts < 5) {
        await new Promise((r) => setTimeout(r, 500));
        win = await getActiveWindow();
        attempts++;
      }

      // If still Omnirun is focused, don't move anything
      if (omniNames.some(n => win.app_name.toLowerCase().includes(n) || win.title.toLowerCase().includes(n))) {
        return;
      }

      const winCenterX = win.x + Math.round(win.width / 2);
      const winCenterY = win.y + Math.round(win.height / 2);

      // Find which monitor the window center is on
      let windowMonitor = -1;
      for (const mon of mons) {
        if (winCenterX >= mon.x && winCenterX < mon.x + mon.width &&
            winCenterY >= mon.y && winCenterY < mon.y + mon.height) {
          windowMonitor = mon.index;
          break;
        }
      }

      // If window is on the Omnirun monitor, move it to apps monitor
      if (windowMonitor === omniMonIndex) {
        const omniMon = mons.find((m: any) => m.index === omniMonIndex);
        const appsMon = mons.find((m: any) => m.index !== omniMonIndex);
        if (omniMon && appsMon) {
          const moveKey = appsMon.x < omniMon.x ? 'meta+shift+left' : 'meta+shift+right';
          await executeScreenAction({ type: 'KEY', combo: moveKey });
          log(`📺 Moved ${win.app_name} to apps monitor (monitor ${appsMon.index + 1}).`);
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    } catch {
      // Non-fatal
    }
  };

  const MAX_SCREEN_STEPS = 12;

  const runScreenControlLoop = useCallback(async (instruction: string) => {
    if (!screenControlEnabled) return;
    const screenProvider = getScreenControlProvider();
    if (!screenProvider) return;

    const scSettings = loadScreenControlSettings();
    onScreenControlStart?.();
    onScreenControlStatus?.('idle', 0, 'Starting...');

    const logId = (Date.now() + 1).toString();
    addMessage({ id: logId, role: 'assistant', content: '🖥️ Starting screen control...', timestamp: new Date() });

    const updateLog = (text: string) => {
      useAssistantStore.setState((state) => ({
        messages: state.messages.map((m) => m.id === logId ? { ...m, content: text } : m),
      }));
    };

    let logText = '';
    const log = (line: string) => {
      logText += (logText ? '\n' : '') + line;
      updateLog(logText);
    };

    // ── Detect monitor setup ──
    let monitors: any[] = [];
    let appsMonitor = 0;
    let singleMon = true;
    try {
      monitors = await listMonitors();
      singleMon = isSingleMonitor(monitors);
      appsMonitor = getAppsMonitorIndex(monitors, scSettings.omnirunMonitor);
    } catch {}

    // ── Log monitor setup (no minimize) ──
    if (!singleMon) {
      log(`📌 Dual monitor — Omnirun on monitor ${scSettings.omnirunMonitor + 1}, capturing monitor ${appsMonitor + 1}.`);
    } else {
      log('📌 Single monitor — apps will open on top.');
    }

    // ── Auto-create playlist if needed ──
    const wantsPlaylist = /\b(create|make|build|generate)\s+(a\s+)?playlist\b/i.test(instruction)
      || (/\bplay\s+(my\s+)?(music|songs|tracks)\b/i.test(instruction));

    let playlistPath: string | undefined;
    if (wantsPlaylist) {
      const musicFolder = scSettings.folders.find((f) => f.label === 'Music');
      if (musicFolder) {
        try {
          playlistPath = await createPlaylist(musicFolder.path);
          log(`🎵 Created playlist from ${musicFolder.path}`);
        } catch (err: any) {
          log(`⚠️ Playlist failed: ${err?.message || err}`);
        }
      } else {
        log('⚠️ No Music folder set in Settings → Screen Control.');
      }
    }

    // ── Auto-launch from omni-files ──
    const fileMatch = await matchFileFromOmniFiles(instruction);
    if (fileMatch) {
      try {
        const fileArg = playlistPath || fileMatch.fileArg;
        const appNameLower = fileMatch.name.toLowerCase();

        // Check if the app is already running by checking active window first
        let alreadyRunning = false;
        try {
          const currentWin = await getActiveWindow();
          const winApp = currentWin.app_name.toLowerCase();
          const winTitle = currentWin.title.toLowerCase();
          if (winApp.includes(appNameLower) || winTitle.includes(appNameLower) ||
              appNameLower.split(/[\s\-_()]+/).some(w => w.length >= 3 && (winApp.includes(w) || winTitle.includes(w)))) {
            alreadyRunning = true;
          }
        } catch {}

        // Launch the app (if already running, this usually brings it to focus)
        await launchApp(fileMatch.path, fileArg);
        log(`🚀 Launching ${fileMatch.name}...`);

        // Verify the app is in focus — check active window up to 5 seconds
        let appOpened = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            const win = await getActiveWindow();
            const winApp = win.app_name.toLowerCase();
            const winTitle = win.title.toLowerCase();
            if (winApp.includes(appNameLower) || winTitle.includes(appNameLower) ||
                appNameLower.includes(winApp) || appNameLower.split(/[\s\-_()]+/).some(w => w.length >= 3 && (winApp.includes(w) || winTitle.includes(w)))) {
              appOpened = true;
              log(`✅ ${fileMatch.name} is open (${win.app_name}).`);
              break;
            }
          } catch {}

          // If not focused yet, try Alt+Tab to find it
          if (attempt === 2) {
            log('🔄 Trying Alt+Tab to find the app...');
            try { await executeScreenAction({ type: 'KEY', combo: 'alt+tab' }); } catch {}
            await new Promise((r) => setTimeout(r, 500));
          }
        }

        if (!appOpened) {
          log(`⚠️ ${fileMatch.name} didn't focus. Retrying launch...`);
          try {
            await launchApp(fileMatch.path, fileArg);
            await new Promise((r) => setTimeout(r, 3000));
            const win = await getActiveWindow();
            const winApp = win.app_name.toLowerCase();
            const winTitle = win.title.toLowerCase();
            if (winApp.includes(appNameLower) || winTitle.includes(appNameLower) ||
                appNameLower.split(/[\s\-_()]+/).some(w => w.length >= 3 && (winApp.includes(w) || winTitle.includes(w)))) {
              appOpened = true;
              log(`✅ ${fileMatch.name} is open on retry.`);
            }
          } catch {}
          if (!appOpened) {
            log(`❌ ${fileMatch.name} failed to open. Check the shortcut in omni-files.`);
          }
        }

        if (alreadyRunning) {
          wasAlreadyRunning = true;
          log(`ℹ️ ${fileMatch.name} was already running — may show a previous state.`);
        }

        // Move window to apps monitor if it opened on the wrong one
        if (appOpened && !singleMon) {
          await moveWindowToAppsMonitor(monitors, scSettings.omnirunMonitor, log);
        }
      } catch (err: any) {
        log(`⚠️ Could not launch ${fileMatch.name}: ${err?.message || err}`);
      }
    } else if (playlistPath) {
      try {
        await launchApp(playlistPath);
        log('🚀 Opened playlist with default player');
        await new Promise((r) => setTimeout(r, 2000));
        if (!singleMon) {
          await moveWindowToAppsMonitor(monitors, scSettings.omnirunMonitor, log);
        }
      } catch (err: any) {
        log(`⚠️ Could not open playlist: ${err?.message || err}`);
      }
    } else if (/(?:open|launch|start|run)\s+/i.test(instruction) && !playlistPath) {
      // User asked to open something but it's not in omni-files
      let omniPath = '';
      try { omniPath = await getOmniFilesPath(); } catch {}
      log(`⚠️ Not found in omni-files. Add a shortcut to: ${omniPath || '~/omni-files'}`);
      onScreenControlStatus?.('idle', 0, 'File not in omni-files');
      return;
    }

    // ── Build system prompt ──
    const userCtx = buildUserContextPrompt();
    const fullSystemPrompt = SCREEN_CONTROL_SYSTEM_PROMPT + (userCtx ? '\n' + userCtx : '');

    const conversationHistory: { role: 'user' | 'assistant'; content: any }[] = [];
    let step = 0;
    let done = false;
    let consecutiveClicks = 0; // Track repeated clicks without other actions
    let hasTyped = false; // Track if TYPE action has been executed this session
    let wasAlreadyRunning = false; // Track if app was already open before launch

    try {
      while (!done && step < MAX_SCREEN_STEPS) {
        if (screenControlStopRef?.current) { log('\n⏹️ Stopped by user.'); break; }

        step++;
        onScreenControlStatus?.('capturing', step, 'Capturing...');

        // Screenshot — always capture only the apps monitor
        // We already moved the launched app there, and capturing both monitors
        // causes the AI to see Omnirun's chat and get confused by old messages
        let screenshot;
        const useCaptureAll = false;
        try {
          screenshot = await takeScreenshot(
            singleMon ? scSettings.cropToWindow : false,
            scSettings.screenshotQuality,
            appsMonitor,
            useCaptureAll,
          );
        } catch (e: any) { log(`❌ Screenshot failed: ${e?.message || e}`); break; }

        log(`📸 Step ${step} — captured ${screenshot.width}×${screenshot.height}`);
        onScreenControlStatus?.('analyzing', step, 'Reading screen...');

        // Context
        let ctx = '';
        try {
          const win = await getActiveWindow();
          if (useCaptureAll && monitors.length > 1) {
            const minX = Math.min(...monitors.map((m: any) => m.x));
            const minY = Math.min(...monitors.map((m: any) => m.y));
            const totalW = Math.max(...monitors.map((m: any) => m.x + m.width)) - minX;
            const totalH = Math.max(...monitors.map((m: any) => m.y + m.height)) - minY;
            ctx = `\nContext: Active app="${win.app_name}" title="${win.title}" (${win.width}x${win.height}). Virtual desktop: ${totalW}x${totalH} (${monitors.length} monitors). Screenshot: ${screenshot.width}x${screenshot.height}. Coords: screenshot pixel space (0-${screenshot.width}, 0-${screenshot.height}). OS: Windows. Taskbar at bottom.`;
          } else {
            const scr = await getScreenSize(appsMonitor);
            ctx = `\nContext: Active app="${win.app_name}" title="${win.title}" (${win.width}x${win.height}). Screen: ${scr.width}x${scr.height}. Screenshot: ${screenshot.width}x${screenshot.height}. Coords: screenshot pixel space (0-${screenshot.width}, 0-${screenshot.height}). OS: Windows. Taskbar at bottom.`;
          }
        } catch {}

        let repeatHint = '';
        if (consecutiveClicks >= 2) {
          repeatHint = ' WARNING: You have clicked multiple times without typing. If you need to type text, use ACTION: TYPE now. If a popup or emoji panel is blocking, press Escape first.';
        }

        const textContent = step === 1
          ? `Task: ${instruction}${fileMatch ? `. NOTE: We launched "${fileMatch.name}" for you.${wasAlreadyRunning ? ' The app was already running — it may be showing a previous chat or state. Navigate to the correct screen first.' : ''} Look for its WINDOW on screen. Do NOT click taskbar icons or open Start menu.` : ''}${ctx}`
          : `Screenshot after previous action.${repeatHint}${ctx}`;

        conversationHistory.push({
          role: 'user' as const,
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot.base64 } },
            { type: 'text', text: textContent },
          ],
        });

        // Trim history
        let trimmed = [...conversationHistory];
        if (trimmed.length > 6) {
          trimmed = [...trimmed.slice(0, 2), { role: 'user' as const, content: '[steps omitted]' }, ...trimmed.slice(-4)];
        }

        // AI call
        let aiText = '';
        try {
          const result = await sendScreenControlMessage(trimmed, screenProvider.apiKey, screenProvider.model, fullSystemPrompt);
          aiText = result.text;
          useUsageStore.getState().trackAPICall({
            model: screenProvider.model, provider: screenProvider.id,
            inputTokens: result.inputTokens, outputTokens: result.outputTokens, source: 'assistant',
          });
        } catch (e: any) { log(`❌ AI error: ${e?.message || e}`); break; }

        conversationHistory.push({ role: 'assistant', content: aiText });

        // Observation
        const obsMatch = aiText.match(/OBSERVATION:\s*(.+)/i);
        log(`👁️ ${obsMatch ? obsMatch[1].trim() : cleanAiResponse(aiText).split('\n')[0].slice(0, 120)}`);

        // Parse action
        const action = parseScreenAction(aiText);
        if (!action) {
          log('⚠️ No action parsed: ' + cleanAiResponse(aiText).slice(0, 80));
          if (step >= 3) { log('⚠️ Giving up.'); break; }
          continue;
        }

        if (action.type === 'DONE') {
          // If the task involves sending a message but AI never typed, reject DONE
          const needsTyping = /\b(send|type|write|tell|message|say)\b/i.test(instruction);
          if (needsTyping && !hasTyped) {
            log('⚠️ AI said DONE but never typed the message. Continuing...');
            conversationHistory.push({
              role: 'user' as const,
              content: 'You have NOT typed the message yet. You must use ACTION: TYPE to type the message text first, then click send.',
            });
            continue;
          }
          log('\n✅ Done.'); done = true; onScreenControlStatus?.('idle', step, 'Complete'); break;
        }
        if (action.type === 'FAIL') { log(`\n❌ ${action.reason || 'Failed'}`); done = true; break; }

        // ── Repeat-click detection ──
        // If AI keeps clicking without typing, something is blocking (emoji panel, popup, etc).
        // After 2 consecutive clicks: press Escape to close any overlay.
        // After 3 consecutive clicks: force a KEY tab to move focus.
        if (action.type === 'CLICK' || action.type === 'DOUBLE_CLICK' || action.type === 'RIGHT_CLICK') {
          consecutiveClicks++;
          if (consecutiveClicks === 3) {
            log('🔧 Repeated clicks detected — pressing Escape to close any overlay.');
            try { await executeScreenAction({ type: 'KEY', combo: 'escape' }); } catch {}
            await new Promise((r) => setTimeout(r, 300));
            continue; // Skip this click, retake screenshot
          }
          if (consecutiveClicks >= 4) {
            log('🔧 Still clicking — trying Tab to move focus to input field.');
            try { await executeScreenAction({ type: 'KEY', combo: 'tab' }); } catch {}
            await new Promise((r) => setTimeout(r, 300));
            consecutiveClicks = 0; // Reset and let AI try again
            continue;
          }
        } else {
          // Any non-click action (TYPE, KEY, SCROLL) resets the counter
          consecutiveClicks = 0;
          if (action.type === 'TYPE') hasTyped = true;
        }

        // Scale coordinates from screenshot space to real screen space
        if (action.x !== undefined && action.y !== undefined) {
          try {
            if (useCaptureAll && monitors.length > 1) {
              // Combined screenshot: scale to virtual desktop, then add origin offset
              const minX = Math.min(...monitors.map((m: any) => m.x));
              const minY = Math.min(...monitors.map((m: any) => m.y));
              const totalW = Math.max(...monitors.map((m: any) => m.x + m.width)) - minX;
              const totalH = Math.max(...monitors.map((m: any) => m.y + m.height)) - minY;
              const sx = totalW / screenshot.width;
              const sy = totalH / screenshot.height;
              action.x = Math.round(action.x * sx) + minX;
              action.y = Math.round(action.y * sy) + minY;
              if (action.x2 !== undefined && action.y2 !== undefined) {
                action.x2 = Math.round(action.x2 * sx) + minX;
                action.y2 = Math.round(action.y2 * sy) + minY;
              }
            } else {
              // Single monitor: scale to that monitor's resolution
              const scr = await getScreenSize(appsMonitor);
              const sx = scr.width / screenshot.width;
              const sy = scr.height / screenshot.height;
              action.x = Math.round(action.x * sx);
              action.y = Math.round(action.y * sy);
              if (action.x2 !== undefined && action.y2 !== undefined) {
                action.x2 = Math.round(action.x2 * sx);
                action.y2 = Math.round(action.y2 * sy);
              }
            }
          } catch {}
        }

        if (screenControlStopRef?.current) { log('\n⏹️ Stopped.'); break; }

        const actionLabel = `${action.type}${action.x !== undefined ? ` ${action.x},${action.y}` : ''}${action.text ? ` "${action.text.slice(0, 30)}"` : ''}${action.combo ? ` ${action.combo}` : ''}${action.direction ? ` ${action.direction}` : ''}`;
        onScreenControlStatus?.('acting', step, actionLabel);

        try {
          const result = await executeScreenAction(action);
          log(`⚡ ${result}`);
        } catch (e: any) {
          log(`❌ Action failed: ${e?.message || e?.toString?.() || 'Unknown'}`);
          break;
        }

        const delay = scSettings.actionDelay || 500;
        if (delay > 0 && action.type !== 'WAIT') await new Promise((r) => setTimeout(r, delay));
      }

      if (step >= MAX_SCREEN_STEPS && !done) log(`\n⚠️ Step limit (${MAX_SCREEN_STEPS}).`);
    } finally {
      onScreenControlStatus?.('idle', 0, 'Ready for next command');
    }
  }, [screenControlEnabled, screenControlStopRef, onScreenControlStart, onScreenControlEnd, onScreenControlStatus, addMessage]);

  // ── Record usage ────────────────────────────────────────────
  const recordAssistantUsage = async (result: any, providerConfig: { id: string; model: string }) => {
    try {
      const raw = result?.usage ?? {};
      useUsageStore.getState().trackAPICall({
        model: providerConfig.model ?? '', provider: providerConfig.id,
        inputTokens: raw.inputTokens ?? raw.input_tokens ?? 0,
        outputTokens: raw.outputTokens ?? raw.output_tokens ?? 0,
        cacheCreationTokens: raw.cacheCreationTokens ?? raw.cache_creation_input_tokens ?? 0,
        cacheReadTokens: raw.cacheReadTokens ?? raw.cache_read_input_tokens ?? 0,
        source: 'assistant',
      });
    } catch (err) {
      console.error('[AssistantChatArea] recordUsage failed:', err);
    }
  };

  // ── Send message ────────────────────────────────────────────
  const handleSend = useCallback(async (overrideText?: string) => {
    const messageText = overrideText || input.trim();
    if (!messageText || isLoading) return;
    setInput('');

    const userMsgId = Date.now().toString();
    addMessage({ id: userMsgId, role: 'user', content: messageText, timestamp: new Date() });

    if (screenControlEnabled && screenControlMode) {
      runScreenControlLoop(messageText);
      return;
    }

    setLoading(true);
    stoppedRef.current = false;

    try {
      const provider = getActiveProvider();
      if (!provider) throw new Error('No API key configured. Go to Settings \u2192 API Keys.');

      const history = messages.filter((m) => m.content.trim() !== '').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      const apiMessages = [...history, { role: 'user' as const, content: messageText }];
      const assistantId = (Date.now() + 1).toString();
      addMessage({ id: assistantId, role: 'assistant', content: '', timestamp: new Date() });
      let fullResponse = '';

      const systemPrompt = buildSystemPrompt(activeAccounts.map((a) => ({ provider: a.provider, email: a.email, accountLabel: a.accountLabel, providerType: a.providerType ?? 'email' })));
      let memoryBlock = '';
      try { memoryBlock = await buildMemoryBlock(); } catch {}
      const routinesBlock = buildRoutinesPromptBlock();
      const screenControlBlock = buildScreenControlPrompt();

      const result = await sendMessage(
        apiMessages, provider,
        (chunk) => {
          if (stoppedRef.current) return;
          fullResponse += chunk;
          useAssistantStore.setState((state) => ({ messages: state.messages.map((m) => m.id === assistantId ? { ...m, content: fullResponse } : m) }));
        },
        { path: '', manifest: null, contextString: systemPrompt + memoryBlock + routinesBlock + screenControlBlock },
        undefined,
        (reader) => { readerRef.current = reader; }
      );

      fullResponse = result.text;
      useAssistantStore.setState((state) => ({ messages: state.messages.map((m) => m.id === assistantId ? { ...m, content: fullResponse } : m) }));
      if (!stoppedRef.current) await recordAssistantUsage(result, { id: provider.id, model: provider.model ?? '' });

    } catch (error: any) {
      if (!stoppedRef.current) {
        useAssistantStore.setState((state) => ({
          messages: state.messages.filter((m) => m.content !== '').concat({ id: (Date.now() + 2).toString(), role: 'assistant', content: `\u274C ${error.message}`, timestamp: new Date() }),
        }));
      }
    } finally {
      stoppedRef.current = false;
      readerRef.current = null;
      setLoading(false);
      const currentMsgs = useAssistantStore.getState().messages;
      if (currentMsgs.length >= 4) extractObservations(currentMsgs.map((m) => ({ role: m.role, content: m.content })), 'assistant').catch(() => {});
    }
  }, [input, isLoading, messages, activeAccounts, screenControlEnabled, screenControlMode, runScreenControlLoop]);

  // Wire voice commands to assistant chat when this section is active
  useEffect(() => {
    useVoiceStore.getState().setOnAutoSend((text: string) => handleSend(text));
    return () => {
      useVoiceStore.getState().setOnAutoSend(null);
    };
  }, [handleSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleSuggestion = (text: string) => { handleSend(text); };

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className={`flex flex-col h-full ${t.colors.bg}`}>
      {/* Header */}
      <div className={`px-4 py-2 ${t.colors.bgSecondary} ${t.colors.border} border-b flex items-center justify-between flex-shrink-0`}>
        <span className={`text-sm ${t.colors.textMuted}`}>
          {screenControlMode ? `Screen Control \u2022 ${(() => {
            const s = loadScreenControlSettings();
            return s.modelPreference === 'haiku' ? 'Haiku' : s.modelPreference === 'sonnet' ? 'Sonnet' : s.modelPreference === 'opus' ? 'Opus' : 'Auto (Sonnet)';
          })()}` : `${getActiveProviderDisplay()} \u2699`}
        </span>
        <div className="flex items-center gap-2">
          {screenControlEnabled && (
            <button
              onClick={() => {
                if (screenControlMode) { onScreenControlModeChange?.(false); if (screenControlStopRef) screenControlStopRef.current = true; }
                else { onScreenControlModeChange?.(true); onScreenControlStart?.(); onScreenControlStatus?.('idle', 0, 'Ready — type a command'); }
              }}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium ${t.borderRadius} transition-colors ${screenControlMode ? 'bg-green-600 text-white' : `${t.colors.bgTertiary} ${t.colors.textMuted} hover:${t.colors.text}`}`}
              title={screenControlMode ? 'Screen control active — click to stop' : 'Enable screen control'}
            >
              <Monitor size={13} />
              {screenControlMode ? 'Screen ON' : 'Screen'}
            </button>
          )}
          <button
            onClick={onToggleAboutMe}
            className={`p-1.5 ${activeView === 'aboutme' ? t.colors.text : t.colors.textMuted} hover:${t.colors.text} transition-colors`}
            title={activeView === 'aboutme' ? 'Back to chat' : 'About me — what AI knows about you'}
          >
            <Brain size={16} />
          </button>
          {messages.length > 0 && (
            <>
              <button onClick={clearMessages} className={`p-1.5 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`} title="New conversation">
                <MessageSquarePlus size={16} />
              </button>
              <button onClick={clearMessages} className={`p-1 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`} title="Clear chat">
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 select-text">
        {messages.length === 0 ? (
          <EmptyState
            hasAccounts={hasAccounts}
            onConnect={() => openConnectModal()}
            accounts={activeAccounts}
            onSuggestion={handleSuggestion}
            theme={t}
            screenControlEnabled={screenControlEnabled}
            onScreenControlEnable={() => {
              onScreenControlModeChange?.(true);
              onScreenControlStart?.();
              onScreenControlStatus?.('idle', 0, 'Ready — type a command');
            }}
          />
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((message) => (
              <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'assistant' && (
                  <div className={`w-10 h-10 ${t.borderRadius} flex items-center justify-center flex-shrink-0 overflow-hidden`}>
                    <img src={theme === 'light' || theme === 'highContrast' ? elipseLight : elipseDark} alt="omnirun" className="w-10 h-10" />
                  </div>
                )}
                <div className={`max-w-[80%] px-4 py-2 break-words overflow-hidden ${t.borderRadius} ${message.role === 'user' ? `${t.colors.accent} ${theme === 'highContrast' ? 'text-black' : 'text-white'}` : `${t.colors.bgSecondary} ${t.colors.text}`}`}>
                  <div className={t.fontFamily} style={{ fontSize: fontSize === 'small' ? '13px' : fontSize === 'large' ? '17px' : '15px' }}>
                    {message.content
                      ? message.role === 'assistant'
                        ? <MarkdownRenderer content={cleanAiResponse(message.content)} theme={t} themeKey={theme} projectPath={null} onSaveCodeBlock={() => {}} />
                        : message.content
                      : <OmnirunSpinner textClass={t.colors.textMuted} />
                    }
                  </div>
                  {/* Streaming indicator — shows while AI is still generating and text has started */}
                  {isLoading && message.role === 'assistant' && message.content && message.id === messages[messages.length - 1]?.id && (
                    <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-current/5">
                      <OmnirunSpinner size={16} showTimer={true} textClass={`${t.colors.textMuted} opacity-70`} />
                    </div>
                  )}
                  <div className={`text-[10px] mt-1 opacity-50 ${message.role === 'user' ? 'text-right' : ''}`}>
                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' })}
                  </div>
                </div>
                {message.role === 'user' && (
                  <div className={`w-8 h-8 ${t.borderRadius} flex items-center justify-center flex-shrink-0 overflow-hidden`} style={{ background: showAvatar ? 'transparent' : 'var(--action, #7C3AED)' }}>
                    {showAvatar
                      ? <img src={avatarUrl!} alt="avatar" className="w-8 h-8 object-cover" onError={() => setAvatarError(true)} />
                      : <span className="text-white text-xs font-semibold">{getInitials()}</span>
                    }
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Voice transcript overlay */}
      <div className="max-w-3xl mx-auto px-4">
        <VoiceTranscriptOverlay />
      </div>

      {/* Input */}
      <div className={`p-4 flex-shrink-0 ${t.colors.border} border-t`}>
        <div className="flex gap-2 max-w-3xl mx-auto">
          <VoiceButton
            onTranscript={(text) => handleSend(text)}
            disabled={isLoading}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              const newHeight = Math.min(e.target.scrollHeight, 200);
              e.target.style.height = newHeight + 'px';
              e.target.style.overflowY = e.target.scrollHeight > 200 ? 'auto' : 'hidden';
            }}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? 'Waiting...' : hasAccounts ? (screenControlEnabled ? 'Ask about emails, calendar, or control your screen...' : 'Ask about emails, calendar, tasks...') : 'Connect an account to get started...'}
            disabled={isLoading}
            rows={1}
            className={`flex-1 ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 ${t.fontFamily} disabled:opacity-50 resize-none overflow-hidden`}
            style={{ maxHeight: '200px' }}
          />
          {isLoading ? (
            <button onClick={handleStop} className={`bg-red-600 hover:bg-red-700 text-white px-4 py-2 ${t.borderRadius} flex items-center gap-2 self-end`}>
              <Square size={18} fill="currentColor" />
            </button>
          ) : (
            <button onClick={() => handleSend()} disabled={!input.trim()} className={`${t.colors.accent} ${t.colors.accentHover} ${theme === 'highContrast' ? 'text-black' : 'text-white'} px-4 py-2 ${t.borderRadius} flex items-center gap-2 disabled:opacity-50 self-end`}>
              <Send size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default AssistantChatArea;