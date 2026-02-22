import { useState } from "react";
import {
  FolderOpen,
  FolderPlus,
  LayoutTemplate,
  X,
  ArrowLeft,
  ArrowRight,
  Loader2,
  MapPin,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import { selectProjectFolder } from "../../services/fileService";
import { open } from "@tauri-apps/plugin-dialog";
import TemplateGallery from "./TemplateGallery";

type ModalStep = "choose" | "create" | "templates";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when a project is ready (folder selected or created). Parent handles addProject, setProjectPath, etc. */
  onProjectReady: (projectPath: string, projectName: string, templateId?: string, templateName?: string) => void;
}

export default function NewProjectModal({ isOpen, onClose, onProjectReady }: NewProjectModalProps) {
  const [step, setStep] = useState<ModalStep>("choose");
  const [projectName, setProjectName] = useState("");
  const [projectLocation, setProjectLocation] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const { theme } = useSettingsStore();
  const t = themes[theme];

  if (!isOpen) return null;

  const resetAndClose = () => {
    setStep("choose");
    setProjectName("");
    setProjectLocation("");
    setError("");
    setIsCreating(false);
    onClose();
  };

  // ── Option 1: Open existing folder ──
  const handleOpenExisting = async () => {
    try {
      const selectedPath = await selectProjectFolder();
      if (selectedPath) {
        const folderName = selectedPath.split(/[/\\]/).pop() || "Untitled";
        onProjectReady(selectedPath, folderName);
        resetAndClose();
      }
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  // ── Option 2: Pick location for new project ──
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

  // ── Option 2: Create new empty project ──
  const handleCreateProject = async () => {
    if (!projectName.trim() || !projectLocation) return;

    setIsCreating(true);
    setError("");

    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // Sanitize folder name
      const safeName = projectName.trim().replace(/[<>:"/\\|?*]/g, "-");
      const projectPath = `${projectLocation}${projectLocation.endsWith("/") || projectLocation.endsWith("\\") ? "" : "/"}${safeName}`;

      // Create the project directory
      await invoke("create_directory", { path: projectPath });

      // Scaffold minimal files
      await invoke("write_file", {
        path: `${projectPath}/index.html`,
        content: getEmptyScaffoldHtml(projectName.trim()),
      });

      await invoke("write_file", {
        path: `${projectPath}/style.css`,
        content: getEmptyScaffoldCss(),
      });

      onProjectReady(projectPath, projectName.trim());
      resetAndClose();
    } catch (err: any) {
      console.error("Failed to create project:", err);
      setError(err?.message || "Failed to create project folder. It may already exist.");
    } finally {
      setIsCreating(false);
    }
  };

  // ── Option 3: Templates (placeholder — TemplateGallery will handle this) ──
  const handleTemplateSelect = () => {
    setStep("templates");
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) resetAndClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: step === "templates" ? 720 : 480,
          background: "rgba(56, 60, 67, 0.75)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(85, 91, 99, 0.5)",
          borderRadius: 12,
          overflow: "hidden",
          transition: "max-width 200ms ease",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(85, 91, 99, 0.4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {step !== "choose" && (
              <button
                onClick={() => {
                  setStep("choose");
                  setError("");
                }}
                className={`p-1 rounded ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 className={`text-lg font-semibold ${t.colors.text}`}>
              {step === "choose" && "New Project"}
              {step === "create" && "Create New Project"}
              {step === "templates" && "Choose a Template"}
            </h2>
          </div>
          <button
            onClick={resetAndClose}
            className={`p-1 rounded ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "20px" }}>
          {/* ── Step: Choose ── */}
          {step === "choose" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <OptionCard
                icon={<FolderOpen size={24} />}
                title="Open Existing Folder"
                description="Add a project folder from your computer"
                onClick={handleOpenExisting}
                theme={t}
              />
              <OptionCard
                icon={<FolderPlus size={24} />}
                title="Create New Project"
                description="Start fresh with a new empty project"
                onClick={() => setStep("create")}
                theme={t}
              />
              <OptionCard
                icon={<LayoutTemplate size={24} />}
                title="Start from Template"
                description="Choose a pre-built template to customize"
                onClick={handleTemplateSelect}
                theme={t}
                accent
              />
            </div>
          )}

          {/* ── Step: Create new project ── */}
          {step === "create" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
                  placeholder="My Awesome Project"
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
                      handleCreateProject();
                    }
                  }}
                />
              </div>

              {/* Location picker */}
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
                onClick={handleCreateProject}
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
                {isCreating ? (
                  <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <>
                    Create Project
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          )}

          {/* ── Step: Templates ── */}
          {step === "templates" && (
            <TemplateGallery
              onProjectReady={(projectPath, projectName, templateId, templateName) => {
                onProjectReady(projectPath, projectName, templateId, templateName);
                resetAndClose();
              }}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ── Option Card Component ──

interface OptionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  theme: (typeof themes)[string];
  accent?: boolean;
}

function OptionCard({ icon, title, description, onClick, theme: t, accent }: OptionCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left ${t.borderRadius} transition-all duration-150`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "16px 18px",
        background: "rgba(38, 42, 47, 0.5)",
        border: accent
          ? "1px solid rgba(45, 184, 122, 0.4)"
          : "1px solid rgba(85, 91, 99, 0.4)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "rgba(45, 184, 122, 0.08)";
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(45, 184, 122, 0.5)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "rgba(38, 42, 47, 0.5)";
        (e.currentTarget as HTMLElement).style.borderColor = accent
          ? "rgba(45, 184, 122, 0.4)"
          : "rgba(85, 91, 99, 0.4)";
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: accent ? "rgba(45, 184, 122, 0.12)" : "rgba(85, 91, 99, 0.25)",
          flexShrink: 0,
        }}
      >
        <span style={{ color: accent ? "#2DB87A" : "#9CA3AF" }}>{icon}</span>
      </div>
      <div>
        <div className={`text-sm font-semibold ${t.colors.text}`}>{title}</div>
        <div className={`text-xs mt-0.5 ${t.colors.textMuted}`}>{description}</div>
      </div>
    </button>
  );
}

// ── Scaffold Templates ──

function getEmptyScaffoldHtml(projectName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>${projectName}</h1>
    <p>Your project is ready. Start building!</p>
  </div>
</body>
</html>`;
}

function getEmptyScaffoldCss(): string {
  return `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  color: #333;
}

.container {
  text-align: center;
  padding: 2rem;
}

h1 {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

p {
  color: #666;
  font-size: 1.1rem;
}`;
}