import { readFile, writeFile, createDirectory, readDirectory, FileEntry } from "./fileService";
import { invoke } from "@tauri-apps/api/core";

/**
 * Context Service — Two-Pass AI-Summarized Project Knowledge
 * 
 * DISK STRUCTURE:
 *   .omnirun/
 *     context.md          ← Master overview (AI reads this once per conversation)
 *     summaries/
 *       01-project.md     ← Detailed summary of txt-pk/01-project.txt
 *       02-branding.md    ← Detailed summary of txt-pk/02-branding.txt
 *       ...
 * 
 * TWO-PASS SUMMARIZATION (first open only):
 *   Pass 1: AI reads each knowledge file → writes detailed summary → .omnirun/summaries/
 *   Pass 2: AI reads ALL summaries → writes master overview → .omnirun/context.md
 * 
 * TOKEN BUDGET:
 *   First open (one-time):    ~15-20K tokens (AI summarization)
 *   System prompt per call:   ~150 tokens
 *   context.md read:          ~2,000-3,000 tokens (once per conversation)
 *   Summary file read:        ~500-800 tokens (only when task needs deeper detail)
 *   Original file read:       rare (when even the summary isn't enough)
 * 
 * UPDATES:
 *   File changed → re-summarize just that file → regenerate master from all summaries
 *   New file → summarize it → regenerate master
 *   No changes → load from disk, zero cost
 */

export interface ProjectContext {
  projectName: string;
  projectPath: string;
  techStack: string[];
  structure: string;
  appRoot: string;
  /** List of knowledge files that have been summarized */
  summarizedFiles: { originalPath: string; summaryPath: string; title: string }[];

  // ── Tier 1: Project DNA (rich, in system prompt every call) ──
  /** Product description — what it is, audience, flows, business rules */
  about: string[];
  /** Visual design system — colors, fonts, spacing, shadows, animations, layout patterns, responsive rules */
  styles: string[];
  /** Coding conventions — patterns, naming, imports, error handling */
  conventions: string[];
  /** Key dependencies extracted from package.json */
  keyDeps: string[];
  /** API routes / page routes — endpoints with methods and descriptions */
  routes: string[];
  /** Database schema — tables, columns, relationships */
  schema: string[];

  // ── Tier 2: Session State (changes between sessions) ──
  /** Completed features — compressed from past sessions */
  built: string[];
  /** Currently in progress — what the AI is working on now */
  progress: string[];
  /** Architectural / product decisions that persist */
  decisions: string[];
  /** User style / behavior preferences */
  preferences: string[];

  // ── Tier 3: Recent Activity (rolling window) ──
  recentChanges: string[];
}

/** Sections that use replace semantics (overwrite entire section) */
const REPLACE_SECTIONS = ["about", "styles", "conventions", "routes", "schema", "progress"] as const;
/** Sections that use append semantics (add new entries, deduplicate) */
const APPEND_SECTIONS = ["decisions", "preferences", "built"] as const;
/** All valid write_context sections */
export const VALID_SECTIONS = [
  "about", "styles", "conventions", "routes", "schema",
  "progress", "decisions", "preferences", "built",
] as const;
export type ContextSection = typeof VALID_SECTIONS[number];

const CONTEXT_DIR = ".omnirun";
const SUMMARIES_DIR = ".omnirun/summaries";
const CONTEXT_FILE = ".omnirun/context.md";
const META_FILE = ".omnirun/meta.json";
const MAX_RECENT_CHANGES = 10;
const MAX_READ_PER_FILE = 12_000;  // 12KB per file sent to AI

// ── Tech Stack Detection ─────────────────────────────────────

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

/** Notable dependencies worth surfacing in context (not frameworks — those go in techStack) */
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
      const pkg = JSON.parse(await readFile(`${folderPath}\\package.json`));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [dep, tech] of Object.entries(PACKAGE_JSON_FRAMEWORKS)) {
        if (dep in allDeps) detected.add(tech);
      }
      // Extract notable deps (not already in techStack via frameworks)
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
  knowledgeFiles: { relativePath: string; name: string }[];
  allTech: string[];
  allKeyDeps: string[];
}

