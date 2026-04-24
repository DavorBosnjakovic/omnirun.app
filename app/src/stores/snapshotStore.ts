// ============================================================
// Snapshot Store - Time Machine State
// ============================================================

import { create } from "zustand";
import {
  getSnapshots,
  getFileSnapshots,
  restoreSnapshot,
  getSnapshotStats,
  groupSnapshotsByDay,
} from "../services/snapshotService";
import type { Snapshot } from "../services/snapshotService";

// ─── Types ───────────────────────────────────────────────────

interface SnapshotGroup {
  label: string;
  date: string;
  snapshots: Snapshot[];
}

interface SnapshotState {
  // Data
  snapshots: Snapshot[];
  groupedSnapshots: SnapshotGroup[];
  totalCount: number;
  filesTracked: number;

  // UI state
  isOpen: boolean;
  isLoading: boolean;
  filterFile: string | null; // Filter to a specific file path, or null for all
  restoringId: string | null; // Currently restoring snapshot ID

  // Actions
  open: () => void;
  close: () => void;
  toggle: () => void;
  setFilterFile: (filePath: string | null) => void;
  loadSnapshots: (projectPath: string) => Promise<void>;
  restore: (projectPath: string, snapshotId: string) => Promise<string>;
  addSnapshot: (snapshot: Snapshot) => void;
}

// ─── Store ───────────────────────────────────────────────────

export const useSnapshotStore = create<SnapshotState>((set, get) => ({
  snapshots: [],
  groupedSnapshots: [],
  totalCount: 0,
  filesTracked: 0,

  isOpen: false,
  isLoading: false,
  filterFile: null,
  restoringId: null,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),

  setFilterFile: (filePath) => {
    set({ filterFile: filePath });
    // Re-group with filter applied
    const { snapshots } = get();
    const filtered = filePath
      ? snapshots.filter((s) => s.filePath === filePath)
      : snapshots;
    set({ groupedSnapshots: groupSnapshotsByDay(filtered) });
  },

  loadSnapshots: async (projectPath) => {
    set({ isLoading: true });

    try {
      const [allSnapshots, stats] = await Promise.all([
        getSnapshots(projectPath),
        getSnapshotStats(projectPath),
      ]);

      const { filterFile } = get();
      const filtered = filterFile
        ? allSnapshots.filter((s) => s.filePath === filterFile)
        : allSnapshots;

      set({
        snapshots: allSnapshots,
        groupedSnapshots: groupSnapshotsByDay(filtered),
        totalCount: stats.totalSnapshots,
        filesTracked: stats.filesTracked,
        isLoading: false,
      });
    } catch (error) {
      console.error("Failed to load snapshots:", error);
      set({ isLoading: false });
    }
  },

  restore: async (projectPath, snapshotId) => {
    set({ restoringId: snapshotId });

    try {
      const result = await restoreSnapshot(projectPath, snapshotId);

      // Reload snapshots after restore (new snapshot was created)
      await get().loadSnapshots(projectPath);

      set({ restoringId: null });
      return result.restoredPath;
    } catch (error) {
      set({ restoringId: null });
      throw error;
    }
  },

  // Called by fileService after each snapshot is taken, to keep UI in sync
  addSnapshot: (snapshot) => {
    set((state) => {
      const updated = [snapshot, ...state.snapshots];
      const { filterFile } = state;
      const filtered = filterFile
        ? updated.filter((s) => s.filePath === filterFile)
        : updated;

      return {
        snapshots: updated,
        groupedSnapshots: groupSnapshotsByDay(filtered),
        totalCount: state.totalCount + 1,
        filesTracked: new Set(updated.map((s) => s.filePath)).size,
      };
    });
  },
}));