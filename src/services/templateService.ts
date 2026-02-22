// ============================================================
// Template Service — fetch templates from Supabase
// ============================================================
// Metadata lives in the `templates` table.
// Actual files live in the `templates` storage bucket.
// Plan gating is handled by the `get_templates_for_plan()` RPC function.

import { getSupabase } from "./supabaseClient";
import {
  type TemplateDefinition,
  type TemplateCategory,
  type TemplateFile,
  groupTemplatesByCategory,
} from "../data/templateData";

// ── Cache ────────────────────────────────────────────────────
// Cache template list in memory for the session so we don't
// re-fetch on every modal open. Invalidated on app restart.

let cachedTemplates: TemplateDefinition[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isCacheValid(): boolean {
  return cachedTemplates !== null && Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

export function clearTemplateCache(): void {
  cachedTemplates = null;
  cacheTimestamp = 0;
}

// ── Fetch Template List ──────────────────────────────────────

/**
 * Fetches all templates available for the user's plan.
 * Returns grouped by category for display in the gallery.
 */
export async function getTemplatesForPlan(
  userPlan: string
): Promise<TemplateCategory[]> {
  // Return from cache if valid
  if (isCacheValid()) {
    return groupTemplatesByCategory(cachedTemplates!);
  }

  const supabase = getSupabase();

  const { data, error } = await supabase.rpc("get_templates_for_plan", {
    user_plan: userPlan || "starter",
  });

  if (error) {
    console.error("[templateService] Failed to fetch templates:", error);
    throw new Error(`Failed to load templates: ${error.message}`);
  }

  const templates: TemplateDefinition[] = (data || []).map((row: any) => ({
    id: row.slug,
    name: row.name,
    category: row.category,
    description: row.description,
    icon: row.icon,
    defaultName: row.default_name,
    framework: row.framework,
    source: "cloud" as const,
    tier: row.tier,
    featured: row.featured,
    tags: row.tags || [],
    previewUrl: row.preview_url,
  }));

  // Update cache
  cachedTemplates = templates;
  cacheTimestamp = Date.now();

  return groupTemplatesByCategory(templates);
}

/**
 * Fetches all active templates (ignores plan gating).
 * Useful for admin views.
 */
export async function getAllTemplates(): Promise<TemplateCategory[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("is_active", true)
    .order("category")
    .order("sort_order");

  if (error) {
    console.error("[templateService] Failed to fetch all templates:", error);
    throw new Error(`Failed to load templates: ${error.message}`);
  }

  const templates: TemplateDefinition[] = (data || []).map((row: any) => ({
    id: row.slug,
    name: row.name,
    category: row.category,
    description: row.description,
    icon: row.icon,
    defaultName: row.default_name,
    framework: row.framework,
    source: "cloud" as const,
    tier: row.tier,
    featured: row.featured,
    tags: row.tags || [],
    previewUrl: row.preview_url,
  }));

  return groupTemplatesByCategory(templates);
}

// ── List Template Files in Storage ───────────────────────────

/**
 * Lists all files in a template's storage folder.
 * Returns relative paths (e.g. "src/App.jsx", "index.html").
 */
export async function listTemplateFiles(templateSlug: string): Promise<string[]> {
  const supabase = getSupabase();
  const filePaths: string[] = [];

  async function listFolder(folderPath: string): Promise<void> {
    const { data, error } = await supabase.storage
      .from("templates")
      .list(folderPath, { limit: 200 });

    if (error) {
      console.error(`[templateService] Failed to list ${folderPath}:`, error);
      throw new Error(`Failed to list template files: ${error.message}`);
    }

    for (const item of data || []) {
      const fullPath = folderPath ? `${folderPath}/${item.name}` : item.name;

      if (item.id === null) {
        // It's a folder — recurse
        await listFolder(fullPath);
      } else {
        // It's a file — strip the template slug prefix to get relative path
        const relativePath = fullPath.replace(`${templateSlug}/`, "");
        filePaths.push(relativePath);
      }
    }
  }

  await listFolder(templateSlug);
  return filePaths;
}

// ── Download Template Files ──────────────────────────────────

/**
 * Downloads a single file from the templates storage bucket.
 * Returns the file content as a string.
 */
async function downloadTemplateFile(
  templateSlug: string,
  relativePath: string
): Promise<string> {
  const supabase = getSupabase();
  const storagePath = `${templateSlug}/${relativePath}`;

  const { data, error } = await supabase.storage
    .from("templates")
    .download(storagePath);

  if (error) {
    console.error(`[templateService] Failed to download ${storagePath}:`, error);
    throw new Error(`Failed to download ${relativePath}: ${error.message}`);
  }

  return await data.text();
}

/**
 * Downloads all files for a template.
 * Returns an array of { path, content } for writing to disk.
 */
export async function downloadTemplateFiles(
  templateSlug: string
): Promise<TemplateFile[]> {
  // 1. List all files in the template folder
  const filePaths = await listTemplateFiles(templateSlug);

  if (filePaths.length === 0) {
    throw new Error(`Template "${templateSlug}" has no files in storage.`);
  }

  // 2. Download all files in parallel (with concurrency limit)
  const CONCURRENCY = 5;
  const files: TemplateFile[] = [];

  for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
    const batch = filePaths.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (relativePath) => {
        const content = await downloadTemplateFile(templateSlug, relativePath);
        return { path: relativePath, content };
      })
    );
    files.push(...results);
  }

  return files;
}

