import { FileEntry, readFile } from "./fileService";

export interface ManifestEntry {
  path: string;        // Relative path from project root
  size: number;        // Character count
  lines: number;       // Line count
  description?: string; // Optional one-liner (added by AI or app)
}

export interface ProjectManifest {
  projectPath: string;
  generatedAt: number;
  totalFiles: number;
  entries: ManifestEntry[];
}

// Extensions to skip entirely
const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov",
  ".zip", ".rar", ".7z", ".tar", ".gz",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".exe", ".dll", ".so", ".dylib",
  ".lock", ".map",
]);

// Directories to skip
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".next", "coverage",
  "__pycache__", ".venv", "target", "vendor", ".svelte-kit",
  ".nuxt", ".output", ".cache",
]);

/**
 * Generate a manifest from the file tree.
 * Reads each text file just to get line count and size — NOT to send contents to AI.
 * This is a one-time cost on project open.
 */
export async function generateManifest(
  projectPath: string,
  fileTree: FileEntry[]
): Promise<ProjectManifest> {
  const entries: ManifestEntry[] = [];

  async function walk(items: FileEntry[], relativePath: string = "") {
    for (const entry of items) {
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.is_dir) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.children) {
          await walk(entry.children, relPath);
        }
      } else {
        const ext = "." + (entry.name.split(".").pop()?.toLowerCase() || "");
        if (SKIP_EXTENSIONS.has(ext)) continue;

        try {
          const content = await readFile(entry.path);
          const lines = content.split("\n").length;
          entries.push({
            path: relPath,
            size: content.length,
            lines,
          });
        } catch {
          // Skip unreadable files, still note they exist
          entries.push({
            path: relPath,
            size: 0,
            lines: 0,
          });
        }
      }
    }
  }

  await walk(fileTree);

  return {
    projectPath,
    generatedAt: Date.now(),
    totalFiles: entries.length,
    entries,
  };
}

/**
 * Update manifest after a file is created or modified.
 * Called by the app after any file write operation.
 */
export function updateManifestEntry(
  manifest: ProjectManifest,
  relativePath: string,
  content: string,
  description?: string
): ProjectManifest {
  const lines = content.split("\n").length;
  const newEntry: ManifestEntry = {
    path: relativePath,
    size: content.length,
    lines,
    description,
  };

  // Replace existing or add new
  const existingIndex = manifest.entries.findIndex((e) => e.path === relativePath);
  const newEntries = [...manifest.entries];

  if (existingIndex >= 0) {
    // Keep existing description if no new one provided
    if (!description && newEntries[existingIndex].description) {
      newEntry.description = newEntries[existingIndex].description;
    }
    newEntries[existingIndex] = newEntry;
  } else {
    newEntries.push(newEntry);
  }

  return {
    ...manifest,
    entries: newEntries,
    totalFiles: newEntries.length,
    generatedAt: Date.now(),
  };
}

/**
 * Remove a file from the manifest.
 * Called by the app after any file delete operation.
 */
export function removeManifestEntry(
  manifest: ProjectManifest,
  relativePath: string
): ProjectManifest {
  const newEntries = manifest.entries.filter((e) => e.path !== relativePath);
  return {
    ...manifest,
    entries: newEntries,
    totalFiles: newEntries.length,
    generatedAt: Date.now(),
  };
}

/**
 * Convert manifest to a compact string for the system prompt.
 * This is what the AI actually sees — paths + line counts, NOT contents.
 * Typically 500-1500 tokens for a 50-100 file project.
 */
export function manifestToString(manifest: ProjectManifest): string {
  // Group by directory for readability
  const byDir: Record<string, ManifestEntry[]> = {};

  for (const entry of manifest.entries) {
    const parts = entry.path.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(entry);
  }

  let result = `Project: ${manifest.projectPath.split(/[/\\]/).pop()}\n`;
  result += `Files: ${manifest.totalFiles}\n\n`;

  for (const [dir, files] of Object.entries(byDir).sort()) {
    result += `${dir}/\n`;
    for (const f of files.sort((a, b) => a.path.localeCompare(b.path))) {
      const name = f.path.split("/").pop();
      const desc = f.description ? ` — ${f.description}` : "";
      result += `  ${name} (${f.lines} lines)${desc}\n`;
    }
  }

  return result;
}

/**
 * Get the relative path of a file from the project root.
 */
export function getRelativePath(projectPath: string, fullPath: string): string {
  return fullPath
    .replace(projectPath, "")
    .replace(/^[/\\]+/, "")
    .replace(/\\/g, "/");
}