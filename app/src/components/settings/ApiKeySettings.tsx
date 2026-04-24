import { useState, useEffect, useRef } from "react";
import {
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Loader2,
  Plus,
  Trash2,
  Star,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Shield,
  ExternalLink,
  Plug,
  Unplug,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTeamStore } from "../../stores/teamStore";
import { themes } from "../../config/themes";
import { fetch } from "@tauri-apps/plugin-http";
import {
  ANTHROPIC_MODELS,
  ANTHROPIC_MODEL_OPTIONS,
  ANTHROPIC_MODEL_MIGRATIONS,
} from "../../config/anthropicModels";

// --------------- Provider Icons ---------------

import anthropicIcon from '../../assets/icons/providers/anthropic.svg';
import groqIcon from '../../assets/icons/providers/groq.svg';
import openaiIcon from '../../assets/icons/providers/openai.svg';
import googleIcon from '../../assets/icons/providers/google-gemini.svg';
import deepseekIcon from '../../assets/icons/providers/deepseek.svg';
import ollamaIcon from '../../assets/icons/providers/ollama.svg';

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: anthropicIcon,
  groq: groqIcon,
  openai: openaiIcon,
  google: googleIcon,
  deepseek: deepseekIcon,
  ollama: ollamaIcon,
};

function getProviderIcon(providerId: string): string | null {
  return PROVIDER_ICONS[providerId] || null;
}

// --------------- Types ---------------

interface Provider {
  id: string;
  name: string;
  description: string;
  keyPlaceholder: string;
  keyPrefix: string;
  defaultModel: string;
  free: boolean;
  isCustom?: boolean;
  endpoint?: string;
  keyUrl?: string;
  keyUrlLabel?: string;
}

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    description: "Recommended — Smart routing uses Haiku/Sonnet/Opus based on task",
    keyPlaceholder: "sk-ant-...",
    keyPrefix: "sk-ant-",
    defaultModel: ANTHROPIC_MODELS.sonnet,
    free: false,
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyUrlLabel: "Get your API Key",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Free tier available — Very fast inference",
    keyPlaceholder: "gsk_...",
    keyPrefix: "gsk_",
    defaultModel: "llama-3.3-70b-versatile",
    free: true,
    keyUrl: "https://console.groq.com/keys",
    keyUrlLabel: "Get your API Key",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o and GPT-4o mini",
    keyPlaceholder: "sk-...",
    keyPrefix: "sk-",
    defaultModel: "gpt-4o",
    free: false,
    keyUrl: "https://platform.openai.com/api-keys",
    keyUrlLabel: "Get your API Key",
  },
  {
    id: "google",
    name: "Google (Gemini)",
    description: "Free tier available — Gemini Flash and Pro",
    keyPlaceholder: "AI...",
    keyPrefix: "AI",
    defaultModel: "gemini-2.0-flash",
    free: true,
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyUrlLabel: "Get your API Key",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "Very cheap — 5M free tokens on signup",
    keyPlaceholder: "sk-...",
    keyPrefix: "sk-",
    defaultModel: "deepseek-chat",
    free: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyUrlLabel: "Get your API Key",
  },
  {
    id: "ollama",
    name: "Ollama (Local, free)",
    description: "Free — Run models locally on your machine",
    keyPlaceholder: "http://localhost:11434",
    keyPrefix: "",
    defaultModel: "llama3.1",
    free: true,
    keyUrl: "https://ollama.com/download",
    keyUrlLabel: "Download Ollama",
  },
];

interface FetchedModel {
  id: string;
  name: string;
}

interface ConfiguredProvider {
  providerId: string;
  apiKey: string;
  selectedModel: string;
  status: "idle" | "testing" | "success" | "error";
  endpoint?: string;
  name?: string;
}

interface CustomProviderForm {
  name: string;
  endpoint: string;
  apiKey: string;
  modelName: string;
}

// ── Model fetching logic per provider ──────────────────────────

