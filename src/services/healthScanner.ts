// ============================================================
// healthScanner.ts - Local Project Health Scanner
// ============================================================
// Reads project files via Tauri invoke and runs regex/pattern
// checks. No AI involved — pure local analysis.

import { invoke } from '@tauri-apps/api/core';
import { useProjectStore } from '../stores/projectStore';

// --------------- Types (match HealthChecksPage exports) ---------------

type CheckCategory = 'security' | 'performance' | 'accessibility' | 'seo' | 'code-quality';
type IssueSeverity = 'critical' | 'warning' | 'info';

interface HealthIssue {
  id: string;
  category: CheckCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  file?: string;
  line?: number;
  fixMessage?: string;
  fixLabel?: string;
}

interface ScanResult {
  timestamp: number;
  issues: HealthIssue[];
  scannedFiles: number;
  duration: number;
}

// --------------- File tree helpers ---------------

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

function flattenFiles(entries: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.is_dir) {
      if (entry.children) result.push(...flattenFiles(entry.children));
    } else {
      result.push(entry);
    }
  }
  return result;
}

function isSourceFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return [
    'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss',
    'vue', 'svelte', 'json', 'md', 'mdx', 'yaml', 'yml',
    'py', 'rb', 'php', 'go', 'rs',
  ].includes(ext);
}

function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp', 'svg', 'ico'].includes(ext);
}

function isSkippable(path: string): boolean {
  const norm = path.replace(/\\/g, '/').toLowerCase();
  const skip = [
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
    'coverage', '__pycache__', '.venv', 'target', 'vendor',
    '.omnirun', '.DS_Store',
  ];
  return skip.some((s) => norm.includes(`/${s}/`) || norm.includes(`/${s}`));
}

function relativePath(filePath: string, projectPath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const base = projectPath.replace(/\\/g, '/');
  if (norm.startsWith(base)) {
    return norm.slice(base.length).replace(/^\//, '');
  }
  return norm;
}

// --------------- Read file safely ---------------

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    const content = await invoke<string>('read_file', { path: filePath });
    return content;
  } catch {
    return null;
  }
}

/** Get file size in bytes via Rust backend */
async function getFileSize(filePath: string): Promise<number> {
  try {
    const size = await invoke<number>('get_file_size', { path: filePath });
    return size;
  } catch {
    return 0;
  }
}

// --------------- Issue factory ---------------

let issueIdCounter = 0;

function nextId(): string {
  return `issue_${++issueIdCounter}`;
}

function makeIssue(
  category: CheckCategory,
  severity: IssueSeverity,
  title: string,
  description: string,
  file?: string,
  line?: number,
  fixMessage?: string,
): HealthIssue {
  return { id: nextId(), category, severity, title, description, file, line, fixMessage, fixLabel: 'Fix' };
}

// ═══════════════════════════════════════════════════
// SECURITY CHECKS
// ═══════════════════════════════════════════════════

