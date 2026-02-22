// ── Template System Types ─────────────────────────────────────
// These types are used by both the Rust-backed bundled templates
// and the future Supabase cloud templates.

/** A single file within a template */
export interface TemplateFile {
  /** Relative path within the template folder (e.g. "src/App.jsx") */
  path: string;
  /** File content — only populated when scaffolding, not during listing */
  content?: string;
}

/** Metadata for a single template */
export interface TemplateDefinition {
  /** Unique ID matching the folder name (e.g. "landing-page") */
  id: string;
  /** Display name (e.g. "Landing Page") */
  name: string;
  /** Category ID (e.g. "websites") */
  category: string;
  /** Short description shown on the card */
  description: string;
  /** Emoji icon for the card */
  icon: string;
  /** Default project name when selected */
  defaultName: string;
  /** Project type: "static" | "react" | "next" | etc. */
  framework: string;
  /** Source: "bundled" (ships with app) or "cloud" (from Supabase) */
  source: "bundled" | "cloud";
  /** List of files — only populated when creating a project, not during browsing */
  files?: TemplateFile[];
}

/** A category grouping templates together */
export interface TemplateCategory {
  /** Unique category ID (e.g. "websites") */
  id: string;
  /** Display name (e.g. "Websites") */
  name: string;
  /** Templates in this category */
  templates: TemplateDefinition[];
}

/** The complete response from listing all available templates */
export interface TemplateListResponse {
  /** Grouped by category for display */
  categories: TemplateCategory[];
  /** Total template count */
  totalCount: number;
}

// ── Category Definitions ──────────────────────────────────────
// These are the fixed category IDs and display names.
// Templates are assigned to categories via their `category` field.

export const TEMPLATE_CATEGORIES: { id: string; name: string }[] = [
  { id: "websites", name: "Websites" },
  { id: "personal-tools", name: "Personal Tools" },
  { id: "business-tools", name: "Business Tools" },
  { id: "automations", name: "Automations" },
  { id: "fun-learning", name: "Fun & Learning" },
];

// ── Helpers ───────────────────────────────────────────────────

/**
 * Groups a flat array of templates into categories.
 * Templates with unknown category IDs are silently dropped.
 */
export function groupTemplatesByCategory(
  templates: TemplateDefinition[]
): TemplateCategory[] {
  const grouped: TemplateCategory[] = TEMPLATE_CATEGORIES.map((cat) => ({
    id: cat.id,
    name: cat.name,
    templates: [],
  }));

  for (const template of templates) {
    const category = grouped.find((c) => c.id === template.category);
    if (category) {
      category.templates.push(template);
    }
  }

  // Only return categories that have at least one template
  return grouped.filter((c) => c.templates.length > 0);
}