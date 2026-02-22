import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { ProjectManifest } from "./manifestService";
import { buildToolsPrompt } from "./toolService";
import { getConnectionsSummary } from "./connectionTool";
import { useSettingsStore } from "../stores/settingsStore";
import type { MessageImage } from "../stores/chatStore";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: MessageImage[];
}

interface Provider {
  id: string;
  apiKey: string;
  model: string;
  endpoint?: string;
}

interface ProjectContext {
  path: string;
  manifest: ProjectManifest | null;
  contextString?: string; // Lean context from contextService (~100-150 tokens)
  templateId?: string;    // Template slug if project was created from a template
  templateName?: string;  // Template display name
}

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

const ENDPOINTS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/models",
  ollama: "http://localhost:11434/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
};

export function buildSystemPrompt(context?: ProjectContext): string {
  let prompt = `You are Mydevify, an AI development assistant built into a desktop app. You help users build websites and applications by generating code.

When generating code:
- Generate complete, working files
- Use modern best practices
- If creating HTML, include all CSS and JS in the same file unless asked otherwise
- When editing existing files, provide the complete updated file

IMPORTANT: You have direct access to project files through tools. You MUST use them:
- Use list_directory to see what files and folders exist — don't guess the project structure.
- Use read_file to see file contents — never guess or ask the user to show you.
- Use write_file to create and edit files — never ask the user to copy/paste code.
- Use create_directory to make folders — never tell the user to create them.
- ALWAYS take action with tools. NEVER say "you should" or "you can" — just DO IT.
- When using tools, be concise. Do not explain what you're about to do or narrate your actions. Just do it and report results briefly.
- Only explore (list_directory/read_file) when you actually need to. If you already know the file from this conversation, just edit it directly.
- Do NOT run "npm install", "yarn install", "pnpm install", "npm run dev", "npm start", or any dev server commands. The app detects dependencies automatically and prompts the user to install them. The app also starts dev servers automatically. Just create the files and the app handles the rest.
- After completing a task, use write_context to note any important decisions or user preferences (e.g. "blue color scheme", "using localStorage for cart"). This helps you remember across conversations.
- When the user wants to automate something on a schedule (backups, deployments, cleanups, checks, etc.), use the create_scheduled_task tool. Do NOT write scheduling code — use the built-in task scheduler instead. Common cron patterns: "0 2 * * *" (daily 2am), "0 17 * * 5" (Fridays 5pm), "0 0 * * 0" (weekly Sunday midnight), "0 */6 * * *" (every 6 hours).
`;

  // Get connection context early so we can use it for both tools prompt and services section
  const connectionContext = getConnectionsSummary();

  if (context) {
    // Lean context: project info + AI notes (~100-150 tokens)
    // NO file tree — AI uses list_directory when it needs to explore
    if (context.contextString) {
      prompt += `\n## Project Context\n${context.contextString}\n`;
    } else {
      prompt += `\n## Current Project\n- **Path:** ${context.path}\n`;
    }

    const hasConnections = !!connectionContext;
    const { webSearchEnabled, searchApiKey } = useSettingsStore.getState();
    const includeWebSearch = webSearchEnabled && !!searchApiKey.trim();
    prompt += buildToolsPrompt(hasConnections, includeWebSearch);

    // Template context — let AI know the starting point
    if (context.templateId) {
      prompt += `\n## Template Origin\nThis project was created from the "${context.templateName || context.templateId}" template. The starter files are already in place. Build on top of them — don't recreate the scaffolding unless the user asks to start over.\n`;
    }
  }

  // Add connected services context (only if any are connected)
  if (connectionContext) {
    prompt += `\n## Connected Services\n${connectionContext}\n`;
  }

  return prompt;
}

/**
 * Build system prompt as structured content blocks for Anthropic prompt caching.
 * Static instructions go FIRST (cached). Dynamic project context goes LAST (not cached, but tiny).
 * cache_control is placed on the last static block so everything above it gets cached.
 */
