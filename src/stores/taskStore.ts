import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ── Types (mirrors Rust data model) ───────────────────────────

export type Executor = "local" | "web" | "ai";

export type FailureAction =
  | { type: "stop" }
  | { type: "skip_and_continue" }
  | { type: "retry"; max_attempts: number };

export type StepAction =
  | { type: "run_command"; command: string; cwd?: string }
  | { type: "backup_files"; source: string; destination: string }
  | { type: "git_commit"; message: string }
  | { type: "git_push"; remote?: string; branch?: string }
  | { type: "run_script"; path: string }
  | { type: "delete_files"; path: string; pattern: string }
  | { type: "http_request"; url: string; method: string; headers?: Record<string, string>; body?: string }
  | { type: "deploy_trigger"; provider: string; project_id: string }
  | { type: "send_webhook"; url: string; payload?: string }
  | { type: "generate_content"; prompt: string; output_path?: string }
  | { type: "analyze_and_act"; prompt: string };

export interface TaskStep {
  id: string;
  name: string;
  executor: Executor;
  action: StepAction;
  depends_on_previous: boolean;
}

export type RunStatus = "running" | "success" | "partial_success" | "failed";
export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface StepResult {
  step_id: string;
  status: StepStatus;
  output?: string;
  error?: string;
  started_at: string;
  finished_at?: string;
}

export interface TaskRun {
  started_at: string;
  finished_at?: string;
  status: RunStatus;
  step_results: StepResult[];
}

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  schedule: string;
  cron_expression: string;
  project_id?: string;
  enabled: boolean;
  steps: TaskStep[];
  on_failure: FailureAction;
  last_run?: TaskRun;
  next_run?: string;
  created_at: string;
  updated_at: string;
}

// ── Task event from Rust scheduler ────────────────────────────

interface TaskEventStarted {
  type: "started";
}

interface TaskEventStepCompleted {
  type: "step_completed";
  step_id: string;
  step_name: string;
  status: StepStatus;
  output?: string;
  error?: string;
}

interface TaskEventFinished {
  type: "finished";
  status: RunStatus;
}

type TaskEventType = TaskEventStarted | TaskEventStepCompleted | TaskEventFinished;

interface TaskEvent {
  task_id: string;
  task_name: string;
  event_type: TaskEventType;
}

// ── Store ─────────────────────────────────────────────────────

interface TaskState {
  tasks: ScheduledTask[];
  isLoading: boolean;
  error: string | null;
  runningTaskId: string | null;
  runningStepResults: StepResult[];
  setTasks: (tasks: ScheduledTask[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setRunningTaskId: (id: string | null) => void;
  setRunningStepResults: (results: StepResult[]) => void;
  addRunningStepResult: (result: StepResult) => void;
  addTask: (task: ScheduledTask) => void;
  updateTaskInStore: (task: ScheduledTask) => void;
  removeTask: (taskId: string) => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  isLoading: false,
  error: null,
  runningTaskId: null,
  runningStepResults: [],
  setTasks: (tasks) => set({ tasks }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setRunningTaskId: (id) => set({ runningTaskId: id }),
  setRunningStepResults: (results) => set({ runningStepResults: results }),
  addRunningStepResult: (result) =>
    set((state) => ({
      runningStepResults: [...state.runningStepResults, result],
    })),
  addTask: (task) =>
    set((state) => ({ tasks: [...state.tasks, task] })),
  updateTaskInStore: (task) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
    })),
  removeTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    })),
}));

// ── Tauri IPC functions ───────────────────────────────────────
// These call the Rust backend and update the store.
// Called from components, not from inside the store.

export async function fetchTasks(): Promise<void> {
  const store = useTaskStore.getState();
  store.setLoading(true);
  store.setError(null);
  try {
    const tasks = await invoke<ScheduledTask[]>("get_tasks");
    store.setTasks(tasks);
  } catch (err) {
    store.setError(String(err));
  } finally {
    store.setLoading(false);
  }
}