// ── Scaffold Project from Template ───────────────────────────

/**
 * Full flow: download template files and write them to a local project folder.
 * Creates subdirectories as needed.
 *
 * @param templateSlug - The template ID (e.g. "landing-page")
 * @param projectPath - The local folder path to write files into
 * @param onProgress - Optional callback for progress updates (0-100)
 * @returns Array of files written
 */
export async function scaffoldProjectFromTemplate(
  templateSlug: string,
  projectPath: string,
  onProgress?: (percent: number, currentFile: string) => void
): Promise<TemplateFile[]> {
  const { invoke } = await import("@tauri-apps/api/core");

  // 1. Download all template files
  onProgress?.(5, "Downloading template files...");
  const files = await downloadTemplateFiles(templateSlug);

  // 2. Create project folder and set scope
  //    set_project_path creates the dir if needed AND sets the Rust
  //    path scope so subsequent write_file/create_directory calls pass validation
  onProgress?.(15, "Creating project folder...");
  await invoke("set_project_path", { path: projectPath });

  // 3. Write files to disk
  const totalFiles = files.length;
  for (let i = 0; i < totalFiles; i++) {
    const file = files[i];
    const filePath = `${projectPath}/${file.path}`;

    // Create subdirectories if needed
    const dirParts = file.path.split("/");
    if (dirParts.length > 1) {
      const dirPath = `${projectPath}/${dirParts.slice(0, -1).join("/")}`;
      try {
        await invoke("create_directory", { path: dirPath });
      } catch {
        // Directory may already exist
      }
    }

    // Write the file (skip snapshot for template scaffolding)
    await invoke("write_file", { path: filePath, content: file.content });

    const percent = 20 + Math.round(((i + 1) / totalFiles) * 75);
    onProgress?.(percent, file.path);
  }

  onProgress?.(100, "Done!");
  return files;
}

// ── Log Template Download (Analytics) ────────────────────────

/**
 * Records that a user used a template. For analytics/popularity tracking.
 */
export async function logTemplateDownload(templateSlug: string): Promise<void> {
  try {
    const supabase = getSupabase();

    // Get the template UUID from slug
    const { data: template } = await supabase
      .from("templates")
      .select("id")
      .eq("slug", templateSlug)
      .single();

    if (!template) return;

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("template_downloads").insert({
      template_id: template.id,
      user_id: user.id,
    });
  } catch (err) {
    // Non-critical — don't fail the project creation if analytics fails
    console.warn("[templateService] Failed to log download:", err);
  }
}