async function scanProject(projectPath: string): Promise<ScanResult> {
  const entries = await readDirectory(projectPath, 2);
  const structureLines: string[] = [];
  const appRoots: { relativePath: string; techStack: string[] }[] = [];
  const knowledgeFiles: { relativePath: string; name: string }[] = [];
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
      knowledgeFiles.push({ relativePath: file.name, name: file.name });
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
        knowledgeFiles.push({ relativePath: `${dir.name}/${kf.name}`, name: kf.name });
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

// ── AI Provider / Call Helpers ────────────────────────────────

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

/** Thrown on 401/403 — signals callers to abort immediately, never retry. */
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
        model: provider.model || "claude-sonnet-4-20250514",
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

  // OpenAI-compatible (OpenAI, Groq, Ollama)
  const urls: Record<string, string> = {
    openai: "https://api.openai.com/v1/chat/completions",
    groq: "https://api.groq.com/openai/v1/chat/completions",
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

// ── Summary File Name Helpers ────────────────────────────────

/**
 * Convert a knowledge file path like "txt-pk/01-project.txt"
 * to a summary filename like "01-project.md"
 * If names would collide (files in different folders with same name),
 * prefix with folder: "txt-pk--01-project.md"
 */
function toSummaryFilename(relativePath: string, allPaths: string[]): string {
  const basename = relativePath.split(/[/\\]/).pop() || relativePath;
  const stem = basename.replace(/\.[^.]+$/, "");

  // Check for name collision
  const sameName = allPaths.filter(p => {
    const other = (p.split(/[/\\]/).pop() || p).replace(/\.[^.]+$/, "");
    return other === stem;
  });

  if (sameName.length > 1) {
    // Add folder prefix to avoid collision
    const parts = relativePath.replace(/\\/g, "/").split("/");
    if (parts.length > 1) {
      return `${parts[0]}--${stem}.md`;
    }
  }

  return `${stem}.md`;
}

// ── Pass 1: Individual File Summarization ────────────────────

const SUMMARIZE_FILE_PROMPT = `You are summarizing a project documentation file for an AI coding assistant. The assistant will use this summary to build and modify the project WITHOUT reading the original file most of the time.

Write a thorough, USEFUL summary that includes:

1. WHAT it covers — be specific (not "describes features" but "the app has AI tattoo generation, style transfer, and artist marketplace")
2. ALL SPECIFIC VALUES — exact prices ($39/mo Starter, $69/mo Pro), hex colors (#1A1A2E), dimensions, tier names, feature limits per plan, API endpoints, database table names, font names
3. CURRENT STATE — what's built and working vs. in progress vs. planned
4. ARCHITECTURE — how components connect, what tech is used where, dependencies
5. RULES/CONSTRAINTS — design requirements, brand guidelines, things that must not change

Write in dense bullet points. Every bullet = concrete information. If a number, name, color, price, limit, or spec exists in the file — include it in the summary. The AI needs these details to write correct code.

Target: 200-500 words depending on the file's complexity and information density.

End with: → Full details: FILE_PATH

Respond with ONLY the summary text. No preamble, no "Here's the summary:", no markdown fences around the whole thing. Just start writing the bullets.

File to summarize:
`;

/**
 * Pass 1: Summarize each knowledge file individually.
 * Writes each summary to .omnirun/summaries/filename.md
 * Returns list of what was summarized.
 */
async function pass1_summarizeFiles(
  projectPath: string,
  files: { relativePath: string; name: string }[],
  provider: ProviderConfig,
  /** Optional: progress callback for UI ("Summarizing 3/14...") */
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<{ originalPath: string; summaryPath: string; title: string }[]> {
  const results: { originalPath: string; summaryPath: string; title: string }[] = [];
  const allPaths = files.map(f => f.relativePath);

  // Ensure summaries directory exists
  try {
    await createDirectory(`${projectPath}\\${SUMMARIES_DIR}`);
  } catch { /* exists */ }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.name);

    try {
      const fullPath = `${projectPath}\\${file.relativePath.replace(/\//g, "\\")}`;
      const content = await readFile(fullPath);
      const fileContent = content.slice(0, MAX_READ_PER_FILE);

      const prompt = SUMMARIZE_FILE_PROMPT +
        `=== ${file.relativePath} ===\n${fileContent}`;

      const summary = await callAI(provider, prompt);
      // Extract title from first line of original (or summary)
      let title = file.name.replace(/\.[^.]+$/, "").replace(/^\d+-/, "").replace(/[-_]/g, " ");
      const firstHeading = content.match(/^#+\s+(.+)/m);
      if (firstHeading) title = firstHeading[1].trim().slice(0, 80);

      // Write summary file
      const summaryFilename = toSummaryFilename(file.relativePath, allPaths);
      const summaryRelPath = `${SUMMARIES_DIR}/${summaryFilename}`;
      const summaryFullPath = `${projectPath}\\${summaryRelPath.replace(/\//g, "\\")}`;

      const summaryContent = `# ${title}\n\nSource: \`${file.relativePath}\`\n\n${summary.trim()}\n`;
      await writeFile(summaryFullPath, summaryContent);

      results.push({
        originalPath: file.relativePath,
        summaryPath: summaryRelPath,
        title,
      });

      console.log(`[context] Summarized ${i + 1}/${files.length}: ${file.relativePath}`);
    } catch (err) {
      // Fatal auth errors (401/403) must propagate — retrying every file would just
      // flood the API and cause an infinite loop via the file watcher.
      if (err instanceof FatalAPIError) throw err;

      console.error(`[context] Failed to summarize ${file.relativePath}:`, err);
      // Still track it — with a fallback
      results.push({
        originalPath: file.relativePath,
        summaryPath: "",
        title: file.name,
      });
    }
  }

  return results;
}

// ── Pass 2: Master Overview Generation ───────────────────────

const MASTER_OVERVIEW_PROMPT = `You are creating a master project overview for an AI coding assistant. This single file is what the AI reads ONCE at the start of every conversation to understand the entire project.

Below are summaries of all the project's documentation files. Synthesize them into ONE cohesive overview that covers:

1. **Product Overview** — What it is, who it's for, what it does. Be concrete.
2. **Tech Stack & Architecture** — What technologies, where the app code lives, how things connect.
3. **Key Specs** — Subscription tiers with prices, branding (colors, fonts), feature limits — all the numbers the AI needs to write correct code.
4. **Current State** — What's built, what's in progress, what's planned.
5. **Important Rules** — Design constraints, brand guidelines, architectural decisions that must not change.

For EACH section, include a reference line: → Deep dive: summaries/filename.md

The overview should be detailed enough that the AI can handle 80-90% of tasks without reading anything else. Include specific values: prices, colors, dimensions, tier names, tech versions.

Write in structured markdown with clear headings. Dense and information-rich. No filler. Target: 1,500-2,500 words.

Here is the project metadata, followed by all file summaries:

`;

/**
 * Pass 2: Read all summary files and generate the master overview.
 * Writes to .omnirun/context.md
 */
async function pass2_generateMaster(
  projectPath: string,
  projectName: string,
  techStack: string[],
  keyDeps: string[],
  structure: string,
  appRoot: string,
  summarizedFiles: { originalPath: string; summaryPath: string; title: string }[],
  provider: ProviderConfig,
  preferences: string[],
  decisions: string[],
  recentChanges: string[],
): Promise<void> {
  // Build the prompt with project metadata + all summaries
  let prompt = MASTER_OVERVIEW_PROMPT;

  prompt += `PROJECT: ${projectName}\n`;
  prompt += `TECH STACK: ${techStack.join(", ") || "not detected"}\n`;
  if (keyDeps.length > 0) prompt += `KEY DEPENDENCIES: ${keyDeps.join(", ")}\n`;
  prompt += `APP ROOT: ${appRoot || "(project root)"}\n`;
  prompt += `STRUCTURE:\n${structure}\n\n`;
  prompt += `--- FILE SUMMARIES ---\n\n`;

  for (const sf of summarizedFiles) {
    if (!sf.summaryPath) continue;
    try {
      const summaryFullPath = `${projectPath}\\${sf.summaryPath.replace(/\//g, "\\")}`;
      const content = await readFile(summaryFullPath);
      prompt += `=== ${sf.summaryPath} (from ${sf.originalPath}) ===\n`;
      prompt += content + "\n\n";
    } catch {
      prompt += `=== ${sf.originalPath} === (summary unavailable)\n\n`;
    }
  }

  prompt += `--- END SUMMARIES ---\n\n`;
  prompt += `Now write the master overview. Start with a # heading. Include all specific values from the summaries. Reference summary files for deep dives. No preamble.`;

  try {
    console.log("[context] Generating master overview...");
    const masterContent = await callAI(provider, prompt);

    // Build the full context.md with AI content + machine-readable footer
    let contextMd = masterContent.trim() + "\n";

    // Append a structured footer the app can parse on load
    contextMd += `\n\n---\n\n`;
    contextMd += `<!-- METADATA (machine-readable — do not edit below this line) -->\n`;
    contextMd += `<!-- project: ${projectName} -->\n`;
    contextMd += `<!-- path: ${projectPath} -->\n`;
    contextMd += `<!-- appRoot: ${appRoot || "(root)"} -->\n`;
    contextMd += `<!-- tech: ${techStack.join(", ")} -->\n`;
    contextMd += `<!-- keyDeps: ${keyDeps.join(", ")} -->\n`;
    contextMd += `<!-- structure:\n${structure}\n-->\n`;
    for (const sf of summarizedFiles) {
      contextMd += `<!-- summary: ${sf.originalPath} | ${sf.summaryPath} | ${sf.title} -->\n`;
    }

    if (preferences.length > 0) {
      contextMd += `\n## Preferences\n`;
      for (const p of preferences) contextMd += `- ${p}\n`;
    }

    if (decisions.length > 0) {
      contextMd += `\n## Decisions\n`;
      for (const d of decisions) contextMd += `- ${d}\n`;
    }

    if (recentChanges.length > 0) {
      contextMd += `\n## Recent Changes\n`;
      for (const c of recentChanges) contextMd += `- ${c}\n`;
    }

    await writeFile(`${projectPath}\\${CONTEXT_FILE}`, contextMd);
    console.log("[context] Master overview saved to context.md");
  } catch (err) {
    console.error("[context] Master overview generation failed:", err);
    // Write a basic fallback context.md
    await writeFallbackContext(projectPath, projectName, techStack, keyDeps, structure, appRoot, summarizedFiles, preferences, decisions, recentChanges);
  }
}

async function writeFallbackContext(
  projectPath: string,
  projectName: string,
  techStack: string[],
  keyDeps: string[],
  structure: string,
  appRoot: string,
  summarizedFiles: { originalPath: string; summaryPath: string; title: string }[],
  preferences: string[],
  decisions: string[],
  recentChanges: string[],
): Promise<void> {
  let md = `# ${projectName} — Project Overview\n\n`;
  md += `Tech: ${techStack.join(", ") || "not detected"}\n`;
  if (keyDeps.length > 0) md += `Key deps: ${keyDeps.join(", ")}\n`;
  md += `App Root: ${appRoot || "(project root)"}\n\n`;
  md += `## Structure\n${structure}\n\n`;
  md += `## Knowledge Files\n`;
  md += `Detailed summaries available — read these for full project context:\n\n`;
  for (const sf of summarizedFiles) {
    md += `- **${sf.title}** → \`${sf.summaryPath || sf.originalPath}\`\n`;
  }

  md += `\n\n---\n\n`;
  md += `<!-- METADATA (machine-readable — do not edit below this line) -->\n`;
  md += `<!-- project: ${projectName} -->\n`;
  md += `<!-- path: ${projectPath} -->\n`;
  md += `<!-- appRoot: ${appRoot || "(root)"} -->\n`;
  md += `<!-- tech: ${techStack.join(", ")} -->\n`;
  md += `<!-- keyDeps: ${keyDeps.join(", ")} -->\n`;
  md += `<!-- structure:\n${structure}\n-->\n`;
  for (const sf of summarizedFiles) {
    md += `<!-- summary: ${sf.originalPath} | ${sf.summaryPath} | ${sf.title} -->\n`;
  }

  if (preferences.length > 0) {
    md += `\n## Preferences\n`;
    for (const p of preferences) md += `- ${p}\n`;
  }
  if (decisions.length > 0) {
    md += `\n## Decisions\n`;
    for (const d of decisions) md += `- ${d}\n`;
  }
  if (recentChanges.length > 0) {
    md += `\n## Recent Changes\n`;
    for (const c of recentChanges) md += `- ${c}\n`;
  }

  await writeFile(`${projectPath}\\${CONTEXT_FILE}`, md);
}

// ── Basic Fallback (no AI provider) ──────────────────────────

async function basicFallbackSummaries(
  projectPath: string,
  files: { relativePath: string; name: string }[]
): Promise<{ originalPath: string; summaryPath: string; title: string }[]> {
  try {
    await createDirectory(`${projectPath}\\${SUMMARIES_DIR}`);
  } catch { /* exists */ }

  const results: { originalPath: string; summaryPath: string; title: string }[] = [];
  const allPaths = files.map(f => f.relativePath);

  for (const file of files) {
    try {
      const fullPath = `${projectPath}\\${file.relativePath.replace(/\//g, "\\")}`;
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
      await writeFile(`${projectPath}\\${summaryRelPath.replace(/\//g, "\\")}`, summaryContent);

      results.push({ originalPath: file.relativePath, summaryPath: summaryRelPath, title });
    } catch {
      results.push({ originalPath: file.relativePath, summaryPath: "", title: file.name });
    }
  }

  return results;
}

// ── Context File I/O ─────────────────────────────────────────

export async function loadContext(projectPath: string): Promise<ProjectContext | null> {
  try {
    const content = await readFile(`${projectPath}\\${CONTEXT_FILE}`);
    return parseContextFile(content, projectPath);
  } catch {
    return null;
  }
}

export async function saveContext(projectPath: string, context: ProjectContext): Promise<void> {
  // We don't rewrite context.md here — that's AI-generated.
  // We only update the machine-readable sections.
  try {
    let content = await readFile(`${projectPath}\\${CONTEXT_FILE}`);

    // Update metadata comments for new fields
    content = upsertComment(content, "keyDeps", context.keyDeps.join(", "));

    // Tier 1 sections (replace semantics)
    if (context.about.length > 0) {
      content = replaceSection(content, "About",
        context.about.map(a => a.startsWith("- ") ? a : a).join("\n"));
    }
    if (context.styles.length > 0) {
      content = replaceSection(content, "Styles & Design",
        context.styles.join("\n"));
    }
    if (context.conventions.length > 0) {
      content = replaceSection(content, "Conventions",
        context.conventions.map(c => `- ${c}`).join("\n"));
    }
    if (context.routes.length > 0) {
      content = replaceSection(content, "Routes",
        context.routes.join("\n"));
    }
    if (context.schema.length > 0) {
      content = replaceSection(content, "Schema",
        context.schema.join("\n"));
    }

    // Tier 2 sections
    content = replaceSection(content, "Built (completed)",
      context.built.length > 0
        ? context.built.map(b => `- ${b}`).join("\n")
        : "(none yet)"
    );
    content = replaceSection(content, "In Progress",
      context.progress.length > 0
        ? context.progress.map(p => `- ${p}`).join("\n")
        : "(none)"
    );
    content = replaceSection(content, "Preferences",
      context.preferences.length > 0
        ? context.preferences.map(p => `- ${p}`).join("\n")
        : "(none yet — use write_context to save preferences)"
    );
    content = replaceSection(content, "Decisions",
      context.decisions.length > 0
        ? context.decisions.map(d => `- ${d}`).join("\n")
        : "(none yet — use write_context to save decisions)"
    );

    // Tier 3
    content = replaceSection(content, "Recent Changes",
      context.recentChanges.length > 0
        ? context.recentChanges.map(c => `- ${c}`).join("\n")
        : "(none yet)"
    );

    await writeFile(`${projectPath}\\${CONTEXT_FILE}`, content);
  } catch {
    // context.md doesn't exist yet — nothing to update
  }
}

/** Insert or update a metadata comment in context.md */
function upsertComment(content: string, key: string, value: string): string {
  const regex = new RegExp(`<!-- ${key}: .+? -->`);
  const newComment = `<!-- ${key}: ${value} -->`;
  if (regex.test(content)) {
    return content.replace(regex, newComment);
  }
  // Insert before first ## section if possible
  const metaInsert = content.indexOf("<!-- METADATA");
  if (metaInsert !== -1) {
    const insertPos = content.indexOf("-->", metaInsert) + 3;
    return content.slice(0, insertPos) + "\n" + newComment + content.slice(insertPos);
  }
  return content + "\n" + newComment;
}

function replaceSection(content: string, heading: string, newContent: string): string {
  const regex = new RegExp(`(## ${heading}\\s*\\n)[\\s\\S]*?(?=\\n## |$)`);
  if (regex.test(content)) {
    return content.replace(regex, `$1${newContent}\n`);
  }
  // Section doesn't exist — append it
  return content + `\n## ${heading}\n${newContent}\n`;
}

// ── Init ─────────────────────────────────────────────────────

/**
 * Initialize context for a project.
 * 
 * Has context.md? → Load from disk (instant, zero cost).
 * No context.md? → Full scan + two-pass AI summarization.
 * 
 * Returns { context, isFirstScan } for UI feedback.
 */
export async function initContext(
  projectPath: string,
  onProgress?: (message: string) => void,
  externalProvider?: ProviderConfig | null
): Promise<{ context: ProjectContext; isFirstScan: boolean }> {
  await invoke("set_project_path", { path: projectPath });

  const existing = await loadContext(projectPath);
  if (existing) {
    return { context: existing, isFirstScan: false };
  }

  try {
    const context = await fullScan(projectPath, onProgress, externalProvider);
    return { context, isFirstScan: true };
  } catch (err: any) {
    // If the AI scan fails (401, rate limit, network, etc.) fall back to a
    // basic context so the rest of the app still works normally.
    console.warn("[context] Full scan failed:", err.message || err);
    const projectName = projectPath.split(/[/\\]/).pop() || "unknown";
    const fallback: ProjectContext = {
      projectName, projectPath,
      techStack: [], structure: "", appRoot: "",
      summarizedFiles: [],
      about: [], styles: [], conventions: [], keyDeps: [],
      routes: [], schema: [],
      built: [], progress: [],
      preferences: [], decisions: [], recentChanges: [],
    };
    return { context: fallback, isFirstScan: true };
  }
}

async function fullScan(
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

    // Ensure .omnirun directory exists
    try { await createDirectory(`${projectPath}\\${CONTEXT_DIR}`); } catch { /* exists */ }
    try { await createDirectory(`${projectPath}\\${SUMMARIES_DIR}`); } catch { /* exists */ }

    // Use externally-provided provider first, fall back to localStorage
    const provider = externalProvider || getActiveProvider();
    let summarizedFiles: { originalPath: string; summaryPath: string; title: string }[];

    if (scan.knowledgeFiles.length > 0 && provider) {
      // ── Pass 1: AI summarizes each file ──
      onProgress?.(`Summarizing ${scan.knowledgeFiles.length} knowledge files...`);
      summarizedFiles = await pass1_summarizeFiles(
        projectPath,
        scan.knowledgeFiles,
        provider,
        (current, total, name) => {
          onProgress?.(`Summarizing ${current}/${total}: ${name}`);
        }
      );

      // ── Pass 2: AI generates master overview ──
      onProgress?.("Generating project overview...");
      await pass2_generateMaster(
        projectPath, projectName, scan.allTech, scan.allKeyDeps,
        scan.structureLines.join("\n"), primaryAppRoot,
        summarizedFiles, provider, [], [], []
      );
    } else if (scan.knowledgeFiles.length > 0) {
      // No AI provider — basic fallback
      onProgress?.("Creating basic summaries (no AI provider configured)...");
      summarizedFiles = await basicFallbackSummaries(projectPath, scan.knowledgeFiles);
      await writeFallbackContext(
        projectPath, projectName, scan.allTech, scan.allKeyDeps,
        scan.structureLines.join("\n"), primaryAppRoot,
        summarizedFiles, [], [], []
      );
    } else {
      // No knowledge files
      summarizedFiles = [];
      await writeFallbackContext(
        projectPath, projectName, scan.allTech, scan.allKeyDeps,
        scan.structureLines.join("\n"), primaryAppRoot,
        [], [], [], []
      );
    }

    const context: ProjectContext = {
      projectName,
      projectPath,
      techStack: scan.allTech,
      structure: scan.structureLines.join("\n"),
      appRoot: primaryAppRoot,
      summarizedFiles,
      about: [],
      styles: [],
      conventions: [],
      keyDeps: scan.allKeyDeps,
      routes: [],
      schema: [],
      built: [],
      progress: [],
      decisions: [],
      preferences: [],
      recentChanges: [],
    };

    // Write meta.json for tracking which files are summarized
    await writeMeta(projectPath, summarizedFiles);

    return context;

  } catch (err) {
    console.error("[context] Full scan failed:", err);
    const fallback: ProjectContext = {
      projectName, projectPath,
      techStack: [], structure: "", appRoot: "",
      summarizedFiles: [],
      about: [], styles: [], conventions: [], keyDeps: [],
      routes: [], schema: [],
      built: [], progress: [],
      preferences: [], decisions: [], recentChanges: [],
    };
    // Do NOT write to disk on a fatal API error — writing triggers the file
    // watcher which would call initContext again, creating an infinite loop.
    if (!(err instanceof FatalAPIError)) {
      try {
        await writeFallbackContext(projectPath, projectName, [], [], "", "", [], [], [], []);
      } catch { /* ok */ }
    }
    return fallback;
  }
}

// ── Meta tracking (which files have been summarized) ─────────

interface MetaData {
  summarizedFiles: { originalPath: string; summaryPath: string; title: string }[];
}

async function writeMeta(
  projectPath: string,
  summarizedFiles: { originalPath: string; summaryPath: string; title: string }[]
): Promise<void> {
  const meta: MetaData = { summarizedFiles };
  await writeFile(
    `${projectPath}\\${META_FILE.replace(/\//g, "\\")}`,
    JSON.stringify(meta, null, 2)
  );
}

async function readMeta(projectPath: string): Promise<MetaData | null> {
  try {
    const content = await readFile(`${projectPath}\\${META_FILE.replace(/\//g, "\\")}`);
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ── Refresh: Called When Files Change ─────────────────────────

/**
 * Incremental context refresh. Called by the file watcher.
 * - Re-scans structure (cheap)
 * - Keeps existing summaries for unchanged files
 * - AI-summarizes only NEW knowledge files
 * - Regenerates master overview if anything changed
 */
export async function refreshContext(projectPath: string): Promise<ProjectContext | null> {
  try {
    const existing = await loadContext(projectPath);
    if (!existing) return null;

    const meta = await readMeta(projectPath);
    if (!meta) return null;

    const scan = await scanProject(projectPath);
    const projectName = projectPath.split(/[/\\]/).pop() || "unknown";

    const primaryAppRoot = scan.appRoots.length > 0
      ? (scan.appRoots.find(r => r.relativePath !== "")?.relativePath || "")
      : "";

    // Find NEW files not yet summarized
    const alreadySummarized = new Set(meta.summarizedFiles.map(s => s.originalPath));
    const newFiles = scan.knowledgeFiles.filter(f => !alreadySummarized.has(f.relativePath));

    // Find REMOVED files (no longer exist)
    const currentPaths = new Set(scan.knowledgeFiles.map(f => f.relativePath));
    const keptSummaries = meta.summarizedFiles.filter(s => currentPaths.has(s.originalPath));

    if (newFiles.length === 0 && keptSummaries.length === meta.summarizedFiles.length) {
      // Nothing changed in knowledge files — just update structure
      // Don't regenerate master (expensive)
      return existing;
    }

    // Summarize new files
    const provider = getActiveProvider();
    let newSummaries: { originalPath: string; summaryPath: string; title: string }[] = [];
    if (newFiles.length > 0 && provider) {
      console.log(`[context] ${newFiles.length} new knowledge files, summarizing...`);
      try {
        newSummaries = await pass1_summarizeFiles(projectPath, newFiles, provider);
      } catch (err) {
        if (err instanceof FatalAPIError) {
          // Bad API key — abort silently, return existing context without writing
          // anything to disk (writing would re-trigger the file watcher endlessly).
          console.warn("[context] Refresh aborted: fatal API error —", (err as Error).message);
          return existing;
        }
        throw err;
      }
    } else if (newFiles.length > 0) {
      newSummaries = await basicFallbackSummaries(projectPath, newFiles);
    }

    const allSummaries = [...keptSummaries, ...newSummaries];

    // Regenerate master overview
    if (provider) {
      try {
        await pass2_generateMaster(
          projectPath, projectName, scan.allTech, scan.allKeyDeps,
          scan.structureLines.join("\n"), primaryAppRoot,
          allSummaries, provider,
          existing.preferences, existing.decisions, existing.recentChanges
        );
      } catch (err) {
        if (err instanceof FatalAPIError) {
          console.warn("[context] Master overview skipped: fatal API error —", (err as Error).message);
          return existing;
        }
        throw err;
      }
    } else {
      await writeFallbackContext(
        projectPath, projectName, scan.allTech, scan.allKeyDeps,
        scan.structureLines.join("\n"), primaryAppRoot,
        allSummaries, existing.preferences, existing.decisions, existing.recentChanges
      );
    }

    await writeMeta(projectPath, allSummaries);

    return {
      projectName,
      projectPath,
      techStack: scan.allTech,
      structure: scan.structureLines.join("\n"),
      appRoot: primaryAppRoot,
      summarizedFiles: allSummaries,
      about: existing.about,
      styles: existing.styles,
      conventions: existing.conventions,
      keyDeps: scan.allKeyDeps,
      routes: existing.routes,
      schema: existing.schema,
      built: existing.built,
      progress: existing.progress,
      preferences: existing.preferences,
      decisions: existing.decisions,
      recentChanges: existing.recentChanges,
    };
  } catch (err) {
    console.error("[context] Refresh failed:", err);
    return null;
  }
}

/**
 * Force full re-scan and re-summarization.
 * Deletes existing summaries and regenerates everything.
 * Preserves preferences/decisions.
 */
export async function rescanContext(projectPath: string): Promise<ProjectContext> {
  const existing = await loadContext(projectPath);
  const fresh = await fullScan(projectPath);

  if (existing) {
    // Preserve all AI-written sections from previous context
    fresh.about = existing.about;
    fresh.styles = existing.styles;
    fresh.conventions = existing.conventions;
    fresh.routes = existing.routes;
    fresh.schema = existing.schema;
    fresh.built = existing.built;
    fresh.progress = existing.progress;
    fresh.preferences = existing.preferences;
    fresh.decisions = existing.decisions;
    fresh.recentChanges = existing.recentChanges;
    await saveContext(projectPath, fresh);
  }

  return fresh;
}

// ── Context Updates (called after AI file operations) ────────

export function addRecentChange(context: ProjectContext, change: string): ProjectContext {
  const recentChanges = [change, ...context.recentChanges].slice(0, MAX_RECENT_CHANGES);
  return { ...context, recentChanges };
}

export function updateContextFromAI(
  context: ProjectContext,
  section: ContextSection,
  entries: string[]
): ProjectContext {
  if (!VALID_SECTIONS.includes(section)) return context;

  const isReplace = (REPLACE_SECTIONS as readonly string[]).includes(section);

  if (isReplace) {
    // Replace semantics: overwrite entire section
    return { ...context, [section]: entries };
  }

  // Append semantics: add new entries, deduplicate
  const existing = (context[section as keyof ProjectContext] as string[]) || [];
  const existingLower = new Set(existing.map(x => x.toLowerCase()));
  const newEntries = entries.filter(e => !existingLower.has(e.toLowerCase()));
  return { ...context, [section]: [...existing, ...newEntries] };
}

/**
 * Compress session state when chat ends (new chat / clear chat / project switch).
 * Moves "in progress" + "recent changes" into "built" as a compressed summary.
 * Clears progress and recent changes for the next session.
 * 
 * Example: 
 *   progress: ["Checkout page — Stripe integration started, PaymentForm created"]
 *   recent: ["Updated PaymentForm.tsx", "Edited checkout.ts", "Created stripe.ts"]
 *   → built: ["Checkout page progress: PaymentForm, checkout route, stripe utils"]
 *   → progress: [] , recent: []
 */
export function compressSession(context: ProjectContext): ProjectContext {
  // Nothing to compress if no activity this session
  if (context.progress.length === 0 && context.recentChanges.length === 0) {
    return context;
  }

  const newBuilt = [...context.built];

  // Move progress entries to built
  if (context.progress.length > 0) {
    for (const p of context.progress) {
      newBuilt.push(p);
    }
  }

  // Compress recent file changes into a summary line if there's no progress to carry them
  if (context.recentChanges.length > 0 && context.progress.length === 0) {
    // Group by action type
    const files = context.recentChanges
      .map(c => c.replace(/^(Updated|Edited|Deleted|Created)\s+/, ""))
      .map(f => f.split(/[/\\]/).pop() || f);  // Just filenames for brevity
    const unique = [...new Set(files)];
    if (unique.length > 0) {
      newBuilt.push(`Session work: ${unique.slice(0, 8).join(", ")}${unique.length > 8 ? ` + ${unique.length - 8} more` : ""}`);
    }
  }

  return {
    ...context,
    built: newBuilt,
    progress: [],
    recentChanges: [],
  };
}

// ── System Prompt String (Rich Tiered Context) ─────────────

/**
 * Rich system prompt context. Sent on EVERY API call.
 * 
 * Tiers:
 *   1. Project DNA — product, stack, conventions, structure, routes, schema (~800-1800 tokens)
 *   2. Session State — built, progress, decisions, preferences (~200-400 tokens)
 *   3. Recent Activity — last 10 file operations (~50-80 tokens)
 * 
 * Total: ~1,000-2,300 tokens depending on project size and richness.
 * Saves 2-5 tool round-trips per session by eliminating blind exploration.
 */
export function contextToPromptString(context: ProjectContext): string {
  // Defensive defaults — guard against older context objects missing newer fields
  if (!context) return "";
  context.about = context.about || [];
  context.styles = context.styles || [];
  context.conventions = context.conventions || [];
  context.keyDeps = context.keyDeps || [];
  context.routes = context.routes || [];
  context.schema = context.schema || [];
  context.built = context.built || [];
  context.progress = context.progress || [];
  context.decisions = context.decisions || [];
  context.preferences = context.preferences || [];
  context.recentChanges = context.recentChanges || [];
  context.summarizedFiles = context.summarizedFiles || [];

  const sections: string[] = [];

  // ── Header ──
  sections.push(`Project: ${context.projectName}`);
  sections.push(`Path: ${context.projectPath}`);
  if (context.appRoot) {
    sections.push(`App root: ${context.appRoot}/ (dev server, builds, installs run here)`);
  }

  // ── Tier 1: Project DNA ──

  // About (rich product description)
  if (context.about.length > 0) {
    sections.push("");
    sections.push("## About");
    for (const line of context.about) sections.push(line);
  }

  // Stack & Key Dependencies
  if (context.techStack.length > 0 || context.keyDeps.length > 0) {
    sections.push("");
    sections.push(`Stack: ${context.techStack.join(", ") || "not detected"}`);
    if (context.keyDeps.length > 0) {
      sections.push(`Key deps: ${context.keyDeps.join(", ")}`);
    }
  }

  // Styles & Design System
  if (context.styles.length > 0) {
    sections.push("");
    sections.push("## Styles & Design");
    for (const s of context.styles) sections.push(s);
  }

  // Conventions
  if (context.conventions.length > 0) {
    sections.push("");
    sections.push("## Conventions");
    for (const c of context.conventions) sections.push(`- ${c}`);
  }

  // Structure (folder/file index)
  if (context.structure) {
    sections.push("");
    sections.push("## Structure");
    sections.push(context.structure);
  }

  // Routes / API Map
  if (context.routes.length > 0) {
    sections.push("");
    sections.push("## Routes");
    for (const r of context.routes) sections.push(r);
  }

  // Schema / Data Model
  if (context.schema.length > 0) {
    sections.push("");
    sections.push("## Schema");
    for (const s of context.schema) sections.push(s);
  }

  // ── Knowledge File References ──
  if (context.summarizedFiles.length > 0) {
    sections.push("");
    sections.push("## Knowledge Files");
    sections.push("Detailed docs available — read the summary file if you need deeper context:");
    for (const sf of context.summarizedFiles) {
      sections.push(`- ${sf.title} → \`${sf.summaryPath || sf.originalPath}\``);
    }
  }

  // ── Tier 2: Session State ──

  if (context.built.length > 0) {
    sections.push("");
    sections.push("## Built (completed)");
    for (const b of context.built) sections.push(`- ${b}`);
  }

  if (context.progress.length > 0) {
    sections.push("");
    sections.push("## In Progress");
    for (const p of context.progress) sections.push(`- ${p}`);
  }

  if (context.decisions.length > 0) {
    sections.push("");
    sections.push("## Decisions");
    for (const d of context.decisions) sections.push(`- ${d}`);
  }

  if (context.preferences.length > 0) {
    sections.push("");
    sections.push("## Preferences");
    for (const p of context.preferences) sections.push(`- ${p}`);
  }

  // ── Tier 3: Recent Activity ──

  if (context.recentChanges.length > 0) {
    sections.push("");
    sections.push("## Recent Changes");
    for (const c of context.recentChanges.slice(0, 5)) sections.push(`- ${c}`);
  }

  // ── write_context guidance ──
  sections.push("");
  sections.push("Use write_context to save project knowledge that persists across sessions:");
  sections.push('- "about": what the project is, audience, user roles, user flows, key features, business rules, monetization, status');
  sections.push('- "styles": colors (primary, secondary, accent, bg, text as hex), fonts (headings, body), spacing scale, border-radius, shadows, animations (library, transitions), layout patterns, responsive breakpoints, dark/light mode, component styling approach');
  sections.push('- "conventions": coding patterns, naming, imports, error handling rules, file/folder naming');
  sections.push('- "routes": API endpoints (method + path + description) and page routes');
  sections.push('- "schema": database tables, columns, types, relationships, constraints');
  sections.push('- "progress": what you\'re currently working on');
  sections.push('- "decisions": architectural / product choices');
  sections.push('- "preferences": user behavior / workflow preferences');
  sections.push('- "built": completed features (compress finished work here)');
  sections.push("");
  sections.push("IMPORTANT: When any section above is empty and you learn relevant information (from user messages, from reading files, or from your own code decisions), PROACTIVELY save it. Don't wait to be asked.");
  sections.push("On first interaction with a new project, ASK the user about: what the project is (about), visual style preferences (styles), and coding conventions (conventions) if not already known. Gather this once, save it, never ask again.");

  return sections.join("\n");
}

// ── Parsing context.md (metadata from HTML comments) ─────────

function parseContextFile(content: string, projectPath: string): ProjectContext {
  const projectName = extractComment(content, "project") ||
    content.match(/^#\s+(.+?)(?:\s*[—-]|$)/m)?.[1]?.trim() ||
    projectPath.split(/[/\\]/).pop() || "unknown";

  const appRoot = extractComment(content, "appRoot") || "";
  const techLine = extractComment(content, "tech") || "";
  const techStack = techLine ? techLine.split(",").map(t => t.trim()).filter(Boolean) : [];

  const keyDepsLine = extractComment(content, "keyDeps") || "";
  const keyDeps = keyDepsLine ? keyDepsLine.split(",").map(t => t.trim()).filter(Boolean) : [];

  // Parse structure from multiline comment
  const structureMatch = content.match(/<!-- structure:\n([\s\S]*?)\n-->/);
  const structure = structureMatch ? structureMatch[1].trim() : "";

  // Parse summary entries
  const summaryRegex = /<!-- summary: (.+?) \| (.+?) \| (.+?) -->/g;
  const summarizedFiles: { originalPath: string; summaryPath: string; title: string }[] = [];
  let match;
  while ((match = summaryRegex.exec(content)) !== null) {
    summarizedFiles.push({
      originalPath: match[1].trim(),
      summaryPath: match[2].trim(),
      title: match[3].trim(),
    });
  }

  // Parse all sections
  const about = extractListSection(content, "About");
  const styles = extractListSection(content, "Styles & Design") || extractListSection(content, "Styles");
  const conventions = extractListSection(content, "Conventions");
  const routes = extractListSection(content, "Routes");
  const schema = extractListSection(content, "Schema");
  const built = extractListSection(content, "Built (completed)") || extractListSection(content, "Built");
  const progress = extractListSection(content, "In Progress");
  const decisions = extractListSection(content, "Decisions");
  const preferences = extractListSection(content, "Preferences");
  const recentChanges = extractListSection(content, "Recent Changes");

  return {
    projectName,
    projectPath,
    techStack,
    structure,
    appRoot: appRoot === "(root)" ? "" : appRoot,
    summarizedFiles,
    about,
    styles,
    conventions,
    keyDeps,
    routes,
    schema,
    built,
    progress,
    decisions,
    preferences,
    recentChanges,
  };
}

function extractComment(content: string, key: string): string | null {
  const regex = new RegExp(`<!-- ${key}: (.+?) -->`);
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function extractListSection(content: string, heading: string): string[] {
  // Try exact heading match first, then case-insensitive
  let regex = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  let match = content.match(regex);
  if (!match) {
    regex = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
    match = content.match(regex);
  }
  if (!match) return [];

  const lines = match[1].split("\n").filter(l => l.trim());
  
  // If most lines are bulleted, extract bullet content
  const bulletLines = lines.filter(l => l.trim().startsWith("- "));
  if (bulletLines.length >= lines.length * 0.5) {
    return bulletLines
      .map(line => line.trim().slice(2).trim())
      .filter(l => l && !l.startsWith("(none"));
  }

  // Otherwise return all non-empty lines as-is (for about, routes, schema sections)
  return lines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("(none"));
}