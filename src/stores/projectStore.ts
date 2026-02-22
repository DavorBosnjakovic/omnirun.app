import { create } from "zustand";
import { FileEntry } from "../services/fileService";
import { ProjectManifest } from "../services/manifestService";
import { dbService } from "../services/dbService";

interface Project {
  id: string;
  name: string;
  path: string;
}

// Tracks a file modified outside the app while user is editing it
interface ExternalFileChange {
  path: string;
  timestamp: number;
}

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  projectPath: string | null;
  fileTree: FileEntry[];
  selectedFile: FileEntry | null;
  manifest: ProjectManifest | null;
  // Build error auto-fix
  buildError: string | null;
  autoFixCount: number;
  // External file change detection
  externalFileChange: ExternalFileChange | null;
  setCurrentProject: (project: Project | null) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setProjectPath: (path: string | null) => void;
  setFileTree: (tree: FileEntry[]) => void;
  setSelectedFile: (file: FileEntry | null) => void;
  setManifest: (manifest: ProjectManifest | null) => void;
  setBuildError: (error: string | null) => void;
  incrementAutoFix: () => void;
  resetAutoFix: () => void;
  setExternalFileChange: (change: ExternalFileChange | null) => void;
  // New: load from SQLite on startup
  loadFromDB: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  projectPath: null,
  fileTree: [],
  selectedFile: null,
  manifest: null,
  // Build error auto-fix
  buildError: null,
  autoFixCount: 0,
  // External file change detection
  externalFileChange: null,

  setCurrentProject: (project) => {
    set({ currentProject: project });
    // Update last opened in DB (fire-and-forget)
    if (project) {
      dbService.updateLastOpened(project.id).catch(() => {});
      dbService.setLastProjectId(project.id).catch(() => {});
    }
  },

  addProject: (project) =>
    set((state) => {
      const newProjects = [...state.projects, project];
      // Persist to SQLite (fire-and-forget)
      dbService.saveProject(project).catch((e) => {
        console.error("Failed to save project to DB:", e);
      });
      return { projects: newProjects };
    }),

  removeProject: (id) =>
    set((state) => {
      const newProjects = state.projects.filter((p) => p.id !== id);
      // Delete from SQLite (fire-and-forget)
      dbService.deleteProject(id).catch((e) => {
        console.error("Failed to delete project from DB:", e);
      });
      return { projects: newProjects };
    }),

  setProjectPath: (path) => set({ projectPath: path }),
  setFileTree: (tree) => set({ fileTree: tree }),
  setSelectedFile: (file) => set({ selectedFile: file }),
  setManifest: (manifest) => set({ manifest: manifest }),
  setBuildError: (error) => set({ buildError: error }),
  incrementAutoFix: () => set((state) => ({ autoFixCount: state.autoFixCount + 1 })),
  resetAutoFix: () => set({ autoFixCount: 0, buildError: null }),
  setExternalFileChange: (change) => set({ externalFileChange: change }),

  // Load projects from SQLite on app startup
  loadFromDB: async () => {
    try {
      const projects = await dbService.getProjects();
      set({ projects });
    } catch (e) {
      console.error("Failed to load projects from DB:", e);
    }
  },
}));