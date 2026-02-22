import { useState, useEffect } from "react";
import {
  ArrowRight,
  Loader2,
  MapPin,
  Globe,
  Wrench,
  Briefcase,
  Zap,
  Gamepad2,
  Check,
  AlertCircle,
  Search,
  Star,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAuthStore } from "../../stores/authStore";
import { themes } from "../../config/themes";
import { open } from "@tauri-apps/plugin-dialog";
import {
  type TemplateDefinition,
  type TemplateCategory,
} from "../../data/templateData";
import {
  getTemplatesForPlan,
  scaffoldProjectFromTemplate,
  logTemplateDownload,
} from "../../services/templateService";

interface TemplateGalleryProps {
  onProjectReady: (projectPath: string, projectName: string, templateId: string, templateName: string) => void;
}

// Map category IDs to icons
const categoryIcons: Record<string, React.ReactNode> = {
  websites: <Globe size={18} />,
  "personal-tools": <Wrench size={18} />,
  "business-tools": <Briefcase size={18} />,
  automations: <Zap size={18} />,
  "fun-learning": <Gamepad2 size={18} />,
};

type GalleryStep = "browse" | "configure" | "creating";

export default function TemplateGallery({ onProjectReady }: TemplateGalleryProps) {
  // Gallery state
  const [step, setStep] = useState<GalleryStep>("browse");
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Selected template + project config
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDefinition | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectLocation, setProjectLocation] = useState("");
  const [error, setError] = useState("");

  // Creation progress
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressFile, setProgressFile] = useState("");

  const { theme } = useSettingsStore();
  const t = themes[theme];

  // Get user plan for template gating
  const profile = useAuthStore((s) => s.profile);
  const userPlan = profile?.plan || "starter";

  // ── Load templates on mount ──
  useEffect(() => {
    loadTemplates();
  }, [userPlan]);

  async function loadTemplates() {
    setIsLoading(true);
    setLoadError("");
    try {
      const result = await getTemplatesForPlan(userPlan);
      setCategories(result);
    } catch (err: any) {
      console.error("[TemplateGallery] Failed to load:", err);
      setLoadError(err?.message || "Failed to load templates. Check your connection.");
    } finally {
      setIsLoading(false);
    }
  }

  // ── Pick location ──
  const handlePickLocation = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose where to create your project",
      });
      if (selected && typeof selected === "string") {
        setProjectLocation(selected);
      }
    } catch (err) {
      console.error("Failed to pick location:", err);
    }
  };

  // ── Create project from template ──
  const handleCreate = async () => {
    if (!selectedTemplate || !projectName.trim() || !projectLocation) return;

    setIsCreating(true);
    setStep("creating");
    setError("");
    setProgress(0);
    setProgressFile("");

    try {
      const safeName = projectName.trim().replace(/[<>:"/\\|?*]/g, "-");
      const separator = projectLocation.endsWith("/") || projectLocation.endsWith("\\") ? "" : "/";
      const projectPath = `${projectLocation}${separator}${safeName}`;

      // Scaffold the project with progress tracking
      await scaffoldProjectFromTemplate(
        selectedTemplate.id,
        projectPath,
        (percent, currentFile) => {
          setProgress(percent);
          setProgressFile(currentFile);
        }
      );

      // Log download for analytics (non-blocking)
      logTemplateDownload(selectedTemplate.id);

      onProjectReady(projectPath, projectName.trim(), selectedTemplate.id, selectedTemplate.name);
    } catch (err: any) {
      console.error("Failed to create project from template:", err);
      setError(err?.message || "Failed to create project. Check that the location is writable.");
      setStep("configure");
    } finally {
      setIsCreating(false);
    }
  };

  // ── Filter templates by search ──
  const filteredCategories = searchQuery.trim()
    ? categories
        .map((cat) => ({
          ...cat,
          templates: cat.templates.filter(
            (tmpl) =>
              tmpl.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              tmpl.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
              (tmpl.tags || []).some((tag: string) =>
                tag.toLowerCase().includes(searchQuery.toLowerCase())
              )
          ),
        }))
        .filter((cat) => cat.templates.length > 0)
    : categories;

  // ── Step: Creating (progress view) ──
  if (step === "creating") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 20px",
          gap: 20,
        }}
      >
        <Loader2
          size={36}
          style={{ color: "#2DB87A", animation: "spin 1s linear infinite" }}
        />
        <div style={{ textAlign: "center" }}>
          <div className={`text-sm font-medium ${t.colors.text}`}>
            Creating your project...
          </div>
          <div className={`text-xs mt-1 ${t.colors.textMuted}`}>
            {progressFile || "Preparing..."}
          </div>
        </div>

        {/* Progress bar */}
        <div
          style={{
            width: "100%",
            maxWidth: 300,
            height: 4,
            borderRadius: 2,
            background: "rgba(85, 91, 99, 0.3)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: "#2DB87A",
              borderRadius: 2,
              transition: "width 200ms ease",
            }}
          />
        </div>
        <div className={`text-xs ${t.colors.textMuted}`}>{progress}%</div>
      </div>
    );
  }

  // ── Step: Configure (name + location) ──
  if (step === "configure" && selectedTemplate) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Selected template badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            background: "rgba(45, 184, 122, 0.08)",
            border: "1px solid rgba(45, 184, 122, 0.3)",
            borderRadius: 8,
          }}
        >
          <Check size={16} style={{ color: "#2DB87A", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className={`text-sm font-medium ${t.colors.text}`}>
              {selectedTemplate.icon} {selectedTemplate.name}
            </div>
            <div className={`text-xs ${t.colors.textMuted}`}>
              {selectedTemplate.description}
            </div>
          </div>
          <button
            onClick={() => {
              setStep("browse");
              setSelectedTemplate(null);
              setProjectName("");
              setError("");
            }}
            className={`text-xs ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
              padding: 0,
            }}
          >
            Change
          </button>
        </div>

        {error && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#EF4444",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {/* Project name */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className={`text-sm font-medium ${t.colors.textMuted}`}>
            Project name
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder={selectedTemplate.defaultName || "My Project"}
            autoFocus
            disabled={isCreating}
            className={`w-full ${t.colors.text} ${t.borderRadius} outline-none transition-colors`}
            style={{
              background: "rgba(38, 42, 47, 0.8)",
              border: "1px solid rgba(74, 79, 87, 0.8)",
              padding: "10px 14px",
              fontSize: 14,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && projectName.trim() && projectLocation) {
                handleCreate();
              }
            }}
          />
        </div>

        {/* Location */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className={`text-sm font-medium ${t.colors.textMuted}`}>
            Location
          </label>
          <button
            onClick={handlePickLocation}
            disabled={isCreating}
            className={`w-full flex items-center gap-3 ${t.borderRadius} transition-colors text-left`}
            style={{
              background: "rgba(38, 42, 47, 0.8)",
              border: "1px solid rgba(74, 79, 87, 0.8)",
              padding: "10px 14px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            <MapPin size={16} className={t.colors.textMuted} />
            {projectLocation ? (
              <span className={t.colors.text} style={{ fontSize: 13 }}>
                {projectLocation}
              </span>
            ) : (
              <span className={t.colors.textMuted}>Choose a folder...</span>
            )}
          </button>
        </div>

        {/* Preview path */}
        {projectName.trim() && projectLocation && (
          <div
            className={`text-xs ${t.colors.textMuted}`}
            style={{
              background: "rgba(38, 42, 47, 0.5)",
              borderRadius: 6,
              padding: "8px 12px",
              wordBreak: "break-all",
            }}
          >
            Will create:{" "}
            <span className={t.colors.text}>
              {projectLocation}
              {projectLocation.endsWith("/") || projectLocation.endsWith("\\") ? "" : "/"}
              {projectName.trim().replace(/[<>:"/\\|?*]/g, "-")}
            </span>
          </div>
        )}

        {/* Create button */}
        <button
          onClick={handleCreate}
          disabled={isCreating || !projectName.trim() || !projectLocation}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: !projectName.trim() || !projectLocation ? "#4A4F57" : "#2DB87A",
            color: !projectName.trim() || !projectLocation ? "#9CA3AF" : "#FFFFFF",
            border: "none",
            borderRadius: 8,
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: !projectName.trim() || !projectLocation ? "not-allowed" : "pointer",
            transition: "background 150ms ease",
            marginTop: 4,
          }}
        >
          Create from Template
          <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  // ── Step: Browse (gallery grid) ──

  // Loading state
  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 20px",
          gap: 12,
        }}
      >
        <Loader2
          size={28}
          style={{ color: "#2DB87A", animation: "spin 1s linear infinite" }}
        />
        <span className={`text-sm ${t.colors.textMuted}`}>Loading templates...</span>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 20px",
          gap: 12,
        }}
      >
        <AlertCircle size={28} style={{ color: "#EF4444" }} />
        <span className={`text-sm ${t.colors.textMuted} text-center`}>{loadError}</span>
        <button
          onClick={loadTemplates}
          style={{
            background: "rgba(45, 184, 122, 0.12)",
            color: "#2DB87A",
            border: "1px solid rgba(45, 184, 122, 0.3)",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  // Empty search state
  if (filteredCategories.length === 0 && searchQuery.trim()) {
    return (
      <div>
        <SearchBar value={searchQuery} onChange={setSearchQuery} theme={t} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "40px 20px",
            gap: 8,
          }}
        >
          <Search size={24} style={{ color: "#6B7280" }} />
          <span className={`text-sm ${t.colors.textMuted}`}>
            No templates match "{searchQuery}"
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Search bar */}
      <SearchBar value={searchQuery} onChange={setSearchQuery} theme={t} />

      {/* Template grid */}
      <div style={{ maxHeight: 400, overflowY: "auto", paddingRight: 4, marginTop: 12 }}>
        {filteredCategories.map((category) => (
          <div key={category.id} style={{ marginBottom: 20 }}>
            {/* Category header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <span style={{ color: "#2DB87A" }}>
                {categoryIcons[category.id] || <Wrench size={18} />}
              </span>
              <span className={`text-sm font-semibold ${t.colors.text}`}>
                {category.name}
              </span>
              <span className={`text-xs ${t.colors.textMuted}`}>
                {category.templates.length}
              </span>
            </div>

            {/* Template cards grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(195px, 1fr))",
                gap: 8,
              }}
            >
              {category.templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  theme={t}
                  onClick={() => {
                    setSelectedTemplate(template);
                    setProjectName(template.defaultName || "");
                    setStep("configure");
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Search Bar ──

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  theme: (typeof themes)[string];
}

function SearchBar({ value, onChange, theme: t }: SearchBarProps) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
      }}
    >
      <Search
        size={15}
        style={{
          position: "absolute",
          left: 10,
          color: "#6B7280",
          pointerEvents: "none",
        }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search templates..."
        className={`w-full ${t.colors.text} ${t.borderRadius} outline-none`}
        style={{
          background: "rgba(38, 42, 47, 0.6)",
          border: "1px solid rgba(85, 91, 99, 0.35)",
          padding: "8px 12px 8px 32px",
          fontSize: 13,
        }}
      />
    </div>
  );
}

// ── Template Card ──

interface TemplateCardProps {
  template: TemplateDefinition;
  theme: (typeof themes)[string];
  onClick: () => void;
}

function TemplateCard({ template, theme: t, onClick }: TemplateCardProps) {
  return (
    <button
      onClick={onClick}
      className={`text-left ${t.borderRadius} transition-all duration-150`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "12px 14px",
        background: "rgba(38, 42, 47, 0.5)",
        border: template.featured
          ? "1px solid rgba(45, 184, 122, 0.35)"
          : "1px solid rgba(85, 91, 99, 0.35)",
        cursor: "pointer",
        width: "100%",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "rgba(45, 184, 122, 0.06)";
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(45, 184, 122, 0.4)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "rgba(38, 42, 47, 0.5)";
        (e.currentTarget as HTMLElement).style.borderColor = template.featured
          ? "rgba(45, 184, 122, 0.35)"
          : "rgba(85, 91, 99, 0.35)";
      }}
    >
      {/* Badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, position: "absolute", top: 8, right: 8 }}>
        {template.featured && (
          <Star size={12} style={{ color: "#F59E0B" }} />
        )}
        {template.tier === "pro" && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#818CF8",
              background: "rgba(129, 140, 248, 0.12)",
              padding: "1px 6px",
              borderRadius: 4,
            }}
          >
            PRO
          </span>
        )}
        {template.tier === "custom" && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#F59E0B",
              background: "rgba(245, 158, 11, 0.12)",
              padding: "1px 6px",
              borderRadius: 4,
            }}
          >
            ENT
          </span>
        )}
      </div>

      <div style={{ fontSize: 20, marginBottom: 2 }}>{template.icon}</div>
      <div className={`text-sm font-medium ${t.colors.text}`}>{template.name}</div>
      <div className={`text-xs ${t.colors.textMuted}`} style={{ lineHeight: 1.4 }}>
        {template.description}
      </div>
    </button>
  );
}