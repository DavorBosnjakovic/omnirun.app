import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Search, FolderOpen, X } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import { themes } from "../../config/themes";

interface Project {
  id: string;
  name: string;
  path: string;
}

interface ProjectSelectorProps {
  selectedProjectId: string | null;
  onSelect: (projectId: string, projectName: string) => void;
  compact?: boolean; // inline pill mode vs full-width
}

// Track recently used projects in memory (persists within session)
const recentProjectIds: string[] = [];
const MAX_RECENT = 4;

export function addRecentProject(projectId: string) {
  const idx = recentProjectIds.indexOf(projectId);
  if (idx !== -1) recentProjectIds.splice(idx, 1);
  recentProjectIds.unshift(projectId);
  if (recentProjectIds.length > MAX_RECENT) recentProjectIds.pop();
}

function ProjectSelector({ selectedProjectId, onSelect, compact = true }: ProjectSelectorProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { projects, currentProject } = useProjectStore();

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Find selected project name
  const selectedProject = projects.find(
    (p) => p.path === selectedProjectId || p.id === selectedProjectId
  );
  const displayName = selectedProject?.name || "Select project";

  // Split into recent and all, filtered by search
  const { recentProjects, allProjects } = useMemo(() => {
    const query = search.toLowerCase().trim();

    const filtered = projects.filter((p) =>
      query ? p.name.toLowerCase().includes(query) : true
    );

    const recent = recentProjectIds
      .map((id) => filtered.find((p) => p.path === id || p.id === id))
      .filter(Boolean) as Project[];

    const recentSet = new Set(recent.map((p) => p.path || p.id));
    const rest = filtered.filter((p) => !recentSet.has(p.path || p.id));

    return { recentProjects: recent, allProjects: rest };
  }, [projects, search]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Focus search when opening
  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (project: Project) => {
    const id = project.path || project.id;
    addRecentProject(id);
    onSelect(id, project.name);
    setIsOpen(false);
    setSearch("");
  };

  const showSearch = projects.length > 5;
  const showRecent = recentProjects.length > 0 && !search;

  return (
    <div ref={dropdownRef} className="relative">
      {/* ── Trigger button ──────────────────────────── */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 ${
          compact ? "px-2.5 py-1.5" : "px-3 py-2 w-full"
        } text-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} ${t.colors.text} hover:bg-white/10 transition-colors truncate`}
        title={selectedProject ? `Project: ${selectedProject.name}` : "Select a project"}
      >
        <FolderOpen size={12} className={`${t.colors.textMuted} flex-shrink-0`} />
        <span className="truncate max-w-[140px]">{displayName}</span>
        <ChevronDown
          size={10}
          className={`${t.colors.textMuted} flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* ── Dropdown popover ────────────────────────── */}
      {isOpen && (
        <div
          className={`absolute bottom-full mb-1 left-0 z-50 w-64 ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-xl overflow-hidden`}
        >
          {/* Search field (only if 6+ projects) */}
          {showSearch && (
            <div className={`p-2 ${t.colors.border} border-b`}>
              <div className="relative">
                <Search
                  size={12}
                  className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${t.colors.textMuted}`}
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search projects..."
                  className={`w-full pl-7 pr-7 py-1.5 text-xs ${t.colors.bgTertiary || t.colors.bgSecondary} ${t.colors.text} ${t.borderRadius} border ${t.colors.border} focus:outline-none focus:ring-1 focus:ring-blue-500 ${t.fontFamily}`}
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 ${t.colors.textMuted} hover:${t.colors.text}`}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Scrollable list */}
          <div className="max-h-56 overflow-y-auto py-1">
            {/* Recent section */}
            {showRecent && (
              <>
                <div className={`px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider ${t.colors.textMuted}`}>
                  Recent
                </div>
                {recentProjects.map((project) => (
                  <ProjectRow
                    key={`recent-${project.path || project.id}`}
                    project={project}
                    isSelected={
                      (project.path || project.id) === selectedProjectId
                    }
                    isCurrent={
                      currentProject?.path === project.path ||
                      currentProject?.id === project.id
                    }
                    onClick={() => handleSelect(project)}
                    theme={t}
                  />
                ))}
                {allProjects.length > 0 && (
                  <div className={`mx-2 my-1 border-t ${t.colors.border}`} />
                )}
              </>
            )}

            {/* All projects section */}
            {(showRecent || search) && allProjects.length > 0 && (
              <div className={`px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider ${t.colors.textMuted}`}>
                {search ? "Results" : "All Projects"}
              </div>
            )}

            {/* If no recent section and no search, just show the flat list */}
            {(showRecent || search ? allProjects : projects).map((project) => (
              <ProjectRow
                key={project.path || project.id}
                project={project}
                isSelected={
                  (project.path || project.id) === selectedProjectId
                }
                isCurrent={
                  currentProject?.path === project.path ||
                  currentProject?.id === project.id
                }
                onClick={() => handleSelect(project)}
                theme={t}
              />
            ))}

            {/* Empty state */}
            {projects.length === 0 && (
              <div className={`px-3 py-4 text-xs ${t.colors.textMuted} text-center`}>
                No projects yet
              </div>
            )}

            {/* No search results */}
            {search && recentProjects.length === 0 && allProjects.length === 0 && (
              <div className={`px-3 py-4 text-xs ${t.colors.textMuted} text-center`}>
                No projects matching "{search}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Individual project row ────────────────────────────────────

interface ProjectRowProps {
  project: Project;
  isSelected: boolean;
  isCurrent: boolean;
  onClick: () => void;
  theme: any;
}

function ProjectRow({ project, isSelected, isCurrent, onClick, theme: t }: ProjectRowProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
        isSelected
          ? "bg-blue-600/20 text-blue-300"
          : `${t.colors.text} hover:bg-white/10`
      }`}
    >
      <span className="flex-shrink-0 text-sm">📂</span>
      <span className="truncate flex-1">{project.name}</span>
      {isCurrent && (
        <span className={`text-[10px] ${t.colors.textMuted} flex-shrink-0`}>
          current
        </span>
      )}
    </button>
  );
}

export default ProjectSelector;