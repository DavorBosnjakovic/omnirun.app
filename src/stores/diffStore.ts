// ============================================================
// Diff Store - Approval Flow
// ============================================================
// Manages pending file change approvals.
// When AI wants to write/edit/delete, the change is shown to
// the user for approval before executing.

import { create } from "zustand";
import type { PendingDiff } from "../services/toolService";

export type { PendingDiff };

interface DiffState {
  pendingDiff: PendingDiff | null;
  resolver: ((approved: boolean) => void) | null;

  /**
   * Show a diff to the user and wait for approval.
   * Returns a Promise that resolves to true (approved) or false (rejected).
   */
  requestApproval: (diff: PendingDiff) => Promise<boolean>;

  /** User clicked Approve */
  approve: () => void;

  /** User clicked Reject */
  reject: () => void;

  /** Clear without resolving (e.g. on chat clear) */
  clear: () => void;
}

export const useDiffStore = create<DiffState>((set, get) => ({
  pendingDiff: null,
  resolver: null,

  requestApproval: (diff: PendingDiff) => {
    return new Promise<boolean>((resolve) => {
      set({
        pendingDiff: diff,
        resolver: resolve,
      });
    });
  },

  approve: () => {
    const { resolver } = get();
    if (resolver) resolver(true);
    set({ pendingDiff: null, resolver: null });
  },

  reject: () => {
    const { resolver } = get();
    if (resolver) resolver(false);
    set({ pendingDiff: null, resolver: null });
  },

  clear: () => {
    const { resolver } = get();
    if (resolver) resolver(false); // Reject any pending
    set({ pendingDiff: null, resolver: null });
  },
}));