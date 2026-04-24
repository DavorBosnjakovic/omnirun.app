// ============================================================
// Snapshot Service - Time Machine
// ============================================================
// Automatically saves file snapshots before every write/delete.
// Stores snapshots in .omnirun/snapshots/ inside the project.
// Never destructive — restoring doesn't delete future snapshots.

import { invoke } from "@tauri-apps/api/core";

// ─── Types ───────────────────────────────────────────────────

export interface Snapshot {
  id: string;
  timestamp: number;
  filePath: string;         // Relative path within project (e.g. "src/index.html")
  fileName: string;         // Just the filename (e.g. "index.html")
  action: "write" | "delete" | "restore"; // What triggered the snapshot
  label?: string;           // Optional human-readable label (e.g. "Added contact form")
  fileSize: number;         // Size of the backed-up content in bytes
  snapshotFile: string;     // Filename in snapshots/files/ folder
  isNewFile: boolean;       // True if file didn't exist before (first write)
}

export interface SnapshotIndex {
  version: 1;
  projectPath: string;
  snapshots: Snapshot[];
}

// ─── Constants ───────────────────────────────────────────────

const SNAPSHOT_DIR = ".omnirun";
const SNAPSHOTS_SUBDIR = "snapshots";
const FILES_SUBDIR = "files";
const INDEX_FILE = "index.json";

// ─── Path Helpers ────────────────────────────────────────────

function getSnapshotsRoot(projectPath: string): string {
  return `${projectPath}\\${SNAPSHOT_DIR}\\${SNAPSHOTS_SUBDIR}`;
}

function getFilesDir(projectPath: string): string {
  return `${getSnapshotsRoot(projectPath)}\\${FILES_SUBDIR}`;
}

function getIndexPath(projectPath: string): string {
  return `${getSnapshotsRoot(projectPath)}\\${INDEX_FILE}`;
}

