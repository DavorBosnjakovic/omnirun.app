import { readFile, writeFile, createDirectory, readDirectory, deletePath, FileEntry } from "./fileService";
import { invoke } from "@tauri-apps/api/core";

/** Best-effort file delete. Silent on failure (file may not exist). */
async function tryDeleteFile(absolutePath: string): Promise<void> {
  try {
    await deletePath(absolutePath);
  } catch {
    /* swallow — file may not exist */
  }
}

/** Cross-platform path join — uses "/" which works on Windows, Mac, and Linux with Tauri */
function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\\/g, "/").replace(/\/+/g, "/");
}

/**
 * Context Service — Layered Project Knowledge
 *
 * DISK LAYOUT:
 *   .omnirun/
 *     index.md           ← Tiny index (always loaded into system prompt)
 *     brief.md           ← Full product vision (loaded on demand)
 *     styles.md          ← Design language (loaded on demand)
 *     conventions.md     ← Coding patterns (loaded on demand)
 *     kickoff.md         ← New-project instructions (loaded once per new project)
 *     docs/              ← User-uploaded / AI-saved reference docs
 *     summaries/         ← AI summaries of user knowledge files (.txt/.md in project)
 *     meta.json          ← Tracking for summaries (mtime-based refresh)
 *
 * WHAT GOES WHERE:
 *   index.md             One-liner about, pointers, preferences, decisions, recent changes
 *   brief.md             Product vision, user flows, business rules, scope
 *   styles.md            Design direction beyond what Tailwind/theme files capture
 *   conventions.md       Coding patterns, naming, file structure this project uses
 *
 * DERIVABLE FACTS ARE NOT STORED:
 *   Tech stack  → re-detected fresh on every initContext (reads package.json)
 *   Schema      → schema.prisma / schema.sql already loaded as source files
 *   Routes      → AI uses list_directory / grep when needed
 *   File tree   → AI uses list_directory
 *
 * TOKEN BUDGET PER AI CALL:
 *   index.md              ~200-400 tokens   (always)
 *   Source files          ~1000-5000 tokens (cached after first call)
 *   TOTAL DYNAMIC         ~200-400 tokens
 *
 * WRITE DISCIPLINE:
 *   - write_context("about"|"brief"|"styles"|"conventions") → writes the topic file
 *     and ensures a pointer exists in index.md.
 *   - write_context("decisions"|"preferences"|"built") → appends to index.md section.
 *   - Kickoff instructions live in kickoff.md, not in the system prompt.
 */

// ── Types ────────────────────────────────────────────────────

export interface ProjectContext {
  projectName: string;
  projectPath: string;
  appRoot: string;

  /** True when there is no index.md yet — AI should run kickoff on first message. */
  isNewProject: boolean;

  /** Fresh tech detection from package.json/etc (not persisted). */
  techStack: string[];
  /** Notable dependencies from package.json (not persisted). */
  keyDeps: string[];
  /** Structure lines from scanProject (not persisted — re-derived). */
  structure: string;

  // ── Index fields ──
  /** Product description. Array form for backward compatibility. */
  about: string[];
  /** Comprehensive project brief (kept for backward compatibility — actual content lives in .omnirun/brief.md). */
  brief: string[];
  /** Visual design system (kept for backward compatibility — actual content lives in .omnirun/styles.md). */
  styles: string[];
  /** Coding conventions (kept for backward compatibility — actual content lives in .omnirun/conventions.md). */
  conventions: string[];
  /** API routes / page routes (legacy — derived from code, not persisted). */
  routes: string[];
  /** Database schema (legacy — derived from schema.prisma/schema.sql, not persisted). */
  schema: string[];
  /** Confirmed user preferences. */
  preferences: string[];
  /** Architectural / product decisions with reasoning. */
  decisions: string[];
  /** Compressed log of completed features. */
  built: string[];
  /** Currently in progress — cleared at session end. */
  progress: string[];
  /** Rolling log of recent file operations. */
  recentChanges: string[];
  /** Pointers to topic files that exist. */
  knowledgePointers: { file: string; label: string }[];
  /** Summaries of user knowledge files (.txt/.md in project root). */
  summarizedFiles: { originalPath: string; summaryPath: string; title: string }[];

  /** Actual content of key project files: schema, tailwind config, .env.example, etc. */
  sourceFiles: { relativePath: string; label: string; content: string }[];
}

/** Valid sections for write_context calls. */
export const VALID_SECTIONS = [
  "about", "brief", "styles", "conventions",
  "decisions", "preferences", "built", "progress",
  // Legacy sections — accepted for backward compatibility, routed appropriately:
  "schema", "routes",
] as const;
export type ContextSection = typeof VALID_SECTIONS[number];

/** Sections that write to a standalone topic file (replace-mode). */
const TOPIC_FILES: Record<string, { file: string; label: string }> = {
  brief: { file: "brief.md", label: "Project brief (vision, flows, rules, scope)" },
  styles: { file: "styles.md", label: "Design language (colors, fonts, patterns)" },
  conventions: { file: "conventions.md", label: "Coding conventions for this project" },
};

/** Sections that append to a bulleted list inside index.md. */
const APPEND_SECTIONS = new Set(["decisions", "preferences", "built"]);

/** Sections that replace a field inside index.md. */
const INDEX_REPLACE_SECTIONS = new Set(["about", "progress"]);

// ── Constants ────────────────────────────────────────────────

const CONTEXT_DIR = ".omnirun";
const DOCS_DIR = ".omnirun/docs";
const SUMMARIES_DIR = ".omnirun/summaries";
const INDEX_FILE = ".omnirun/index.md";
const KICKOFF_FILE = ".omnirun/kickoff.md";
const META_FILE = ".omnirun/meta.json";
const LEGACY_CONTEXT_FILE = ".omnirun/context.md"; // old format — triggers wipe-and-restart

const MAX_RECENT_CHANGES = 10;
const MAX_BUILT_ENTRIES = 15;
const MAX_READ_PER_FILE = 12_000;
const SUMMARIZE_CONCURRENCY = 3;

// ── Tech Stack Detection (fresh on every open, not persisted) ─

const TECH_INDICATORS: { file: string; tech: string }[] = [
  { file: "package.json", tech: "" },
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
];

const PACKAGE_JSON_FRAMEWORKS: Record<string, string> = {
  "react": "React", "react-dom": "React", "next": "Next.js",
  "vue": "Vue", "nuxt": "Nuxt", "svelte": "Svelte",
  "@sveltejs/kit": "SvelteKit", "angular": "Angular",
  "@angular/core": "Angular", "express": "Express",
  "fastify": "Fastify", "hono": "Hono",
  "tailwindcss": "Tailwind CSS", "three": "Three.js",
  "d3": "D3.js", "prisma": "Prisma", "drizzle-orm": "Drizzle",
  "mongoose": "Mongoose", "stripe": "Stripe",
  "firebase": "Firebase", "@supabase/supabase-js": "Supabase",
};