function buildSystemPromptBlocks(context?: ProjectContext): Array<{ type: string; text: string; cache_control?: { type: string } }> {
  // ── Static instructions (identical across all projects/sessions) ──
  const staticInstructions = `You are Mydevify, an AI development assistant built into a desktop app. You help users build websites and applications by generating code.

When generating code:
- Generate complete, working files
- Use modern best practices
- If creating HTML, include all CSS and JS in the same file unless asked otherwise
- When editing existing files, provide the complete updated file

IMPORTANT: You have direct access to project files through tools. You MUST use them:
- Use list_directory to see what files and folders exist — don't guess the project structure.
- Use read_file to see file contents — never guess or ask the user to show you.
- Use write_file to create and edit files — never ask the user to copy/paste code.
- Use create_directory to make folders — never tell the user to create them.
- ALWAYS take action with tools. NEVER say "you should" or "you can" — just DO IT.
- When using tools, be concise. Do not explain what you're about to do or narrate your actions. Just do it and report results briefly.
- Only explore (list_directory/read_file) when you actually need to. If you already know the file from this conversation, just edit it directly.
- Do NOT run "npm install", "yarn install", "pnpm install", "npm run dev", "npm start", or any dev server commands. The app detects dependencies automatically and prompts the user to install them. The app also starts dev servers automatically. Just create the files and the app handles the rest.
- After completing a task, use write_context to note any important decisions or user preferences (e.g. "blue color scheme", "using localStorage for cart"). This helps you remember across conversations.
- When the user wants to automate something on a schedule (backups, deployments, cleanups, checks, etc.), use the create_scheduled_task tool. Do NOT write scheduling code — use the built-in task scheduler instead. Common cron patterns: "0 2 * * *" (daily 2am), "0 17 * * 5" (Fridays 5pm), "0 0 * * 0" (weekly Sunday midnight), "0 */6 * * *" (every 6 hours).`;

  // ── Tools prompt (static per session — tool definitions don't change) ──
  const connectionContext = getConnectionsSummary();
  const hasConnections = !!connectionContext;
  const { webSearchEnabled, searchApiKey } = useSettingsStore.getState();
  const includeWebSearch = webSearchEnabled && !!searchApiKey.trim();
  const toolsPrompt = context ? buildToolsPrompt(hasConnections, includeWebSearch) : "";

  // Combine static parts into one block and mark for caching
  const staticText = toolsPrompt
    ? `${staticInstructions}\n${toolsPrompt}`
    : staticInstructions;

  const blocks: Array<{ type: string; text: string; cache_control?: { type: string } }> = [
    {
      type: "text",
      text: staticText,
      cache_control: { type: "ephemeral" },
    },
  ];

  // ── Dynamic project context (~100-150 tokens, changes per project) ──
  if (context) {
    if (context.contextString) {
      blocks.push({ type: "text", text: `## Project Context\n${context.contextString}` });
    } else {
      blocks.push({ type: "text", text: `## Current Project\n- **Path:** ${context.path}` });
    }
  }

  // ── Connection summary (only if active) ──
  if (connectionContext) {
    blocks.push({ type: "text", text: `## Connected Services\n${connectionContext}` });
  }

  // ── Template origin (only if project was created from a template) ──
  if (context?.templateId) {
    blocks.push({
      type: "text",
      text: `## Template Origin\nThis project was created from the "${context.templateName || context.templateId}" template. The starter files are already in place. Build on top of them — don't recreate the scaffolding unless the user asks to start over.`,
    });
  }

  return blocks;
}

export function flattenFileTree(entries: any[], prefix = ""): string {
  let result = "";
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.is_dir) {
      result += `📁 ${path}/\n`;
      if (entry.children) {
        result += flattenFileTree(entry.children, path);
      }
    } else {
      result += `  ${path}\n`;
    }
  }
  return result;
}

// ——— Format messages with images for each provider ——————————————

