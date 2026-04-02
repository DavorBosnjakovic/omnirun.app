// ============================================================
// routineStore.ts - Routines State Management
// ============================================================
// Stores routines in SQLite via the settings table as JSON.
// No schema migration needed.

import { create } from 'zustand';
import { dbService } from '../services/dbService';

// --------------- Types ---------------

export interface RoutineStep {
  id: string;
  name: string;    // display label: "Open Slack"
  action: string;  // instruction for AI: "Open the Slack application"
}

export interface Routine {
  id: string;
  name: string;           // trigger phrase: "good morning", "start work"
  description: string;    // short summary of what it does
  steps: RoutineStep[];
  createdAt: number;
  updatedAt: number;
}

interface RoutineState {
  routines: Routine[];
  isLoading: boolean;

  // CRUD
  loadRoutines: () => Promise<void>;
  addRoutine: (routine: Omit<Routine, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Routine>;
  updateRoutine: (id: string, updates: Partial<Omit<Routine, 'id' | 'createdAt'>>) => Promise<void>;
  deleteRoutine: (id: string) => Promise<void>;
  reorderSteps: (routineId: string, steps: RoutineStep[]) => Promise<void>;

  // Helpers
  getRoutine: (id: string) => Routine | undefined;
  getRoutineByName: (name: string) => Routine | undefined;
  getRoutineNames: () => string[];
}

// --------------- Persistence ---------------

const STORAGE_KEY = 'routines';

async function saveRoutines(routines: Routine[]): Promise<void> {
  try {
    await dbService.setSetting(STORAGE_KEY, JSON.stringify(routines));
  } catch (e) {
    console.error('Failed to save routines:', e);
  }
}

async function loadRoutinesFromDB(): Promise<Routine[]> {
  try {
    const all = await dbService.getAllSettings();
    if (all[STORAGE_KEY]) {
      return JSON.parse(all[STORAGE_KEY]);
    }
  } catch (e) {
    console.error('Failed to load routines:', e);
  }
  return [];
}

// --------------- Helpers ---------------

function generateId(): string {
  return `routine_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// --------------- Store ---------------

export const useRoutineStore = create<RoutineState>((set, get) => ({
  routines: [],
  isLoading: false,

  loadRoutines: async () => {
    set({ isLoading: true });
    const routines = await loadRoutinesFromDB();
    set({ routines, isLoading: false });
  },

  addRoutine: async (input) => {
    const now = Date.now();
    const routine: Routine = {
      id: generateId(),
      name: input.name.trim(),
      description: input.description.trim(),
      steps: input.steps.map((s) => ({
        ...s,
        id: s.id || generateStepId(),
      })),
      createdAt: now,
      updatedAt: now,
    };

    const updated = [...get().routines, routine];
    set({ routines: updated });
    await saveRoutines(updated);
    return routine;
  },

  updateRoutine: async (id, updates) => {
    const updated = get().routines.map((r) =>
      r.id === id
        ? { ...r, ...updates, updatedAt: Date.now() }
        : r
    );
    set({ routines: updated });
    await saveRoutines(updated);
  },

  deleteRoutine: async (id) => {
    const updated = get().routines.filter((r) => r.id !== id);
    set({ routines: updated });
    await saveRoutines(updated);
  },

  reorderSteps: async (routineId, steps) => {
    const updated = get().routines.map((r) =>
      r.id === routineId
        ? { ...r, steps, updatedAt: Date.now() }
        : r
    );
    set({ routines: updated });
    await saveRoutines(updated);
  },

  getRoutine: (id) => get().routines.find((r) => r.id === id),

  getRoutineByName: (name) => {
    const lower = name.toLowerCase().trim();
    return get().routines.find((r) => r.name.toLowerCase().trim() === lower);
  },

  getRoutineNames: () => get().routines.map((r) => r.name),
}));

// --------------- Helper for system prompt injection ---------------

/**
 * Build a block of text describing the user's routines for injection
 * into the Assistant system prompt. Returns empty string if no routines.
 */
export function buildRoutinesPromptBlock(): string {
  const { routines } = useRoutineStore.getState();
  if (routines.length === 0) return '';

  const routineList = routines.map((r) => {
    const steps = r.steps.map((s, i) => `  ${i + 1}. ${s.action}`).join('\n');
    return `- "${r.name}": ${r.description}\n${steps}`;
  }).join('\n\n');

  return `\n\nThe user has configured the following routines. When the user says "run [routine name]" or "start [routine name]", execute the steps in order. ONLY trigger routines when explicitly asked with "run" or "start" — never on casual mentions of the routine name.\n\nRoutines:\n${routineList}`;
}