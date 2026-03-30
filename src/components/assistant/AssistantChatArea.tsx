// ============================================================
// AssistantChatArea.tsx
// ============================================================
// Chat interface for the Assistant section.
// Same visual patterns as ChatArea.tsx but:
// - Uses assistantStore messages (not chatStore)
// - No project context, no tool calls, no file tree
// - System prompt focused on personal assistant tasks
// - Aware of connected email accounts so it can reference them
// - Shows onboarding empty state when no accounts are connected
// - Records usage to SQLite with source: 'assistant' for Usage dashboard

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, Bot, User, Trash2, MessageSquarePlus, Mail } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { themes } from '../../config/themes';
import { useAssistantStore, selectEmailAccounts } from '../../stores/assistantStore';
import { sendMessage } from '../../services/aiService';
import { dbService } from '../../services/dbService';
import MarkdownRenderer from '../chat/MarkdownRenderer';

interface AssistantChatAreaProps {
  plan: string;
}

// ─── System prompt ────────────────────────────────────────────
// Built fresh on each send so it always reflects current accounts.

function buildSystemPrompt(
  connectedEmails: { provider: string; email: string; accountLabel: string | null }[]
): string {
  const emailList = connectedEmails
    .map((a) => `- ${a.accountLabel || a.email} (${a.provider}: ${a.email})`)
    .join('\n');

  return `You are a personal AI assistant integrated into Omnirun, a desktop productivity app.

Your role is to help the user manage their personal communications and schedule — not to write code or build software (that is handled in the Projects section).

${connectedEmails.length > 0 ? `The user has connected the following email accounts:\n${emailList}\n\nYou can help them read, summarize, draft replies, and manage these email accounts via the Gmail API and Microsoft Graph API.` : 'The user has not connected any email accounts yet. If they ask about email, encourage them to connect an account using the panel on the left.'}

Your capabilities:
- Summarize unread or important emails
- Draft and send email replies in the user's voice
- Flag urgent emails and suggest actions
- Help organize and prioritize their inbox
- Answer questions about their emails
- Set reminders based on email content

Guidelines:
- Be concise and direct — the user is busy
- When drafting emails, match the user's tone from their existing messages
- Always confirm before sending anything on behalf of the user
- If you cannot take an action yet (e.g. calendar is not connected), say so clearly and suggest connecting it
- Never make up email content — only work with what the user tells you or what the API returns`;
}

// ─── Empty / onboarding state ─────────────────────────────────

function EmptyState({
  hasAccounts,
  onConnect,
  theme: t,
}: {
  hasAccounts: boolean;
  onConnect: () => void;
  theme: any;
}) {
  if (hasAccounts) {
    return (
      <div className={`${t.colors.textMuted} text-center mt-12 px-6`}>
        <Bot size={32} className="mx-auto mb-3 opacity-40" />
        <p className="text-sm font-medium mb-1">Your personal assistant is ready</p>
        <p className="text-xs leading-relaxed opacity-70">
          Ask me to check your emails, summarize your inbox, or draft a reply.
        </p>
        <div className={`mt-6 text-left mx-auto max-w-xs space-y-2`}>
          {[
            'What emails need my attention today?',
            'Summarize my unread emails',
            'Draft a reply to the latest email from Marco',
          ].map((suggestion) => (
            <button
              key={suggestion}
              className={`w-full text-left text-xs px-3 py-2 rounded-lg ${t.colors.bgSecondary} ${t.colors.border} border hover:opacity-80 transition-opacity ${t.colors.textMuted}`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="text-center mt-12 px-6 max-w-sm mx-auto">
      <div
        className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
        style={{ background: 'rgba(45,184,122,0.12)', border: '1px solid rgba(45,184,122,0.25)' }}
      >
        <Mail size={24} style={{ color: '#2DB87A' }} />
      </div>
      <p className={`text-sm font-medium mb-2 ${t.colors.text}`}>
        Connect your first email account
      </p>
      <p className={`text-xs leading-relaxed mb-5 ${t.colors.textMuted}`}>
        Connect Gmail or Outlook and your assistant can read, summarize, and reply to emails on your behalf.
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

function AssistantChatArea({ plan }: AssistantChatAreaProps) {
  const [input, setInput] = useState('');
  const stoppedRef = useRef(false);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { theme, timeFormat } = useSettingsStore();
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

  const emailAccounts = selectEmailAccounts(accounts);
  const hasAccounts = emailAccounts.length > 0;

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
    return { id: activeProviderId, apiKey: config.apiKey, model: config.selectedModel };
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
    const model = config.selectedModel?.split('-').slice(0, 2).join(' ') || '';
    return `${name} • ${model}`;
  };

  const handleStop = () => {
    stoppedRef.current = true;
    readerRef.current?.cancel().catch(() => {});
    readerRef.current = null;
    setLoading(false);
  };

  // ── Record assistant usage to SQLite ─────────────────────
  // Fires after each completed response. Never throws — usage tracking
  // is non-critical and must not interrupt the chat flow.
  //
  // Safely handles whatever shape sendMessage returns for usage data.
  // Cost defaults to 0 if not pre-calculated by aiService; token counts
  // are always accurate. Cost calculation is handled by usageStore when
  // the shared trackUsage path is later integrated here.
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
        throw new Error('No API key configured. Go to Settings → API Keys to add one.');
      }

      // Build API messages from store history
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
        emailAccounts.map((a) => ({
          provider: a.provider,
          email: a.email,
          accountLabel: a.accountLabel,
        }))
      );

      // Pass systemPrompt override via projectContext.contextString
      const assistantContext = {
        path: '',
        manifest: null,
        contextString: systemPrompt,
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

      // ── Track usage (source: 'assistant') ────────────────
      // Only record if the stream completed (not stopped by user).
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
              content: `❌ ${error.message}`,
              timestamp: new Date(),
            }),
        }));
      }
    } finally {
      stoppedRef.current = false;
      readerRef.current = null;
      setLoading(false);
    }
  }, [input, isLoading, messages, emailAccounts]);

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
          {getActiveProviderDisplay()} ⚙
        </span>
        <div className="flex items-center gap-2">
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
                  <div className={`w-8 h-8 ${t.colors.accent} ${t.borderRadius} flex items-center justify-center flex-shrink-0`}>
                    <Bot size={18} className={theme === 'highContrast' ? 'text-black' : 'text-white'} />
                  </div>
                )}

                <div
                  className={`max-w-[80%] px-4 py-2 break-words overflow-hidden ${t.borderRadius} ${
                    message.role === 'user'
                      ? `${t.colors.accent} ${theme === 'highContrast' ? 'text-black' : 'text-white'}`
                      : `${t.colors.bgSecondary} ${t.colors.text}`
                  }`}
                >
                  <div className={t.fontFamily}>
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
                  <div className={`w-8 h-8 ${t.colors.bgTertiary} ${t.borderRadius} flex items-center justify-center flex-shrink-0`}>
                    <User size={18} className={t.colors.text} />
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
                  ? 'Ask about your emails...'
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