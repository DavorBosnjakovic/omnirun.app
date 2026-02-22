import { readFile, writeFile, createDirectory } from "./fileService";

/**
 * Context Service — Phase 2 Token Optimization
 * 
 * Replaces the manifest in the system prompt with a lean context file (~100-150 tokens).
 * The AI uses list_directory/read_file tools when it needs to explore — no more
 * sending the full file tree on every single API call.
 * 
 * Context file lives at: .mydevify/context.md (inside the project folder)
 * Persists across sessions so the AI remembers decisions from previous chats.
 */

export interface ProjectContext {
  projectName: string;
  projectPath: string;
  techStack: string[];
  preferences: string[];
  decisions: string[];
  recentChanges: string[];
}

const CONTEXT_DIR = ".mydevify";
const CONTEXT_FILE = ".mydevify/context.md";
const MAX_RECENT_CHANGES = 10;

// ── Tech Stack Detection ─────────────────────────────────────

interface TechIndicator {
  file: string;
  tech: string;
}

const TECH_INDICATORS: TechIndicator[] = [
  { file: "package.json", tech: "" },         // Special — parsed for frameworks
  { file: "tsconfig.json", tech: "TypeScript" },
  { file: "tailwind.config.js", tech: "Tailwind CSS" },
  { file: "tailwind.config.ts", tech: "Tailwind CSS" },
  { file: "postcss.config.js", tech: "PostCSS" },
  { file: "vite.config.ts", tech: "Vite" },
  { file: "vite.config.js", tech: "Vite" },
  { file: "next.config.js", tech: "Next.js" },
  { file: "next.config.mjs", tech: "Next.js" },
  { file: "next.config.ts", tech: "Next.js" },
  { file: "nuxt.config.ts", tech: "Nuxt" },
  { file: "svelte.config.js", tech: "SvelteKit" },
  { file: "astro.config.mjs", tech: "Astro" },
  { file: "angular.json", tech: "Angular" },
  { file: "vue.config.js", tech: "Vue CLI" },
  { file: "Cargo.toml", tech: "Rust" },
  { file: "requirements.txt", tech: "Python" },
  { file: "pyproject.toml", tech: "Python" },
  { file: "go.mod", tech: "Go" },
  { file: "Gemfile", tech: "Ruby" },
  { file: "composer.json", tech: "PHP" },
  { file: ".env", tech: "" },                 // Skip — not a tech
];

const PACKAGE_JSON_FRAMEWORKS: Record<string, string> = {
  "react": "React",
  "react-dom": "React",
  "next": "Next.js",
  "vue": "Vue",
  "nuxt": "Nuxt",
  "svelte": "Svelte",
  "@sveltejs/kit": "SvelteKit",
  "angular": "Angular",
  "@angular/core": "Angular",
  "express": "Express",
  "fastify": "Fastify",
  "hono": "Hono",
  "tailwindcss": "Tailwind CSS",
  "three": "Three.js",
  "d3": "D3.js",
  "prisma": "Prisma",
  "drizzle-orm": "Drizzle",
  "mongoose": "Mongoose",
  "stripe": "Stripe",
  "firebase": "Firebase",
  "@supabase/supabase-js": "Supabase",
};

/**
 * Detect tech stack from root files in the project.
 * Returns array like ["React", "TypeScript", "Vite", "Tailwind CSS"]
 */
async function detectTechStack(projectPath: string, rootFileNames: string[]): Promise<string[]> {
  const detected = new Set<string>();

  // Check which indicator files exist
  for (const indicator of TECH_INDICATORS) {
    if (rootFileNames.includes(indicator.file) && indicator.tech) {
      detected.add(indicator.tech);
    }
  }

  // Parse package.json for framework dependencies
  if (rootFileNames.includes("package.json")) {
    try {
      const pkgContent = await readFile(`${projectPath}\\package.json`);
      const pkg = JSON.parse(pkgContent);
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      for (const [dep, tech] of Object.entries(PACKAGE_JSON_FRAMEWORKS)) {
        if (dep in allDeps) {
          detected.add(tech);
        }
      }
    } catch {
      // Can't read or parse — skip
    }
  }

  // Check for plain HTML project (no package.json, has .html files)
  if (!rootFileNames.includes("package.json")) {
    const hasHtml = rootFileNames.some(f => f.endsWith(".html"));
    if (hasHtml) {
      detected.add("Static HTML");
    }
  }

  return Array.from(detected);
}

// ── Context File I/O ─────────────────────────────────────────

/**
 * Load existing context from .mydevify/context.md.
 * Returns null if the file doesn't exist yet.
 */
export async function loadContext(projectPath: string): Promise<ProjectContext | null> {
  try {
    const content = await readFile(`${projectPath}\\${CONTEXT_FILE}`);
    return parseContextFile(content, projectPath);
  } catch {
    return null;
  }
}

/**
 * Save context to .mydevify/context.md.
 */
export async function saveContext(projectPath: string, context: ProjectContext): Promise<void> {
  const content = serializeContext(context);

  // Ensure .mydevify directory exists
  try {
    await createDirectory(`${projectPath}\\${CONTEXT_DIR}`);
  } catch {
    // Already exists
  }

  await writeFile(`${projectPath}\\${CONTEXT_FILE}`, content);
}