async function fetchModelsForProvider(
  providerId: string,
  apiKey: string,
  endpoint?: string
): Promise<FetchedModel[]> {
  try {
    if (providerId === "anthropic") {
      try {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "User-Agent": "Mozilla/5.0",
          },
        });
        if (res.ok) {
          const data = await res.json();
          const models = (data.data || [])
            .map((m: any) => ({
              id: m.id,
              name: m.display_name || m.id,
            }))
            .sort((a: FetchedModel, b: FetchedModel) => a.name.localeCompare(b.name));
          if (models.length > 0) return models;
        }
      } catch (e) {
        console.warn("Failed to fetch Anthropic models, using fallback list:", e);
      }
      return ANTHROPIC_MODEL_OPTIONS;
    }

    if (providerId === "google") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { method: "GET", headers: { "User-Agent": "Mozilla/5.0" } }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      return (data.models || [])
        .filter((m: any) =>
          m.supportedGenerationMethods?.includes("generateContent") &&
          !m.name.includes("embedding") &&
          !m.name.includes("aqa") &&
          !m.name.includes("imagen") &&
          !m.name.includes("tts")
        )
        .map((m: any) => ({
          id: m.name.replace("models/", ""),
          name: m.displayName || m.name.replace("models/", ""),
        }))
        .sort((a: FetchedModel, b: FetchedModel) => a.name.localeCompare(b.name));
    }

    if (providerId === "ollama") {
      const baseUrl = apiKey || "http://localhost:11434";
      const res = await fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      return (data.models || []).map((m: any) => ({
        id: m.name,
        name: m.name,
      }));
    }

    // OpenAI-compatible (OpenAI, Groq, DeepSeek, custom)
    const url = endpoint
      ? endpoint.replace("/chat/completions", "/models")
      : providerId === "groq"
      ? "https://api.groq.com/openai/v1/models"
      : providerId === "deepseek"
      ? "https://api.deepseek.com/v1/models"
      : "https://api.openai.com/v1/models";

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    return (data.data || [])
      .filter((m: any) => {
        const id = m.id?.toLowerCase() || "";
        return (
          !id.includes("embed") &&
          !id.includes("moderation") &&
          !id.includes("whisper") &&
          !id.includes("tts") &&
          !id.includes("dall-e")
        );
      })
      .map((m: any) => ({
        id: m.id,
        name: m.id,
      }))
      .sort((a: FetchedModel, b: FetchedModel) => a.id.localeCompare(b.id));
  } catch (e) {
    console.warn(`Failed to fetch models for ${providerId}:`, e);
    return [];
  }
}

// ── Themed dropdown ──────────────────────────────────────────