const NOTABLE_DEPS: Record<string, string> = {
  "react-router-dom": "react-router", "react-router": "react-router",
  "@tanstack/react-query": "TanStack Query", "swr": "SWR",
  "zustand": "zustand", "jotai": "jotai", "recoil": "recoil", "redux": "redux",
  "@reduxjs/toolkit": "Redux Toolkit", "mobx": "MobX",
  "react-hook-form": "react-hook-form", "formik": "formik",
  "zod": "zod", "yup": "yup", "joi": "joi",
  "axios": "axios", "ky": "ky",
  "framer-motion": "framer-motion", "gsap": "gsap",
  "@stripe/stripe-js": "Stripe.js", "stripe": "Stripe",
  "next-auth": "NextAuth", "@auth/core": "Auth.js",
  "lucia": "Lucia Auth", "clerk": "Clerk",
  "drizzle-orm": "Drizzle", "prisma": "Prisma", "@prisma/client": "Prisma",
  "mongoose": "Mongoose", "typeorm": "TypeORM", "sequelize": "Sequelize",
  "@supabase/supabase-js": "Supabase", "firebase": "Firebase",
  "socket.io": "Socket.IO", "socket.io-client": "Socket.IO",
  "sharp": "sharp", "multer": "multer",
  "nodemailer": "nodemailer", "resend": "Resend", "@sendgrid/mail": "SendGrid",
  "wavesurfer.js": "WaveSurfer.js", "howler": "Howler.js",
  "chart.js": "Chart.js", "recharts": "Recharts", "d3": "D3.js",
  "three": "Three.js", "@react-three/fiber": "React Three Fiber",
  "shadcn-ui": "shadcn/ui", "@radix-ui/react-dialog": "Radix UI",
  "@headlessui/react": "HeadlessUI", "@mantine/core": "Mantine",
  "lucide-react": "lucide-react", "react-icons": "react-icons",
  "date-fns": "date-fns", "dayjs": "dayjs", "moment": "moment",
  "i18next": "i18next", "react-i18next": "react-i18next",
  "jest": "Jest", "vitest": "Vitest", "@testing-library/react": "React Testing Library",
  "playwright": "Playwright", "cypress": "Cypress",
};

interface TechDetectionResult {
  techStack: string[];
  keyDeps: string[];
}

async function detectTechStack(folderPath: string, fileNames: string[]): Promise<TechDetectionResult> {
  const detected = new Set<string>();
  const keyDeps: string[] = [];

  for (const ind of TECH_INDICATORS) {
    if (fileNames.includes(ind.file) && ind.tech) detected.add(ind.tech);
  }
  if (fileNames.includes("package.json")) {
    try {
      const pkg = JSON.parse(await readFile(joinPath(folderPath, "package.json")));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [dep, tech] of Object.entries(PACKAGE_JSON_FRAMEWORKS)) {
        if (dep in allDeps) detected.add(tech);
      }
      const frameworkNames = new Set(Object.values(PACKAGE_JSON_FRAMEWORKS));
      for (const [dep, label] of Object.entries(NOTABLE_DEPS)) {
        if (dep in allDeps && !frameworkNames.has(label) && !detected.has(label)) {
          const version = (allDeps[dep] as string || "").replace(/[\^~>=<]/g, "");
          keyDeps.push(version ? `${label} ${version}` : label);
        }
      }
    } catch { /* skip */ }
  }
  if (!fileNames.includes("package.json") && fileNames.some(f => f.endsWith(".html"))) {
    detected.add("Static HTML");
  }
  return { techStack: Array.from(detected), keyDeps };
}

// ── Project Scanning ─────────────────────────────────────────

const APP_ROOT_FILES = [
  "package.json", "Cargo.toml", "requirements.txt",
  "pyproject.toml", "go.mod", "Gemfile", "composer.json",
];

const SKIP_DIRS = [
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  ".svelte-kit", ".astro", ".output", ".cache", ".omnirun",
  "__pycache__", ".turbo", "target", "coverage", ".venv",
];

const KNOWLEDGE_EXTENSIONS = [".txt", ".md"];
const SKIP_KNOWLEDGE_NAMES = [
  "license", "licence", "changelog", "changes",
  "contributing", "code_of_conduct", "security",
  "package-lock", "yarn-lock", "pnpm-lock",
];

function isKnowledgeFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (SKIP_KNOWLEDGE_NAMES.some(s => lower.startsWith(s))) return false;
  if (lower === "readme.md") return true;
  return KNOWLEDGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function isKnowledgeFolder(files: FileEntry[]): boolean {
  if (files.length === 0) return false;
  const count = files.filter(f => !f.is_dir && isKnowledgeFile(f.name)).length;
  return count >= 2 && count / files.length >= 0.4;
}

interface ScanResult {
  structureLines: string[];
  appRoots: { relativePath: string; techStack: string[] }[];
  knowledgeFiles: { relativePath: string; name: string; mtime?: number }[];
  allTech: string[];
  allKeyDeps: string[];
}

async function scanProject(projectPath: string): Promise<ScanResult> {
  const entries = await readDirectory(projectPath, 2);
  const structureLines: string[] = [];
  const appRoots: { relativePath: string; techStack: string[] }[] = [];
  const knowledgeFiles: { relativePath: string; name: string; mtime?: number }[] = [];
  const allTech: string[] = [];
  const allKeyDeps: string[] = [];

  const rootFiles = entries.filter(e => !e.is_dir);
  const rootDirs = entries.filter(e => e.is_dir);
  const rootFileNames = rootFiles.map(e => e.name);

  if (APP_ROOT_FILES.some(f => rootFileNames.includes(f))) {
    const { techStack, keyDeps } = await detectTechStack(projectPath, rootFileNames);
    appRoots.push({ relativePath: "", techStack });
    allTech.push(...techStack);
    allKeyDeps.push(...keyDeps);
  }

  for (const file of rootFiles) {
    if (isKnowledgeFile(file.name)) {
      knowledgeFiles.push({
        relativePath: file.name,
        name: file.name,
        mtime: (file as any).modified_time || undefined,
      });
    }
  }

  for (const dir of rootDirs) {
    if (SKIP_DIRS.includes(dir.name.toLowerCase()) || dir.name.startsWith(".")) continue;
    const children = dir.children || [];
    const childFiles = children.filter(c => !c.is_dir);
    const childDirs = children.filter(c => c.is_dir);
    const childFileNames = childFiles.map(c => c.name);

    if (APP_ROOT_FILES.some(f => childFileNames.includes(f))) {
      const { techStack, keyDeps } = await detectTechStack(dir.path, childFileNames);
      appRoots.push({ relativePath: dir.name, techStack });
      allTech.push(...techStack);
      allKeyDeps.push(...keyDeps);
      structureLines.push(`${dir.name}/ — app (${techStack.join(", ") || "unknown"})`);
    } else if (isKnowledgeFolder(childFiles)) {
      const knFiles = childFiles.filter(c => isKnowledgeFile(c.name));
      for (const kf of knFiles) {
        knowledgeFiles.push({
          relativePath: `${dir.name}/${kf.name}`,
          name: kf.name,
          mtime: (kf as any).modified_time || undefined,
        });
      }
      structureLines.push(`${dir.name}/ — ${knFiles.length} knowledge files`);
    } else {
      const desc = childDirs.length > 0
        ? `${childFiles.length} files, ${childDirs.length} folders`
        : `${childFiles.length} files`;
      structureLines.push(`${dir.name}/ — ${desc}`);
    }
  }

  const notable = rootFileNames.filter(n =>
    ["package.json", "README.md", "tsconfig.json", "Cargo.toml",
     "requirements.txt", "docker-compose.yml", ".env.example"].includes(n)
  );
  if (notable.length > 0) {
    structureLines.unshift(`(root) — ${notable.join(", ")}${rootFiles.length > notable.length ? ` + ${rootFiles.length - notable.length} more` : ""}`);
  }

  return {
    structureLines, appRoots, knowledgeFiles,
    allTech: [...new Set(allTech)],
    allKeyDeps: [...new Set(allKeyDeps)],
  };
}

// ── Source-of-truth file detection ───────────────────────────
// Real project files whose actual content is included in every AI call.
// Prompt caching makes these nearly free on Anthropic after the first call.

