// src/services/webSearchService.ts
// Web search via Brave Search API — uses fetch() (Tauri HTTP plugin handles https://**)
// Free tier: 2,000 queries/month — https://brave.com/search/api/

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  error?: string;
}

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

export async function webSearch(
  query: string,
  apiKey: string,
  maxResults: number = 5
): Promise<WebSearchResponse> {
  if (!apiKey?.trim()) {
    return { query, results: [], error: "No search API key configured. Add your Brave Search API key in Settings → General." };
  }
  if (!query?.trim()) {
    return { query, results: [], error: "Empty search query." };
  }

  try {
    const params = new URLSearchParams({
      q: query.trim(),
      count: String(Math.min(Math.max(maxResults, 1), 10)),
      text_decorations: "false",
      search_lang: "en",
    });

    const response = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey.trim(),
      },
    });

    if (!response.ok) {
      if (response.status === 401) return { query, results: [], error: "Invalid Brave Search API key. Check Settings → General." };
      if (response.status === 429) return { query, results: [], error: "Search rate limit hit. Brave free tier: 2,000/month." };
      return { query, results: [], error: `Search API error: ${response.status} ${response.statusText}` };
    }

    const data = await response.json();
    const webResults = data?.web?.results || [];

    const results: SearchResult[] = webResults
      .slice(0, maxResults)
      .map((r: any) => ({
        title: r.title || "Untitled",
        url: r.url || "",
        snippet: truncateSnippet(r.description || r.meta_description || "", 200),
      }))
      .filter((r: SearchResult) => r.url);

    return { query, results };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("Failed")) {
      return { query, results: [], error: "Network error — check your internet connection." };
    }
    return { query, results: [], error: `Search failed: ${msg}` };
  }
}

/**
 * Format search results for AI context (token-efficient).
 * Typically ~100-200 tokens for 5 results.
 */
export function formatResultsForAI(response: WebSearchResponse): string {
  if (response.error) {
    return `Web search error: ${response.error}`;
  }

  if (response.results.length === 0) {
    return `Web search for "${response.query}" returned no results.`;
  }

  const lines: string[] = [`Search: "${response.query}" — ${response.results.length} results:\n`];

  for (let i = 0; i < response.results.length; i++) {
    const r = response.results[i];
    lines.push(`[${i + 1}] ${r.title}`);
    lines.push(`    ${r.url}`);
    if (r.snippet) lines.push(`    ${r.snippet}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * Format search results for display in chat (user-facing).
 * Returns a clean summary string.
 */
export function formatResultsForChat(response: WebSearchResponse): string {
  if (response.error) {
    return `🔍 Search error: ${response.error}`;
  }

  if (response.results.length === 0) {
    return `🔍 No results for "${response.query}"`;
  }

  const lines: string[] = [`🔍 Found ${response.results.length} results for "${response.query}":`];

  for (let i = 0; i < response.results.length; i++) {
    const r = response.results[i];
    lines.push(`  ${i + 1}. ${r.title}`);
    lines.push(`     ${r.url}`);
  }

  return lines.join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────

function truncateSnippet(text: string, maxLen: number): string {
  if (!text) return "";
  const clean = text.replace(/<[^>]*>/g, "").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}