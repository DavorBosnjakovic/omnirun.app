import { useState } from "react";
import { Eye, EyeOff, CheckCircle, XCircle, Loader, Plus, Trash2, Star, X, RefreshCw } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import { fetch } from "@tauri-apps/plugin-http";

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
}

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    description: "Recommended — Smart routing uses Haiku/Sonnet/Opus based on task",
    keyPlaceholder: "sk-ant-...",
    keyPrefix: "sk-ant-",
    defaultModel: "claude-sonnet-4-5-20250929",
    free: false,
  },
  {
    id: "groq",
    name: "Groq",
    description: "Free tier available — Very fast inference",
    keyPlaceholder: "gsk_...",
    keyPrefix: "gsk_",
    defaultModel: "llama-3.3-70b-versatile",
    free: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o and GPT-4o mini",
    keyPlaceholder: "sk-...",
    keyPrefix: "sk-",
    defaultModel: "gpt-4o",
    free: false,
  },
  {
    id: "google",
    name: "Google (Gemini)",
    description: "Free tier available — Gemini Flash and Pro",
    keyPlaceholder: "AI...",
    keyPrefix: "AI",
    defaultModel: "gemini-2.0-flash",
    free: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "Very cheap — 5M free tokens on signup",
    keyPlaceholder: "sk-...",
    keyPrefix: "sk-",
    defaultModel: "deepseek-chat",
    free: true,
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    description: "Free — Run models locally on your machine",
    keyPlaceholder: "http://localhost:11434",
    keyPrefix: "",
    defaultModel: "llama3.1",
    free: true,
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
      // Fetch models from Anthropic's /v1/models endpoint
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
      // Fallback if API call fails
      return [
        { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
        { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5" },
        { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
      ];
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
        // Filter out embedding / moderation / whisper / tts / dall-e models
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

// ── Component ──────────────────────────────────────────────────

function ApiKeySettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const [providers, setProviders] = useState<Provider[]>(DEFAULT_PROVIDERS);
  const [configuredProviders, setConfiguredProviders] = useState<ConfiguredProvider[]>(() => {
    try {
      const saved = localStorage.getItem("ai-providers");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migrate deprecated Anthropic model IDs to current versions
        const MODEL_MIGRATIONS: Record<string, string> = {
          "claude-sonnet-4-20250514": "claude-sonnet-4-5-20250929",
          "claude-haiku-4-20250414": "claude-haiku-4-5-20251001",
          "claude-opus-4-20250514": "claude-opus-4-6",
          "claude-opus-4-0-20250514": "claude-opus-4-6",
        };
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
    return [{ providerId: "anthropic", apiKey: "", selectedModel: "claude-sonnet-4-5-20250929", status: "idle" }];
  });

  const [activeProvider, setActiveProvider] = useState(() => {
    return localStorage.getItem("ai-active-provider") || "anthropic";
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [smartRouting, setSmartRouting] = useState(true);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customForm, setCustomForm] = useState<CustomProviderForm>({
    name: "",
    endpoint: "",
    apiKey: "",
    modelName: "",
  });

  // Store fetched models per provider
  const [fetchedModels, setFetchedModels] = useState<Record<string, FetchedModel[]>>({});
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});

  const getProvider = (id: string) => providers.find((p) => p.id === id)!;

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

    // If current selected model isn't in the fetched list, pick the first or the default
    if (models.length > 0 && config) {
      const currentValid = models.some((m) => m.id === config.selectedModel);
      if (!currentValid) {
        const defaultMatch = models.find((m) => m.id === provider.defaultModel);
        handleUpdateProvider(providerId, {
          selectedModel: defaultMatch ? defaultMatch.id : models[0].id,
        });
      }
    }
  };

  const handleAddProvider = (providerId: string) => {
    const provider = getProvider(providerId);
    setConfiguredProviders([
      ...configuredProviders,
      {
        providerId,
        apiKey: "",
        selectedModel: provider.defaultModel,
        status: "idle",
      },
    ]);
  };

  const handleRemoveProvider = (providerId: string) => {
    const provider = getProvider(providerId);
    setConfiguredProviders(configuredProviders.filter((p) => p.providerId !== providerId));

    if (provider.isCustom) {
      setProviders(providers.filter((p) => p.id !== providerId));
    }

    if (activeProvider === providerId) {
      setActiveProvider(configuredProviders[0]?.providerId || "anthropic");
    }
  };

  const handleUpdateProvider = (providerId: string, updates: Partial<ConfiguredProvider>) => {
    setConfiguredProviders(
      configuredProviders.map((p) =>
        p.providerId === providerId ? { ...p, ...updates } : p
      )
    );
  };

  const handleTestConnection = async (providerId: string) => {
    const config = configuredProviders.find((p) => p.providerId === providerId);
    if (!config?.apiKey.trim() && providerId !== "ollama") return;

    handleUpdateProvider(providerId, { status: "testing" });

    // Fetch models as the real test — if we get models back, the key works
    const provider = getProvider(providerId);
    const models = await fetchModelsForProvider(
      providerId,
      config?.apiKey || "",
      provider.endpoint
    );

    setFetchedModels((prev) => ({ ...prev, [providerId]: models }));

    if (models.length > 0) {
      handleUpdateProvider(providerId, { status: "success" });
      // Auto-select a valid model
      const currentValid = models.some((m) => m.id === config?.selectedModel);
      if (!currentValid) {
        const defaultMatch = models.find((m) => m.id === provider.defaultModel);
        handleUpdateProvider(providerId, {
          status: "success",
          selectedModel: defaultMatch ? defaultMatch.id : models[0].id,
        });
      }
    } else {
      // Anthropic returns hardcoded models, so it always succeeds — do a real ping
      if (providerId === "anthropic") {
        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": config?.apiKey || "",
              "anthropic-version": "2023-06-01",
              "User-Agent": "Mozilla/5.0",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-20250414",
              max_tokens: 1,
              messages: [{ role: "user", content: "hi" }],
            }),
          });
          handleUpdateProvider(providerId, { status: res.ok ? "success" : "error" });
          // Set hardcoded models for Anthropic
          setFetchedModels((prev) => ({
            ...prev,
            anthropic: [
              { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
              { id: "claude-haiku-4-20250414", name: "Claude Haiku 4" },
              { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
            ],
          }));
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
      },
    ]);

    setCustomForm({ name: "", endpoint: "", apiKey: "", modelName: "" });
    setShowCustomModal(false);
  };

  const unconfiguredProviders = providers.filter(
    (p) => !configuredProviders.some((cp) => cp.providerId === p.id) && !p.isCustom
  );

  // Helper: get models to show in dropdown
  const getModelsForDropdown = (providerId: string): FetchedModel[] => {
    const fetched = fetchedModels[providerId];
    if (fetched && fetched.length > 0) return fetched;

    // Fallback: show current selected model so the dropdown isn't empty
    const config = configuredProviders.find((p) => p.providerId === providerId);
    if (config?.selectedModel) {
      return [{ id: config.selectedModel, name: config.selectedModel }];
    }

    const provider = getProvider(providerId);
    return [{ id: provider.defaultModel, name: provider.defaultModel }];
  };

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-2">API Providers</h1>
      <p className={`${t.colors.textMuted} mb-6`}>
        Configure AI providers. Claude is recommended for best results.
      </p>

      {/* Active provider selector */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Active Provider
        </label>
        <select
          value={activeProvider}
          onChange={(e) => setActiveProvider(e.target.value)}
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          {configuredProviders.map((cp) => {
            const provider = getProvider(cp.providerId);
            return (
              <option key={cp.providerId} value={cp.providerId}>
                {provider.name} {cp.status === "success" ? "✓" : cp.status === "error" ? "✗" : ""}
              </option>
            );
          })}
        </select>
      </div>

      {/* Configured providers */}
      <div className="space-y-4 mb-6">
        {configuredProviders.map((config) => {
          const provider = getProvider(config.providerId);
          const isActive = activeProvider === config.providerId;
          const models = getModelsForDropdown(config.providerId);
          const isFetching = fetchingModels[config.providerId] || false;

          return (
            <div
              key={config.providerId}
              className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 ${
                isActive ? `${t.colors.border} border-2` : ""
              }`}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold">{provider.name}</h3>
                  {provider.id === "anthropic" && (
                    <span className="flex items-center gap-1 text-xs text-yellow-500">
                      <Star size={12} fill="currentColor" /> Recommended
                    </span>
                  )}
                  {provider.free && (
                    <span className={`text-xs px-2 py-0.5 ${t.colors.bgTertiary} ${t.borderRadius}`}>
                      Free tier
                    </span>
                  )}
                  {provider.isCustom && (
                    <span className={`text-xs px-2 py-0.5 ${t.colors.bgTertiary} ${t.borderRadius}`}>
                      Custom
                    </span>
                  )}
                  {isActive && (
                    <span className={`text-xs px-2 py-0.5 bg-green-600 text-white ${t.borderRadius}`}>
                      Active
                    </span>
                  )}
                </div>
                {configuredProviders.length > 1 && (
                  <button
                    onClick={() => handleRemoveProvider(config.providerId)}
                    className={`${t.colors.textMuted} hover:text-red-500`}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <p className={`text-sm ${t.colors.textMuted} mb-3`}>{provider.description}</p>

              {/* API Key input */}
              <div className="mb-3">
                <label className={`block text-sm mb-1 ${t.colors.textMuted}`}>
                  {provider.id === "ollama" ? "Server URL" : "API Key"}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKeys[config.providerId] ? "text" : "password"}
                      value={config.apiKey}
                      onChange={(e) =>
                        handleUpdateProvider(config.providerId, { apiKey: e.target.value, status: "idle" })
                      }
                      placeholder={provider.keyPlaceholder}
                      className={`w-full ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 pr-10 focus:outline-none`}
                    />
                    <button
                      onClick={() =>
                        setShowKeys({ ...showKeys, [config.providerId]: !showKeys[config.providerId] })
                      }
                      className={`absolute right-2 top-1/2 -translate-y-1/2 ${t.colors.textMuted}`}
                    >
                      {showKeys[config.providerId] ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleTestConnection(config.providerId)}
                    disabled={!config.apiKey.trim() || config.status === "testing"}
                    className={`${t.colors.accent} ${t.colors.accentHover} ${
                      theme === "highContrast" ? "text-black" : "text-white"
                    } px-4 py-2 ${t.borderRadius} disabled:opacity-50`}
                  >
                    {config.status === "testing" ? <Loader size={18} className="animate-spin" /> : "Test"}
                  </button>
                </div>

                {config.status === "success" && (
                  <div className="flex items-center gap-2 mt-2 text-green-500">
                    <CheckCircle size={16} />
                    <span className="text-sm">Connection successful!</span>
                  </div>
                )}
                {config.status === "error" && (
                  <div className="flex items-center gap-2 mt-2 text-red-500">
                    <XCircle size={16} />
                    <span className="text-sm">Connection failed. Check your key and try again.</span>
                  </div>
                )}
              </div>

              {/* Model selection / Smart routing */}
              {provider.id === "anthropic" ? (
                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smartRouting}
                      onChange={(e) => setSmartRouting(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <div>
                      <span className="font-medium">Smart Routing</span>
                      <p className={`text-sm ${t.colors.textMuted}`}>
                        Automatically use Haiku for quick tasks, Sonnet for normal work, Opus for complex problems
                      </p>
                    </div>
                  </label>
                  {!smartRouting && (
                    <div className="mt-2 flex gap-2 items-center">
                      <select
                        value={config.selectedModel}
                        onChange={(e) =>
                          handleUpdateProvider(config.providerId, { selectedModel: e.target.value })
                        }
                        className={`w-full max-w-xs ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className={`block text-sm mb-1 ${t.colors.textMuted}`}>Model</label>
                  <div className="flex gap-2 items-center">
                    {provider.isCustom ? (
                      <input
                        type="text"
                        value={config.selectedModel}
                        onChange={(e) =>
                          handleUpdateProvider(config.providerId, { selectedModel: e.target.value })
                        }
                        className={`w-full max-w-xs ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
                      />
                    ) : (
                      <select
                        value={config.selectedModel}
                        onChange={(e) =>
                          handleUpdateProvider(config.providerId, { selectedModel: e.target.value })
                        }
                        className={`w-full max-w-xs ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {/* Refresh models button */}
                    {!provider.isCustom && (
                      <button
                        onClick={() => handleFetchModels(config.providerId)}
                        disabled={(!config.apiKey.trim() && provider.id !== "ollama") || isFetching}
                        title="Fetch available models"
                        className={`p-2 ${t.colors.bgTertiary} ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text} disabled:opacity-30`}
                      >
                        <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
                      </button>
                    )}
                  </div>
                  {isFetching && (
                    <p className={`text-xs mt-1 ${t.colors.textMuted}`}>Fetching models...</p>
                  )}
                  {fetchedModels[config.providerId] && fetchedModels[config.providerId].length > 1 && (
                    <p className={`text-xs mt-1 ${t.colors.textMuted}`}>
                      {fetchedModels[config.providerId].length} models available
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add provider */}
      <div>
        <h3 className={`text-sm font-medium mb-3 ${t.colors.textMuted}`}>Add Provider</h3>
        <div className="flex flex-wrap gap-2">
          {unconfiguredProviders.map((provider) => (
            <button
              key={provider.id}
              onClick={() => handleAddProvider(provider.id)}
              className={`${t.colors.bgSecondary} hover:${t.colors.bgTertiary} px-3 py-2 ${t.borderRadius} text-sm flex items-center gap-2`}
            >
              <Plus size={16} />
              {provider.name}
              {provider.free && (
                <span className={`text-xs px-1 py-0.5 ${t.colors.bgTertiary} ${t.borderRadius}`}>
                  Free
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => setShowCustomModal(true)}
            className={`${t.colors.bgSecondary} hover:${t.colors.bgTertiary} px-3 py-2 ${t.borderRadius} text-sm flex items-center gap-2 border ${t.colors.border} border-dashed`}
          >
            <Plus size={16} />
            Custom Provider...
          </button>
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
        onClick={() => {
          localStorage.setItem("ai-providers", JSON.stringify(configuredProviders));
          localStorage.setItem("ai-active-provider", activeProvider);
          alert("Settings saved!");
        }}
        className={`mt-6 ${t.colors.accent} ${t.colors.accentHover} ${
          theme === "highContrast" ? "text-black" : "text-white"
        } px-6 py-2 ${t.borderRadius}`}
      >
        Save Changes
      </button>
    </div>
  );
}

export default ApiKeySettings;