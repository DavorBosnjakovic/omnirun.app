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
import { Send, Square, Bot, Trash2, MessageSquarePlus, Zap, Brain } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { themes } from '../../config/themes';
import {
  useAssistantStore,
  ASSISTANT_PROVIDERS,
} from '../../stores/assistantStore';
import { sendMessage } from '../../services/aiService';
import { dbService } from '../../services/dbService';
import { buildMemoryBlock, extractObservations } from '../../services/memoryService';
import { buildRoutinesPromptBlock } from '../../stores/routineStore';
import MarkdownRenderer from '../chat/MarkdownRenderer';
import elipseDark from '../../assets/elipse_transparent_dark.svg';
import elipseLight from '../../assets/elipse_transparent_light.svg';

interface AssistantChatAreaProps {
  plan: string;
  onToggleAboutMe: () => void;
  activeView: 'chat' | 'aboutme';
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

function AssistantChatArea({ plan, onToggleAboutMe, activeView }: AssistantChatAreaProps) {
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

  // ── Provider helpers (same pattern as ChatArea) ───────────
  const getActiveProvider = () => {
    const activeProviderId = localStorage.getItem('ai-active-provider') || 'anthropic';
    const savedProviders = localStorage.getItem('ai-providers');
    if (!savedProviders) return null;
    const providers = JSON.parse(savedProviders);
    const config = providers.find((p: any) => p.providerId === activeProviderId);
    if (!config || !config.apiKey) return null;

    let model = config.selectedModel;

    // Assistant tasks (emails, calendar, chat) are simple — prefer Haiku to save cost
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

    // Reflect the Haiku override for Anthropic in assistant
    if (activeProviderId === 'anthropic' && !/haiku/i.test(selectedModel)) {
      selectedModel = 'claude-haiku-4-5-20251001';
    }

    const model = selectedModel.split('-').slice(0, 2).join(' ') || '';
    return `${name} \u2022 ${model}`;
  };

  const handleStop = () => {
    stoppedRef.current = true;
    readerRef.current?.cancel().catch(() => {});
    readerRef.current = null;
    setLoading(false);
  };

  // ── Record assistant usage to SQLite ─────────────────────
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
      const totalTokens        = inputTokens + outputTokens;

      const cost       = raw.cost       ?? result?.cost       ?? 0;
      const inputCost  = raw.inputCost  ?? result?.inputCost  ?? 0;
      const outputCost = raw.outputCost ?? result?.outputCost ?? 0;

      await dbService.recordUsage({
        provider:             providerConfig.id,
        model:                providerConfig.model ?? '',
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        totalTokens,
        cost,
        inputCost,
        outputCost,
        taskLabel:  null,
        timestamp:  Date.now(),
        sessionId:  null,
        source:     'assistant',
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

      // Append memory context (what the AI knows about this user)
      let memoryBlock = '';
      try {
        memoryBlock = await buildMemoryBlock();
      } catch {
        // Non-fatal — proceed without memory
      }

      // Append routines context (trigger phrases and steps)
      const routinesBlock = buildRoutinesPromptBlock();

      const assistantContext = {
        path: '',
        manifest: null,
        contextString: systemPrompt + memoryBlock + routinesBlock,
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

      // Silent background: extract observations for memory system
      const currentMsgs = useAssistantStore.getState().messages;
      if (currentMsgs.length >= 4) {
        extractObservations(
          currentMsgs.map((m) => ({ role: m.role, content: m.content })),
          'assistant'
        ).catch(() => {}); // fire-and-forget, never block
      }
    }
  }, [input, isLoading, messages, activeAccounts]);

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
          {getActiveProviderDisplay()} \u2699
        </span>
        <div className="flex items-center gap-2">
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
                            content={message.content}
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
                  ? 'Ask about your emails, calendar, tasks...'
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