const SOURCE_FILE_PATTERNS: { pattern: string; label: string; maxChars: number }[] = [
  { pattern: "schema.prisma", label: "Database Schema", maxChars: 8000 },
  { pattern: "prisma/schema.prisma", label: "Database Schema", maxChars: 8000 },
  { pattern: "schema.sql", label: "Database Schema", maxChars: 8000 },
  { pattern: "database.sql", label: "Database Schema", maxChars: 8000 },
  { pattern: "supabase/schema.sql", label: "Database Schema", maxChars: 8000 },
  { pattern: "drizzle/schema.ts", label: "Database Schema", maxChars: 8000 },
  { pattern: "src/db/schema.ts", label: "Database Schema", maxChars: 8000 },
  { pattern: "src/schema.ts", label: "Database Schema", maxChars: 8000 },
  { pattern: "tailwind.config.ts", label: "Tailwind Config", maxChars: 4000 },
  { pattern: "tailwind.config.js", label: "Tailwind Config", maxChars: 4000 },
  { pattern: "src/styles/theme.ts", label: "Theme Config", maxChars: 4000 },
  { pattern: "src/config/theme.ts", label: "Theme Config", maxChars: 4000 },
  { pattern: "src/theme.ts", label: "Theme Config", maxChars: 4000 },
  { pattern: ".env.example", label: "Environment Template", maxChars: 2000 },
  { pattern: ".env.local.example", label: "Environment Template", maxChars: 2000 },
];

const MAX_SOURCE_TOTAL_CHARS = 12000;

async function loadSourceFiles(
  projectPath: string
): Promise<{ relativePath: string; label: string; content: string }[]> {
  const results: { relativePath: string; label: string; content: string }[] = [];
  const seenLabels = new Set<string>();
  let totalChars = 0;

  // Pattern-based detection
  for (const { pattern, label, maxChars } of SOURCE_FILE_PATTERNS) {
    if (seenLabels.has(label)) continue;
    if (totalChars >= MAX_SOURCE_TOTAL_CHARS) break;

    try {
      const fullPath = joinPath(projectPath, pattern);
      const content = await readFile(fullPath);
      const trimmed = content.slice(0, maxChars);
      if (trimmed.trim().length > 0) {
        results.push({ relativePath: pattern, label, content: trimmed });
        seenLabels.add(label);
        totalChars += trimmed.length;
      }
    } catch { /* file doesn't exist — skip */ }
  }

  // Scan .omnirun/docs/ for AI-saved / user-uploaded reference docs
  if (totalChars < MAX_SOURCE_TOTAL_CHARS) {
    try {
      const docsPath = joinPath(projectPath, DOCS_DIR);
      const entries = await readDirectory(docsPath, 1);
      const docFiles = entries
        .filter(e => !e.is_dir && /\.(md|txt|sql)$/i.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of docFiles) {
        if (totalChars >= MAX_SOURCE_TOTAL_CHARS) break;
        try {
          const content = await readFile(entry.path);
          const trimmed = content.slice(0, 6000);
          if (trimmed.trim().length > 0) {
            const relativePath = `${DOCS_DIR}/${entry.name}`;
            const label = entry.name
              .replace(/\.[^.]+$/, "")
              .replace(/[-_]/g, " ")
              .replace(/\b\w/g, c => c.toUpperCase());
            results.push({ relativePath, label, content: trimmed });
            totalChars += trimmed.length;
          }
        } catch { /* skip individual failures */ }
      }
    } catch { /* docs dir doesn't exist yet — fine */ }
  }

  return results;
}

// ── AI Provider / Call Helpers ───────────────────────────────

export interface ProviderConfig {
  id: string;
  apiKey: string;
  model: string;
}

function getActiveProvider(): ProviderConfig | null {
  try {
    const activeId = localStorage.getItem("ai-active-provider") || "anthropic";
    const saved = localStorage.getItem("ai-providers");
    if (!saved) return null;
    const providers = JSON.parse(saved);
    const config = providers.find((p: any) => p.providerId === activeId);
    if (!config?.apiKey) return null;
    return { id: activeId, apiKey: config.apiKey, model: config.selectedModel };
  } catch {
    return null;
  }
}

class FatalAPIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalAPIError";
  }
}

function throwIfFatal(status: number, provider: string): void {
  if (status === 401 || status === 403) {
    throw new FatalAPIError(`${provider} API ${status} Error: invalid or expired API key — aborting`);
  }
}

async function callAI(provider: ProviderConfig, prompt: string): Promise<string> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");

  if (provider.id === "anthropic") {
    const resp = await tauriFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: provider.model || "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    throwIfFatal(resp.status, "Anthropic");
    if (!resp.ok) throw new Error(`Anthropic API ${resp.status}`);
    const data: any = await resp.json();
    return data?.content?.[0]?.text || "";
  }

  if (provider.id === "google") {
    const model = provider.model || "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.apiKey}`;
    const resp = await tauriFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096 },
      }),
    });
    throwIfFatal(resp.status, "Google");
    if (!resp.ok) throw new Error(`Google API ${resp.status}`);
    const data: any = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  const urls: Record<string, string> = {
    openai: "https://api.openai.com/v1/chat/completions",
    groq: "https://api.groq.com/openai/v1/chat/completions",
    deepseek: "https://api.deepseek.com/v1/chat/completions",
    ollama: "http://localhost:11434/v1/chat/completions",
  };
  const url = urls[provider.id];
  if (!url) throw new Error(`Unsupported provider: ${provider.id}`);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.id !== "ollama") headers["authorization"] = `Bearer ${provider.apiKey}`;

  const resp = await tauriFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  throwIfFatal(resp.status, provider.id);
  if (!resp.ok) throw new Error(`${provider.id} API ${resp.status}`);
  const data: any = await resp.json();
  return data?.choices?.[0]?.message?.content || "";
}

// ── Summary file naming ──────────────────────────────────────

function toSummaryFilename(relativePath: string, allPaths: string[]): string {
  const basename = relativePath.split(/[/\\]/).pop() || relativePath;
  const stem = basename.replace(/\.[^.]+$/, "");
  const sameName = allPaths.filter(p => {
    const other = (p.split(/[/\\]/).pop() || p).replace(/\.[^.]+$/, "");
    return other === stem;
  });
  if (sameName.length > 1) {
    const parts = relativePath.replace(/\\/g, "/").split("/");
    if (parts.length > 1) return `${parts[0]}--${stem}.md`;
  }
  return `${stem}.md`;
}

// ── File summarization ───────────────────────────────────────

const SUMMARIZE_FILE_PROMPT = `You are summarizing a project documentation file for an AI coding assistant. The assistant will use this summary to build and modify the project WITHOUT reading the original file most of the time.

Write a thorough, USEFUL summary that includes:

1. WHAT it covers — be specific (not "describes features" but "the app has AI tattoo generation, style transfer, and artist marketplace")
2. ALL SPECIFIC VALUES — exact prices ($39/mo Starter, $69/mo Pro), hex colors (#1A1A2E), dimensions, tier names, feature limits per plan, API endpoints, database table names, font names
3. CURRENT STATE — what's built and working vs. in progress vs. planned
4. ARCHITECTURE — how components connect, what tech is used where, dependencies
5. RULES/CONSTRAINTS — design requirements, brand guidelines, things that must not change

Write in dense bullet points. Every bullet = concrete information. Target: 200-500 words.
End with: → Full details: FILE_PATH

Respond with ONLY the summary text. No preamble, no markdown fences around the whole thing.

File to summarize:
`;