function formatAnthropicMessages(messages: Message[]) {
  const formatted = messages.map((m) => {
    if (m.images && m.images.length > 0) {
      const content: any[] = [];
      // Images first
      for (const img of m.images) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mimeType,
            data: img.base64,
          },
        });
      }
      // Then text
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      return { role: m.role, content };
    }
    return { role: m.role, content: m.content };
  });

  // Add cache breakpoint on second-to-last user message.
  // This caches the entire conversation prefix up to that point,
  // so only the latest user message + assistant response are uncached.
  if (formatted.length >= 3) {
    // Find indices of user messages
    const userIndices: number[] = [];
    formatted.forEach((m, i) => { if (m.role === "user") userIndices.push(i); });

    if (userIndices.length >= 2) {
      const idx = userIndices[userIndices.length - 2];
      const msg = formatted[idx];

      if (typeof msg.content === "string") {
        msg.content = [{
          type: "text",
          text: msg.content,
          cache_control: { type: "ephemeral" },
        }];
      } else if (Array.isArray(msg.content) && msg.content.length > 0) {
        const lastBlock = msg.content[msg.content.length - 1];
        lastBlock.cache_control = { type: "ephemeral" };
      }
    }
  }

  return formatted;
}

function formatOpenAIMessages(messages: Message[], systemPrompt: string) {
  const formatted: any[] = [{ role: "system", content: systemPrompt }];

  for (const m of messages) {
    if (m.images && m.images.length > 0) {
      const content: any[] = [];
      // Images first
      for (const img of m.images) {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${img.mimeType};base64,${img.base64}`,
          },
        });
      }
      // Then text
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      formatted.push({ role: m.role, content });
    } else {
      formatted.push({ role: m.role, content: m.content });
    }
  }

  return formatted;
}

function formatGoogleMessages(messages: Message[], systemPrompt: string) {
  const contents: any[] = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Understood. I'm ready to help." }] },
  ];

  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts: any[] = [];

    // Images first
    if (m.images && m.images.length > 0) {
      for (const img of m.images) {
        parts.push({
          inline_data: {
            mime_type: img.mimeType,
            data: img.base64,
          },
        });
      }
    }
    // Then text
    if (m.content) {
      parts.push({ text: m.content });
    }

    contents.push({ role, parts });
  }

  return contents;
}

// ——— History Trimming (Phase 3.1) ——————————————————————————————————
// Collapse consumed tool results to save tokens.
// Any tool_result that the AI has already responded to gets replaced
// with a short summary. Only the most recent tool_result (not yet
// consumed) keeps its full content.

function trimHistory(messages: Message[]): Message[] {
  const trimmed: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Only process user messages that contain tool results
    if (msg.role !== "user" || !msg.content.includes("<tool_result>")) {
      trimmed.push(msg);
      continue;
    }

    // Check if there's an assistant message AFTER this one.
    // If yes, the AI already consumed this result — safe to collapse.
    const hasAssistantAfter = messages.slice(i + 1).some((m) => m.role === "assistant");

    if (!hasAssistantAfter) {
      // This is the most recent tool result — keep full content
      trimmed.push(msg);
      continue;
    }

    // Collapse the tool result content, preserving images if any
    trimmed.push({
      ...msg,
      content: collapseToolResult(msg.content),
    });
  }

  return trimmed;
}

function collapseToolResult(content: string): string {
  // Process each <tool_result>...</tool_result> block in the message
  return content.replace(
    /<tool_result>\n?([\s\S]*?)\n?<\/tool_result>/g,
    (_match, inner: string) => {
      const collapsed = collapseSingleResult(inner.trim());
      return `<tool_result>\n${collapsed}\n</tool_result>`;
    }
  );
}

function collapseSingleResult(result: string): string {
  // Already short (covers ✅ Written, ✅ Edited, short errors) — keep as-is
  if (result.length < 300) return result;

  // Strip optional [tool_name] prefix for pattern matching, re-add after
  let prefix = "";
  let body = result;
  const prefixMatch = result.match(/^\[(\w+)\]\s*/);
  if (prefixMatch) {
    prefix = prefixMatch[0];
    body = result.slice(prefix.length);
  }

  // Pattern 1: File read — "Contents of path:\n```\n...content...\n```"
  const fileReadMatch = body.match(/^Contents of (.+?):\n```\n([\s\S]*)\n```$/);
  if (fileReadMatch) {
    const filePath = fileReadMatch[1];
    const lineCount = fileReadMatch[2].split("\n").length;
    return `${prefix}[read ${filePath} — ${lineCount} lines]`;
  }

  // Pattern 2: Directory listing — "Contents of path:\n..."
  const dirMatch = body.match(/^Contents of (.+?):\n/);
  if (dirMatch) {
    const dirPath = dirMatch[1];
    const entryCount = body.split("\n").length - 1;
    return `${prefix}[listed ${dirPath} — ${entryCount} entries]`;
  }

  // Pattern 3: Multiple file reads in one result
  const multiFileMatches = body.match(/Contents of .+?:/g);
  if (multiFileMatches && multiFileMatches.length > 1) {
    const files = multiFileMatches.map((m) => m.replace("Contents of ", "").replace(":", ""));
    return `${prefix}[read ${files.length} files: ${files.join(", ")}]`;
  }

  // Fallback: keep first line + collapsed note
  const firstLine = body.split("\n")[0];
  return `${prefix}${firstLine} [...collapsed, ${body.length} chars]`;
}

// ——— History Limiting (Phase 3.2) —————————————————————————————————
// Keep only the last 10 user/assistant pairs (20 messages).
// Older turns are dropped — the AI still has the project manifest
// for context about what files exist.

const MAX_HISTORY_PAIRS = 10;

function limitHistory(messages: Message[]): Message[] {
  if (messages.length <= MAX_HISTORY_PAIRS * 2) return messages;

  // Keep the last 20 messages (10 pairs)
  return messages.slice(-MAX_HISTORY_PAIRS * 2);
}

// ——— Main send function —————————————————————————————————————————

export async function sendMessage(
  messages: Message[],
  provider: Provider,
  onStream?: (chunk: string) => void,
  projectContext?: ProjectContext,
  signal?: AbortSignal,
  onReader?: (reader: ReadableStreamDefaultReader) => void
): Promise<{ text: string; usage: UsageData }> {
  let endpoint = provider.endpoint || ENDPOINTS[provider.id];

  // Trim consumed tool results, then limit to last 10 pairs
  const trimmedMessages = limitHistory(trimHistory(messages));

  // Strip images for providers that don't support image_url in messages
  const supportsImages = ["anthropic", "openai", "google"].includes(provider.id);
  const cleanMessages = supportsImages
    ? trimmedMessages
    : trimmedMessages.map((m) => ({ ...m, images: undefined }));

  if (provider.id === "ollama" && provider.apiKey) {
    const baseUrl = provider.apiKey.replace(/\/+$/, "");
    endpoint = `${baseUrl}/v1/chat/completions`;
  }

  if (provider.id === "anthropic") {
    // Anthropic: structured content blocks with prompt caching
    const systemBlocks = buildSystemPromptBlocks(projectContext);
    return await sendAnthropicMessage(cleanMessages, provider, systemBlocks, onStream, onReader);
  }

  // All other providers: plain string system prompt
  const systemPrompt = buildSystemPrompt(projectContext);

  if (provider.id === "google") {
    return await sendGoogleMessage(cleanMessages, provider, systemPrompt);
  } else {
    return await sendOpenAICompatibleMessage(cleanMessages, provider, endpoint, systemPrompt, onStream, onReader);
  }
}

async function sendOpenAICompatibleMessage(
  messages: Message[],
  provider: Provider,
  endpoint: string,
  systemPrompt: string,
  onStream?: (chunk: string) => void,
  onReader?: (reader: ReadableStreamDefaultReader) => void
): Promise<{ text: string; usage: UsageData }> {
  const allMessages = formatOpenAIMessages(messages, systemPrompt);

  const body: any = {
    model: provider.model,
    messages: allMessages,
    stream: !!onStream,
  };

  // Ask for usage data in streaming mode (OpenAI & Groq support this)
  if (onStream) {
    body.stream_options = { include_usage: true };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`,
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  const usage: UsageData = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  if (onStream && response.body) {
    const reader = response.body.getReader();
    if (onReader) onReader(reader);
    const decoder = new TextDecoder();
    let fullContent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || "";
            if (content) {
              fullContent += content;
              onStream(content);
            }
            // Capture usage from the final chunk (OpenAI/Groq send it here)
            if (parsed.usage) {
              usage.inputTokens = parsed.usage.prompt_tokens || 0;
              usage.outputTokens = parsed.usage.completion_tokens || 0;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch (e: any) {
      // Reader was cancelled (user hit stop) — return what we have
      return { text: fullContent, usage };
    }

    return { text: fullContent, usage };
  }

  const data = await response.json();

  // Capture usage from non-streaming response
  if (data.usage) {
    usage.inputTokens = data.usage.prompt_tokens || 0;
    usage.outputTokens = data.usage.completion_tokens || 0;
  }

  return { text: data.choices?.[0]?.message?.content || "", usage };
}

async function sendAnthropicMessage(
  messages: Message[],
  provider: Provider,
  systemBlocks: Array<{ type: string; text: string; cache_control?: { type: string } }>,
  onStream?: (chunk: string) => void,
  onReader?: (reader: ReadableStreamDefaultReader) => void
): Promise<{ text: string; usage: UsageData }> {
  const formattedMessages = formatAnthropicMessages(messages);

  const response = await fetch(ENDPOINTS.anthropic, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "token-efficient-tools-2025-02-19",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 4096,
      system: systemBlocks,
      messages: formattedMessages,
      stream: !!onStream,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  const usage: UsageData = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  if (onStream && response.body) {
    const reader = response.body.getReader();
    if (onReader) onReader(reader);
    const decoder = new TextDecoder();
    let fullContent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);

            // Content streaming
            if (parsed.type === "content_block_delta") {
              const content = parsed.delta?.text || "";
              if (content) {
                fullContent += content;
                onStream(content);
              }
            }

            // Anthropic sends input tokens in message_start
            if (parsed.type === "message_start" && parsed.message?.usage) {
              usage.inputTokens = parsed.message.usage.input_tokens || 0;
              usage.cacheCreationTokens = parsed.message.usage.cache_creation_input_tokens || 0;
              usage.cacheReadTokens = parsed.message.usage.cache_read_input_tokens || 0;
            }

            // Anthropic sends output tokens in message_delta
            if (parsed.type === "message_delta" && parsed.usage) {
              usage.outputTokens = parsed.usage.output_tokens || 0;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch (e: any) {
      // Reader was cancelled (user hit stop) — return what we have
      return { text: fullContent, usage };
    }

    return { text: fullContent, usage };
  }

  const data = await response.json();

  // Capture usage from non-streaming response
  if (data.usage) {
    usage.inputTokens = data.usage.input_tokens || 0;
    usage.outputTokens = data.usage.output_tokens || 0;
    usage.cacheCreationTokens = data.usage.cache_creation_input_tokens || 0;
    usage.cacheReadTokens = data.usage.cache_read_input_tokens || 0;
  }

  return { text: data.content?.[0]?.text || "", usage };
}

async function sendGoogleMessage(
  messages: Message[],
  provider: Provider,
  systemPrompt: string
): Promise<{ text: string; usage: UsageData }> {
  const endpoint = `${ENDPOINTS.google}/${provider.model}:generateContent?key=${provider.apiKey}`;
  const contents = formatGoogleMessages(messages, systemPrompt);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ contents }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  const usage: UsageData = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  // Google sends usage in usageMetadata
  if (data.usageMetadata) {
    usage.inputTokens = data.usageMetadata.promptTokenCount || 0;
    usage.outputTokens = data.usageMetadata.candidatesTokenCount || 0;
  }

  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "", usage };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}