function getRelativePath(projectPath: string, absolutePath: string): string {
  // Normalize both paths to use same separator
  const normProject = projectPath.replace(/\//g, "\\").replace(/\\+$/, "");
  const normAbsolute = absolutePath.replace(/\//g, "\\");
  if (normAbsolute.startsWith(normProject)) {
    return normAbsolute.slice(normProject.length + 1); // +1 for separator
  }
  return absolutePath;
}

function generateSnapshotId(): string {
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now}_${rand}`;
}

function generateSnapshotFilename(id: string, originalName: string): string {
  // e.g. "1706123456789_abc123_index.html"
  return `${id}_${originalName}`;
}

// ─── Index Management ────────────────────────────────────────

async function ensureSnapshotDirs(projectPath: string): Promise<void> {
  try {
    await invoke("create_directory", { path: getFilesDir(projectPath) });
  } catch {
    // Directories may already exist
  }
}

async function loadIndex(projectPath: string): Promise<SnapshotIndex> {
  try {
    const content: string = await invoke("read_file", { path: getIndexPath(projectPath) });
    const parsed = JSON.parse(content);
    return parsed;
  } catch {
    // Index doesn't exist yet — create empty
    return {
      version: 1,
      projectPath,
      snapshots: [],
    };
  }
}

async function saveIndex(projectPath: string, index: SnapshotIndex): Promise<void> {
  const content = JSON.stringify(index, null, 2);
  await invoke("write_file", { path: getIndexPath(projectPath), content });
}

// ─── Core Functions ──────────────────────────────────────────

/**
 * Take a snapshot of a file before it gets modified or deleted.
 * Call this BEFORE writeFile or deletePath.
 * Returns the snapshot entry, or null if file doesn't exist (new file).
 */
export async function takeSnapshot(
  projectPath: string,
  filePath: string,
  action: "write" | "delete",
  label?: string
): Promise<Snapshot | null> {
  // Skip snapshotting our own snapshot files
  const relative = getRelativePath(projectPath, filePath);
  if (relative.startsWith(SNAPSHOT_DIR)) return null;

  await ensureSnapshotDirs(projectPath);

  // Try to read the current file content
  let content: string;
  let isNewFile = false;

  try {
    content = await invoke("read_file", { path: filePath });
  } catch {
    // File doesn't exist yet (new file being created)
    isNewFile = true;

    if (action === "write") {
      // First write — no previous content to snapshot, but record the event
      const id = generateSnapshotId();
      const fileName = filePath.split(/[/\\]/).pop() || "unknown";

      const snapshot: Snapshot = {
        id,
        timestamp: Date.now(),
        filePath: relative,
        fileName,
        action,
        label,
        fileSize: 0,
        snapshotFile: "",
        isNewFile: true,
      };

      const index = await loadIndex(projectPath);
      index.snapshots.push(snapshot);
      await saveIndex(projectPath, index);

      return snapshot;
    }

    // Can't snapshot a delete of a file that doesn't exist
    return null;
  }

  // Save the current content as a snapshot file
  const id = generateSnapshotId();
  const fileName = filePath.split(/[/\\]/).pop() || "unknown";
  const snapshotFile = generateSnapshotFilename(id, fileName);
  const snapshotFilePath = `${getFilesDir(projectPath)}\\${snapshotFile}`;

  await invoke("write_file", { path: snapshotFilePath, content });

  const snapshot: Snapshot = {
    id,
    timestamp: Date.now(),
    filePath: relative,
    fileName,
    action,
    label,
    fileSize: content.length,
    snapshotFile,
    isNewFile: false,
  };

  // Update index
  const index = await loadIndex(projectPath);
  index.snapshots.push(snapshot);
  await saveIndex(projectPath, index);

  return snapshot;
}

/**
 * Restore a file from a snapshot.
 * Creates a new snapshot of the current state before restoring (so restore is undoable).
 */
export async function restoreSnapshot(
  projectPath: string,
  snapshotId: string
): Promise<{ restored: boolean; restoredPath: string }> {
  const index = await loadIndex(projectPath);
  const snapshot = index.snapshots.find((s) => s.id === snapshotId);

  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const absolutePath = `${projectPath}\\${snapshot.filePath}`;

  // If it was a new file snapshot (no content), "restore" means delete the file
  if (snapshot.isNewFile && !snapshot.snapshotFile) {
    // Snapshot the current state first (so this restore is undoable)
    await takeSnapshot(projectPath, absolutePath, "restore", `Restore: removed ${snapshot.fileName}`);

    // Delete the file (restore to "didn't exist" state)
    try {
      await invoke("delete_path", { path: absolutePath });
    } catch {
      // File might already be gone
    }

    return { restored: true, restoredPath: snapshot.filePath };
  }

  // Read the snapshot content
  const snapshotFilePath = `${getFilesDir(projectPath)}\\${snapshot.snapshotFile}`;
  let snapshotContent: string;

  try {
    snapshotContent = await invoke("read_file", { path: snapshotFilePath });
  } catch {
    throw new Error(`Snapshot file missing: ${snapshot.snapshotFile}`);
  }

  // Take a snapshot of the CURRENT state before restoring (so restore is undoable)
  await takeSnapshot(projectPath, absolutePath, "restore", `Before restore to ${formatTime(snapshot.timestamp)}`);

  // Ensure parent directory exists
  const parentDir = absolutePath.replace(/[/\\][^/\\]+$/, "");
  try {
    await invoke("create_directory", { path: parentDir });
  } catch {
    // May already exist
  }

  // Write the snapshot content back to the file
  await invoke("write_file", { path: absolutePath, content: snapshotContent });

  return { restored: true, restoredPath: snapshot.filePath };
}

/**
 * Get all snapshots for the project, newest first.
 */
export async function getSnapshots(projectPath: string): Promise<Snapshot[]> {
  const index = await loadIndex(projectPath);
  return [...index.snapshots].reverse(); // Newest first
}

/**
 * Get snapshots for a specific file, newest first.
 */
export async function getFileSnapshots(projectPath: string, relativeFilePath: string): Promise<Snapshot[]> {
  const index = await loadIndex(projectPath);
  return index.snapshots
    .filter((s) => s.filePath === relativeFilePath)
    .reverse();
}

/**
 * Get the content of a snapshot file (for compare/preview).
 */
export async function getSnapshotContent(projectPath: string, snapshotId: string): Promise<string | null> {
  const index = await loadIndex(projectPath);
  const snapshot = index.snapshots.find((s) => s.id === snapshotId);

  if (!snapshot || !snapshot.snapshotFile) return null;

  try {
    const snapshotFilePath = `${getFilesDir(projectPath)}\\${snapshot.snapshotFile}`;
    return await invoke("read_file", { path: snapshotFilePath });
  } catch {
    return null;
  }
}

/**
 * Get snapshot stats for the project.
 */
export async function getSnapshotStats(projectPath: string): Promise<{
  totalSnapshots: number;
  filesTracked: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
}> {
  const index = await loadIndex(projectPath);
  const uniqueFiles = new Set(index.snapshots.map((s) => s.filePath));

  return {
    totalSnapshots: index.snapshots.length,
    filesTracked: uniqueFiles.size,
    oldestTimestamp: index.snapshots.length > 0 ? index.snapshots[0].timestamp : null,
    newestTimestamp: index.snapshots.length > 0 ? index.snapshots[index.snapshots.length - 1].timestamp : null,
  };
}

// ─── Formatting Helpers ──────────────────────────────────────

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Group snapshots by day for the timeline UI.
 */
export function groupSnapshotsByDay(snapshots: Snapshot[]): { label: string; date: string; snapshots: Snapshot[] }[] {
  const groups: Map<string, Snapshot[]> = new Map();

  for (const snap of snapshots) {
    const date = new Date(snap.timestamp);
    const dateKey = date.toISOString().split("T")[0]; // "2026-02-06"

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(snap);
  }

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  return Array.from(groups.entries()).map(([dateKey, snaps]) => ({
    label: dateKey === today ? "Today" : dateKey === yesterday ? "Yesterday" : new Date(dateKey).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
    date: dateKey,
    snapshots: snaps,
  }));
}