/** Summarize one file. Returns { summary, title } or throws. */
async function summarizeOneFile(
  projectPath: string,
  file: { relativePath: string; name: string },
  allPaths: string[],
  provider: ProviderConfig
): Promise<{ originalPath: string; summaryPath: string; title: string }> {
  const fullPath = joinPath(projectPath, file.relativePath);
  const content = await readFile(fullPath);
  const fileContent = content.slice(0, MAX_READ_PER_FILE);
  const prompt = SUMMARIZE_FILE_PROMPT + `=== ${file.relativePath} ===\n${fileContent}`;

  const summary = await callAI(provider, prompt);

  let title = file.name.replace(/\.[^.]+$/, "").replace(/^\d+-/, "").replace(/[-_]/g, " ");
  const firstHeading = content.match(/^#+\s+(.+)/m);
  if (firstHeading) title = firstHeading[1].trim().slice(0, 80);

  const summaryFilename = toSummaryFilename(file.relativePath, allPaths);
  const summaryRelPath = `${SUMMARIES_DIR}/${summaryFilename}`;
  const summaryFullPath = joinPath(projectPath, summaryRelPath);
  const summaryContent = `# ${title}\n\nSource: \`${file.relativePath}\`\n\n${summary.trim()}\n`;
  await writeFile(summaryFullPath, summaryContent);

  return { originalPath: file.relativePath, summaryPath: summaryRelPath, title };
}

/** Summarize files in parallel with concurrency limit. */
async function summarizeFilesParallel(
  projectPath: string,
  files: { relativePath: string; name: string }[],
  provider: ProviderConfig,
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<{ originalPath: string; summaryPath: string; title: string }[]> {
  try {
    await createDirectory(joinPath(projectPath, SUMMARIES_DIR));
  } catch { /* exists */ }

  const allPaths = files.map(f => f.relativePath);
  const results: { originalPath: string; summaryPath: string; title: string }[] = new Array(files.length);
  let completed = 0;
  let fatalError: Error | null = null;

  // Process in chunks of SUMMARIZE_CONCURRENCY
  for (let i = 0; i < files.length; i += SUMMARIZE_CONCURRENCY) {
    if (fatalError) throw fatalError;
    const chunk = files.slice(i, i + SUMMARIZE_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (file, idx) => {
        const globalIdx = i + idx;
        // If a sibling in this chunk already hit a fatal error, skip this one — don't
        // waste another API call. Just return a stub entry so the caller can decide.
        if (fatalError) {
          return {
            idx: globalIdx,
            result: { originalPath: file.relativePath, summaryPath: "", title: file.name },
          };
        }
        try {
          const result = await summarizeOneFile(projectPath, file, allPaths, provider);
          completed++;
          onProgress?.(completed, files.length, file.name);
          return { idx: globalIdx, result };
        } catch (err) {
          if (err instanceof FatalAPIError) {
            fatalError = err;
            throw err;
          }
          console.error(`[context] Failed to summarize ${file.relativePath}:`, err);
          completed++;
          onProgress?.(completed, files.length, file.name);
          return {
            idx: globalIdx,
            result: { originalPath: file.relativePath, summaryPath: "", title: file.name },
          };
        }
      })
    );
    for (const { idx, result } of chunkResults) {
      results[idx] = result;
    }
  }

  return results;
}

/** Basic summarization fallback when no AI provider is configured. */
async function basicFallbackSummaries(
  projectPath: string,
  files: { relativePath: string; name: string }[]
): Promise<{ originalPath: string; summaryPath: string; title: string }[]> {
  try {
    await createDirectory(joinPath(projectPath, SUMMARIES_DIR));
  } catch { /* exists */ }

  const results: { originalPath: string; summaryPath: string; title: string }[] = [];
  const allPaths = files.map(f => f.relativePath);

  for (const file of files) {
    try {
      const fullPath = joinPath(projectPath, file.relativePath);
      const content = await readFile(fullPath);
      let title = file.name.replace(/\.[^.]+$/, "").replace(/^\d+-/, "").replace(/[-_]/g, " ");
      const heading = content.match(/^#+\s+(.+)/m);
      if (heading) title = heading[1].trim().slice(0, 80);

      const headings = content.split("\n")
        .filter(l => l.trim().match(/^#{1,3}\s/))
        .map(l => l.trim().replace(/^#+\s+/, ""))
        .slice(0, 20);

      const summaryContent = `# ${title}\n\nSource: \`${file.relativePath}\`\n\n` +
        (headings.length > 0
          ? `Sections covered: ${headings.join(", ")}\n\n`
          : `${(content.length / 1024).toFixed(0)}KB of documentation.\n\n`) +
        `→ Full details: ${file.relativePath}\n`;

      const summaryFilename = toSummaryFilename(file.relativePath, allPaths);
      const summaryRelPath = `${SUMMARIES_DIR}/${summaryFilename}`;
      await writeFile(joinPath(projectPath, summaryRelPath), summaryContent);
      results.push({ originalPath: file.relativePath, summaryPath: summaryRelPath, title });
    } catch {
      results.push({ originalPath: file.relativePath, summaryPath: "", title: file.name });
    }
  }
  return results;
}

// ── index.md: writing ────────────────────────────────────────

function renderIndex(ctx: {
  projectName: string;
  projectPath: string;
  appRoot: string;
  about: string;
  preferences: string[];
  decisions: string[];
  built: string[];
  progress: string[];
  recentChanges: string[];
  knowledgePointers: { file: string; label: string }[];
  summarizedFiles: { originalPath: string; summaryPath: string; title: string }[];
}): string {
  const lines: string[] = [];
  lines.push(`# ${ctx.projectName}`);
  lines.push("");
  lines.push(`<!-- project: ${ctx.projectName} -->`);
  lines.push(`<!-- path: ${ctx.projectPath} -->`);
  lines.push(`<!-- appRoot: ${ctx.appRoot || "(root)"} -->`);
  lines.push("");

  lines.push("## What this is");
  lines.push(ctx.about || "(not set yet)");
  lines.push("");

  if (ctx.knowledgePointers.length > 0 || ctx.summarizedFiles.length > 0) {
    lines.push("## Knowledge available");
    for (const ptr of ctx.knowledgePointers) {
      lines.push(`- ${ptr.label} → \`.omnirun/${ptr.file}\``);
    }
    for (const sf of ctx.summarizedFiles) {
      if (sf.summaryPath) {
        lines.push(`- ${sf.title} → \`${sf.summaryPath}\``);
      }
    }
    lines.push("");
  }

  if (ctx.preferences.length > 0) {
    lines.push("## Preferences");
    for (const p of ctx.preferences) lines.push(`- ${p}`);
    lines.push("");
  }

  if (ctx.decisions.length > 0) {
    lines.push("## Decisions");
    for (const d of ctx.decisions) lines.push(`- ${d}`);
    lines.push("");
  }

  if (ctx.progress.length > 0) {
    lines.push("## In progress");
    for (const p of ctx.progress) lines.push(`- ${p}`);
    lines.push("");
  }

  if (ctx.built.length > 0) {
    lines.push("## Built");
    for (const b of ctx.built) lines.push(`- ${b}`);
    lines.push("");
  }

  if (ctx.recentChanges.length > 0) {
    lines.push("## Recent changes");
    for (const c of ctx.recentChanges.slice(0, MAX_RECENT_CHANGES)) lines.push(`- ${c}`);
    lines.push("");
  }

  lines.push("## Verification rule");
  lines.push("Preferences and decisions above are trusted. Architecture claims are hints — verify against actual files before acting on them.");
  lines.push("");

  // Machine-readable footer for pointer tracking
  lines.push("<!-- METADATA (machine-readable) -->");
  for (const ptr of ctx.knowledgePointers) {
    lines.push(`<!-- pointer: ${ptr.file} | ${ptr.label} -->`);
  }
  for (const sf of ctx.summarizedFiles) {
    if (sf.summaryPath) {
      lines.push(`<!-- summary: ${sf.originalPath} | ${sf.summaryPath} | ${sf.title} -->`);
    }
  }

  return lines.join("\n") + "\n";
}

// ── index.md: parsing ────────────────────────────────────────

function parseIndex(content: string, projectPath: string): Omit<ProjectContext,
  "techStack" | "keyDeps" | "structure" | "sourceFiles" | "isNewProject"
> {
  const projectName =
    extractComment(content, "project") ||
    content.match(/^#\s+(.+?)(?:\s*[—-]|$)/m)?.[1]?.trim() ||
    projectPath.split(/[/\\]/).pop() || "unknown";

  const appRootRaw = extractComment(content, "appRoot") || "";
  const appRoot = appRootRaw === "(root)" ? "" : appRootRaw;

  const aboutLines = extractSection(content, "What this is");
  const aboutJoined = aboutLines.join(" ").trim();
  const about: string[] = aboutJoined === "(not set yet)" || !aboutJoined ? [] : [aboutJoined];

  const preferences = extractBulletSection(content, "Preferences");
  const decisions = extractBulletSection(content, "Decisions");
  const built = extractBulletSection(content, "Built");
  const progress = extractBulletSection(content, "In progress");
  const recentChanges = extractBulletSection(content, "Recent changes");

  const knowledgePointers: { file: string; label: string }[] = [];
  const pointerRegex = /<!-- pointer: (.+?) \| (.+?) -->/g;
  let m: RegExpExecArray | null;
  while ((m = pointerRegex.exec(content)) !== null) {
    knowledgePointers.push({ file: m[1].trim(), label: m[2].trim() });
  }

  const summarizedFiles: { originalPath: string; summaryPath: string; title: string }[] = [];
  const summaryRegex = /<!-- summary: (.+?) \| (.+?) \| (.+?) -->/g;
  while ((m = summaryRegex.exec(content)) !== null) {
    summarizedFiles.push({
      originalPath: m[1].trim(),
      summaryPath: m[2].trim(),
      title: m[3].trim(),
    });
  }

  return {
    projectName,
    projectPath,
    appRoot,
    about,
    brief: [],
    styles: [],
    conventions: [],
    routes: [],
    schema: [],
    preferences,
    decisions,
    built,
    progress,
    recentChanges,
    knowledgePointers,
    summarizedFiles,
  };
}

function extractComment(content: string, key: string): string | null {
  const regex = new RegExp(`<!-- ${key}: (.+?) -->`);
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function extractSection(content: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n<!-- METADATA|$)`, "i");
  const match = content.match(regex);
  if (!match) return [];
  return match[1].split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("<!--"));
}

function extractBulletSection(content: string, heading: string): string[] {
  const lines = extractSection(content, heading);
  return lines
    .filter(l => l.startsWith("- "))
    .map(l => l.slice(2).trim())
    .filter(l => l && !l.startsWith("(none"));
}

// ── Legacy cleanup ───────────────────────────────────────────

/** If a legacy .omnirun/context.md exists, wipe the whole .omnirun/ folder. */
async function wipeLegacyIfPresent(projectPath: string): Promise<boolean> {
  try {
    await readFile(joinPath(projectPath, LEGACY_CONTEXT_FILE));
  } catch {
    return false; // no legacy file — nothing to do
  }

  console.log("[context] Legacy .omnirun/context.md detected — wiping folder for clean restart");

  const toDelete = [
    LEGACY_CONTEXT_FILE,
    META_FILE,
    INDEX_FILE,
    KICKOFF_FILE,
    `${CONTEXT_DIR}/brief.md`,
    `${CONTEXT_DIR}/styles.md`,
    `${CONTEXT_DIR}/conventions.md`,
  ];
  for (const rel of toDelete) {
    await tryDeleteFile(joinPath(projectPath, rel));
  }

  // Wipe summaries and docs directories (file by file)
  for (const subdir of [SUMMARIES_DIR, DOCS_DIR]) {
    try {
      const entries = await readDirectory(joinPath(projectPath, subdir), 1);
      for (const entry of entries) {
        if (!entry.is_dir) {
          await tryDeleteFile(entry.path);
        }
      }
    } catch { /* dir doesn't exist — fine */ }
  }

  return true;
}

// ── Meta tracking (summary mtimes for change detection) ──────

interface MetaData {
  summarizedFiles: {
    originalPath: string;
    summaryPath: string;
    title: string;
    sourceMtime?: number;
  }[];
}

async function writeMeta(projectPath: string, meta: MetaData): Promise<void> {
  await writeFile(
    joinPath(projectPath, META_FILE),
    JSON.stringify(meta, null, 2)
  );
}

async function readMeta(projectPath: string): Promise<MetaData | null> {
  try {
    const content = await readFile(joinPath(projectPath, META_FILE));
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ── Public API: load / init ──────────────────────────────────

function emptyContext(projectPath: string, projectName: string): ProjectContext {
  return {
    projectName,
    projectPath,
    appRoot: "",
    isNewProject: true,
    techStack: [],
    keyDeps: [],
    structure: "",
    about: [],
    brief: [],
    styles: [],
    conventions: [],
    routes: [],
    schema: [],
    preferences: [],
    decisions: [],
    built: [],
    progress: [],
    recentChanges: [],
    knowledgePointers: [],
    summarizedFiles: [],
    sourceFiles: [],
  };
}

export async function loadContext(projectPath: string): Promise<ProjectContext | null> {
  // First: does the index file exist at all? If not, return null (not new project, just no context yet).
  let content: string;
  try {
    content = await readFile(joinPath(projectPath, INDEX_FILE));
  } catch {
    return null;
  }

  // Parse what we can — if parsing throws, degrade to empty fields rather than losing the whole context.
  let parsed: Omit<ProjectContext, "techStack" | "keyDeps" | "structure" | "sourceFiles" | "isNewProject">;
  try {
    parsed = parseIndex(content, projectPath);
  } catch (err) {
    console.warn("[context] Failed to parse index.md, falling back to empty:", err);
    const projectName = projectPath.split(/[/\\]/).pop() || "unknown";
    parsed = {
      projectName,
      projectPath,
      appRoot: "",
      about: [],
      brief: [],
      styles: [],
      conventions: [],
      routes: [],
      schema: [],
      preferences: [],
      decisions: [],
      built: [],
      progress: [],
      recentChanges: [],
      knowledgePointers: [],
      summarizedFiles: [],
    };
  }

  // Re-derive tech stack fresh (derivability rule) — allowed to fail
  const scan = await scanProject(projectPath).catch(() => null);
  const techStack = scan?.allTech || [];
  const keyDeps = scan?.allKeyDeps || [];
  const structure = scan?.structureLines.join("\n") || "";

  // Source files are allowed to fail silently
  const sourceFiles = await loadSourceFiles(projectPath).catch(() => []);

  return {
    ...parsed,
    isNewProject: false,
    techStack,
    keyDeps,
    structure,
    sourceFiles,
  };
}

/**
 * Initialize context for a project.
 *   - index.md exists? → load it, fresh-detect tech, return.
 *   - legacy context.md exists? → wipe .omnirun/ and start fresh.
 *   - nothing exists? → scan project in memory, return empty context with isNewProject=true.
 *
 * Does NOT create index.md on disk. That happens on the first successful write_context.
 */
export async function initContext(
  projectPath: string,
  onProgress?: (message: string) => void,
  _externalProvider?: ProviderConfig | null
): Promise<{ context: ProjectContext; isFirstScan: boolean }> {
  await invoke("set_project_path", { path: projectPath });

  // Legacy cleanup — nuke old .omnirun/ if present
  const wiped = await wipeLegacyIfPresent(projectPath);
  if (wiped) onProgress?.("Migrating to new context format...");

  // Try loading current format
  if (!wiped) {
    const existing = await loadContext(projectPath);
    if (existing) {
      return { context: existing, isFirstScan: false };
    }
  }

  // Fresh scan — in-memory context, nothing written to disk yet
  try {
    const projectName = projectPath.split(/[/\\]/).pop() || "unknown";
    onProgress?.("Scanning project structure...");
    const scan = await scanProject(projectPath);

    const primaryAppRoot = scan.appRoots.length > 0
      ? (scan.appRoots.find(r => r.relativePath !== "")?.relativePath || "")
      : "";

    const context: ProjectContext = {
      ...emptyContext(projectPath, projectName),
      appRoot: primaryAppRoot,
      techStack: scan.allTech,
      keyDeps: scan.allKeyDeps,
      structure: scan.structureLines.join("\n"),
      sourceFiles: await loadSourceFiles(projectPath),
    };

    return { context, isFirstScan: true };
  } catch (err: any) {
    console.warn("[context] Init scan failed:", err?.message || err);
    const projectName = projectPath.split(/[/\\]/).pop() || "unknown";
    return { context: emptyContext(projectPath, projectName), isFirstScan: true };
  }
}

// ── Public API: the heavy scan (summaries) ───────────────────

/**
 * Explicit "Scan project" — summarizes all knowledge files and writes summaries to disk.
 * Also creates a minimal index.md if none exists.
 */
export async function fullScan(
  projectPath: string,
  onProgress?: (message: string) => void,
  externalProvider?: ProviderConfig | null
): Promise<ProjectContext> {
  const projectName = projectPath.split(/[/\\]/).pop() || "unknown";

  try {
    onProgress?.("Scanning project structure...");
    const scan = await scanProject(projectPath);

    const primaryAppRoot = scan.appRoots.length > 0
      ? (scan.appRoots.find(r => r.relativePath !== "")?.relativePath || "")
      : "";

    try { await createDirectory(joinPath(projectPath, CONTEXT_DIR)); } catch { /* exists */ }
    try { await createDirectory(joinPath(projectPath, SUMMARIES_DIR)); } catch { /* exists */ }

    const provider = externalProvider || getActiveProvider();
    let summarizedFiles: { originalPath: string; summaryPath: string; title: string }[];

    if (scan.knowledgeFiles.length > 0 && provider) {
      onProgress?.(`Summarizing ${scan.knowledgeFiles.length} knowledge files...`);
      summarizedFiles = await summarizeFilesParallel(
        projectPath,
        scan.knowledgeFiles,
        provider,
        (current, total, name) => {
          onProgress?.(`Summarizing ${current}/${total}: ${name}`);
        }
      );
    } else if (scan.knowledgeFiles.length > 0) {
      onProgress?.("Creating basic summaries (no AI provider configured)...");
      summarizedFiles = await basicFallbackSummaries(projectPath, scan.knowledgeFiles);
    } else {
      summarizedFiles = [];
    }

    // Load existing index if present, to preserve user content across rescans
    const existing = await loadContext(projectPath);

    // Write/update meta with mtimes
    const metaEntries = summarizedFiles.map(sf => {
      const file = scan.knowledgeFiles.find(f => f.relativePath === sf.originalPath);
      return { ...sf, sourceMtime: file?.mtime };
    });
    await writeMeta(projectPath, { summarizedFiles: metaEntries });

    const context: ProjectContext = {
      projectName,
      projectPath,
      appRoot: primaryAppRoot,
      isNewProject: false,
      techStack: scan.allTech,
      keyDeps: scan.allKeyDeps,
      structure: scan.structureLines.join("\n"),
      about: existing?.about || [],
      brief: existing?.brief || [],
      styles: existing?.styles || [],
      conventions: existing?.conventions || [],
      routes: existing?.routes || [],
      schema: existing?.schema || [],
      preferences: existing?.preferences || [],
      decisions: existing?.decisions || [],
      built: existing?.built || [],
      progress: existing?.progress || [],
      recentChanges: existing?.recentChanges || [],
      knowledgePointers: existing?.knowledgePointers || [],
      summarizedFiles,
      sourceFiles: await loadSourceFiles(projectPath),
    };

    // Write index.md so summaries are discoverable
    await writeIndexFile(context);

    return context;
  } catch (err) {
    console.error("[context] Full scan failed:", err);
    return emptyContext(projectPath, projectName);
  }
}

/**
 * Incremental refresh from file watcher.
 *   - Detects new knowledge files → summarizes them
 *   - Detects edited knowledge files (mtime changed) → re-summarizes
 *   - Detects removed knowledge files → drops their summary
 *   - Updates index.md pointers
 */
export async function refreshContext(projectPath: string): Promise<ProjectContext | null> {
  try {
    const existing = await loadContext(projectPath);
    if (!existing) return null;

    const meta = await readMeta(projectPath);
    const scan = await scanProject(projectPath);

    const prevByPath = new Map((meta?.summarizedFiles || []).map(s => [s.originalPath, s]));
    const currentPaths = new Set(scan.knowledgeFiles.map(f => f.relativePath));

    // Kept = still exists AND mtime unchanged
    const kept: { originalPath: string; summaryPath: string; title: string; sourceMtime?: number }[] = [];
    // New or changed
    const toSummarize: { relativePath: string; name: string; mtime?: number }[] = [];

    for (const file of scan.knowledgeFiles) {
      const prev = prevByPath.get(file.relativePath);
      const changed = !prev || (prev.sourceMtime !== file.mtime && file.mtime !== undefined);
      if (prev && !changed && prev.summaryPath) {
        kept.push(prev);
      } else {
        toSummarize.push(file);
      }
    }

    // If nothing changed AND nothing was removed, early return
    const prevCount = meta?.summarizedFiles.length || 0;
    const removedCount = prevCount - kept.length;
    if (toSummarize.length === 0 && removedCount === 0) {
      return existing;
    }

    // Summarize new/changed files
    const provider = getActiveProvider();
    let newSummaries: { originalPath: string; summaryPath: string; title: string }[] = [];
    if (toSummarize.length > 0 && provider) {
      try {
        newSummaries = await summarizeFilesParallel(projectPath, toSummarize, provider);
      } catch (err) {
        if (err instanceof FatalAPIError) {
          console.warn("[context] Refresh aborted: fatal API error —", (err as Error).message);
          return existing;
        }
        throw err;
      }
    } else if (toSummarize.length > 0) {
      newSummaries = await basicFallbackSummaries(projectPath, toSummarize);
    }

    // Combine kept + new, drop removed
    const allSummaries = [
      ...kept.filter(s => currentPaths.has(s.originalPath)),
      ...newSummaries,
    ];

    // Write updated meta with mtimes
    const metaEntries = allSummaries.map(sf => {
      const file = scan.knowledgeFiles.find(f => f.relativePath === sf.originalPath);
      return { ...sf, sourceMtime: file?.mtime };
    });
    await writeMeta(projectPath, { summarizedFiles: metaEntries });

    // Rewrite index with updated pointers
    const updated: ProjectContext = {
      ...existing,
      techStack: scan.allTech,
      keyDeps: scan.allKeyDeps,
      structure: scan.structureLines.join("\n"),
      summarizedFiles: allSummaries,
      sourceFiles: await loadSourceFiles(projectPath),
    };
    await writeIndexFile(updated);

    return updated;
  } catch (err) {
    console.error("[context] Refresh failed:", err);
    return null;
  }
}

/** Force a full rescan — preserves user-written index content. */
export async function rescanContext(projectPath: string): Promise<ProjectContext> {
  return fullScan(projectPath);
}

// ── Public API: write_context (AI saves memory) ──────────────

/** Per-file write queue — serializes rapid successive writes to the same file. */
const fileWriteQueues = new Map<string, Promise<void>>();

function queueFileWrite(absolutePath: string, work: () => Promise<void>): void {
  const prev = fileWriteQueues.get(absolutePath) || Promise.resolve();
  const next = prev.then(async () => {
    try { await work(); } catch (err) {
      console.error(`[context] Write failed for ${absolutePath}:`, err);
    }
  });
  fileWriteQueues.set(absolutePath, next);
  void next.finally(() => {
    if (fileWriteQueues.get(absolutePath) === next) fileWriteQueues.delete(absolutePath);
  });
}

/**
 * Fire-and-forget disk writes for topic files. We don't await these inside
 * the sync `updateContextFromAI` call — writes are serialized per-file via
 * the queue above so rapid successive calls land in order.
 */
function flushTopicFile(
  projectPath: string,
  file: string,
  heading: string,
  body: string
): void {
  const absolutePath = joinPath(projectPath, CONTEXT_DIR, file);
  const content = `# ${heading}\n\n${body}\n`;
  queueFileWrite(absolutePath, async () => {
    try { await createDirectory(joinPath(projectPath, CONTEXT_DIR)); } catch { /* exists */ }
    await writeFile(absolutePath, content);
  });
}

function flushLegacyDoc(
  projectPath: string,
  fileName: string,
  header: string,
  body: string
): void {
  const absolutePath = joinPath(projectPath, DOCS_DIR, fileName);
  const content = `${header}\n\n${body}\n`;
  queueFileWrite(absolutePath, async () => {
    try { await createDirectory(joinPath(projectPath, DOCS_DIR)); } catch { /* exists */ }
    await writeFile(absolutePath, content);
  });
}

/**
 * Fire-and-forget flush of the current in-memory context to index.md.
 * Guarantees index.md stays in sync with in-memory state after every
 * write_context call, without requiring callers to await anything.
 *
 * Writes are SERIALIZED on a per-project queue so rapid successive calls
 * (e.g. kickoff: about → brief → styles → conventions → decisions)
 * land on disk in call order, not completion order.
 */
const indexWriteQueues = new Map<string, Promise<void>>();

function flushIndex(context: ProjectContext): void {
  const key = context.projectPath;
  const prev = indexWriteQueues.get(key) || Promise.resolve();
  const next = prev.then(async () => {
    try {
      await writeIndexFile(context);
    } catch (err) {
      console.error("[context] Failed to flush index.md:", err);
    }
  });
  indexWriteQueues.set(key, next);
  // Clean up the queue entry once this write completes AND no newer one replaced it
  void next.finally(() => {
    if (indexWriteQueues.get(key) === next) indexWriteQueues.delete(key);
  });
}

/**
 * Sanitize a single-line entry that will be rendered as a bullet in index.md.
 * - Collapses newlines to spaces (prevents parse round-trip loss)
 * - Escapes leading `## ` patterns that would break section parsing
 * - Trims whitespace
 * - Caps length at 500 chars (prevents a runaway AI entry from bloating index.md)
 */
function sanitizeInlineEntry(raw: string): string {
  let s = raw.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  // Escape literal "## " at start so it can't be mistaken for a heading
  s = s.replace(/^(#+)\s/, "$1\u200b ");
  if (s.length > 500) s = s.slice(0, 497) + "…";
  return s;
}

/**
 * The AI calls this via the write_context tool. MUST stay synchronous —
 * the caller (toolService.ts → ChatArea.tsx) expects a ProjectContext back,
 * not a Promise. The caller invokes `saveContext` separately to flush index.md.
 *
 * TOPIC FILES (brief, styles, conventions):
 *   Writes the content to the standalone file (fire-and-forget disk I/O).
 *   Adds a pointer into the in-memory knowledgePointers list.
 *   REPLACE semantics — each call overwrites the file.
 *   Free-form markdown: newlines and headings preserved.
 *
 * INDEX SECTIONS (decisions, preferences, built):
 *   Appends new entries to the in-memory array, deduplicated case-insensitively.
 *   Entries are sanitized to single lines for safe round-trip through markdown parsing.
 *
 * INDEX FIELDS (about, progress):
 *   Replaces the value in memory. Same sanitization as index sections.
 *
 * LEGACY (schema, routes):
 *   Saved to .omnirun/docs/ (fire-and-forget) for reference. No structural role.
 */
export function updateContextFromAI(
  context: ProjectContext,
  section: ContextSection,
  entries: string[]
): ProjectContext {
  if (!VALID_SECTIONS.includes(section)) return context;
  // Accept a single string or array; defend against malformed inputs.
  const entriesArr = Array.isArray(entries)
    ? entries
    : typeof entries === "string"
      ? [entries as string]
      : [];
  // Filter out empty/whitespace-only entries
  const cleanEntries = entriesArr.map(e => (typeof e === "string" ? e : String(e || "")).trim()).filter(e => e.length > 0);
  if (cleanEntries.length === 0) return context;

  let updated: ProjectContext = { ...context, isNewProject: false };

  // Topic files (brief/styles/conventions) → standalone file + pointer
  // These are free-form markdown; don't sanitize newlines.
  if (section in TOPIC_FILES) {
    const { file, label } = TOPIC_FILES[section];
    const body = cleanEntries.join("\n\n").trim();
    const heading = label.split(" ")[0];
    flushTopicFile(context.projectPath, file, heading, body);

    const hasPtr = updated.knowledgePointers.some(p => p.file === file);
    if (!hasPtr) {
      updated.knowledgePointers = [...updated.knowledgePointers, { file, label }];
    }
    flushIndex(updated);
    return updated;
  }

  // Index fields (about, progress) → replace (sanitized)
  if (INDEX_REPLACE_SECTIONS.has(section)) {
    if (section === "about") {
      const sanitized = sanitizeInlineEntry(cleanEntries.join(" "));
      updated.about = sanitized ? [sanitized] : [];
    } else if (section === "progress") {
      updated.progress = cleanEntries.map(sanitizeInlineEntry).filter(s => s.length > 0);
    }
    flushIndex(updated);
    return updated;
  }

  // Index append sections (decisions, preferences, built) — sanitized
  if (APPEND_SECTIONS.has(section)) {
    const sanitized = cleanEntries.map(sanitizeInlineEntry).filter(s => s.length > 0);
    if (sanitized.length === 0) return context;

    const existing = (updated[section as "decisions" | "preferences" | "built"]) || [];
    const existingLower = new Set(existing.map(x => x.toLowerCase()));
    const newEntries = sanitized.filter(e => !existingLower.has(e.toLowerCase()));
    let combined = [...existing, ...newEntries];

    // Compress old "built" entries instead of dropping them
    if (section === "built" && combined.length > MAX_BUILT_ENTRIES) {
      const overflow = combined.length - MAX_BUILT_ENTRIES + 1;
      const oldEntries = combined.slice(0, overflow);
      const summary = `Historical: ${oldEntries.slice(0, 5).join("; ")}${oldEntries.length > 5 ? ` (+${oldEntries.length - 5} more)` : ""}`;
      combined = [summary, ...combined.slice(overflow)];
    }
    updated = { ...updated, [section]: combined };
    flushIndex(updated);
    return updated;
  }

  // Legacy sections (schema, routes) — saved to docs/ for reference
  if (section === "schema" || section === "routes") {
    const fileName = section === "schema" ? "legacy-schema.md" : "legacy-routes.md";
    const header = section === "schema" ? "# Schema notes" : "# Route notes";
    flushLegacyDoc(context.projectPath, fileName, header, cleanEntries.join("\n\n"));
    return updated;
  }

  return updated;
}

/** Write the index.md file from the current context. */
async function writeIndexFile(context: ProjectContext): Promise<void> {
  try { await createDirectory(joinPath(context.projectPath, CONTEXT_DIR)); } catch { /* exists */ }
  const content = renderIndex({
    projectName: context.projectName,
    projectPath: context.projectPath,
    appRoot: context.appRoot,
    about: context.about.join(" ").trim(),
    preferences: context.preferences,
    decisions: context.decisions,
    built: context.built,
    progress: context.progress,
    recentChanges: context.recentChanges,
    knowledgePointers: context.knowledgePointers,
    summarizedFiles: context.summarizedFiles,
  });
  await writeFile(joinPath(context.projectPath, INDEX_FILE), content);
}

/** Save the current in-memory context to disk (used after recent-changes updates). */
export async function saveContext(projectPath: string, context: ProjectContext): Promise<void> {
  const hasRealContent =
    context.about.length > 0 ||
    context.preferences.length > 0 ||
    context.decisions.length > 0 ||
    context.built.length > 0 ||
    context.progress.length > 0 ||
    context.knowledgePointers.length > 0 ||
    context.summarizedFiles.length > 0 ||
    context.recentChanges.length > 0;

  if (!hasRealContent) return; // don't create an empty file

  // Ensure projectPath is set on context
  const ctx = { ...context, projectPath };
  await writeIndexFile(ctx);
}

// ── Public API: recent changes / session compression ─────────

export function addRecentChange(context: ProjectContext, change: string): ProjectContext {
  const clean = sanitizeInlineEntry(change);
  if (!clean) return context;
  // Also dedup against existing recent changes (last 3) to avoid rapid-fire duplicates
  const recentLower = new Set(context.recentChanges.slice(0, 3).map(r => r.toLowerCase()));
  if (recentLower.has(clean.toLowerCase())) return context;
  const recentChanges = [clean, ...context.recentChanges].slice(0, MAX_RECENT_CHANGES);
  return { ...context, recentChanges };
}

/**
 * Compress session state when chat ends (new chat / clear chat / project switch).
 * Moves "in progress" + "recent changes" into "built" as compressed entries.
 */
export function compressSession(context: ProjectContext): ProjectContext {
  if (context.progress.length === 0 && context.recentChanges.length === 0) {
    return context;
  }

  const newBuilt = [...context.built];

  if (context.progress.length > 0) {
    const existingLower = new Set(newBuilt.map(b => b.toLowerCase()));
    for (const p of context.progress) {
      if (!existingLower.has(p.toLowerCase())) {
        newBuilt.push(p);
        existingLower.add(p.toLowerCase());
      }
    }
  }

  if (context.recentChanges.length > 0 && context.progress.length === 0) {
    const files = context.recentChanges
      .map(c => c.replace(/^(Updated|Edited|Deleted|Created)\s+/, ""))
      .map(f => f.split(/[/\\]/).pop() || f);
    const unique = [...new Set(files)];
    if (unique.length > 0) {
      newBuilt.push(`Session work: ${unique.slice(0, 8).join(", ")}${unique.length > 8 ? ` + ${unique.length - 8} more` : ""}`);
    }
  }

  // Apply "built" cap via compression (not slice — preserve history)
  let capped = newBuilt;
  if (capped.length > MAX_BUILT_ENTRIES) {
    const overflow = capped.length - MAX_BUILT_ENTRIES + 1;
    const oldEntries = capped.slice(0, overflow);
    const summary = `Historical: ${oldEntries.slice(0, 5).join("; ")}${oldEntries.length > 5 ? ` (+${oldEntries.length - 5} more)` : ""}`;
    capped = [summary, ...capped.slice(overflow)];
  }

  return {
    ...context,
    built: capped,
    progress: [],
    recentChanges: [],
  };
}

// ── Public API: system-prompt string ─────────────────────────

/**
 * Rich system prompt context. Sent on EVERY API call (as the dynamic block).
 *
 * Contents:
 *   - Project header (name, path, app root)
 *   - About (one line)
 *   - Knowledge pointers (AI reads these on demand)
 *   - Preferences, Decisions, Progress (short lists)
 *   - Recent changes (last 5)
 *   - Source files (actual content — schema.prisma, tailwind config, .env.example)
 *   - Verification rule
 *
 * Target: ~300–800 tokens for typical projects.
 */
export function contextToPromptString(context: ProjectContext): string {
  if (!context) return "";

  // Defensive defaults
  const ctx = {
    ...context,
    about: context.about || [],
    preferences: context.preferences || [],
    decisions: context.decisions || [],
    built: context.built || [],
    progress: context.progress || [],
    recentChanges: context.recentChanges || [],
    knowledgePointers: context.knowledgePointers || [],
    summarizedFiles: context.summarizedFiles || [],
    sourceFiles: context.sourceFiles || [],
    techStack: context.techStack || [],
    keyDeps: context.keyDeps || [],
  };

  const lines: string[] = [];

  lines.push(`Project: ${ctx.projectName}`);
  lines.push(`Path: ${ctx.projectPath}`);
  if (ctx.appRoot) {
    lines.push(`App root: ${ctx.appRoot}/ (dev server, builds, installs run here)`);
  }

  // Fresh tech detection (not persisted — cheap to re-derive)
  if (ctx.techStack.length > 0) {
    lines.push(`Stack: ${ctx.techStack.join(", ")}`);
  }
  if (ctx.keyDeps.length > 0) {
    lines.push(`Key deps: ${ctx.keyDeps.join(", ")}`);
  }

  // New project banner with inline kickoff steps (no file read needed).
  // This is ~150 tokens that only appear on the first turn of a brand-new
  // project. Once the AI writes any context, isNewProject becomes false
  // and this block disappears from the prompt permanently.
  if (ctx.isNewProject) {
    lines.push("");
    lines.push("## ⚠️ NEW PROJECT — RUN KICKOFF BEFORE write_file");
    lines.push("No context saved yet. BEFORE any write_file, do this:");
    lines.push("");
    lines.push("1. If the request is vague, ask clarifying questions in ONE message (tech stack, design, features, audience). Suggest defaults.");
    lines.push("2. If the request is a clear spec, skip questions.");
    lines.push("3. Save MANDATORY context (in this order, before any write_file):");
    lines.push(`   - write_context("about", ["One sentence — what it is, who it's for"])`);
    lines.push(`   - write_context("brief", ["Comprehensive project document: vision, user flows, business rules, features, design direction, scope"])`);
    lines.push(`   - write_context("styles", ["Design language: colors (hex), fonts, spacing, component patterns. Suggest defaults if unspecified."])`);
    lines.push(`   - write_context("conventions", ["Coding patterns, naming, file structure"])`);
    lines.push(`   - write_context("decisions", ["Tech choices made and why"])`);
    lines.push("4. Only now call write_file. Build a polished foundation, not a skeleton.");
    lines.push("");
    lines.push("A $0.01 context save prevents a $2.00 rebuild next session. Don't skip.");
  }

  if (ctx.about.length > 0) {
    lines.push("");
    lines.push("## What this is");
    for (const line of ctx.about) lines.push(line);
  }

  // Knowledge pointers — AI reads these on demand
  if (ctx.knowledgePointers.length > 0 || ctx.summarizedFiles.length > 0) {
    lines.push("");
    lines.push("## Knowledge available (read on demand)");
    for (const ptr of ctx.knowledgePointers) {
      lines.push(`- ${ptr.label} → \`.omnirun/${ptr.file}\``);
    }
    for (const sf of ctx.summarizedFiles) {
      if (sf.summaryPath) {
        lines.push(`- ${sf.title} → \`${sf.summaryPath}\``);
      }
    }
  }

  if (ctx.preferences.length > 0) {
    lines.push("");
    lines.push("## Preferences");
    for (const p of ctx.preferences) lines.push(`- ${p}`);
  }

  if (ctx.decisions.length > 0) {
    lines.push("");
    lines.push("## Decisions");
    for (const d of ctx.decisions) lines.push(`- ${d}`);
  }

  if (ctx.progress.length > 0) {
    lines.push("");
    lines.push("## In progress");
    for (const p of ctx.progress) lines.push(`- ${p}`);
  }

  if (ctx.recentChanges.length > 0) {
    lines.push("");
    lines.push("## Recent changes");
    for (const c of ctx.recentChanges.slice(0, 5)) lines.push(`- ${c}`);
  }

  // Source files — actual content, prompt-cached after first call
  if (ctx.sourceFiles.length > 0) {
    lines.push("");
    lines.push("## Source files (use directly, no read_file needed)");
    for (const sf of ctx.sourceFiles) {
      lines.push("");
      lines.push(`### ${sf.label} (\`${sf.relativePath}\`)`);
      lines.push("```");
      lines.push(sf.content);
      lines.push("```");
    }
  }

  return lines.join("\n");
}