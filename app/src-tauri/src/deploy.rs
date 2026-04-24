// ============================================================
// Deploy Module — Provider-agnostic project file reader
// ============================================================
// Walks a project directory, respects .gitignore / .vercelignore /
// .netlifyignore, skips common build artifacts, computes SHA1 for
// each file, and returns a structured list ready to be uploaded to
// any deploy provider (Vercel, Netlify, Cloudflare Pages, etc.).
//
// Frontend calls: invoke('read_project_for_deploy', { projectPath })
// ============================================================

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};

// Max per-file size we'll include in a deploy (100 MB).
// Vercel/Netlify have their own limits; this is a sanity guard.
const MAX_FILE_SIZE: u64 = 100 * 1024 * 1024;

// Total deploy payload cap (250 MB). Anything larger almost certainly
// means the user forgot to ignore something big (videos, datasets).
const MAX_TOTAL_SIZE: u64 = 250 * 1024 * 1024;

// Directories we always skip, regardless of .gitignore.
// These are build outputs, caches, and VCS metadata that should
// never be uploaded to a deploy provider.
const ALWAYS_SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    ".next",
    ".nuxt",
    ".vercel",
    ".netlify",
    ".cache",
    ".parcel-cache",
    ".turbo",
    ".vite",
    "coverage",
    ".nyc_output",
    ".DS_Store",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "target",        // Rust
    ".gradle",       // Gradle
    ".idea",         // JetBrains
    ".vscode",
    ".omnirun",      // our own folder
];

// Files we always skip.
const ALWAYS_SKIP_FILES: &[&str] = &[
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    "npm-debug.log",
    "yarn-debug.log",
    "yarn-error.log",
    ".pnpm-debug.log",
];

// File extensions we skip (logs, lockfiles are kept, but source maps
// and backups are dropped).
const ALWAYS_SKIP_EXTENSIONS: &[&str] = &[
    ".log",
    ".swp",
    ".swo",
    ".bak",
    ".tmp",
];

#[derive(Debug, Serialize, Deserialize)]
pub struct DeployFile {
    /// Path relative to the project root, forward-slash normalized.
    /// e.g. "index.html", "assets/logo.png", "src/main.ts"
    pub path: String,

    /// SHA1 hex digest of the raw file bytes.
    /// This is what Vercel's x-vercel-digest header wants, and what
    /// Netlify's /deploys endpoint expects in the files map.
    pub sha1: String,

    /// Raw file size in bytes.
    pub size: u64,

    /// Base64-encoded file contents. Frontend decodes and uploads
    /// as raw bytes. (Base64 avoids JSON escape issues with binary
    /// files like images.)
    pub content_base64: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeployPayload {
    pub files: Vec<DeployFile>,
    pub total_size: u64,
    pub file_count: usize,
    /// Detected framework hint (e.g. "nextjs", "vite", "static").
    /// Used by the frontend to set projectSettings/buildCommand.
    pub framework: Option<String>,
    /// Detected output directory for pre-built sites (e.g. "dist", ".next").
    /// None = no pre-built output detected, deploy the source tree.
    pub output_dir: Option<String>,
}

/// Walk the project tree and collect all deployable files.
/// Respects .gitignore, .vercelignore, .netlifyignore, and our
/// own ALWAYS_SKIP lists.
#[tauri::command]
pub fn read_project_for_deploy(project_path: String) -> Result<DeployPayload, String> {
    let root = PathBuf::from(&project_path);
    if !root.exists() {
        return Err(format!("Project path does not exist: {}", project_path));
    }
    if !root.is_dir() {
        return Err(format!("Project path is not a directory: {}", project_path));
    }

    // Detect framework + output dir BEFORE walking, so we can
    // optionally redirect the walk to the build output.
    let framework = detect_framework(&root);
    let output_dir = detect_output_dir(&root, framework.as_deref());

    // If a build output directory exists and has content, deploy THAT
    // instead of the source tree. This matches what Vercel/Netlify do
    // when you "deploy the dist folder."
    let walk_root = match &output_dir {
        Some(dir) => {
            let candidate = root.join(dir);
            if candidate.exists() && candidate.is_dir() && has_files(&candidate) {
                candidate
            } else {
                root.clone()
            }
        }
        None => root.clone(),
    };

    // Build the walker. `ignore` handles .gitignore, .ignore, and
    // any custom ignore files we add.
    let walker = WalkBuilder::new(&walk_root)
        .hidden(false) // we want dotfiles like .htaccess, but filter specific ones below
        .git_ignore(true)
        .git_exclude(true)
        .add_custom_ignore_filename(".vercelignore")
        .add_custom_ignore_filename(".netlifyignore")
        .add_custom_ignore_filename(".deployignore")
        .filter_entry(|entry| !is_always_skipped(entry.path()))
        .build();

    let mut files: Vec<DeployFile> = Vec::new();
    let mut total_size: u64 = 0;

    for result in walker {
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();

        // Skip directories; we only want files.
        if !path.is_file() {
            continue;
        }

        // Secondary extension/name check (the walker's filter_entry only
        // fires on directories reliably).
        if is_skipped_file(path) {
            continue;
        }

        let metadata = match fs::metadata(path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let size = metadata.len();
        if size > MAX_FILE_SIZE {
            // Skip oversized files silently rather than failing the whole
            // deploy. User can add them to .deployignore if intentional.
            eprintln!(
                "deploy: skipping oversized file ({} bytes): {}",
                size,
                path.display()
            );
            continue;
        }

        total_size += size;
        if total_size > MAX_TOTAL_SIZE {
            return Err(format!(
                "Deploy payload exceeds {} MB. Add large files to .deployignore or build into an output directory.",
                MAX_TOTAL_SIZE / (1024 * 1024)
            ));
        }

        // Read file contents.
        let bytes = match fs::read(path) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("deploy: failed to read {}: {}", path.display(), e);
                continue;
            }
        };

        // Compute SHA1.
        let mut hasher = Sha1::new();
        hasher.update(&bytes);
        let sha1 = format!("{:x}", hasher.finalize());

        // Relative path, forward-slash normalized.
        let rel = match path.strip_prefix(&walk_root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let rel_str = rel
            .to_string_lossy()
            .replace('\\', "/");

        // Base64-encode the content.
        let content_base64 = B64.encode(&bytes);

        files.push(DeployFile {
            path: rel_str,
            sha1,
            size,
            content_base64,
        });
    }

    if files.is_empty() {
        return Err("No files found to deploy. Check that the project folder contains deployable files and that nothing is excluded by .gitignore.".to_string());
    }

    let file_count = files.len();
    Ok(DeployPayload {
        files,
        total_size,
        file_count,
        framework,
        output_dir,
    })
}

// ---- Helpers ---------------------------------------------------

fn is_always_skipped(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if ALWAYS_SKIP_DIRS.contains(&name) {
            return true;
        }
    }
    false
}