/**
 * Initialize context for a project.
 * If context.md exists, loads it and reconciles tech stack.
 * If not, creates a fresh one from filesystem detection.
 */
export async function initContext(
  projectPath: string,
  rootFileNames: string[]
): Promise<ProjectContext> {
  const projectName = projectPath.split(/[/\\]/).pop() || "unknown";
  const techStack = await detectTechStack(projectPath, rootFileNames);

  // Try loading existing context
  const existing = await loadContext(projectPath);

  if (existing) {
    // Reconcile: update tech stack if new stuff detected, keep AI notes
    const mergedTech = Array.from(new Set([...existing.techStack, ...techStack]));
    const updated: ProjectContext = {
      ...existing,
      projectName,
      techStack: mergedTech,
    };
    await saveContext(projectPath, updated);
    return updated;
  }

  // Fresh context
  const fresh: ProjectContext = {
    projectName,
    projectPath,
    techStack,
    preferences: [],
    decisions: [],
    recentChanges: [],
  };

  await saveContext(projectPath, fresh);
  return fresh;
}

// ── Context Updates (called after file operations) ───────────

/**
 * Add a recent change entry. Called automatically after write/edit/delete.
 * Keeps only the last MAX_RECENT_CHANGES entries.
 */
export function addRecentChange(context: ProjectContext, change: string): ProjectContext {
  const recentChanges = [change, ...context.recentChanges].slice(0, MAX_RECENT_CHANGES);
  return { ...context, recentChanges };
}

/**
 * Add preferences or decisions from AI's write_context tool call.
 */
export function updateContextFromAI(
  context: ProjectContext,
  section: "preferences" | "decisions",
  entries: string[]
): ProjectContext {
  if (section === "preferences") {
    // Merge, avoiding duplicates (case-insensitive)
    const existing = new Set(context.preferences.map(p => p.toLowerCase()));
    const newEntries = entries.filter(e => !existing.has(e.toLowerCase()));
    return { ...context, preferences: [...context.preferences, ...newEntries] };
  } else {
    const existing = new Set(context.decisions.map(d => d.toLowerCase()));
    const newEntries = entries.filter(e => !existing.has(e.toLowerCase()));
    return { ...context, decisions: [...context.decisions, ...newEntries] };
  }
}

// ── System Prompt String ─────────────────────────────────────

/**
 * Convert context to a lean string for the system prompt.
 * This is what gets sent on EVERY API call — keep it minimal.
 * Typically 80-150 tokens.
 */
export function contextToPromptString(context: ProjectContext): string {
  let result = `Project: ${context.projectName}\n`;
  result += `Path: ${context.projectPath}\n`;

  if (context.techStack.length > 0) {
    result += `Tech: ${context.techStack.join(", ")}\n`;
  }

  if (context.preferences.length > 0) {
    result += `\nPreferences:\n`;
    for (const p of context.preferences) {
      result += `- ${p}\n`;
    }
  }

  if (context.decisions.length > 0) {
    result += `\nDecisions:\n`;
    for (const d of context.decisions) {
      result += `- ${d}\n`;
    }
  }

  if (context.recentChanges.length > 0) {
    result += `\nRecent changes:\n`;
    for (const c of context.recentChanges.slice(0, 5)) {
      result += `- ${c}\n`;
    }
  }

  return result;
}

// ── Parsing & Serialization ──────────────────────────────────

function serializeContext(context: ProjectContext): string {
  let md = `# Project Context\n`;
  md += `Project: ${context.projectName}\n`;
  md += `Path: ${context.projectPath}\n`;
  md += `Tech: ${context.techStack.join(", ")}\n`;

  md += `\n## Preferences\n`;
  if (context.preferences.length === 0) {
    md += `(none yet)\n`;
  } else {
    for (const p of context.preferences) {
      md += `- ${p}\n`;
    }
  }

  md += `\n## Decisions\n`;
  if (context.decisions.length === 0) {
    md += `(none yet)\n`;
  } else {
    for (const d of context.decisions) {
      md += `- ${d}\n`;
    }
  }

  md += `\n## Recent Changes\n`;
  if (context.recentChanges.length === 0) {
    md += `(none yet)\n`;
  } else {
    for (const c of context.recentChanges) {
      md += `- ${c}\n`;
    }
  }

  return md;
}

function parseContextFile(content: string, projectPath: string): ProjectContext {
  const projectName = extractField(content, "Project") || projectPath.split(/[/\\]/).pop() || "unknown";
  const techLine = extractField(content, "Tech") || "";
  const techStack = techLine ? techLine.split(",").map(t => t.trim()).filter(Boolean) : [];

  const preferences = extractListSection(content, "Preferences");
  const decisions = extractListSection(content, "Decisions");
  const recentChanges = extractListSection(content, "Recent Changes");

  return {
    projectName,
    projectPath,
    techStack,
    preferences,
    decisions,
    recentChanges,
  };
}

function extractField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

function extractListSection(content: string, heading: string): string[] {
  const regex = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(regex);
  if (!match) return [];

  return match[1]
    .split("\n")
    .filter(line => line.trim().startsWith("- "))
    .map(line => line.trim().slice(2).trim())
    .filter(Boolean);
}