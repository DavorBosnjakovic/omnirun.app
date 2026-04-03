// ============================================================
// AssistantChatArea.tsx
// ============================================================
// Chat interface for the Assistant section.
// Same visual patterns as ChatArea.tsx but:
// - Uses assistantStore messages (not chatStore)
// - No project context, no tool calls, no file tree
// - System prompt aware of ALL connected integrations
// - Shows onboarding empty state when no accounts connected
// - Records usage to SQLite with source: 'assistant'

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
  minimizeSelf,
  matchAppLaunch,
  launchApp,
} from '../../services/screenControlService';
import type { ScreenControlStatus } from './ScreenControlOverlay';
import MarkdownRenderer from '../chat/MarkdownRenderer';
import elipseDark from '../../assets/elipse_transparent_dark.svg';
import elipseLight from '../../assets/elipse_transparent_light.svg';

// Global shortcut for kill switch
let globalShortcutRegistered = false;

interface AssistantChatAreaProps {
  plan: string;
  onToggleAboutMe: () => void;
  activeView: 'chat' | 'aboutme';
  // Screen control
  screenControlEnabled?: boolean;
  screenControlMode?: boolean;
  onScreenControlModeChange?: (active: boolean) => void;
  onScreenControlStart?: () => void;
  onScreenControlEnd?: () => void;
  onScreenControlStatus?: (status: ScreenControlStatus, step?: number, action?: string) => void;
  screenControlStopRef?: { current: boolean };
}

// ─── System prompt ────────────────────────────────────────────
// Built fresh on each send so it always reflects current accounts.