fn is_skipped_file(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if ALWAYS_SKIP_FILES.contains(&name) {
            return true;
        }
    }
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let dotted = format!(".{}", ext);
        if ALWAYS_SKIP_EXTENSIONS.contains(&dotted.as_str()) {
            return true;
        }
    }
    false
}

/// Quick existence + non-empty check for a directory.
fn has_files(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|mut iter| iter.next().is_some())
        .unwrap_or(false)
}

/// Best-effort framework detection based on root files.
/// Returns a short identifier matching Vercel/Netlify's naming.
fn detect_framework(root: &Path) -> Option<String> {
    let package_json = root.join("package.json");
    if package_json.exists() {
        if let Ok(contents) = fs::read_to_string(&package_json) {
            // Cheap substring matching — avoids pulling in serde_json for
            // one field. Good enough for a hint.
            if contents.contains("\"next\"") {
                return Some("nextjs".to_string());
            }
            if contents.contains("\"nuxt\"") {
                return Some("nuxtjs".to_string());
            }
            if contents.contains("\"@remix-run/") {
                return Some("remix".to_string());
            }
            if contents.contains("\"@sveltejs/kit\"") {
                return Some("sveltekit".to_string());
            }
            if contents.contains("\"astro\"") {
                return Some("astro".to_string());
            }
            if contents.contains("\"gatsby\"") {
                return Some("gatsby".to_string());
            }
            if contents.contains("\"vite\"") {
                return Some("vite".to_string());
            }
            if contents.contains("\"react-scripts\"") {
                return Some("create-react-app".to_string());
            }
        }
    }

    // Pure static site
    if root.join("index.html").exists() {
        return Some("static".to_string());
    }

    None
}

/// Best-effort output-directory detection. Returns the directory to
/// deploy if a pre-built output exists.
fn detect_output_dir(root: &Path, framework: Option<&str>) -> Option<String> {
    // Vercel/Netlify expect SOURCE for server-rendered frameworks — they
    // run the build themselves. Only deploy pre-built output for pure
    // static sites (SPAs, static generators).
    let candidates: &[&str] = match framework {
        // Server-rendered / full-stack — deploy source, provider builds.
        Some("nextjs")
        | Some("nuxtjs")
        | Some("remix")
        | Some("sveltekit") => &[],

        // Static-output frameworks — deploy the built bundle.
        Some("astro") => &["dist"],
        Some("gatsby") => &["public"],
        Some("vite") => &["dist"],
        Some("create-react-app") => &["build"],

        // Pure static — deploy as-is.
        Some("static") => &[],

        // Unknown — try common output dirs, fall back to source.
        _ => &["dist", "build", "out", "public"],
    };

    for c in candidates {
        let p = root.join(c);
        if p.exists() && p.is_dir() && has_files(&p) {
            return Some(c.to_string());
        }
    }

    None
}