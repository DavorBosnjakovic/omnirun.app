import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { takeSnapshot } from "./snapshotService";
import { useSnapshotStore } from "../stores/snapshotStore";
import { useProjectStore } from "../stores/projectStore";

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export async function selectProjectFolder(): Promise<string | null> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Project Folder",
    });

    console.log("Dialog returned:", selected);

    if (selected && typeof selected === "string") {
      await invoke("set_project_path", { path: selected });
      return selected;
    }

    return null;
  } catch (error) {
    console.error("selectProjectFolder error:", error);
    throw error;
  }
}

export async function getProjectPath(): Promise<string | null> {
  return await invoke("get_project_path");
}

export async function readDirectory(path: string, depth: number = 3): Promise<FileEntry[]> {
  return await invoke("read_directory", { path, depth });
}

export async function readFile(path: string): Promise<string> {
  return await invoke("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  // Auto-snapshot before writing
  const projectPath = useProjectStore.getState().projectPath;
  if (projectPath) {
    try {
      const snapshot = await takeSnapshot(projectPath, path, "write");
      if (snapshot) {
        useSnapshotStore.getState().addSnapshot(snapshot);
      }
    } catch (error) {
      console.error("Snapshot failed (write continues):", error);
    }
  }

  return await invoke("write_file", { path, content });
}

export async function createDirectory(path: string): Promise<void> {
  return await invoke("create_directory", { path });
}

export async function deletePath(path: string): Promise<void> {
  // Auto-snapshot before deleting
  const projectPath = useProjectStore.getState().projectPath;
  if (projectPath) {
    try {
      const snapshot = await takeSnapshot(projectPath, path, "delete");
      if (snapshot) {
        useSnapshotStore.getState().addSnapshot(snapshot);
      }
    } catch (error) {
      console.error("Snapshot failed (delete continues):", error);
    }
  }

  return await invoke("delete_path", { path });
}

const BINARY_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov",
  ".zip", ".rar", ".7z", ".tar", ".gz",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".exe", ".dll", ".so", ".dylib",
  ".lock", ".map"
];

export async function readAllProjectFiles(
  entries: FileEntry[],
  maxTotalChars: number = 100000
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  let totalChars = 0;

  async function walk(items: FileEntry[]) {
    for (const entry of items) {
      if (totalChars >= maxTotalChars) break;

      if (entry.is_dir) {
        if (entry.children) {
          await walk(entry.children);
        }
      } else {
        // Skip binary files
        const ext = "." + (entry.name.split(".").pop()?.toLowerCase() || "");
        if (BINARY_EXTENSIONS.includes(ext)) continue;

        try {
          const content = await readFile(entry.path);
          if (totalChars + content.length > maxTotalChars) {
            // Add truncated
            files.push({
              path: entry.path,
              content: content.slice(0, maxTotalChars - totalChars) + "\n... (truncated)",
            });
            totalChars = maxTotalChars;
            break;
          }
          files.push({ path: entry.path, content });
          totalChars += content.length;
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(entries);
  return files;
}

// ── File watcher ─────────────────────────────────────────────

// Folders to ignore — changes in these shouldn't trigger refreshes
const IGNORED_DIRS = [
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  ".svelte-kit", ".astro", ".output", ".cache", ".mydevify",
  ".backups", "__pycache__", ".turbo",
];

// Store the unwatch function so we can stop watching later
let unwatchFn: (() => void) | null = null;

/**
 * Watch a project directory for external file changes.
 * Calls onChange(changedPaths) when files are created/modified/deleted.
 * Debounces to avoid flooding during npm install, builds, etc.
 */
export async function watchProject(
  projectPath: string,
  onChange: (paths: string[]) => void
): Promise<void> {
  // Stop any existing watcher first
  await unwatchProject();

  try {
    const { watch } = await import("@tauri-apps/plugin-fs");

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingPaths: Set<string> = new Set();

    const stopWatching = await watch(
      projectPath,
      (event) => {
        // event can be a single event or array depending on the plugin version
        const events = Array.isArray(event) ? event : [event];

        for (const ev of events) {
          // Skip if no paths
          if (!ev.paths || ev.paths.length === 0) continue;

          for (const p of ev.paths) {
            if (!p) continue;

            // Normalize path separators for comparison
            const normalized = p.replace(/\\/g, "/");

            // Skip ignored directories
            const shouldIgnore = IGNORED_DIRS.some(
              (dir) => normalized.includes(`/${dir}/`) || normalized.endsWith(`/${dir}`)
            );
            if (shouldIgnore) continue;

            pendingPaths.add(p);
          }
        }

        // Debounce — wait 500ms of quiet before firing
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (pendingPaths.size > 0) {
            const paths = Array.from(pendingPaths);
            pendingPaths.clear();
            onChange(paths);
          }
        }, 500);
      },
      { recursive: true }
    );

    unwatchFn = typeof stopWatching === "function" ? stopWatching : null;
    console.log("[watcher] Watching project:", projectPath);
  } catch (err) {
    console.error("[watcher] Failed to start watching:", err);
  }
}

/**
 * Stop watching the current project directory.
 */
export async function unwatchProject(): Promise<void> {
  if (unwatchFn) {
    try {
      unwatchFn();
      console.log("[watcher] Stopped watching");
    } catch (err) {
      console.error("[watcher] Failed to stop watching:", err);
    }
    unwatchFn = null;
  }
}