function buildSystemPrompt(
  accounts: { provider: string; email: string; accountLabel: string | null; providerType: string }[]
): string {
  // Group accounts by type
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
  if (emailAccounts.length > 0) {
    capabilities.push(
      'Summarize unread or important emails',
      'Draft and send email replies in the user\'s voice',
      'Flag urgent emails and suggest actions',
    );
  }
  if (calendarAccounts.length > 0) {
    capabilities.push(
      'Show today\'s schedule and upcoming events',
      'Warn about scheduling conflicts',
      'Help schedule or reschedule meetings',
    );
  }
  if (messagingAccounts.length > 0) {
    capabilities.push(
      'Surface important Slack/Discord messages the user missed',
      'Summarize busy channels',
      'Draft and send replies',
    );
  }
  if (devAccounts.length > 0) {
    capabilities.push(
      'Notify about new PRs, issues, and review requests',
      'Summarize repo activity',
    );
  }
  if (knowledgeAccounts.length > 0) {
    capabilities.push(
      'Search and reference the user\'s Notion pages',
    );
  }
  if (taskAccounts.length > 0) {
    capabilities.push(
      'Show and manage Todoist tasks',
      'Create, complete, or reschedule tasks',
    );
  }
  if (watchers.length > 0) {
    capabilities.push(
      'Report on changes detected on watched websites',
    );
  }
  if (capabilities.length === 0) {
    capabilities.push(
      'Help the user once they connect their accounts',
      'Answer general questions',
    );
  }

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

// ─── Suggestion prompts based on connected accounts ───────────

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

// ─── Empty / onboarding state ─────────────────────────────────

// ── Screen control request detection ─────────────────────────

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
  /\b(write|type|enter|input)\s+.{1,50}(in|into|on|to)?\b/i,
  /\b(write|type)\s+(it\s+)?["'].+["']/i,
  /\b(scroll|drag|swipe)\s+(up|down|left|right)/i,
  /\b(go\s+to|navigate\s+to|switch\s+to|focus)\s+/i,
  /\b(copy|paste|cut|undo|redo|save|select\s+all)\b/i,
  /\b(right[- ]?click|double[- ]?click)\b/i,
];

function isScreenControlRequest(message: string): boolean {
  return SCREEN_CONTROL_PATTERNS.some((pattern) => pattern.test(message));
}

// ── Direct Anthropic API call for screen control ──────────

const SCREEN_CONTROL_SYSTEM_PROMPT = `You are a desktop automation agent. You can see the user's screen via screenshots and control it with mouse/keyboard actions.

RESPONSE FORMAT — you MUST use this EXACT format every time, no exceptions:

OBSERVATION: [one sentence describing what you see on screen]
ACTION: [exactly one action from the list below]

Available actions:
CLICK x y — left click at pixel coordinates
DOUBLE_CLICK x y — double click
RIGHT_CLICK x y — right click
TYPE text — type a text string (do NOT add quotes around the text)
KEY combo — press key combo (examples: enter, tab, escape, ctrl+s, alt+tab, ctrl+a)
SCROLL up/down amount — scroll (example: SCROLL down 3)
WAIT seconds — wait for something to load (example: WAIT 2)
DONE — task is complete
FAIL reason — cannot complete, explain why

STRICT RULES:
- ALWAYS output exactly two lines: one OBSERVATION and one ACTION. Nothing else.
- Never write explanations, questions, suggestions, or commentary.
- Never use XML tags, markdown, or any other formatting.
- Coordinates are in screenshot pixel space.
- ONE action per response. Never combine multiple actions.
- If an app icon is visible in the taskbar, click it directly. Do not use Start menu.
- After completing the task, respond with ACTION: DONE
- If you only need to describe the screen, describe it then say ACTION: DONE
- NEVER click send/submit/post, enter passwords, or interact with payment screens without user approval.
- If something unexpected appears (error, popup, wrong app), respond with ACTION: FAIL and explain.
- Some apps may have been pre-launched for you. Check the screenshot to see what is already open.

EXAMPLES:

User provides screenshot of Windows desktop with Notepad in taskbar.
Task: Open Notepad and type hello world.

OBSERVATION: I see the Windows desktop. Notepad icon is visible in the taskbar at approximately (450, 1060).
ACTION: CLICK 450 1060

---

User provides screenshot showing Notepad is now open with an empty document.

OBSERVATION: Notepad is open with a blank document. The text cursor is in the editing area.
ACTION: TYPE hello world

---

User provides screenshot showing "hello world" typed in Notepad.

OBSERVATION: The text "hello world" has been typed successfully in Notepad.
ACTION: DONE

---

User provides screenshot showing an unexpected error dialog.

OBSERVATION: An error dialog appeared saying "Application not responding".
ACTION: FAIL Unexpected error dialog appeared — application not responding.`;

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

// ── Clean AI responses for display ───────────────────────────

function cleanAiResponse(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
  cleaned = cleaned.replace(/<tool_call>[\s\S]*$/g, '').trim();
  cleaned = cleaned.replace(/<screenshot_base64>[\s\S]*?<\/screenshot_base64>/g, '').trim();
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

function EmptyState({
  hasAccounts,
  onConnect,
  accounts,
  onSuggestion,
  theme: t,
}: {
  hasAccounts: boolean;
  onConnect: () => void;
  accounts: any[];
  onSuggestion: (text: string) => void;
  theme: any;
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
      <p className={`text-sm font-medium mb-2 ${t.colors.text}`}>
        Connect your first account
      </p>
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

  // ── User avatar ────────────────────────────────────────────
  const { user, profile } = useAuthStore();
  const [avatarError, setAvatarError] = useState(false);
  const avatarUrl = profile?.avatar_url || null;
  const showAvatar = avatarUrl && !avatarError;

  useEffect(() => {
    setAvatarError(false);
  }, [profile?.avatar_url]);

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

  // ── Kill switch: global hotkey registration ─────────────────
  useEffect(() => {
    if (!screenControlEnabled) return;

    let cleanedUp = false;

    const registerKillSwitch = async () => {
      try {
        const { register, unregister } = await import('@tauri-apps/plugin-global-shortcut');
        const settings = loadScreenControlSettings();
        const hotkey = settings.killSwitchKey || 'F10';

        try { await unregister(hotkey); } catch { /* ignore */ }

        await register(hotkey, (event: any) => {
          if (event.state === 'Pressed' && !cleanedUp) {
            console.log('[ScreenControl] Kill switch activated:', hotkey);
            if (screenControlStopRef) screenControlStopRef.current = true;
            onScreenControlModeChange?.(false);
            onScreenControlEnd?.();
          }
        });

        globalShortcutRegistered = true;
        console.log('[ScreenControl] Kill switch registered:', hotkey);
      } catch (err) {
        console.warn('[ScreenControl] Failed to register kill switch:', err);
      }
    };

    registerKillSwitch();

    return () => {
      cleanedUp = true;
      if (globalShortcutRegistered) {
        import('@tauri-apps/plugin-global-shortcut').then(({ unregister }) => {
          const settings = loadScreenControlSettings();
          unregister(settings.killSwitchKey || 'F10').catch(() => {});
          globalShortcutRegistered = false;
        }).catch(() => {});
      }
    };
  }, [screenControlEnabled]);

  // ── Get provider for screen control (bypasses Haiku override) ──
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
      else model = 'claude-opus-4-6'; // "auto" defaults to opus for screen control
    }

    return { id: activeProviderId, apiKey: config.apiKey, model };
  };

  // ── Provider helpers (same pattern as ChatArea) ───────────
  const getActiveProvider = () => {
    const activeProviderId = localStorage.getItem('ai-active-provider') || 'anthropic';
    const savedProviders = localStorage.getItem('ai-providers');
    if (!savedProviders) return null;
    const providers = JSON.parse(savedProviders);
    const config = providers.find((p: any) => p.providerId === activeProviderId);
    if (!config || !config.apiKey) return null;

    let model = config.selectedModel;

    if (activeProviderId === 'anthropic' && model && !/haiku/i.test(model)) {
      model = 'claude-haiku-4-5-20251001';
    }

    return { id: activeProviderId, apiKey: config.apiKey, model };
  };

  const getActiveProviderDisplay = () => {
    const activeProviderId = localStorage.getItem('ai-active-provider') || 'anthropic';
    const savedProviders = localStorage.getItem('ai-providers');
    if (!savedProviders) return 'No provider';
    const providers = JSON.parse(savedProviders);
    const config = providers.find((p: any) => p.providerId === activeProviderId);
    if (!config) return 'No provider';
    const names: Record<string, string> = {
      anthropic: 'Claude', groq: 'Groq', openai: 'OpenAI', google: 'Gemini', ollama: 'Ollama',
    };
    const name = names[activeProviderId] || activeProviderId;

    let selectedModel = config.selectedModel ?? '';

    if (activeProviderId === 'anthropic' && !/haiku/i.test(selectedModel)) {
      selectedModel = 'claude-haiku-4-5-20251001';
    }

    const model = selectedModel.split('-').slice(0, 2).join(' ') || '';
    return `${name} \u2022 ${model}`;
  };

  const handleStop = () => {
    // Stop screen control if active, otherwise stop chat streaming
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
        messages: state.messages.map((m) =>
          m.id === logId ? { ...m, content: text } : m
        ),
      }));
    };

    let logText = '';
    const log = (line: string) => {
      logText += (logText ? '\n' : '') + line;
      updateLog(logText);
    };

    // ── Step 0: Minimize Omnirun so AI doesn't see/interact with our own window ──
    try {
      await minimizeSelf();
      log('📌 Omnirun minimized — focusing target app.');
    } catch (err: any) {
      log('⚠️ Could not minimize Omnirun: ' + (err?.message || err));
    }

    // ── Step 0.5: Auto-launch app if instruction matches a registered app ──
    const appMatch = matchAppLaunch(instruction);
    if (appMatch) {
      try {
        await launchApp(appMatch.command, appMatch.fileArg);
        log(`🚀 Launched ${appMatch.label}${appMatch.fileArg ? ` with ${appMatch.fileArg}` : ''}`);
        // Wait for app to open before taking first screenshot
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err: any) {
        log(`⚠️ Could not launch ${appMatch.label}: ${err?.message || err}`);
        // Continue anyway — AI will try to find/open the app visually
      }
    }

    // ── Build system prompt with user context ──
    const userCtx = buildUserContextPrompt();
    const fullSystemPrompt = SCREEN_CONTROL_SYSTEM_PROMPT + (userCtx ? '\n' + userCtx : '');

    const conversationHistory: { role: 'user' | 'assistant'; content: string; images?: { base64: string; mimeType: string }[] }[] = [];
    let step = 0;
    let done = false;

    try {
      while (!done && step < MAX_SCREEN_STEPS) {
        if (screenControlStopRef?.current) {
          log('\n⏹️ Stopped by user.');
          break;
        }

        step++;
        onScreenControlStatus?.('capturing', step, 'Capturing...');

        // ── Blocked app check before screenshot ──
        try {
          const blockCheck = await isBlockedApp();
          if (blockCheck.blocked) {
            log(`🚫 Blocked app detected: "${blockCheck.appName}". Waiting for user to switch apps...`);
            onScreenControlStatus?.('paused', step, `Blocked: ${blockCheck.appName}`);
            await new Promise((r) => setTimeout(r, 2000));
            const recheck = await isBlockedApp();
            if (recheck.blocked) {
              log(`🚫 Still on blocked app "${recheck.appName}". Stopping.`);
              break;
            }
          }
        } catch { /* ignore check failures */ }

        // 1. Screenshot
        let screenshot;
        try {
          screenshot = await takeScreenshot(scSettings.cropToWindow, scSettings.screenshotQuality);
        } catch (e: any) {
          log(`❌ Screenshot failed: ${e?.message || e}`);
          break;
        }

        log(`📸 Step ${step} — captured ${screenshot.width}×${screenshot.height}`);
        onScreenControlStatus?.('analyzing', step, 'Reading screen...');

        // 2. Window + screen context
        let ctx = '';
        try {
          const win = await getActiveWindow();
          const scr = await getScreenSize();
          ctx = `\nContext: Active app="${win.app_name}" title="${win.title}" (${win.width}x${win.height} at ${win.x},${win.y}). Screen: ${scr.width}x${scr.height}. Screenshot: ${screenshot.width}x${screenshot.height}. Coordinates: use the screenshot pixel space (0-${screenshot.width}, 0-${screenshot.height}). OS: Windows. Taskbar is at the bottom of the screen.`;
        } catch {}

        // 3. Build user message with screenshot
        const textContent = step === 1
          ? `Task: ${instruction}${ctx}`
          : `Screenshot after previous action.${ctx}`;

        const userMsg = {
          role: 'user' as const,
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot.base64 } },
            { type: 'text', text: textContent },
          ],
        };
        conversationHistory.push(userMsg);

        // 4. Trim history
        let trimmed = [...conversationHistory];
        if (trimmed.length > 6) {
          const first = trimmed.slice(0, 2);
          const recent = trimmed.slice(-4);
          trimmed = [...first, { role: 'user' as const, content: '[previous steps omitted]' }, ...recent];
        }

        // 5. Direct API call
        let aiText = '';
        try {
          const result = await sendScreenControlMessage(trimmed, screenProvider.apiKey, screenProvider.model, fullSystemPrompt);
          aiText = result.text;

          useUsageStore.getState().trackAPICall({
            model: screenProvider.model,
            provider: screenProvider.id,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            source: 'assistant',
          });
        } catch (e: any) {
          log(`❌ AI error: ${e?.message || e}`);
          break;
        }

        conversationHistory.push({ role: 'assistant', content: aiText });

        // 6. Extract observation
        const obsMatch = aiText.match(/OBSERVATION:\s*(.+)/i);
        const observation = obsMatch ? obsMatch[1].trim() : cleanAiResponse(aiText).split('\n')[0].slice(0, 120);
        log(`👁️ ${observation}`);

        // 7. Parse action
        const action = parseScreenAction(aiText);

        if (!action) {
          log('⚠️ No clear action parsed. AI response: ' + cleanAiResponse(aiText).slice(0, 100));
          if (step >= 3) { log('⚠️ Giving up after repeated failures.'); break; }
          continue;
        }

        // 8. Terminal actions
        if (action.type === 'DONE') {
          log('\n✅ Done.');
          done = true;
          onScreenControlStatus?.('idle', step, 'Complete');
          break;
        }
        if (action.type === 'FAIL') {
          log(`\n❌ Failed: ${action.reason || 'unknown reason'}`);
          done = true;
          break;
        }

        // 8.5 Scale coordinates
        if (action.x !== undefined && action.y !== undefined) {
          try {
            const scr = await getScreenSize();
            const scaleX = scr.width / screenshot.width;
            const scaleY = scr.height / screenshot.height;
            action.x = Math.round(action.x * scaleX);
            action.y = Math.round(action.y * scaleY);
            if (action.x2 !== undefined && action.y2 !== undefined) {
              action.x2 = Math.round(action.x2 * scaleX);
              action.y2 = Math.round(action.y2 * scaleY);
            }
          } catch {}
        }

        // ── Blocked app check before action ──
        try {
          const blockCheck = await isBlockedApp();
          if (blockCheck.blocked) {
            log(`🚫 Cannot act on blocked app "${blockCheck.appName}". Stopping.`);
            break;
          }
        } catch { /* ignore */ }

        // 9. Execute action
        if (screenControlStopRef?.current) { log('\n⏹️ Stopped.'); break; }

        const actionLabel = `${action.type}${action.x !== undefined ? ` ${action.x},${action.y}` : ''}${action.text ? ` "${action.text.slice(0, 30)}"` : ''}${action.combo ? ` ${action.combo}` : ''}${action.direction ? ` ${action.direction}` : ''}`;
        onScreenControlStatus?.('acting', step, actionLabel);

        try {
          const result = await executeScreenAction(action);
          log(`⚡ ${result}`);
        } catch (e: any) {
          const errMsg = e?.message || e?.toString?.() || JSON.stringify(e) || 'Unknown error';
          log(`❌ Action failed: ${errMsg}`);
          break;
        }

        // 10. Delay before next step
        const delay = scSettings.actionDelay || 500;
        if (delay > 0 && action.type !== 'WAIT') {
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (step >= MAX_SCREEN_STEPS && !done) {
        log(`\n⚠️ Step limit reached (${MAX_SCREEN_STEPS}).`);
      }

    } finally {
      onScreenControlStatus?.('idle', 0, 'Ready for next command');
    }
  }, [screenControlEnabled, screenControlStopRef, onScreenControlStart, onScreenControlEnd, onScreenControlStatus, addMessage]);

  // ── Record assistant usage ─────
  const recordAssistantUsage = async (
    result: any,
    providerConfig: { id: string; model: string }
  ) => {
    try {
      const raw = result?.usage ?? {};
      const inputTokens        = raw.inputTokens        ?? raw.input_tokens                 ?? 0;
      const outputTokens       = raw.outputTokens       ?? raw.output_tokens                ?? 0;
      const cacheCreationTokens = raw.cacheCreationTokens ?? raw.cache_creation_input_tokens ?? 0;
      const cacheReadTokens    = raw.cacheReadTokens    ?? raw.cache_read_input_tokens       ?? 0;

      useUsageStore.getState().trackAPICall({
        model: providerConfig.model ?? '',
        provider: providerConfig.id,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        source: 'assistant',
      });
    } catch (err) {
      console.error('[AssistantChatArea] recordUsage failed:', err);
    }
  };

  // ── Send message ──────────────────────────────────────────
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
      if (!provider) {
        throw new Error('No API key configured. Go to Settings \u2192 API Keys to add one.');
      }

      const history = messages
        .filter((m) => m.content.trim() !== '')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const apiMessages = [
        ...history,
        { role: 'user' as const, content: messageText },
      ];

      const assistantId = (Date.now() + 1).toString();
      addMessage({ id: assistantId, role: 'assistant', content: '', timestamp: new Date() });

      let fullResponse = '';

      const systemPrompt = buildSystemPrompt(
        activeAccounts.map((a) => ({
          provider: a.provider,
          email: a.email,
          accountLabel: a.accountLabel,
          providerType: a.providerType ?? 'email',
        }))
      );

      let memoryBlock = '';
      try {
        memoryBlock = await buildMemoryBlock();
      } catch {}

      const routinesBlock = buildRoutinesPromptBlock();
      const screenControlBlock = buildScreenControlPrompt();

      const assistantContext = {
        path: '',
        manifest: null,
        contextString: systemPrompt + memoryBlock + routinesBlock + screenControlBlock,
      };

      const result = await sendMessage(
        apiMessages,
        provider,
        (chunk) => {
          if (stoppedRef.current) return;
          fullResponse += chunk;
          useAssistantStore.setState((state) => ({
            messages: state.messages.map((m) =>
              m.id === assistantId ? { ...m, content: fullResponse } : m
            ),
          }));
        },
        assistantContext,
        undefined,
        (reader) => { readerRef.current = reader; }
      );

      fullResponse = result.text;

      useAssistantStore.setState((state) => ({
        messages: state.messages.map((m) =>
          m.id === assistantId ? { ...m, content: fullResponse } : m
        ),
      }));

      if (!stoppedRef.current) {
        await recordAssistantUsage(result, { id: provider.id, model: provider.model ?? '' });
      }

    } catch (error: any) {
      if (!stoppedRef.current) {
        useAssistantStore.setState((state) => ({
          messages: state.messages
            .filter((m) => m.content !== '')
            .concat({
              id: (Date.now() + 2).toString(),
              role: 'assistant',
              content: `\u274C ${error.message}`,
              timestamp: new Date(),
            }),
        }));
      }
    } finally {
      stoppedRef.current = false;
      readerRef.current = null;
      setLoading(false);

      const currentMsgs = useAssistantStore.getState().messages;
      if (currentMsgs.length >= 4) {
        extractObservations(
          currentMsgs.map((m) => ({ role: m.role, content: m.content })),
          'assistant'
        ).catch(() => {});
      }
    }
  }, [input, isLoading, messages, activeAccounts, screenControlEnabled, screenControlMode, onScreenControlModeChange, runScreenControlLoop]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestion = (text: string) => {
    handleSend(text);
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div className={`flex flex-col h-full ${t.colors.bg}`}>

      {/* Header */}
      <div className={`px-4 py-2 ${t.colors.bgSecondary} ${t.colors.border} border-b flex items-center justify-between flex-shrink-0`}>
        <span className={`text-sm ${t.colors.textMuted}`}>
          {screenControlMode ? `Screen Control \u2022 ${(() => {
            const s = loadScreenControlSettings();
            const m = s.modelPreference === 'haiku' ? 'Haiku'
              : s.modelPreference === 'sonnet' ? 'Sonnet'
              : s.modelPreference === 'opus' ? 'Opus'
              : 'Auto (Opus)';
            return m;
          })()}` : `${getActiveProviderDisplay()} \u2699`}
        </span>
        <div className="flex items-center gap-2">
          {screenControlEnabled && (
            <button
              onClick={() => {
                if (screenControlMode) {
                  onScreenControlModeChange?.(false);
                  if (screenControlStopRef) screenControlStopRef.current = true;
                } else {
                  onScreenControlModeChange?.(true);
                  onScreenControlStart?.();
                  onScreenControlStatus?.('idle', 0, 'Ready — type a command');
                }
              }}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium ${t.borderRadius} transition-colors ${
                screenControlMode
                  ? 'bg-green-600 text-white'
                  : `${t.colors.bgTertiary} ${t.colors.textMuted} hover:${t.colors.text}`
              }`}
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
              <button
                onClick={clearMessages}
                className={`p-1.5 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                title="New conversation"
              >
                <MessageSquarePlus size={16} />
              </button>
              <button
                onClick={clearMessages}
                className={`p-1 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                title="Clear chat"
              >
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
          />
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  <div className={`w-10 h-10 ${t.borderRadius} flex items-center justify-center flex-shrink-0 overflow-hidden`}>
                    <img src={theme === 'light' || theme === 'highContrast' ? elipseLight : elipseDark} alt="omnirun" className="w-10 h-10" />
                  </div>
                )}

                <div
                  className={`max-w-[80%] px-4 py-2 break-words overflow-hidden ${t.borderRadius} ${
                    message.role === 'user'
                      ? `${t.colors.accent} ${theme === 'highContrast' ? 'text-black' : 'text-white'}`
                      : `${t.colors.bgSecondary} ${t.colors.text}`
                  }`}
                >
                  <div className={t.fontFamily} style={{ fontSize: fontSize === 'small' ? '13px' : fontSize === 'large' ? '17px' : '15px' }}>
                    {message.content
                      ? message.role === 'assistant'
                        ? <MarkdownRenderer
                            content={cleanAiResponse(message.content)}
                            theme={t}
                            themeKey={theme}
                            projectPath={null}
                            onSaveCodeBlock={() => {}}
                          />
                        : message.content
                      : <span className={`${t.colors.textMuted} italic`}>Thinking...</span>
                    }
                  </div>
                  <div className={`text-[10px] mt-1 opacity-50 ${message.role === 'user' ? 'text-right' : ''}`}>
                    {new Date(message.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: timeFormat === '12h',
                    })}
                  </div>
                </div>

                {message.role === 'user' && (
                  <div className={`w-8 h-8 ${t.borderRadius} flex items-center justify-center flex-shrink-0 overflow-hidden`} style={{ background: showAvatar ? 'transparent' : 'var(--action, #7C3AED)' }}>
                    {showAvatar ? (
                      <img src={avatarUrl!} alt="avatar" className="w-8 h-8 object-cover" onError={() => setAvatarError(true)} />
                    ) : (
                      <span className="text-white text-xs font-semibold">{getInitials()}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className={`p-4 flex-shrink-0 ${t.colors.border} border-t`}>
        <div className="flex gap-2 max-w-3xl mx-auto">
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
            placeholder={
              isLoading
                ? 'Waiting for response...'
                : hasAccounts
                  ? screenControlEnabled
                    ? 'Ask about emails, calendar, or control your screen...'
                    : 'Ask about your emails, calendar, tasks...'
                  : 'Connect an account to get started...'
            }
            disabled={isLoading}
            rows={1}
            className={`flex-1 ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 ${t.fontFamily} disabled:opacity-50 resize-none overflow-hidden`}
            style={{ maxHeight: '200px' }}
          />
          {isLoading ? (
            <button
              onClick={handleStop}
              className={`bg-red-600 hover:bg-red-700 text-white px-4 py-2 ${t.borderRadius} flex items-center gap-2 self-end`}
            >
              <Square size={18} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className={`${t.colors.accent} ${t.colors.accentHover} ${theme === 'highContrast' ? 'text-black' : 'text-white'} px-4 py-2 ${t.borderRadius} flex items-center gap-2 disabled:opacity-50 self-end`}
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default AssistantChatArea;