function CustomSelect({
  value,
  options,
  onChange,
  t,
  maxWidth,
}: {
  value: string;
  options: { id: string; name: string }[];
  onChange: (value: string) => void;
  t: any;
  maxWidth?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = options.find((o) => o.id === value);
  const label = selected?.name || value || "Select...";

  return (
    <div className="relative" ref={ref} style={{ maxWidth: maxWidth || "20rem" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary} ${t.colors.text} hover:opacity-80 transition-opacity`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          size={13}
          className={`${t.colors.textMuted} transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`absolute left-0 top-full mt-1 w-full ${t.colors.bg} border ${t.colors.border} ${t.borderRadius} shadow-xl z-20 overflow-hidden py-1 max-h-60 overflow-y-auto`}
        >
          {options.map((option) => {
            const isActive = option.id === value;
            return (
              <button
                key={option.id}
                onClick={() => { onChange(option.id); setOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left hover:opacity-70 transition-opacity ${
                  isActive ? t.colors.text : t.colors.textMuted
                }`}
              >
                <span className="truncate">{option.name}</span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Status Badge (matches ConnectionsSettings) ───────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "success":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-green-400">
          <CheckCircle size={12} /> Connected
        </span>
      );
    case "testing":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-yellow-400">
          <Loader2 size={12} className="animate-spin" /> Testing...
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-red-400">
          <XCircle size={12} /> Error
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-xs opacity-50">
          <Unplug size={12} /> Not connected
        </span>
      );
  }
}

// ── Provider Card (collapsible, matches ConnectionsSettings) ──

function ProviderCard({
  config,
  provider,
  isActive,
  isAssistant,
  models,
  isFetching,
  fetchedModelsList,
  showKey,
  smartRouting,
  theme,
  t,
  onUpdate,
  onRemove,
  onTest,
  onFetchModels,
  onToggleShowKey,
  onSetSmartRouting,
  onSetActive,
  canRemove,
}: {
  config: ConfiguredProvider | null;
  provider: Provider;
  isActive: boolean;
  isAssistant: boolean;
  models: FetchedModel[];
  isFetching: boolean;
  fetchedModelsList: FetchedModel[];
  showKey: boolean;
  smartRouting: boolean;
  theme: string;
  t: any;
  onUpdate: (updates: Partial<ConfiguredProvider>) => void;
  onRemove: () => void;
  onTest: () => void;
  onFetchModels: () => void;
  onToggleShowKey: () => void;
  onSetSmartRouting: (v: boolean) => void;
  onSetActive: () => void;
  canRemove: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isConnected = config?.status === "success";
  const isConfigured = config !== null;
  const providerIcon = getProviderIcon(provider.id);

  return (
    <div
      className={`overflow-hidden ${t.colors.bgSecondary} ${t.borderRadius}`}
      style={isConnected ? { border: '1px solid #2DB87A' } : undefined}
    >
      {/* Header Row */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {providerIcon ? (
            <img
              src={providerIcon}
              alt={provider.name}
              className="w-[30px] h-[30px] shrink-0"
            />
          ) : (
            <span className="w-[30px] h-[30px] shrink-0 flex items-center justify-center text-sm font-bold opacity-60">
              {provider.name.charAt(0)}
            </span>
          )}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{provider.name}</span>
              {provider.id === "anthropic" && (
                <span className="flex items-center gap-1 text-xs text-yellow-500">
                  <Star size={12} fill="currentColor" /> Recommended
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isActive && (
            <span className={`text-xs px-2 py-0.5 bg-green-600 text-white ${t.borderRadius}`}>
              Projects
            </span>
          )}
          {isAssistant && (
            <span className={`text-xs px-2 py-0.5 bg-blue-600 text-white ${t.borderRadius}`}>
              Assistant
            </span>
          )}
          <StatusBadge status={config?.status || "idle"} />
          {expanded
            ? <ChevronUp size={14} className="opacity-50" />
            : <ChevronDown size={14} className="opacity-50" />
          }
        </div>
      </div>

      {/* Expanded Section */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-opacity-10 border-current">

          {/* Get API Key link */}
          {provider.keyUrl && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  const { openUrl } = await import("@tauri-apps/plugin-opener");
                  await openUrl(provider.keyUrl!);
                } catch {
                  window.open(provider.keyUrl, "_blank");
                }
              }}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition cursor-pointer mt-3"
            >
              {provider.keyUrlLabel || "Get your API Key"} <ExternalLink size={10} />
            </button>
          )}

          {/* API Key / Server URL input */}
          <div className="mt-3 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? "text" : "password"}
                  value={config?.apiKey || ""}
                  onChange={(e) => onUpdate({ apiKey: e.target.value, status: "idle" })}
                  onKeyDown={(e) => { if (e.key === "Enter") onTest(); }}
                  placeholder={provider.keyPlaceholder}
                  className={`w-full px-3 py-2 pr-8 text-xs border outline-none focus:outline-none ${t.colors.bgSecondary} ${t.colors.border} ${t.colors.text} ${t.borderRadius}`}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleShowKey(); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
                >
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onTest(); }}
                disabled={(!config?.apiKey?.trim() && provider.id !== "ollama") || config?.status === "testing"}
                className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {config?.status === "testing"
                  ? <><Loader2 size={12} className="animate-spin" /> Testing...</>
                  : <><Plug size={12} /> Connect</>
                }
              </button>
            </div>

            {/* Connection status messages */}
            {config?.status === "success" && (
              <div className={`rounded-md p-2 text-xs flex items-center gap-1.5 ${
                theme === "light" ? "bg-green-50 text-green-800" : "bg-green-500/10 text-green-300"
              }`}>
                <CheckCircle size={12} /> Connection successful!
              </div>
            )}
            {config?.status === "error" && (
              <div className="rounded-md p-2 bg-red-500/10 text-red-400 text-xs flex items-center gap-1.5">
                <XCircle size={12} /> Connection failed. Check your key and try again.
              </div>
            )}

            {/* Set as active button */}
            {isConnected && !isActive && (
              <button
                onClick={(e) => { e.stopPropagation(); onSetActive(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition"
              >
                <Star size={12} /> Set as Active Provider
              </button>
            )}

            {/* Smart Routing (Anthropic only) */}
            {provider.id === "anthropic" && isConfigured && (
              <label className="flex items-center gap-3 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={smartRouting}
                  onChange={(e) => onSetSmartRouting(e.target.checked)}
                  className="w-4 h-4"
                  onClick={(e) => e.stopPropagation()}
                />
                <div>
                  <span className="font-medium text-xs">Smart Routing</span>
                  <p className="text-xs opacity-50">
                    Automatically use Haiku for quick tasks, Sonnet for normal work, Opus for complex problems
                  </p>
                </div>
              </label>
            )}

            {/* Model selection */}
            {isConfigured && !(provider.id === "anthropic" && smartRouting) && (
              <div>
                <label className="text-xs font-medium opacity-60 block mb-1.5">Model</label>
                <div className="flex gap-2 items-center">
                  {provider.isCustom ? (
                    <input
                      type="text"
                      value={config?.selectedModel || ""}
                      onChange={(e) => onUpdate({ selectedModel: e.target.value })}
                      className={`w-full max-w-xs px-3 py-2 text-xs border outline-none focus:outline-none ${t.colors.bgSecondary} ${t.colors.border} ${t.colors.text} ${t.borderRadius}`}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <CustomSelect
                      value={config?.selectedModel || provider.defaultModel}
                      onChange={(val) => onUpdate({ selectedModel: val })}
                      options={models}
                      t={t}
                      maxWidth="20rem"
                    />
                  )}
                  {!provider.isCustom && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onFetchModels(); }}
                      disabled={(!config?.apiKey?.trim() && provider.id !== "ollama") || isFetching}
                      title="Fetch available models"
                      className="p-2 opacity-50 hover:opacity-100 disabled:opacity-30 transition"
                    >
                      <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
                    </button>
                  )}
                </div>
                {isFetching && (
                  <p className="text-xs opacity-40 mt-1">Fetching models...</p>
                )}
                {fetchedModelsList.length > 1 && (
                  <p className="text-xs opacity-40 mt-1">
                    {fetchedModelsList.length} models available
                  </p>
                )}
              </div>
            )}

            {/* Helpful hint for unconfigured cards */}
            {!isConfigured && (
              <div className="text-xs opacity-40">
                Enter your API key above to start using {provider.name}.
              </div>
            )}

            {/* Disconnect button */}
            {isConfigured && canRemove && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                >
                  <Unplug size={12} /> Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────

function ApiKeySettings() {
  const { theme, smartRouting, setSmartRouting } = useSettingsStore();
  const t = themes[theme];

  // Team shared key state
  const { hasTeam, team, isOwner } = useTeamStore();
  const isSharedMember = hasTeam && team?.api_key_policy === "shared" && !isOwner;

  const [providers, setProviders] = useState<Provider[]>(() => {
    // Restore custom provider definitions from saved configs
    try {
      const saved = localStorage.getItem("ai-providers");
      if (saved) {
        const parsed = JSON.parse(saved);
        const customProviders: Provider[] = parsed
          .filter((p: any) => p.providerId?.startsWith("custom-"))
          .map((p: any) => ({
            id: p.providerId,
            name: p.name || p.providerName || p.selectedModel || p.providerId,
            description: p.endpoint ? `Custom — ${p.endpoint}` : "Custom provider",
            keyPlaceholder: "API key...",
            keyPrefix: "",
            defaultModel: p.selectedModel || "",
            free: false,
            isCustom: true,
            endpoint: p.endpoint || "",
          }));
        return [...DEFAULT_PROVIDERS, ...customProviders];
      }
    } catch { /* use defaults */ }
    return DEFAULT_PROVIDERS;
  });
  const [configuredProviders, setConfiguredProviders] = useState<ConfiguredProvider[]>(() => {
    try {
      const saved = localStorage.getItem("ai-providers");
      if (saved) {
        const parsed = JSON.parse(saved);
        const MODEL_MIGRATIONS = ANTHROPIC_MODEL_MIGRATIONS;
        let migrated = false;
        for (const p of parsed) {
          if (p.selectedModel && MODEL_MIGRATIONS[p.selectedModel]) {
            p.selectedModel = MODEL_MIGRATIONS[p.selectedModel];
            migrated = true;
          }
        }
        if (migrated) {
          localStorage.setItem("ai-providers", JSON.stringify(parsed));
        }
        return parsed;
      }
    } catch (e) {
      console.warn("Failed to load/migrate providers from localStorage:", e);
    }
    return [{ providerId: "anthropic", apiKey: "", selectedModel: ANTHROPIC_MODELS.sonnet, status: "idle" }];
  });

  const [activeProvider, setActiveProvider] = useState(() => {
    return localStorage.getItem("ai-active-provider") || "anthropic";
  });
  const [assistantProvider, setAssistantProvider] = useState(() => {
    return localStorage.getItem("ai-assistant-provider") || "";
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customForm, setCustomForm] = useState<CustomProviderForm>({
    name: "",
    endpoint: "",
    apiKey: "",
    modelName: "",
  });

  const [fetchedModels, setFetchedModels] = useState<Record<string, FetchedModel[]>>({});
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});

  const getProvider = (id: string): Provider => {
    const found = providers.find((p) => p.id === id);
    if (found) return found;
    // Fallback for custom providers not yet in the providers list
    const config = configuredProviders.find((p) => p.providerId === id);
    const displayName = config?.name || config?.selectedModel || id;
    return {
      id,
      name: displayName,
      description: config?.endpoint ? `Custom — ${config.endpoint}` : "Custom provider",
      keyPlaceholder: "API key...",
      keyPrefix: "",
      defaultModel: config?.selectedModel || "",
      free: false,
      isCustom: true,
      endpoint: config?.endpoint,
    };
  };

  const handleFetchModels = async (providerId: string) => {
    const config = configuredProviders.find((p) => p.providerId === providerId);
    if (!config?.apiKey.trim() && providerId !== "ollama") return;

    const provider = getProvider(providerId);
    setFetchingModels((prev) => ({ ...prev, [providerId]: true }));

    const models = await fetchModelsForProvider(
      providerId,
      config?.apiKey || "",
      provider.endpoint
    );

    setFetchedModels((prev) => ({ ...prev, [providerId]: models }));
    setFetchingModels((prev) => ({ ...prev, [providerId]: false }));

    if (models.length > 0 && config) {
      const currentValid = models.some((m) => m.id === config.selectedModel);
      if (!currentValid) {
        const defaultMatch = models.find((m) => m.id === provider.defaultModel);
        handleUpdateProvider(providerId, {
          selectedModel: defaultMatch?.id ?? provider.defaultModel,
        });
      }
    }
  };

  /** Auto-add a provider config when user starts typing in an unconfigured card */
  const ensureConfigured = (providerId: string): ConfiguredProvider => {
    const existing = configuredProviders.find((p) => p.providerId === providerId);
    if (existing) return existing;

    const provider = getProvider(providerId);
    const newConfig: ConfiguredProvider = {
      providerId,
      apiKey: "",
      selectedModel: provider.defaultModel,
      status: "idle",
    };
    setConfiguredProviders((prev) => [...prev, newConfig]);
    return newConfig;
  };

  const handleRemoveProvider = (providerId: string) => {
    const provider = getProvider(providerId);
    setConfiguredProviders(configuredProviders.filter((p) => p.providerId !== providerId));

    if (provider.isCustom) {
      setProviders(providers.filter((p) => p.id !== providerId));
    }

    if (activeProvider === providerId) {
      const remaining = configuredProviders.filter((p) => p.providerId !== providerId);
      setActiveProvider(remaining[0]?.providerId || "anthropic");
    }
  };

  const handleUpdateProvider = (providerId: string, updates: Partial<ConfiguredProvider>) => {
    ensureConfigured(providerId);
    setConfiguredProviders((prev) =>
      prev.map((p) =>
        p.providerId === providerId ? { ...p, ...updates } : p
      )
    );
  };

  const handleTestConnection = async (providerId: string) => {
    const config = ensureConfigured(providerId);
    const currentConfig = configuredProviders.find((p) => p.providerId === providerId) || config;
    if (!currentConfig.apiKey?.trim() && providerId !== "ollama") return;

    handleUpdateProvider(providerId, { status: "testing" });

    const provider = getProvider(providerId);
    const models = await fetchModelsForProvider(
      providerId,
      currentConfig.apiKey || "",
      provider.endpoint
    );

    setFetchedModels((prev) => ({ ...prev, [providerId]: models }));

    if (models.length > 0) {
      const currentValid = models.some((m) => m.id === currentConfig.selectedModel);
      if (!currentValid) {
        const defaultMatch = models.find((m) => m.id === provider.defaultModel);
        handleUpdateProvider(providerId, {
          status: "success",
          selectedModel: defaultMatch?.id ?? provider.defaultModel,
        });
      } else {
        handleUpdateProvider(providerId, { status: "success" });
      }

      // Auto-set as active if this is the first successful connection
      const anyConnected = configuredProviders.some((p) => p.status === "success");
      if (!anyConnected) {
        setActiveProvider(providerId);
      }
    } else {
      if (providerId === "anthropic") {
        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": currentConfig.apiKey || "",
              "anthropic-version": "2023-06-01",
              "User-Agent": "Mozilla/5.0",
            },
            body: JSON.stringify({
              model: ANTHROPIC_MODELS.haiku,
              max_tokens: 1,
              messages: [{ role: "user", content: "hi" }],
            }),
          });
          handleUpdateProvider(providerId, { status: res.ok ? "success" : "error" });
          setFetchedModels((prev) => ({
            ...prev,
            anthropic: ANTHROPIC_MODEL_OPTIONS,
          }));
          if (res.ok) {
            const anyConnected = configuredProviders.some((p) => p.status === "success");
            if (!anyConnected) setActiveProvider(providerId);
          }
        } catch {
          handleUpdateProvider(providerId, { status: "error" });
        }
      } else {
        handleUpdateProvider(providerId, { status: "error" });
      }
    }
  };

  const handleAddCustomProvider = () => {
    if (!customForm.name || !customForm.endpoint || !customForm.modelName) return;

    const customId = `custom-${Date.now()}`;

    const newProvider: Provider = {
      id: customId,
      name: customForm.name,
      description: `Custom — ${customForm.endpoint}`,
      keyPlaceholder: "API key...",
      keyPrefix: "",
      defaultModel: customForm.modelName,
      free: false,
      isCustom: true,
      endpoint: customForm.endpoint,
    };

    setProviders([...providers, newProvider]);

    setConfiguredProviders([
      ...configuredProviders,
      {
        providerId: customId,
        apiKey: customForm.apiKey,
        selectedModel: customForm.modelName,
        status: "idle",
        endpoint: customForm.endpoint,
        name: customForm.name,
      },
    ]);

    setCustomForm({ name: "", endpoint: "", apiKey: "", modelName: "" });
    setShowCustomModal(false);
  };

  // Auto-fetch models for configured providers that have an API key
  useEffect(() => {
    for (const config of configuredProviders) {
      if (config.apiKey.trim() || config.providerId === "ollama") {
        if (!fetchedModels[config.providerId] || fetchedModels[config.providerId].length === 0) {
          handleFetchModels(config.providerId);
        }
      }
    }
  }, []);

  // Helper: get models to show in dropdown
  const getModelsForDropdown = (providerId: string): FetchedModel[] => {
    const fetched = fetchedModels[providerId];
    if (fetched && fetched.length > 0) return fetched;

    const config = configuredProviders.find((p) => p.providerId === providerId);
    if (config?.selectedModel) {
      return [{ id: config.selectedModel, name: config.selectedModel }];
    }

    const provider = getProvider(providerId);
    return [{ id: provider.defaultModel, name: provider.defaultModel }];
  };

  // Count connected providers
  const connectedCount = configuredProviders.filter((p) => p.status === "success").length;

  // Build sorted list: connected first, then configured, then unconfigured
  // Anthropic always first within same tier
  const allProviderIds = providers.map((p) => p.id);
  const sortedProviderIds = [...allProviderIds].sort((a, b) => {
    const aConfig = configuredProviders.find((c) => c.providerId === a);
    const bConfig = configuredProviders.find((c) => c.providerId === b);
    const aScore = aConfig?.status === "success" ? 0 : aConfig?.apiKey?.trim() ? 1 : 2;
    const bScore = bConfig?.status === "success" ? 0 : bConfig?.apiKey?.trim() ? 1 : 2;
    if (aScore !== bScore) return aScore - bScore;
    if (a === "anthropic") return -1;
    if (b === "anthropic") return 1;
    return getProvider(a).name.localeCompare(getProvider(b).name);
  });

  // ── Shared key: member sees read-only banner ──
  if (isSharedMember) {
    return (
      <div className={`${t.colors.text}`}>
        <h1 className="text-2xl font-bold mb-2">API Providers</h1>
        <p className={`${t.colors.textMuted} mb-6`}>
          Configure AI providers. Claude is recommended for best results.
        </p>

        <div
          className={`${t.borderRadius} p-6`}
          style={{
            background: "rgba(45, 184, 122, 0.06)",
            border: "1px solid rgba(45, 184, 122, 0.15)",
          }}
        >
          <div className="flex items-center gap-3 mb-3">
            <Shield size={20} style={{ color: "#2DB87A" }} />
            <h3 className="font-semibold">Using team API key</h3>
          </div>
          <p className={`text-sm ${t.colors.textMuted} leading-relaxed`}>
            Your team owner provides the API keys for the whole team.
            You don't need to set up your own — all AI costs are covered
            by the team owner's account.
          </p>
          <p className={`text-sm ${t.colors.textMuted} mt-3`}>
            If this changes, your team owner will switch to individual keys
            and you'll be prompted to set up your own.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-2">API Providers</h1>
        <p className={`${t.colors.textMuted}`}>
          Connect your AI providers. Claude is recommended for best results.
        </p>
      </div>

      {/* Shared key owner notice */}
      {hasTeam && team?.api_key_policy === "shared" && isOwner && (
        <div
          className={`${t.borderRadius} p-4`}
          style={{
            background: "rgba(45, 184, 122, 0.06)",
            border: "1px solid rgba(45, 184, 122, 0.15)",
          }}
        >
          <div className="flex items-center gap-2">
            <Shield size={16} style={{ color: "#2DB87A" }} />
            <p className="text-sm font-medium">Your API keys are shared with your team</p>
          </div>
          <p className={`text-xs ${t.colors.textMuted} mt-1`}>
            Changes you make here will be synced to all team members next time you save.
            Manage sharing in Settings → Team.
          </p>
        </div>
      )}

      {/* Provider assignment */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-medium opacity-60">Active Provider</label>
          <CustomSelect
            value={activeProvider}
            onChange={(val) => setActiveProvider(val)}
            options={configuredProviders
              .filter((cp) => cp.status === "success" || cp.apiKey.trim())
              .map((cp) => {
                const provider = getProvider(cp.providerId);
                return {
                  id: cp.providerId,
                  name: `${provider.name} ${cp.status === "success" ? "✓" : ""}`,
                };
              })}
            t={t}
            maxWidth="20rem"
          />
          {connectedCount > 0 && (
            <span className="text-xs text-green-400 shrink-0 font-medium">
              {connectedCount} connected
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!assistantProvider}
            onChange={(e) => setAssistantProvider(e.target.checked ? "" : activeProvider)}
            className="accent-green-500"
          />
          <span className="text-xs opacity-60">Use for both Projects and Assistant</span>
        </label>

        {assistantProvider && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs font-medium opacity-60">Assistant Provider</label>
            <CustomSelect
              value={assistantProvider}
              onChange={(val) => setAssistantProvider(val)}
              options={configuredProviders
                .filter((cp) => cp.status === "success" || cp.apiKey.trim())
                .map((cp) => {
                  const provider = getProvider(cp.providerId);
                  return {
                    id: cp.providerId,
                    name: `${provider.name} ${cp.status === "success" ? "✓" : ""}`,
                  };
                })}
              t={t}
              maxWidth="20rem"
            />
          </div>
        )}
      </div>

      {/* All provider cards */}
      <div className="space-y-2">
        {sortedProviderIds.map((providerId) => {
          const provider = getProvider(providerId);
          const config = configuredProviders.find((c) => c.providerId === providerId) || null;
          const configuredWithKeyCount = configuredProviders.filter((p) => p.apiKey.trim()).length;

          return (
            <ProviderCard
              key={providerId}
              config={config}
              provider={provider}
              isActive={activeProvider === providerId}
              isAssistant={!!assistantProvider && assistantProvider === providerId}
              models={getModelsForDropdown(providerId)}
              isFetching={fetchingModels[providerId] || false}
              fetchedModelsList={fetchedModels[providerId] || []}
              showKey={showKeys[providerId] || false}
              smartRouting={smartRouting}
              theme={theme}
              t={t}
              onUpdate={(updates) => handleUpdateProvider(providerId, updates)}
              onRemove={() => handleRemoveProvider(providerId)}
              onTest={() => handleTestConnection(providerId)}
              onFetchModels={() => handleFetchModels(providerId)}
              onToggleShowKey={() => setShowKeys({ ...showKeys, [providerId]: !showKeys[providerId] })}
              onSetSmartRouting={setSmartRouting}
              onSetActive={() => setActiveProvider(providerId)}
              canRemove={configuredWithKeyCount > 1 && !!config?.apiKey.trim()}
            />
          );
        })}

        {/* Add Custom Provider card */}
        <div
          className={`overflow-hidden ${t.colors.bgSecondary} ${t.borderRadius} border ${t.colors.border} border-dashed cursor-pointer select-none hover:opacity-80 transition-opacity`}
          onClick={() => setShowCustomModal(true)}
        >
          <div className="flex items-center gap-3 p-4">
            <span className="w-[30px] h-[30px] shrink-0 flex items-center justify-center opacity-40">
              <Plus size={18} />
            </span>
            <div>
              <span className="font-medium text-sm">Custom Provider...</span>
              <p className="text-xs opacity-50 mt-0.5">Add any OpenAI-compatible API endpoint</p>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Provider Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-6 w-full max-w-md mx-4`}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Add Custom Provider</h2>
              <button
                onClick={() => setShowCustomModal(false)}
                className={`${t.colors.textMuted} hover:${t.colors.text}`}
              >
                <X size={20} />
              </button>
            </div>

            <p className={`text-sm ${t.colors.textMuted} mb-4`}>
              Add any OpenAI-compatible API endpoint (OpenRouter, Together AI, LM Studio, etc.)
            </p>

            <div className="space-y-4">
              <div>
                <label className={`block text-sm mb-1 ${t.colors.textMuted}`}>Provider Name *</label>
                <input
                  type="text"
                  value={customForm.name}
                  onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                  placeholder="e.g., OpenRouter"
                  className={`w-full ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
                />
              </div>

              <div>
                <label className={`block text-sm mb-1 ${t.colors.textMuted}`}>API Endpoint *</label>
                <input
                  type="text"
                  value={customForm.endpoint}
                  onChange={(e) => setCustomForm({ ...customForm, endpoint: e.target.value })}
                  placeholder="https://api.example.com/v1/chat/completions"
                  className={`w-full ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
                />
              </div>

              <div>
                <label className={`block text-sm mb-1 ${t.colors.textMuted}`}>API Key</label>
                <input
                  type="password"
                  value={customForm.apiKey}
                  onChange={(e) => setCustomForm({ ...customForm, apiKey: e.target.value })}
                  placeholder="Your API key"
                  className={`w-full ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
                />
              </div>

              <div>
                <label className={`block text-sm mb-1 ${t.colors.textMuted}`}>Model Name *</label>
                <input
                  type="text"
                  value={customForm.modelName}
                  onChange={(e) => setCustomForm({ ...customForm, modelName: e.target.value })}
                  placeholder="e.g., meta-llama/llama-3.1-70b-instruct"
                  className={`w-full ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowCustomModal(false)}
                className={`flex-1 ${t.colors.bgTertiary} hover:opacity-80 px-4 py-2 ${t.borderRadius}`}
              >
                Cancel
              </button>
              <button
                onClick={handleAddCustomProvider}
                disabled={!customForm.name || !customForm.endpoint || !customForm.modelName}
                className={`flex-1 ${t.colors.accent} ${t.colors.accentHover} ${
                  theme === "highContrast" ? "text-black" : "text-white"
                } px-4 py-2 ${t.borderRadius} disabled:opacity-50`}
              >
                Add Provider
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save button */}
      <button
        onClick={async () => {
          localStorage.setItem("ai-providers", JSON.stringify(configuredProviders));
          localStorage.setItem("ai-active-provider", activeProvider);
          if (assistantProvider) {
            localStorage.setItem("ai-assistant-provider", assistantProvider);
          } else {
            localStorage.removeItem("ai-assistant-provider");
          }

          if (hasTeam && team?.api_key_policy === "shared" && isOwner) {
            const { setApiKeyPolicy } = useTeamStore.getState();
            const keysToShare = configuredProviders
              .filter((p) => p.apiKey && p.apiKey.trim() !== "")
              .map((p) => ({
                providerId: p.providerId,
                apiKey: p.apiKey,
                selectedModel: p.selectedModel,
              }));

            if (keysToShare.length > 0) {
              const { error } = await setApiKeyPolicy("shared", keysToShare);
              if (error) {
                alert("Settings saved locally, but failed to sync shared keys: " + error);
                return;
              }
            }
          }

          alert("Settings saved!");
        }}
        className={`${t.colors.accent} ${t.colors.accentHover} ${
          theme === "highContrast" ? "text-black" : "text-white"
        } px-6 py-2 ${t.borderRadius}`}
      >
        Save Changes
      </button>

      {/* Security Note */}
      <div className={`p-3 text-xs opacity-50 ${t.colors.bgSecondary} ${t.borderRadius}`}>
        <div className="flex items-center gap-1.5 font-medium mb-1">
          <Shield size={12} /> Security
        </div>
        <p>
          API keys are stored locally on your device. They are never sent to Omnirun servers.
          All API calls go directly from your machine to the provider.
        </p>
      </div>
    </div>
  );
}

export default ApiKeySettings;