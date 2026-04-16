import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────

export type ProjectType = "static" | "framework" | "native-app" | "non-web";

// Frameworks that target mobile devices (phone mockup in preview)
const MOBILE_FRAMEWORKS = new Set([
  "React Native",
  "Flutter",
  "Expo",
  "Capacitor",
  "Ionic",
  "Quasar",
  "Framework7",
  "NativeScript",
]);

export interface ProjectDetection {
  type: ProjectType;
  framework: string | null;
  devCommand: string | null;
  installCommand: string | null;
  portPattern: RegExp | null;
  needsInstall: boolean;
  resolvedPath?: string; // Actual project path (may differ from opened folder if found in subdir)
  isMobileApp: boolean;  // True for React Native, Flutter native, Expo — shows phone mockup in preview
}

// ── Framework Detection Map (npm/package.json based) ──────────

interface FrameworkInfo {
  name: string;
  devCommand: string;
  portPattern: RegExp;
}

const FRAMEWORK_MAP: { pkg: string; info: FrameworkInfo }[] = [
  {
    pkg: "next",
    info: {
      name: "Next.js",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "nuxt",
    info: {
      name: "Nuxt",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "@sveltejs/kit",
    info: {
      name: "SvelteKit",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "svelte",
    info: {
      name: "Svelte",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "astro",
    info: {
      name: "Astro",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  // ── Mobile frameworks (must be BEFORE vite — they use vite internally) ──
  {
    pkg: "@ionic/react",
    info: {
      name: "Ionic",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "@ionic/angular",
    info: {
      name: "Ionic",
      devCommand: "npm start",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "@ionic/vue",
    info: {
      name: "Ionic",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "quasar",
    info: {
      name: "Quasar",
      devCommand: "npx quasar dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "framework7",
    info: {
      name: "Framework7",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "@nativescript/core",
    info: {
      name: "NativeScript",
      devCommand: "ns preview",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "@capacitor/core",
    info: {
      name: "Capacitor",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  // ── Generic web frameworks (checked after mobile-specific ones) ──
  {
    pkg: "vite",
    info: {
      name: "Vite",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "react-scripts",
    info: {
      name: "Create React App",
      devCommand: "npm start",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "@angular/cli",
    info: {
      name: "Angular",
      devCommand: "npm start",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "vue",
    info: {
      name: "Vue",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  // ── Expo / React Native Web ──
  {
    pkg: "expo",
    info: {
      name: "Expo",
      devCommand: "set BROWSER=none && npx expo start --web",
      portPattern: /localhost:(\d+)/,
    },
  },
];

// ── Native app detection (npm-based, opens own window) ────────
// These are checked BEFORE the web framework map so they take priority

interface NativeAppInfo {
  name: string;
  devCommand: string;
}

const NATIVE_APP_MAP: { pkg: string; info: NativeAppInfo }[] = [
  {
    pkg: "@tauri-apps/cli",
    info: {
      name: "Tauri",
      devCommand: "npm run tauri dev",
    },
  },
  {
    pkg: "electron",
    info: {
      name: "Electron",
      devCommand: "npm start",
    },
  },
  {
    pkg: "react-native",
    info: {
      name: "React Native",
      devCommand: "npx react-native start",
    },
  },
];

// ── Non-npm framework detection (file-marker based) ───────────

interface FileBasedFramework {
  type: ProjectType;
  name: string;
  devCommand: string;
  installCommand: string | null;
  portPattern: RegExp | null;
  /** Files/dirs that must exist (ALL must match) */
  requiredFiles: string[];
  /** If any of these files exist, it's a match (at least one) */
  anyFiles?: string[];
  /** Check file content for a pattern (optional deeper check) */
  contentCheck?: { file: string; pattern: RegExp };
  /** Custom install check function name */
  installCheck?: "checkPubspecLock" | "checkVenv" | "checkBundler" | "checkDotnetRestore" | "checkCargoTarget";
}

const FILE_BASED_FRAMEWORKS: FileBasedFramework[] = [
  // ── Flutter Web (has web/ folder → can preview in iframe) ──
  {
    type: "framework",
    name: "Flutter Web",
    devCommand: "flutter run -d web-server --web-port=8080",
    installCommand: "flutter pub get",
    portPattern: /localhost:(\d+)/,
    requiredFiles: ["pubspec.yaml", "lib"],
    anyFiles: ["web"],
    installCheck: "checkPubspecLock",
  },
  // ── Flutter Native (no web/ folder → opens emulator/native window) ──
  {
    type: "native-app",
    name: "Flutter",
    devCommand: "flutter run",
    installCommand: "flutter pub get",
    portPattern: null,
    requiredFiles: ["pubspec.yaml", "lib"],
    installCheck: "checkPubspecLock",
  },
  // ── Django ──
  {
    type: "framework",
    name: "Django",
    devCommand: "python manage.py runserver",
    installCommand: "pip install -r requirements.txt",
    portPattern: /(?:localhost|127\.0\.0\.1):(\d+)/,
    requiredFiles: ["manage.py"],
    installCheck: "checkVenv",
  },
  // ── FastAPI ──
  {
    type: "framework",
    name: "FastAPI",
    devCommand: "uvicorn main:app --reload",
    installCommand: "pip install -r requirements.txt",
    portPattern: /(?:localhost|127\.0\.0\.1):(\d+)/,
    requiredFiles: ["requirements.txt"],
    contentCheck: { file: "requirements.txt", pattern: /fastapi/i },
    installCheck: "checkVenv",
  },
  // ── Flask ──
  {
    type: "framework",
    name: "Flask",
    devCommand: "flask run --debug",
    installCommand: "pip install -r requirements.txt",
    portPattern: /(?:localhost|127\.0\.0\.1):(\d+)/,
    requiredFiles: ["requirements.txt"],
    contentCheck: { file: "requirements.txt", pattern: /flask/i },
    installCheck: "checkVenv",
  },
  // ── .NET / Blazor ──
  {
    type: "framework",
    name: ".NET",
    devCommand: "dotnet watch run",
    installCommand: "dotnet restore",
    portPattern: /(?:localhost|127\.0\.0\.1):(\d+)/,
    requiredFiles: [],
    anyFiles: ["*.csproj", "*.fsproj"],
    installCheck: "checkDotnetRestore",
  },
  // ── Ruby on Rails ──
  {
    type: "framework",
    name: "Rails",
    devCommand: "rails server",
    installCommand: "bundle install",
    portPattern: /(?:localhost|127\.0\.0\.1):(\d+)/,
    requiredFiles: ["Gemfile", "Rakefile"],
    anyFiles: ["config"],
    installCheck: "checkBundler",
  },
  // ── Laravel (PHP) ──
  {
    type: "framework",
    name: "Laravel",
    devCommand: "php artisan serve",
    installCommand: "composer install",
    portPattern: /(?:localhost|127\.0\.0\.1):(\d+)/,
    requiredFiles: ["artisan", "composer.json"],
  },
  // ── Go web server ──
  {
    type: "framework",
    name: "Go",
    devCommand: "go run .",
    installCommand: null,
    portPattern: /(?:localhost|127\.0\.0\.1):(\d+)/,
    requiredFiles: ["go.mod"],
    contentCheck: { file: "go.mod", pattern: /^module\s/m },
  },
  // ── Rust (Cargo) — native app ──
  {
    type: "native-app",
    name: "Rust",
    devCommand: "cargo run",
    installCommand: "cargo build",
    portPattern: null,
    requiredFiles: ["Cargo.toml", "src"],
    installCheck: "checkCargoTarget",
  },
  // ── Python script (generic fallback — not Django/Flask/FastAPI) ──
  {
    type: "native-app",
    name: "Python",
    devCommand: "python main.py",
    installCommand: "pip install -r requirements.txt",
    portPattern: null,
    requiredFiles: [],
    anyFiles: ["main.py", "app.py", "run.py"],
    installCheck: "checkVenv",
  },
];

// ── Helpers ────────────────────────────────────────────────────

function detectPackageManager(rootFileNames: string[]): string {
  if (rootFileNames.includes("pnpm-lock.yaml")) return "pnpm";
  if (rootFileNames.includes("yarn.lock")) return "yarn";
  return "npm";
}

function getInstallCommand(manager: string): string {
  switch (manager) {
    case "pnpm": return "pnpm install";
    case "yarn": return "yarn install";
    default: return "npm install";
  }
}

function getDevCommand(manager: string, defaultCmd: string): string {
  if (manager === "npm") return defaultCmd;
  return defaultCmd.replace(/^npm /, `${manager} `);
}

async function checkNodeModules(projectPath: string): Promise<boolean> {
  try {
    await invoke<string>("resolve_path", {
      cwd: projectPath,
      target: "node_modules",
    });
    return true;
  } catch {
    return false;
  }
}

/** Check if a directory or file exists at projectPath/name */
async function pathExists(projectPath: string, name: string): Promise<boolean> {
  try {
    await invoke<string>("resolve_path", {
      cwd: projectPath,
      target: name,
    });
    return true;
  } catch {
    return false;
  }
}

/** Read a file's content, returns null on failure */
async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await invoke<string>("read_file", { path: filePath });
  } catch {
    return null;
  }
}

/** Install-check functions for non-npm projects */
async function checkInstallNeeded(
  projectPath: string,
  check: FileBasedFramework["installCheck"]
): Promise<boolean> {
  if (!check) return false;

  switch (check) {
    case "checkPubspecLock":
      // Flutter: pubspec.lock exists means deps are fetched
      return !(await pathExists(projectPath, "pubspec.lock"));

    case "checkVenv": {
      // Python: check for venv/, .venv/
      const hasVenv = await pathExists(projectPath, "venv");
      const hasDotVenv = await pathExists(projectPath, ".venv");
      if (hasVenv || hasDotVenv) return false;
      // If no requirements.txt, nothing to install
      return await pathExists(projectPath, "requirements.txt");
    }

    case "checkBundler":
      // Ruby: vendor/bundle exists means gems are installed
      return !(await pathExists(projectPath, "vendor"));

    case "checkDotnetRestore":
      // .NET: obj/ folder exists after restore
      return !(await pathExists(projectPath, "obj"));

    case "checkCargoTarget":
      // Rust: target/ folder exists after build
      return !(await pathExists(projectPath, "target"));

    default:
      return false;
  }
}

// ── Main Detection Function ───────────────────────────────────

const NON_WEB: ProjectDetection = {
  type: "non-web",
  framework: null,
  devCommand: null,
  installCommand: null,
  portPattern: null,
  needsInstall: false,
  isMobileApp: false,
};

export async function detectProjectType(projectPath: string): Promise<ProjectDetection> {
  // Set project scope to the USER-SELECTED root — only here, never in recursive calls.
  // This ensures the Rust backend allows access to ALL files in the root folder,
  // not just the detected web-app subdirectory.
  try {
    await invoke("set_project_path", { path: projectPath });
    console.log("[detector] set_project_path OK (root scope):", projectPath);
  } catch (err) {
    console.warn("[detector] set_project_path failed:", err);
  }

  return _detectInPath(projectPath);
}

/**
 * Internal detection — does NOT call set_project_path.
 * Used for recursive subdirectory scanning so we don't
 * accidentally narrow the project scope.
 */
async function _detectInPath(projectPath: string): Promise<ProjectDetection> {
  console.log("[detector] Starting detection for:", projectPath);

  // List root directory
  let rootEntries: { name: string; path: string; is_dir: boolean }[] = [];
  try {
    rootEntries = await invoke("read_directory", { path: projectPath, depth: 0 });
    console.log("[detector] Root entries:", rootEntries.map((e) => e.name));
  } catch (err) {
    console.warn("[detector] read_directory failed:", err);
    return NON_WEB;
  }

  const rootFileNames = rootEntries.map((e) => e.name);
  const rootDirNames = rootEntries.filter((e) => e.is_dir).map((e) => e.name);
  const hasIndexHtml = rootFileNames.includes("index.html");
  const hasPackageJson = rootFileNames.includes("package.json");

  console.log("[detector] hasIndexHtml:", hasIndexHtml, "hasPackageJson:", hasPackageJson);

  // ── 1. Check file-based (non-npm) frameworks FIRST ──────────
  // These take priority because some projects have BOTH package.json and
  // non-npm markers (e.g. a Flutter project with a web/ subfolder that has package.json)

  const fileBasedResult = await detectFileBasedFramework(projectPath, rootFileNames, rootDirNames, rootEntries);
  if (fileBasedResult) {
    console.log("[detector] → file-based framework:", fileBasedResult.framework);
    return fileBasedResult;
  }

  // ── 2. Has index.html but NO package.json → pure static ─────
  if (hasIndexHtml && !hasPackageJson) {
    console.log("[detector] → static (index.html, no package.json)");
    return {
      type: "static",
      framework: null,
      devCommand: null,
      installCommand: null,
      portPattern: null,
      needsInstall: false,
      isMobileApp: false,
    };
  }

  // ── 3. Has package.json → check for npm-based frameworks ────
  if (hasPackageJson) {
    const pkgEntry = rootEntries.find((e) => e.name === "package.json");
    console.log("[detector] package.json entry:", pkgEntry);

    let packageJson: any = null;
    if (pkgEntry) {
      try {
        const raw: string = await invoke("read_file", { path: pkgEntry.path });
        console.log("[detector] package.json read OK, length:", raw.length);
        packageJson = JSON.parse(raw);
      } catch (err) {
        console.warn("[detector] Failed to read/parse package.json:", err);
      }
    }

    if (packageJson) {
      const allDeps = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };
      const depNames = Object.keys(allDeps);
      console.log("[detector] Dependencies found:", depNames);

      // Check native app frameworks first (Tauri, Electron, React Native)
      // Skip React Native match if Expo is present — Expo projects include
      // react-native as a dependency but should use the Expo web dev server
      for (const { pkg, info } of NATIVE_APP_MAP) {
        if (allDeps[pkg] && !(pkg === "react-native" && allDeps["expo"])) {
          const manager = detectPackageManager(rootFileNames);
          const hasModules = await checkNodeModules(projectPath);
          console.log("[detector] → native-app:", info.name, "manager:", manager, "hasModules:", hasModules);

          return {
            type: "native-app",
            framework: info.name,
            devCommand: getDevCommand(manager, info.devCommand),
            installCommand: getInstallCommand(manager),
            portPattern: null,
            needsInstall: !hasModules,
            isMobileApp: MOBILE_FRAMEWORKS.has(info.name),
          };
        }
      }

      // Check web frameworks
      for (const { pkg, info } of FRAMEWORK_MAP) {
        if (allDeps[pkg]) {
          const manager = detectPackageManager(rootFileNames);
          const hasModules = await checkNodeModules(projectPath);
          console.log("[detector] → framework:", info.name, "manager:", manager, "hasModules:", hasModules);

          return {
            type: "framework",
            framework: info.name,
            devCommand: getDevCommand(manager, info.devCommand),
            installCommand: getInstallCommand(manager),
            portPattern: info.portPattern,
            needsInstall: !hasModules,
            isMobileApp: MOBILE_FRAMEWORKS.has(info.name),
          };
        }
      }

      console.log("[detector] package.json found but no known framework in deps");
    } else {
      console.log("[detector] packageJson is null (read or parse failed)");
    }

    if (hasIndexHtml) {
      console.log("[detector] → static (has index.html + unrecognized package.json)");
      return {
        type: "static",
        framework: null,
        devCommand: null,
        installCommand: null,
        portPattern: null,
        needsInstall: false,
        isMobileApp: false,
      };
    }

    console.log("[detector] → non-web (package.json but no framework, no index.html)");
    return NON_WEB;
  }

  // ── 4. No index.html, no package.json at root → scan one level deep ──
  // Handles cases like D:\MyProject where the actual app lives in D:\MyProject\app\
  console.log("[detector] → scanning subdirectories for project...");
  const subDirs = rootEntries.filter((e) => e.is_dir);
  for (const dir of subDirs) {
    try {
      const subEntries: { name: string; path: string; is_dir: boolean }[] = await invoke(
        "read_directory",
        { path: dir.path, depth: 0 }
      );
      const subNames = subEntries.map((e) => e.name);
      const subHasIndex = subNames.includes("index.html");
      const subHasPkg = subNames.includes("package.json");
      // Also check for non-npm markers in subdirs
      const subHasMarker = subNames.includes("pubspec.yaml") ||
        subNames.includes("manage.py") ||
        subNames.includes("Cargo.toml") ||
        subNames.includes("go.mod") ||
        subNames.includes("Gemfile") ||
        subNames.includes("artisan") ||
        subNames.includes("requirements.txt");
      console.log(`[detector] Checking subdir ${dir.name}: hasIndex=${subHasIndex} hasPkg=${subHasPkg} hasMarker=${subHasMarker}`);
      if (subHasIndex || subHasPkg || subHasMarker) {
        console.log(`[detector] → found project in subdirectory: ${dir.name}`);
        const result = await _detectInPath(dir.path);
        result.resolvedPath = dir.path;
        return result;
      }
    } catch {
      // Skip unreadable subdirs
    }
  }

  // ── 5. Nothing found anywhere → non-web ─────────────────────
  console.log("[detector] → non-web (no index.html, no package.json, no known markers)");
  return NON_WEB;
}

// ── File-based framework detection ────────────────────────────

async function detectFileBasedFramework(
  projectPath: string,
  rootFileNames: string[],
  rootDirNames: string[],
  rootEntries: { name: string; path: string; is_dir: boolean }[]
): Promise<ProjectDetection | null> {

  for (const fw of FILE_BASED_FRAMEWORKS) {
    // Check required files
    let allRequired = true;
    for (const req of fw.requiredFiles) {
      if (!rootFileNames.includes(req) && !rootDirNames.includes(req)) {
        allRequired = false;
        break;
      }
    }
    if (!allRequired) continue;

    // Check anyFiles (at least one must exist)
    if (fw.anyFiles && fw.anyFiles.length > 0) {
      let anyFound = false;

      for (const pattern of fw.anyFiles) {
        if (pattern.includes("*")) {
          // Glob-like: *.csproj → check if any file ends with .csproj
          const ext = pattern.replace("*", "");
          if (rootFileNames.some((f) => f.endsWith(ext))) {
            anyFound = true;
            break;
          }
        } else if (pattern.includes("/")) {
          // Path like config/routes.rb → check nested
          const exists = await pathExists(projectPath, pattern);
          if (exists) {
            anyFound = true;
            break;
          }
        } else {
          // Simple filename or dirname
          if (rootFileNames.includes(pattern) || rootDirNames.includes(pattern)) {
            anyFound = true;
            break;
          }
        }
      }

      if (!anyFound) continue;
    }

    // Content check (optional deeper verification)
    if (fw.contentCheck) {
      const entry = rootEntries.find((e) => e.name === fw.contentCheck!.file);
      if (!entry) continue;
      const content = await safeReadFile(entry.path);
      if (!content || !fw.contentCheck.pattern.test(content)) continue;
    }

    console.log(`[detector] File-based match: ${fw.name}`);

    // Determine install need
    const needsInstall = fw.installCommand
      ? await checkInstallNeeded(projectPath, fw.installCheck)
      : false;

    // For Python projects, detect the right entry point
    let devCommand = fw.devCommand;
    if (fw.name === "Python") {
      if (rootFileNames.includes("main.py")) devCommand = "python main.py";
      else if (rootFileNames.includes("app.py")) devCommand = "python app.py";
      else if (rootFileNames.includes("run.py")) devCommand = "python run.py";
    }

    // For FastAPI, detect the module name
    if (fw.name === "FastAPI") {
      if (rootFileNames.includes("main.py")) devCommand = "uvicorn main:app --reload";
      else if (rootFileNames.includes("app.py")) devCommand = "uvicorn app:app --reload";
    }

    return {
      type: fw.type,
      framework: fw.name,
      devCommand,
      installCommand: fw.installCommand,
      portPattern: fw.portPattern,
      needsInstall,
      isMobileApp: MOBILE_FRAMEWORKS.has(fw.name),
    };
  }

  return null;
}