export async function createTask(taskData: Partial<ScheduledTask>): Promise<ScheduledTask | null> {
  const store = useTaskStore.getState();
  try {
    const task: ScheduledTask = {
      id: "",
      name: taskData.name || "New Task",
      description: taskData.description || "",
      schedule: taskData.schedule || "",
      cron_expression: taskData.cron_expression || "",
      project_id: taskData.project_id ?? undefined,
      enabled: taskData.enabled ?? true,
      steps: taskData.steps || [],
      on_failure: taskData.on_failure || { type: "stop" },
      last_run: undefined,
      next_run: undefined,
      created_at: "",
      updated_at: "",
    };
    const created = await invoke<ScheduledTask>("create_task", { task });
    store.addTask(created);
    store.setError(null);
    return created;
  } catch (err) {
    store.setError(String(err));
    return null;
  }
}

export async function updateTask(task: ScheduledTask): Promise<ScheduledTask | null> {
  const store = useTaskStore.getState();
  try {
    const updated = await invoke<ScheduledTask>("update_task", { task });
    store.updateTaskInStore(updated);
    store.setError(null);
    return updated;
  } catch (err) {
    store.setError(String(err));
    return null;
  }
}

export async function deleteTask(taskId: string): Promise<boolean> {
  const store = useTaskStore.getState();
  try {
    await invoke("delete_task", { taskId });
    store.removeTask(taskId);
    store.setError(null);
    return true;
  } catch (err) {
    store.setError(String(err));
    return false;
  }
}

export async function toggleTask(taskId: string): Promise<ScheduledTask | null> {
  const store = useTaskStore.getState();
  try {
    const toggled = await invoke<ScheduledTask>("toggle_task", { taskId });
    store.updateTaskInStore(toggled);
    store.setError(null);
    return toggled;
  } catch (err) {
    store.setError(String(err));
    return null;
  }
}

export async function runTaskNow(taskId: string): Promise<boolean> {
  const store = useTaskStore.getState();
  try {
    await invoke("run_task_now", { taskId });
    return true;
  } catch (err) {
    store.setError(String(err));
    return false;
  }
}

// ── Event listener ────────────────────────────────────────────
// Call startTaskListener() once when TasksPage mounts.
// Call the returned cleanup function on unmount.

export async function startTaskListener(): Promise<UnlistenFn> {
  const unlisten = await listen<TaskEvent>("task-event", (event) => {
    const store = useTaskStore.getState();
    const { task_id, event_type } = event.payload;

    switch (event_type.type) {
      case "started":
        store.setRunningTaskId(task_id);
        store.setRunningStepResults([]);
        break;

      case "step_completed":
        store.addRunningStepResult({
          step_id: event_type.step_id,
          status: event_type.status,
          output: event_type.output,
          error: event_type.error,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        });
        break;

      case "finished":
        // Refresh tasks to get updated last_run and next_run
        fetchTasks();
        store.setRunningTaskId(null);
        store.setRunningStepResults([]);
        break;
    }
  });

  return unlisten;
}

// ── Helpers ───────────────────────────────────────────────────

export function getTasksGrouped(tasks: ScheduledTask[]): Record<string, ScheduledTask[]> {
  const groups: Record<string, ScheduledTask[]> = {};
  for (const task of tasks) {
    const key = task.project_id || "_general";
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  }
  return groups;
}

export function getTaskCounts(tasks: ScheduledTask[]) {
  const active = tasks.filter((t) => t.enabled).length;
  const failed = tasks.filter(
    (t) => t.last_run?.status === "failed" || t.last_run?.status === "partial_success"
  ).length;
  return { active, failed };
}

export function formatNextRun(nextRun?: string): string {
  if (!nextRun) return "Not scheduled";
  try {
    const next = new Date(nextRun);
    const now = new Date();
    const diffMs = next.getTime() - now.getTime();
    if (diffMs < 0) return "Overdue";
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Less than a minute";
    if (diffMins < 60) return `In ${diffMins} min`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `In ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `In ${diffDays}d`;
    return next.toLocaleDateString();
  } catch {
    return "Not scheduled";
  }
}

export function formatRunStatus(status?: RunStatus): { label: string; color: string } {
  switch (status) {
    case "success":
      return { label: "Success", color: "#22c55e" };
    case "partial_success":
      return { label: "Partial", color: "#f59e0b" };
    case "failed":
      return { label: "Failed", color: "#ef4444" };
    case "running":
      return { label: "Running", color: "#3b82f6" };
    default:
      return { label: "Never run", color: "var(--text-secondary)" };
  }
}