const SECRET_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /(?:sk_live_|sk_test_)[a-zA-Z0-9]{20,}/, label: 'Stripe secret key' },
  { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/, label: 'AWS access key' },
  { pattern: /(?:ghp_|gho_|ghs_|ghr_)[a-zA-Z0-9]{30,}/, label: 'GitHub token' },
  { pattern: /(?:xox[bpras]-)[a-zA-Z0-9\-]{20,}/, label: 'Slack token' },
  { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, label: 'Private key' },
  { pattern: /(?:mongodb\+srv|mongodb):\/\/[^\s"']+:[^\s"']+@/, label: 'MongoDB connection string with credentials' },
  { pattern: /(?:postgres|mysql|redis):\/\/[^\s"']+:[^\s"']+@/, label: 'Database connection string with credentials' },
  { pattern: /(?:SG\.)[a-zA-Z0-9_-]{20,}/, label: 'SendGrid API key' },
  { pattern: /(?:sk-)[a-zA-Z0-9]{40,}/, label: 'OpenAI API key' },
  { pattern: /Bearer\s+[a-zA-Z0-9_\-\.]{30,}/, label: 'Bearer token' },
];

function checkSecurity(content: string, relPath: string): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const lines = content.split('\n');

  // Skip template files
  if (relPath.endsWith('.env.example') || relPath.endsWith('.env.template')) return issues;

  for (const { pattern, label } of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('<!--')) continue;

      if (pattern.test(lines[i])) {
        issues.push(makeIssue(
          'security', 'critical',
          `${label} found in source code`,
          `A ${label.toLowerCase()} was detected. Move it to an environment variable.`,
          relPath, i + 1,
          `Move the ${label.toLowerCase()} found at ${relPath}:${i + 1} to a .env file and use an environment variable instead.`,
        ));
        break;
      }
    }
  }

  // Hardcoded passwords
  const passwordPatterns = [
    /password\s*[:=]\s*["'][^"']{4,}["']/i,
    /secret\s*[:=]\s*["'][^"']{4,}["']/i,
    /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  ];

  for (const pat of passwordPatterns) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
      if (pat.test(lines[i]) && !lines[i].includes('process.env') && !lines[i].includes('import.meta.env')) {
        issues.push(makeIssue(
          'security', 'warning',
          'Possible hardcoded credential',
          'This looks like a hardcoded password or API key. Use environment variables instead.',
          relPath, i + 1,
          `Replace the hardcoded credential at ${relPath}:${i + 1} with an environment variable.`,
        ));
        break;
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════
// PERFORMANCE CHECKS
// ═══════════════════════════════════════════════════

function checkPerformance(content: string, relPath: string, fileName: string): HealthIssue[] {
  const issues: HealthIssue[] = [];

  // Large inline data URIs
  const dataUriMatch = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{10000,}/);
  if (dataUriMatch) {
    const sizeKB = Math.round(dataUriMatch[0].length * 0.75 / 1024);
    issues.push(makeIssue(
      'performance', 'warning',
      `Large inline data URI (~${sizeKB}KB)`,
      'Large base64-encoded images increase page size. Use an external image file instead.',
      relPath, undefined,
      `Extract the large base64 data URI in ${relPath} into a separate image file.`,
    ));
  }

  // Missing lazy loading on images in JSX/HTML
  if (fileName.match(/\.(jsx|tsx|html|htm|vue|svelte)$/)) {
    const imgTags = content.match(/<img\s[^>]*>/gi) || [];
    const noLazy = imgTags.filter((tag) => !tag.includes('loading=') && !tag.includes('lazy'));
    if (noLazy.length >= 3) {
      issues.push(makeIssue(
        'performance', 'info',
        `${noLazy.length} images without lazy loading`,
        'Adding loading="lazy" to below-the-fold images improves page load speed.',
        relPath, undefined,
        `Add loading="lazy" to the ${noLazy.length} <img> tags in ${relPath} that don't have it.`,
      ));
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════
// ACCESSIBILITY CHECKS
// ═══════════════════════════════════════════════════

function checkAccessibility(content: string, relPath: string, fileName: string): HealthIssue[] {
  const issues: HealthIssue[] = [];

  if (!fileName.match(/\.(jsx|tsx|html|htm|vue|svelte)$/)) return issues;

  // Images without alt text
  const imgTags = content.match(/<img\s[^>]*>/gi) || [];
  const noAlt = imgTags.filter((tag) => !tag.includes('alt=') && !tag.includes('alt '));
  if (noAlt.length > 0) {
    issues.push(makeIssue(
      'accessibility', 'warning',
      `${noAlt.length} image${noAlt.length > 1 ? 's' : ''} missing alt text`,
      'Screen readers cannot describe images without alt attributes.',
      relPath, undefined,
      `Add descriptive alt text to ${noAlt.length} <img> tag${noAlt.length > 1 ? 's' : ''} in ${relPath}.`,
    ));
  }

  // Buttons with icon-only content
  const emptyButtons = (content.match(/<button[^>]*>\s*<(?:svg|img|icon)/gi) || []).length;
  if (emptyButtons > 0) {
    issues.push(makeIssue(
      'accessibility', 'warning',
      `${emptyButtons} button${emptyButtons > 1 ? 's' : ''} with icon-only content`,
      'Buttons with only icons need an aria-label for screen readers.',
      relPath, undefined,
      `Add aria-label attributes to the ${emptyButtons} icon-only buttons in ${relPath}.`,
    ));
  }

  // Missing form labels
  const inputs = content.match(/<input\s[^>]*>/gi) || [];
  const noLabel = inputs.filter((tag) =>
    !tag.includes('aria-label') && !tag.includes('id=') && tag.includes('type=') &&
    !tag.includes('type="hidden"') && !tag.includes("type='hidden'") && !tag.includes('type="submit"')
  );
  if (noLabel.length >= 2) {
    issues.push(makeIssue(
      'accessibility', 'info',
      `${noLabel.length} inputs possibly missing labels`,
      'Form inputs need associated labels or aria-label for accessibility.',
      relPath, undefined,
      `Add labels or aria-label attributes to form inputs in ${relPath}.`,
    ));
  }

  return issues;
}

// ═══════════════════════════════════════════════════
// SEO CHECKS
// ═══════════════════════════════════════════════════

function checkSEO(content: string, relPath: string, fileName: string): HealthIssue[] {
  const issues: HealthIssue[] = [];

  const isEntry = fileName === 'index.html' || fileName === 'layout.tsx' || fileName === 'layout.jsx'
    || fileName === '_app.tsx' || fileName === '_app.jsx' || fileName === 'app.tsx';

  if (!isEntry && !relPath.includes('app/layout') && !relPath.includes('pages/_document')) return issues;

  if (fileName === 'index.html') {
    if (!content.includes('<title') && !content.includes('<Title')) {
      issues.push(makeIssue(
        'seo', 'warning',
        'Missing <title> tag',
        'Every page needs a title tag for search engines and browser tabs.',
        relPath, undefined,
        `Add a <title> tag to the <head> section of ${relPath}.`,
      ));
    }

    if (!content.includes('name="description"') && !content.includes("name='description'")) {
      issues.push(makeIssue(
        'seo', 'warning',
        'Missing meta description',
        'A meta description helps search engines understand your page content.',
        relPath, undefined,
        `Add a <meta name="description" content="..."> tag to ${relPath}.`,
      ));
    }

    if (!content.includes('og:title') && !content.includes('og:description')) {
      issues.push(makeIssue(
        'seo', 'info',
        'Missing Open Graph tags',
        'OG tags improve how your site looks when shared on social media.',
        relPath, undefined,
        `Add Open Graph meta tags (og:title, og:description, og:image) to ${relPath}.`,
      ));
    }

    if (!content.includes('name="viewport"') && !content.includes("name='viewport'")) {
      issues.push(makeIssue(
        'seo', 'warning',
        'Missing viewport meta tag',
        'Without a viewport tag, your page won\'t render correctly on mobile devices.',
        relPath, undefined,
        `Add <meta name="viewport" content="width=device-width, initial-scale=1"> to ${relPath}.`,
      ));
    }
  }

  return issues;
}

function checkSEOFiles(allRelPaths: string[]): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const hasPublic = allRelPaths.some((p) => p.startsWith('public/'));
  const rootOrPublic = allRelPaths.map((p) => p.replace(/^public\//, ''));

  if (!rootOrPublic.includes('robots.txt')) {
    issues.push(makeIssue(
      'seo', 'info',
      'Missing robots.txt',
      'A robots.txt file tells search engines which pages to crawl.',
      undefined, undefined,
      `Create a robots.txt file ${hasPublic ? 'in the public/ directory' : 'at the project root'}.`,
    ));
  }

  if (!rootOrPublic.includes('sitemap.xml') && !allRelPaths.some((p) => p.includes('sitemap'))) {
    issues.push(makeIssue(
      'seo', 'info',
      'Missing sitemap.xml',
      'A sitemap helps search engines discover and index all your pages.',
      undefined, undefined,
      `Create a sitemap.xml file ${hasPublic ? 'in the public/ directory' : 'at the project root'}.`,
    ));
  }

  return issues;
}

// ═══════════════════════════════════════════════════
// CODE QUALITY CHECKS
// ═══════════════════════════════════════════════════

function checkCodeQuality(content: string, relPath: string, fileName: string): HealthIssue[] {
  const issues: HealthIssue[] = [];

  if (!fileName.match(/\.(js|jsx|ts|tsx|vue|svelte)$/)) return issues;

  // Console.log statements
  const consoleLogs = (content.match(/console\.(log|debug|info)\(/g) || []).length;
  if (consoleLogs >= 3) {
    issues.push(makeIssue(
      'code-quality', 'info',
      `${consoleLogs} console.log statements`,
      'Console log statements should be removed before deploying to production.',
      relPath, undefined,
      `Remove all ${consoleLogs} console.log/debug/info statements from ${relPath}.`,
    ));
  }

  // TODO/FIXME comments
  const todos = (content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)[\s:]/gi) || []).length;
  if (todos >= 3) {
    issues.push(makeIssue(
      'code-quality', 'info',
      `${todos} TODO/FIXME comments`,
      'Multiple TODO comments may indicate unfinished work.',
      relPath, undefined,
      `Review and resolve the ${todos} TODO/FIXME comments in ${relPath}.`,
    ));
  }

  // Very long files
  const lineCount = content.split('\n').length;
  if (lineCount > 500) {
    issues.push(makeIssue(
      'code-quality', 'info',
      `Large file (${lineCount} lines)`,
      'Consider splitting this into smaller, more focused modules.',
      relPath, undefined,
      `Consider refactoring ${relPath} (${lineCount} lines) into smaller modules.`,
    ));
  }

  return issues;
}

// ═══════════════════════════════════════════════════
// MAIN SCANNER (exported)
// ═══════════════════════════════════════════════════

export async function runHealthScan(
  onProgress?: (message: string, filesScanned: number, totalFiles: number) => void
): Promise<ScanResult> {
  issueIdCounter = 0;
  const startTime = Date.now();
  const issues: HealthIssue[] = [];

  const { fileTree, projectPath } = useProjectStore.getState();

  if (!fileTree || !projectPath) {
    return { timestamp: Date.now(), issues: [], scannedFiles: 0, duration: 0 };
  }

  // Flatten and filter files
  const allFiles = flattenFiles(fileTree).filter((f) => !isSkippable(f.path));
  const sourceFiles = allFiles.filter((f) => isSourceFile(f.name));
  const imageFiles = allFiles.filter((f) => isImageFile(f.name));
  const allRelPaths = allFiles.map((f) => relativePath(f.path, projectPath));

  const totalToScan = sourceFiles.length + imageFiles.length;
  let scannedCount = 0;

  // Project-level SEO checks
  issues.push(...checkSEOFiles(allRelPaths));

  // Scan each source file
  for (const file of sourceFiles) {
    const relPath = relativePath(file.path, projectPath);
    onProgress?.(`Scanning ${relPath}`, scannedCount, totalToScan);

    const content = await readFileSafe(file.path);
    if (!content) {
      scannedCount++;
      continue;
    }

    issues.push(...checkSecurity(content, relPath));
    issues.push(...checkPerformance(content, relPath, file.name));
    issues.push(...checkAccessibility(content, relPath, file.name));
    issues.push(...checkSEO(content, relPath, file.name));
    issues.push(...checkCodeQuality(content, relPath, file.name));

    scannedCount++;
  }

  // Check image file sizes via stat (binary files can't be read as text)
  for (const img of imageFiles) {
    const relPath = relativePath(img.path, projectPath);
    onProgress?.(`Checking ${relPath}`, scannedCount, totalToScan);

    const sizeBytes = await getFileSize(img.path);
    if (sizeBytes > 500_000) {
      const sizeKB = Math.round(sizeBytes / 1024);
      const sizeLabel = sizeKB > 1024
        ? `${(sizeKB / 1024).toFixed(1)}MB`
        : `${sizeKB}KB`;

      issues.push(makeIssue(
        'performance',
        sizeBytes > 2_000_000 ? 'warning' : 'info',
        `Large image (${sizeLabel})`,
        'Large images slow down page loads. Compress or convert to WebP.',
        relPath,
        undefined,
        `Compress ${relPath} (${sizeLabel}) or convert it to WebP format to reduce its file size.`,
      ));
    }

    scannedCount++;
  }

  onProgress?.('Scan complete', totalToScan, totalToScan);

  // Sort: critical first, then warning, then info
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2));

  return {
    timestamp: Date.now(),
    issues,
    scannedFiles: scannedCount,
    duration: Date.now() - startTime,
  };
}