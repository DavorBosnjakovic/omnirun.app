// ============================================================
// Database Service - SQLite via tauri-plugin-sql
// ============================================================
// Replaces all localStorage usage with persistent SQLite storage.
// All data stays on device. No cloud sync.
//
// Usage:
//   import { dbService } from '../services/dbService';
//   await dbService.init();
//   const projects = await dbService.getProjects();

import Database from '@tauri-apps/plugin-sql';

// ─── Types ───────────────────────────────────────────────────

interface DBProject {
  id: string;
  name: string;
  path: string;
  last_opened: string | null;
  created_at: string;
}

interface DBChatConversation {
  id: string;
  project_id: string;
  title: string;
  messages: string; // JSON string
  pinned: number;   // 0 or 1
  created_at: string;
  updated_at: string;
}

interface DBUsageEntry {
  id: number;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost: number;
  input_cost: number;
  output_cost: number;
  task_label: string | null;
  session_id: string | null;
  timestamp: string;
  source: string;              // 'project' | 'assistant'
  project_name: string | null;
}

interface DBConnection {
  provider: string;
  token: string;
  token_label: string | null;
  status: string;
  account_info: string | null; // JSON string
  connected_at: string | null;
  last_tested_at: string | null;
  error: string | null;
}

interface DBAssistantAccount {
  id: string;
  user_id: string;
  provider: string;
  provider_type: string;
  email: string;
  display_name: string | null;
  account_label: string | null;
  is_active: number; // 0 or 1
  connected_at: string | null;
  synced_at: string;
}

interface DBNotification {
  id: string;
  user_id: string;
  source: string;
  title: string;
  body: string | null;
  source_meta: string; // JSON string
  is_read: number;     // 0 or 1
  created_at: string;
}

interface DBUserMemory {
  id: number;
  context_text: string;
  updated_at: string;
}

interface DBMemoryObservation {
  id: number;
  content: string;
  source: string;
  session_id: string | null;
  created_at: string;
}

interface DBMemorySettings {
  id: number;
  learn_assistant: number;
  learn_projects: number;
  learn_voice: number;
  sync_enabled: number;
  last_consolidated_at: string | null;
}

// ─── Database Instance ───────────────────────────────────────
// The instance is also stored on window so it survives Vite HMR module
// reloads in development (HMR re-executes this module, resetting `db` to
// null, but window persists — so getDb() can recover without re-init).

declare global {
  interface Window { __omnirunDb?: Database; }
}

let db: Database | null = null;

const CURRENT_SCHEMA_VERSION = 9;

// ─── Schema Creation ─────────────────────────────────────────

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    last_opened TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Chat',
    messages TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    input_cost REAL NOT NULL DEFAULT 0,
    output_cost REAL NOT NULL DEFAULT 0,
    task_label TEXT,
    session_id TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT NOT NULL DEFAULT 'project',
    project_name TEXT
  );

  CREATE TABLE IF NOT EXISTS usage_budget (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    monthly_budget REAL,
    alert_enabled INTEGER NOT NULL DEFAULT 1,
    alert_threshold INTEGER NOT NULL DEFAULT 80
  );

  CREATE TABLE IF NOT EXISTS usage_sessions (
    id TEXT PRIMARY KEY,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_input_cost REAL NOT NULL DEFAULT 0,
    total_output_cost REAL NOT NULL DEFAULT 0,
    entry_count INTEGER NOT NULL DEFAULT 0,
    models TEXT,
    providers TEXT
  );

  CREATE TABLE IF NOT EXISTS connections (
    provider TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    token_label TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected',
    account_info TEXT,
    connected_at TEXT,
    last_tested_at TEXT,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_connections (
    project_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    token TEXT NOT NULL,
    token_label TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected',
    account_info TEXT,
    connected_at TEXT,
    last_tested_at TEXT,
    error TEXT,
    PRIMARY KEY (project_id, provider),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS assistant_accounts_cache (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_type TEXT NOT NULL DEFAULT 'email',
    email TEXT NOT NULL,
    display_name TEXT,
    account_label TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    connected_at TEXT,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications_cache (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    source_meta TEXT NOT NULL DEFAULT '{}',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_memory (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    context_text TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS memory_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'assistant',
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS memory_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    learn_assistant INTEGER NOT NULL DEFAULT 1,
    learn_projects INTEGER NOT NULL DEFAULT 1,
    learn_voice INTEGER NOT NULL DEFAULT 1,
    sync_enabled INTEGER NOT NULL DEFAULT 0,
    last_consolidated_at TEXT
  );
`;

// ─── Initialization ──────────────────────────────────────────

async function init(): Promise<void> {
  if (db) return; // Already initialized

  try {
    db = await Database.load('sqlite:omnirun.db');
    window.__omnirunDb = db; // Persist across Vite HMR module reloads

    // Create all tables
    const statements = CREATE_TABLES_SQL
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await db.execute(statement);
    }

    // Check schema version and run migrations if needed
    const versionRows = await db.select<{ version: number }[]>(
      'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
    );

    const currentVersion = versionRows.length > 0 ? versionRows[0].version : 0;

    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      if (currentVersion === 0) {
        await db.execute(
          'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
          [CURRENT_SCHEMA_VERSION]
        );
      }

      // v1 → v2: Add auth_tokens table for Supabase session persistence
      if (currentVersion >= 1 && currentVersion < 2) {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS auth_tokens (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            expires_at INTEGER,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        await db.execute(
          'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
          [2]
        );
        console.log('[DB] Migrated schema v1 → v2 (auth_tokens)');
      }

      // v2 → v3: Add session_id to usage, expand usage_sessions for session history
      if (currentVersion >= 1 && currentVersion < 3) {
        try {
          await db.execute('ALTER TABLE usage ADD COLUMN session_id TEXT');
        } catch {
          // Column already exists — ignore
        }

        await db.execute(`
          CREATE TABLE IF NOT EXISTS usage_sessions_new (
            id TEXT PRIMARY KEY,
            start_time INTEGER NOT NULL,
            end_time INTEGER,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            total_cost REAL NOT NULL DEFAULT 0,
            total_input_tokens INTEGER NOT NULL DEFAULT 0,
            total_output_tokens INTEGER NOT NULL DEFAULT 0,
            total_input_cost REAL NOT NULL DEFAULT 0,
            total_output_cost REAL NOT NULL DEFAULT 0,
            entry_count INTEGER NOT NULL DEFAULT 0,
            models TEXT,
            providers TEXT
          )
        `);
        try {
          await db.execute(`
            INSERT OR IGNORE INTO usage_sessions_new (id, start_time, total_tokens, total_cost, entry_count)
            SELECT id, start_time, total_tokens, total_cost, entry_count FROM usage_sessions
          `);
        } catch {
          // Original table might not exist — safe to ignore
        }
        await db.execute('DROP TABLE IF EXISTS usage_sessions');
        await db.execute('ALTER TABLE usage_sessions_new RENAME TO usage_sessions');

        await db.execute(
          'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
          [3]
        );
        console.log('[DB] Migrated schema v2 → v3 (session tracking)');
      }

      // v3 → v4: Add project_connections table
      if (currentVersion >= 1 && currentVersion < 4) {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS project_connections (
            project_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            token TEXT NOT NULL,
            token_label TEXT,
            status TEXT NOT NULL DEFAULT 'disconnected',
            account_info TEXT,
            connected_at TEXT,
            last_tested_at TEXT,
            error TEXT,
            PRIMARY KEY (project_id, provider),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )
        `);
        await db.execute(
          'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
          [4]
        );
        console.log('[DB] Migrated schema v3 → v4 (project_connections)');
      }

      // v4 → v5: Add assistant_accounts_cache table
      if (currentVersion >= 1 && currentVersion < 5) {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS assistant_accounts_cache (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            provider_type TEXT NOT NULL DEFAULT 'email',
            email TEXT NOT NULL,
            display_name TEXT,
            account_label TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            connected_at TEXT,
            synced_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        await db.execute(
          'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
          [5]
        );
        console.log('[DB] Migrated schema v4 → v5 (assistant_accounts_cache)');
      }

      // v5 → v6: Add source + project_name columns to usage table
      if (currentVersion >= 1 && currentVersion < 6) {
        try {
          await db.execute(
            "ALTER TABLE usage ADD COLUMN source TEXT NOT NULL DEFAULT 'project'"
          );
        } catch {
          // Already exists — ignore
        }
        try {
          await db.execute(
            'ALTER TABLE usage ADD COLUMN project_name TEXT'
          );
        } catch {
          // Already exists — ignore
        }
        await db.execute(
          'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
          [6]
        );
        console.log('[DB] Migrated schema v5 → v6 (usage source + project_name)');
      }

      // v6 → v7: Add notifications_cache table
      if (currentVersion >= 1 && currentVersion < 7) {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS notifications_cache (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            source TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT,
            source_meta TEXT NOT NULL DEFAULT '{}',
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          )
        `);
        await db.execute(
          'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
          [7]
        );
        console.log('[DB] Migrated schema v6 → v7 (notifications_cache)');
      }

      // v7 → v8: Add memory system tables
      if (currentVersion >= 1 && currentVersion < 8) {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS user_memory (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            context_text TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        await db.execute(`
          CREATE TABLE IF NOT EXISTS memory_observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'assistant',
            session_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        await db.execute(`
          CREATE TABLE IF NOT EXISTS memory_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            learn_assistant INTEGER NOT NULL DEFAULT 1,
            learn_projects INTEGER NOT NULL DEFAULT 1,
            learn_voice INTEGER NOT NULL DEFAULT 1,
            sync_enabled INTEGER NOT NULL DEFAULT 0
          )
        `);
        await db.execute(
          'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
          [8]
        );
        console.log('[DB] Migrated schema v7 → v8 (memory system)');
      }

      // v8 → v9: Add last_consolidated_at to memory_settings for idle consolidation
      if (currentVersion >= 1 && currentVersion < 9) {
        try {
          await db.execute(
            'ALTER TABLE memory_settings ADD COLUMN last_consolidated_at TEXT'
          );
        } catch {
          // Column already exists — ignore
        }
        await db.execute(
          'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
          [9]
        );
        console.log('[DB] Migrated schema v8 → v9 (memory idle consolidation)');
      }
    }

    // Initialize budget row if it doesn't exist
    const budgetRows = await db.select<{ id: number }[]>(
      'SELECT id FROM usage_budget WHERE id = 1'
    );
    if (budgetRows.length === 0) {
      await db.execute(
        'INSERT INTO usage_budget (id, monthly_budget, alert_enabled, alert_threshold) VALUES (1, NULL, 1, 80)'
      );
    }

    // One-time migration from localStorage
    await migrateFromLocalStorage();

    // One-time cost recalculation (fixes cache double-counting bug in historical data)
    await migrateCostRecalculation();

    console.log('[DB] SQLite initialized successfully');
  } catch (error) {
    console.error('[DB] Failed to initialize database:', error);
    throw error;
  }
}

function getDb(): Database {
  // Recover from Vite HMR module reset (db becomes null but window survives)
  if (!db && window.__omnirunDb) {
    db = window.__omnirunDb;
  }
  if (!db) throw new Error('Database not initialized. Call dbService.init() first.');
  return db;
}

// ─── localStorage Migration (one-time) ──────────────────────

async function migrateFromLocalStorage(): Promise<void> {
  try {
    const migrated = await getSetting('localStorage_migrated');
    if (migrated === 'true') return;

    console.log('[DB] Starting localStorage migration...');
    let migrationHappened = false;

    // 1. Migrate projects
    const projectsRaw = localStorage.getItem('omnirun-projects');
    if (projectsRaw) {
      try {
        const parsed = JSON.parse(projectsRaw);
        const projects = parsed.projects || parsed.state?.projects || [];
        for (const p of projects) {
          await saveProject({ id: p.id, name: p.name, path: p.path });
        }
        migrationHappened = true;
        console.log(`[DB] Migrated ${projects.length} projects`);
      } catch (e) {
        console.warn('[DB] Failed to migrate projects:', e);
      }
    }

    // 2. Migrate settings
    const settingsRaw = localStorage.getItem('omnirun-settings');
    if (settingsRaw) {
      try {
        const settings = JSON.parse(settingsRaw);
        for (const [key, value] of Object.entries(settings)) {
          if (value !== undefined && value !== null) {
            await setSetting(key, JSON.stringify(value));
          }
        }
        migrationHappened = true;
        console.log('[DB] Migrated settings');
      } catch (e) {
        console.warn('[DB] Failed to migrate settings:', e);
      }
    }

    // 3. Migrate chat history (per-project keys)
    const projectsForChats = await getProjects();
    for (const project of projectsForChats) {
      const chatKey = `omnirun_chats_${project.id}`;
      const chatRaw = localStorage.getItem(chatKey);
      if (chatRaw) {
        try {
          const chats = JSON.parse(chatRaw);
          for (const chat of chats) {
            const messages = (chat.messages || []).map((msg: any) => ({
              ...msg,
              timestamp: msg.timestamp,
            }));
            await saveChat({
              id: chat.id,
              projectId: chat.projectId || project.id,
              title: chat.title || 'New Chat',
              messages,
              isPinned: chat.isPinned || false,
              createdAt: chat.createdAt || Date.now(),
              updatedAt: chat.updatedAt || Date.now(),
            });
          }
          console.log(`[DB] Migrated ${chats.length} chats for project ${project.id}`);
        } catch (e) {
          console.warn(`[DB] Failed to migrate chats for ${project.id}:`, e);
        }
        migrationHappened = true;
      }
    }

    // 4. Migrate usage data
    const usageRaw = localStorage.getItem('omnirun_usage');
    if (usageRaw) {
      try {
        const usageData = JSON.parse(usageRaw);
        const entries = usageData.entries || [];
        for (const entry of entries) {
          await recordUsage({
            provider: entry.provider,
            model: entry.model,
            inputTokens: entry.inputTokens || 0,
            outputTokens: entry.outputTokens || 0,
            cacheCreationTokens: entry.cacheCreationTokens || 0,
            cacheReadTokens: entry.cacheReadTokens || 0,
            totalTokens: entry.totalTokens || 0,
            cost: entry.cost || 0,
            inputCost: entry.inputCost || 0,
            outputCost: entry.outputCost || 0,
            taskLabel: entry.taskLabel || null,
            timestamp: entry.timestamp || Date.now(),
          });
        }
        const sessions = usageData.sessions || [];
        for (const session of sessions) {
          await saveUsageSession(session);
        }
        console.log(`[DB] Migrated ${entries.length} usage entries`);
      } catch (e) {
        console.warn('[DB] Failed to migrate usage data:', e);
      }
      migrationHappened = true;
    }

    // 4b. Migrate budget settings
    const budgetRaw = localStorage.getItem('omnirun_usage_budget');
    if (budgetRaw) {
      try {
        const budget = JSON.parse(budgetRaw);
        await saveBudgetSettings(
          budget.monthlyBudget ?? null,
          budget.budgetAlertEnabled ?? true,
          budget.budgetAlertThreshold ?? 80
        );
        console.log('[DB] Migrated budget settings');
      } catch (e) {
        console.warn('[DB] Failed to migrate budget settings:', e);
      }
      migrationHappened = true;
    }

    // 5. Migrate connections
    const connectionsRaw = localStorage.getItem('omnirun_connections');
    if (connectionsRaw) {
      try {
        const connections = JSON.parse(connectionsRaw);
        for (const [provider, conn] of Object.entries(connections)) {
          const c = conn as any;
          await saveConnection({
            provider,
            token: c.token || '',
            tokenLabel: c.tokenLabel || null,
            status: c.status === 'connecting' ? 'disconnected' : (c.status || 'disconnected'),
            accountInfo: c.accountInfo || null,
            connectedAt: c.connectedAt || null,
            lastTestedAt: c.lastTestedAt || null,
            error: c.error || null,
          });
        }
        console.log('[DB] Migrated connections');
      } catch (e) {
        console.warn('[DB] Failed to migrate connections:', e);
      }
      migrationHappened = true;
    }

    // 6. Migrate last project preference
    const lastProject = localStorage.getItem('omnirun-last-project');
    if (lastProject) {
      await setSetting('lastProject', JSON.stringify(lastProject));
      migrationHappened = true;
    }

    await setSetting('localStorage_migrated', 'true');

    if (migrationHappened) {
      localStorage.removeItem('omnirun-projects');
      localStorage.removeItem('omnirun-settings');
      localStorage.removeItem('omnirun_usage');
      localStorage.removeItem('omnirun_usage_budget');
      localStorage.removeItem('omnirun_connections');
      localStorage.removeItem('omnirun-last-project');

      for (const project of projectsForChats) {
        localStorage.removeItem(`omnirun_chats_${project.id}`);
      }

      console.log('[DB] localStorage migration complete — old keys removed');
    } else {
      console.log('[DB] No localStorage data found — fresh install');
    }
  } catch (error) {
    console.error('[DB] Migration error (non-fatal):', error);
  }
}

// ─── Projects ────────────────────────────────────────────────

interface ProjectInput {
  id: string;
  name: string;
  path: string;
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  last_opened: string | null;
  created_at: string;
}

async function getProjects(): Promise<{ id: string; name: string; path: string }[]> {
  const d = getDb();
  const rows = await d.select<ProjectRow[]>(
    'SELECT id, name, path, last_opened, created_at FROM projects ORDER BY last_opened DESC NULLS LAST, created_at DESC'
  );
  return rows.map((r) => ({ id: r.id, name: r.name, path: r.path }));
}

async function saveProject(project: ProjectInput): Promise<void> {
  const d = getDb();
  await d.execute(
    `INSERT OR REPLACE INTO projects (id, name, path, last_opened)
     VALUES (?, ?, ?, datetime('now'))`,
    [project.id, project.name, project.path]
  );
}

async function deleteProject(id: string): Promise<void> {
  const d = getDb();
  await d.execute('DELETE FROM projects WHERE id = ?', [id]);
}

async function updateLastOpened(id: string): Promise<void> {
  const d = getDb();
  await d.execute(
    "UPDATE projects SET last_opened = datetime('now') WHERE id = ?",
    [id]
  );
}

// ─── Chat History ────────────────────────────────────────────

interface ChatInput {
  id: string;
  projectId: string;
  title: string;
  messages: any[];
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
}

interface ChatRow {
  id: string;
  project_id: string;
  title: string;
  messages: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

async function getChatHistory(projectId: string): Promise<ChatInput[]> {
  const d = getDb();
  const rows = await d.select<ChatRow[]>(
    'SELECT * FROM chat_history WHERE project_id = ? ORDER BY pinned DESC, updated_at DESC',
    [projectId]
  );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    messages: JSON.parse(r.messages),
    isPinned: r.pinned === 1,
    createdAt: new Date(r.created_at + 'Z').getTime(),
    updatedAt: new Date(r.updated_at + 'Z').getTime(),
  }));
}

async function saveChat(chat: ChatInput): Promise<void> {
  const d = getDb();
  const createdIso = new Date(chat.createdAt).toISOString().replace('T', ' ').replace('Z', '');
  const updatedIso = new Date(chat.updatedAt).toISOString().replace('T', ' ').replace('Z', '');

  await d.execute(
    `INSERT OR REPLACE INTO chat_history (id, project_id, title, messages, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      chat.id,
      chat.projectId,
      chat.title,
      JSON.stringify(chat.messages),
      chat.isPinned ? 1 : 0,
      createdIso,
      updatedIso,
    ]
  );
}

async function deleteChat(projectId: string, chatId: string): Promise<void> {
  const d = getDb();
  await d.execute(
    'DELETE FROM chat_history WHERE id = ? AND project_id = ?',
    [chatId, projectId]
  );
}

async function updateChatMessages(chatId: string, messages: any[], title?: string): Promise<void> {
  const d = getDb();
  const updatedIso = new Date().toISOString().replace('T', ' ').replace('Z', '');

  if (title) {
    await d.execute(
      "UPDATE chat_history SET messages = ?, title = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(messages), title, updatedIso, chatId]
    );
  } else {
    await d.execute(
      "UPDATE chat_history SET messages = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(messages), updatedIso, chatId]
    );
  }
}

async function updateChatTitle(chatId: string, title: string): Promise<void> {
  const d = getDb();
  await d.execute(
    'UPDATE chat_history SET title = ? WHERE id = ?',
    [title, chatId]
  );
}

async function updateChatPinned(chatId: string, pinned: boolean): Promise<void> {
  const d = getDb();
  await d.execute(
    'UPDATE chat_history SET pinned = ? WHERE id = ?',
    [pinned ? 1 : 0, chatId]
  );
}

// ─── Settings ────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const d = getDb();
  const rows = await d.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return rows.length > 0 ? rows[0].value : null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const d = getDb();
  await d.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value]
  );
}

async function getAllSettings(): Promise<Record<string, string>> {
  const d = getDb();
  const rows = await d.select<{ key: string; value: string }[]>(
    'SELECT key, value FROM settings'
  );
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

async function deleteSetting(key: string): Promise<void> {
  const d = getDb();
  await d.execute('DELETE FROM settings WHERE key = ?', [key]);
}

// ─── Usage Tracking ──────────────────────────────────────────

interface UsageInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
  inputCost: number;
  outputCost: number;
  taskLabel: string | null;
  timestamp: number;
  sessionId?: string | null;
  source?: 'project' | 'assistant'; // defaults to 'project'
  projectName?: string | null;      // project name when source='project'
}

async function recordUsage(entry: UsageInput): Promise<void> {
  const d = getDb();
  const ts = new Date(entry.timestamp).toISOString().replace('T', ' ').replace('Z', '');

  await d.execute(
    `INSERT INTO usage
       (provider, model, input_tokens, output_tokens, cache_creation_tokens,
        cache_read_tokens, total_tokens, cost, input_cost, output_cost,
        task_label, session_id, timestamp, source, project_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.provider,
      entry.model,
      entry.inputTokens,
      entry.outputTokens,
      entry.cacheCreationTokens,
      entry.cacheReadTokens,
      entry.totalTokens,
      entry.cost,
      entry.inputCost,
      entry.outputCost,
      entry.taskLabel,
      entry.sessionId || null,
      ts,
      entry.source ?? 'project',
      entry.projectName ?? null,
    ]
  );
}

// ─── Usage filter helper ──────────────────────────────────────

interface UsageFilter {
  source?: 'project' | 'assistant';
  projectName?: string;
}

// Builds optional WHERE fragment + params array for source/project_name filtering.
// baseParams is the array of params that come BEFORE the filter conditions.
function buildFilterClause(
  filter: UsageFilter | undefined,
  baseParams: any[]
): { clause: string; params: any[] } {
  const params = [...baseParams];
  let clause = '';

  if (filter?.source) {
    clause += ' AND source = ?';
    params.push(filter.source);
  }
  if (filter?.projectName) {
    clause += ' AND project_name = ?';
    params.push(filter.projectName);
  }

  return { clause, params };
}

interface UsageAggregateRow {
  total_tokens: number;
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_input_cost: number;
  total_output_cost: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
}

async function getMonthlyUsage(filter?: UsageFilter): Promise<{
  tokens: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}> {
  const d = getDb();
  const now = new Date();
  const startOfMonthUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().replace('T', ' ').replace('Z', '');

  const { clause, params } = buildFilterClause(filter, [startOfMonthUTC]);

  const rows = await d.select<UsageAggregateRow[]>(
    `SELECT
       COALESCE(SUM(total_tokens), 0) as total_tokens,
       COALESCE(SUM(cost), 0) as total_cost,
       COALESCE(SUM(input_tokens), 0) as total_input_tokens,
       COALESCE(SUM(output_tokens), 0) as total_output_tokens,
       COALESCE(SUM(input_cost), 0) as total_input_cost,
       COALESCE(SUM(output_cost), 0) as total_output_cost,
       COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
       COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens
     FROM usage
     WHERE timestamp >= ?${clause}`,
    params
  );

  const r = rows[0];
  return {
    tokens: r.total_tokens,
    cost: r.total_cost,
    inputTokens: r.total_input_tokens,
    outputTokens: r.total_output_tokens,
    inputCost: r.total_input_cost,
    outputCost: r.total_output_cost,
    cacheReadTokens: r.total_cache_read_tokens,
    cacheCreationTokens: r.total_cache_creation_tokens,
  };
}

async function getAllTimeUsage(filter?: UsageFilter): Promise<{
  tokens: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}> {
  const d = getDb();

  const { clause, params } = buildFilterClause(filter, []);
  const whereClause = clause ? `WHERE 1=1${clause}` : '';

  const rows = await d.select<UsageAggregateRow[]>(
    `SELECT
       COALESCE(SUM(total_tokens), 0) as total_tokens,
       COALESCE(SUM(cost), 0) as total_cost,
       COALESCE(SUM(input_tokens), 0) as total_input_tokens,
       COALESCE(SUM(output_tokens), 0) as total_output_tokens,
       COALESCE(SUM(input_cost), 0) as total_input_cost,
       COALESCE(SUM(output_cost), 0) as total_output_cost,
       COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
       COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens
     FROM usage ${whereClause}`,
    params
  );

  const r = rows[0];
  return {
    tokens: r.total_tokens,
    cost: r.total_cost,
    inputTokens: r.total_input_tokens,
    outputTokens: r.total_output_tokens,
    inputCost: r.total_input_cost,
    outputCost: r.total_output_cost,
    cacheReadTokens: r.total_cache_read_tokens,
    cacheCreationTokens: r.total_cache_creation_tokens,
  };
}


// Flexible filtered aggregate for any date range — used by UsageSettings
// to power all timeframe tabs when a source/project filter is active.
async function getUsageInRange(options?: {
  fromDate?: number;
  toDate?: number;
  filter?: UsageFilter;
}): Promise<{
  tokens: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}> {
  const d = getDb();
  const params: any[] = [];
  const conditions: string[] = [];

  if (options?.fromDate) {
    const fromIso = new Date(options.fromDate).toISOString().replace('T', ' ').replace('Z', '');
    conditions.push('timestamp >= ?');
    params.push(fromIso);
  }
  if (options?.toDate) {
    const toIso = new Date(options.toDate).toISOString().replace('T', ' ').replace('Z', '');
    conditions.push('timestamp <= ?');
    params.push(toIso);
  }
  if (options?.filter?.source) {
    conditions.push('source = ?');
    params.push(options.filter.source);
  }
  if (options?.filter?.projectName) {
    conditions.push('project_name = ?');
    params.push(options.filter.projectName);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const rows = await d.select<UsageAggregateRow[]>(
    `SELECT
       COALESCE(SUM(total_tokens), 0) as total_tokens,
       COALESCE(SUM(cost), 0) as total_cost,
       COALESCE(SUM(input_tokens), 0) as total_input_tokens,
       COALESCE(SUM(output_tokens), 0) as total_output_tokens,
       COALESCE(SUM(input_cost), 0) as total_input_cost,
       COALESCE(SUM(output_cost), 0) as total_output_cost,
       COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
       COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens
     FROM usage ${where}`,
    params
  );

  const r = rows[0];
  return {
    tokens: r.total_tokens,
    cost: r.total_cost,
    inputTokens: r.total_input_tokens,
    outputTokens: r.total_output_tokens,
    inputCost: r.total_input_cost,
    outputCost: r.total_output_cost,
    cacheReadTokens: r.total_cache_read_tokens,
    cacheCreationTokens: r.total_cache_creation_tokens,
  };
}

// Returns distinct project names that have usage entries, sorted A→Z.
// Used to populate the project dropdown in UsageSettings.
async function getProjectNamesFromUsage(): Promise<string[]> {
  const d = getDb();
  const rows = await d.select<{ project_name: string }[]>(
    `SELECT DISTINCT project_name
     FROM usage
     WHERE source = 'project' AND project_name IS NOT NULL AND project_name != ''
     ORDER BY project_name ASC`
  );
  return rows.map((r) => r.project_name);
}

async function getAllUsageEntries(): Promise<UsageInput[]> {
  const d = getDb();
  const rows = await d.select<DBUsageEntry[]>(
    'SELECT * FROM usage ORDER BY timestamp DESC'
  );
  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    cacheReadTokens: r.cache_read_tokens,
    totalTokens: r.total_tokens,
    cost: r.cost,
    inputCost: r.input_cost,
    outputCost: r.output_cost,
    taskLabel: r.task_label,
    timestamp: new Date(r.timestamp + 'Z').getTime(),
    source: r.source as 'project' | 'assistant',
    projectName: r.project_name,
  }));
}

async function clearAllUsage(): Promise<void> {
  const d = getDb();
  await d.execute('DELETE FROM usage');
  await d.execute('DELETE FROM usage_sessions');
  await d.execute(
    'UPDATE usage_budget SET monthly_budget = NULL, alert_enabled = 1, alert_threshold = 80 WHERE id = 1'
  );
}

// ─── Usage Budget ────────────────────────────────────────────

async function getBudgetSettings(): Promise<{
  monthlyBudget: number | null;
  budgetAlertEnabled: boolean;
  budgetAlertThreshold: number;
}> {
  const d = getDb();
  const rows = await d.select<{
    monthly_budget: number | null;
    alert_enabled: number;
    alert_threshold: number;
  }[]>('SELECT monthly_budget, alert_enabled, alert_threshold FROM usage_budget WHERE id = 1');

  if (rows.length === 0) {
    return { monthlyBudget: null, budgetAlertEnabled: true, budgetAlertThreshold: 80 };
  }

  return {
    monthlyBudget: rows[0].monthly_budget,
    budgetAlertEnabled: rows[0].alert_enabled === 1,
    budgetAlertThreshold: rows[0].alert_threshold,
  };
}

async function saveBudgetSettings(
  monthlyBudget: number | null,
  alertEnabled: boolean,
  alertThreshold: number
): Promise<void> {
  const d = getDb();
  await d.execute(
    'UPDATE usage_budget SET monthly_budget = ?, alert_enabled = ?, alert_threshold = ? WHERE id = 1',
    [monthlyBudget, alertEnabled ? 1 : 0, alertThreshold]
  );
}

// ─── Usage Sessions ──────────────────────────────────────────

async function saveUsageSession(session: {
  id: string;
  startTime: number;
  endTime: number;
  totalTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalInputCost: number;
  totalOutputCost: number;
  totalCacheReadTokens?: number;
  totalCacheCreationTokens?: number;
  entryCount: number;
  models: string[];
  providers: string[];
}): Promise<void> {
  const d = getDb();
  await d.execute(
    `INSERT OR REPLACE INTO usage_sessions
     (id, start_time, end_time, total_tokens, total_cost, total_input_tokens, total_output_tokens,
      total_input_cost, total_output_cost, entry_count, models, providers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.startTime,
      session.endTime,
      session.totalTokens,
      session.totalCost,
      session.totalInputTokens,
      session.totalOutputTokens,
      session.totalInputCost,
      session.totalOutputCost,
      session.entryCount,
      JSON.stringify(session.models),
      JSON.stringify(session.providers),
    ]
  );
}

// ─── Session History Queries ────────────────────────────────

interface DerivedSessionRow {
  group_key: string;
  min_ts: string;
  max_ts: string;
  total_tokens: number;
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_input_cost: number;
  total_output_cost: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  entry_count: number;
  models_csv: string;
  providers_csv: string;
}

async function getSessionHistory(options?: {
  fromDate?: number;
  toDate?: number;
  filter?: UsageFilter;
}): Promise<Array<{
  id: string;
  startTime: number;
  endTime: number;
  totalTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalInputCost: number;
  totalOutputCost: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  entryCount: number;
  models: string[];
  providers: string[];
}>> {
  const d = getDb();

  let whereClause = '';
  const params: any[] = [];

  if (options?.fromDate) {
    const fromIso = new Date(options.fromDate).toISOString().replace('T', ' ').replace('Z', '');
    whereClause += (whereClause ? ' AND ' : ' WHERE ') + 'timestamp >= ?';
    params.push(fromIso);
  }
  if (options?.toDate) {
    const toIso = new Date(options.toDate).toISOString().replace('T', ' ').replace('Z', '');
    whereClause += (whereClause ? ' AND ' : ' WHERE ') + 'timestamp <= ?';
    params.push(toIso);
  }
  if (options?.filter?.source) {
    whereClause += (whereClause ? ' AND ' : ' WHERE ') + 'source = ?';
    params.push(options.filter.source);
  }
  if (options?.filter?.projectName) {
    whereClause += (whereClause ? ' AND ' : ' WHERE ') + 'project_name = ?';
    params.push(options.filter.projectName);
  }

  const rows = await d.select<DerivedSessionRow[]>(
    `SELECT
       COALESCE(session_id, 'date_' || date(timestamp)) as group_key,
       MIN(timestamp) as min_ts,
       MAX(timestamp) as max_ts,
       COALESCE(SUM(total_tokens), 0) as total_tokens,
       COALESCE(SUM(cost), 0) as total_cost,
       COALESCE(SUM(input_tokens), 0) as total_input_tokens,
       COALESCE(SUM(output_tokens), 0) as total_output_tokens,
       COALESCE(SUM(input_cost), 0) as total_input_cost,
       COALESCE(SUM(output_cost), 0) as total_output_cost,
       COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
       COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens,
       COUNT(*) as entry_count,
       GROUP_CONCAT(DISTINCT model) as models_csv,
       GROUP_CONCAT(DISTINCT provider) as providers_csv
     FROM usage
     ${whereClause}
     GROUP BY group_key
     ORDER BY min_ts DESC
     LIMIT 100`,
    params
  );

  return rows.map((r) => ({
    id: r.group_key,
    startTime: new Date(r.min_ts + 'Z').getTime(),
    endTime: new Date(r.max_ts + 'Z').getTime(),
    totalTokens: r.total_tokens,
    totalCost: r.total_cost,
    totalInputTokens: r.total_input_tokens,
    totalOutputTokens: r.total_output_tokens,
    totalInputCost: r.total_input_cost,
    totalOutputCost: r.total_output_cost,
    totalCacheReadTokens: r.total_cache_read_tokens,
    totalCacheCreationTokens: r.total_cache_creation_tokens,
    entryCount: r.entry_count,
    models: r.models_csv ? r.models_csv.split(',') : [],
    providers: r.providers_csv ? r.providers_csv.split(',') : [],
  }));
}

async function getSessionDetail(groupKey: string): Promise<{
  summary: {
    id: string;
    startTime: number;
    endTime: number;
    totalTokens: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalInputCost: number;
    totalOutputCost: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
    entryCount: number;
    models: string[];
    providers: string[];
  };
  entries: Array<{
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    cost: number;
    inputCost: number;
    outputCost: number;
    taskLabel: string | null;
    timestamp: number;
  }>;
} | null> {
  const d = getDb();

  let entryRows: DBUsageEntry[];

  if (groupKey.startsWith('date_')) {
    const dateStr = groupKey.replace('date_', '');
    entryRows = await d.select<DBUsageEntry[]>(
      `SELECT * FROM usage
       WHERE session_id IS NULL AND date(timestamp) = ?
       ORDER BY timestamp ASC`,
      [dateStr]
    );
  } else {
    entryRows = await d.select<DBUsageEntry[]>(
      'SELECT * FROM usage WHERE session_id = ? ORDER BY timestamp ASC',
      [groupKey]
    );
  }

  if (entryRows.length === 0) return null;

  const entries = entryRows.map((r) => ({
    provider: r.provider,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    cacheReadTokens: r.cache_read_tokens,
    totalTokens: r.total_tokens,
    cost: r.cost,
    inputCost: r.input_cost,
    outputCost: r.output_cost,
    taskLabel: r.task_label,
    timestamp: new Date(r.timestamp + 'Z').getTime(),
  }));

  const models = [...new Set(entries.map(e => e.model))];
  const providers = [...new Set(entries.map(e => e.provider))];

  const summary = {
    id: groupKey,
    startTime: entries[0].timestamp,
    endTime: entries[entries.length - 1].timestamp,
    totalTokens: entries.reduce((s, e) => s + e.totalTokens, 0),
    totalCost: entries.reduce((s, e) => s + e.cost, 0),
    totalInputTokens: entries.reduce((s, e) => s + e.inputTokens, 0),
    totalOutputTokens: entries.reduce((s, e) => s + e.outputTokens, 0),
    totalInputCost: entries.reduce((s, e) => s + e.inputCost, 0),
    totalOutputCost: entries.reduce((s, e) => s + e.outputCost, 0),
    totalCacheReadTokens: entries.reduce((s, e) => s + e.cacheReadTokens, 0),
    totalCacheCreationTokens: entries.reduce((s, e) => s + e.cacheCreationTokens, 0),
    entryCount: entries.length,
    models,
    providers,
  };

  return { summary, entries };
}

// ─── Cost Recalculation Migration ───────────────────────────

const MIGRATION_PRICING: Record<string, { input: number; output: number; cacheCreation?: number; cacheRead?: number }> = {
  "claude-opus": { input: 15, output: 75, cacheCreation: 18.75, cacheRead: 1.50 },
  "claude-sonnet": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.30 },
  "claude-haiku": { input: 0.25, output: 1.25, cacheCreation: 0.30, cacheRead: 0.03 },
  "deepseek-chat": { input: 0.28, output: 0.42, cacheRead: 0.028 },
  "deepseek-reasoner": { input: 0.28, output: 0.42, cacheRead: 0.028 },
};

function getMigrationPricing(model: string, provider: string) {
  const m = model.toLowerCase();
  for (const [key, pricing] of Object.entries(MIGRATION_PRICING)) {
    if (m.includes(key)) return pricing;
  }
  const fallbacks: Record<string, { input: number; output: number }> = {
    openai: { input: 2.50, output: 10 },
    anthropic: { input: 3, output: 15 },
    google: { input: 0.10, output: 0.40 },
    groq: { input: 0.59, output: 0.79 },
    deepseek: { input: 0.28, output: 0.42 },
  };
  return fallbacks[provider] || { input: 3, output: 15 };
}

async function migrateCostRecalculation(): Promise<void> {
  const d = getDb();

  const migrated = await getSetting('cost_recalc_v1');
  if (migrated === 'done') return;

  console.log('[DB] Running cost recalculation migration...');

  const rows = await d.select<{
    id: number;
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  }[]>(
    'SELECT id, provider, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens FROM usage WHERE cache_read_tokens > 0 OR cache_creation_tokens > 0'
  );

  if (rows.length === 0) {
    await setSetting('cost_recalc_v1', 'done');
    console.log('[DB] Cost recalculation: no rows to fix');
    return;
  }

  let fixedCount = 0;
  for (const row of rows) {
    const pricing = getMigrationPricing(row.model, row.provider);

    const correctedInputTokens = row.input_tokens - row.cache_read_tokens;
    const correctedTotalTokens = correctedInputTokens + row.output_tokens;

    const apiInputTokens = correctedInputTokens - row.cache_creation_tokens;
    const regularInputTokens = Math.max(0, apiInputTokens - row.cache_read_tokens);

    const regularInputCost = (regularInputTokens / 1_000_000) * pricing.input;
    const cacheReadCost = pricing.cacheRead
      ? (row.cache_read_tokens / 1_000_000) * pricing.cacheRead
      : 0;
    const cacheCreateCost = pricing.cacheCreation
      ? (row.cache_creation_tokens / 1_000_000) * pricing.cacheCreation
      : 0;
    const outputCost = (row.output_tokens / 1_000_000) * pricing.output;

    const totalInputCost = regularInputCost + cacheReadCost + cacheCreateCost;
    const totalCost = totalInputCost + outputCost;

    await d.execute(
      `UPDATE usage SET input_tokens = ?, total_tokens = ?, cost = ?, input_cost = ?, output_cost = ? WHERE id = ?`,
      [correctedInputTokens, correctedTotalTokens, totalCost, totalInputCost, outputCost, row.id]
    );
    fixedCount++;
  }

  await setSetting('cost_recalc_v1', 'done');
  console.log(`[DB] Cost recalculation: fixed ${fixedCount} rows`);
}

// ─── Connections ─────────────────────────────────────────────

interface ConnectionInput {
  provider: string;
  token: string;
  tokenLabel: string | null;
  status: string;
  accountInfo: any | null;
  connectedAt: number | null;
  lastTestedAt: number | null;
  error: string | null;
}

async function getConnections(): Promise<Record<string, any>> {
  const d = getDb();
  const rows = await d.select<DBConnection[]>('SELECT * FROM connections');

  const result: Record<string, any> = {};
  for (const row of rows) {
    result[row.provider] = {
      provider: row.provider,
      token: row.token,
      tokenLabel: row.token_label,
      status: row.status,
      accountInfo: row.account_info ? JSON.parse(row.account_info) : undefined,
      connectedAt: row.connected_at ? new Date(row.connected_at + 'Z').getTime() : undefined,
      lastTestedAt: row.last_tested_at ? new Date(row.last_tested_at + 'Z').getTime() : undefined,
      error: row.error || undefined,
    };
  }
  return result;
}

async function saveConnection(conn: ConnectionInput): Promise<void> {
  const d = getDb();
  const connectedIso = conn.connectedAt
    ? new Date(conn.connectedAt).toISOString().replace('T', ' ').replace('Z', '')
    : null;
  const testedIso = conn.lastTestedAt
    ? new Date(conn.lastTestedAt).toISOString().replace('T', ' ').replace('Z', '')
    : null;

  await d.execute(
    `INSERT OR REPLACE INTO connections (provider, token, token_label, status, account_info, connected_at, last_tested_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conn.provider,
      conn.token,
      conn.tokenLabel,
      conn.status,
      conn.accountInfo ? JSON.stringify(conn.accountInfo) : null,
      connectedIso,
      testedIso,
      conn.error,
    ]
  );
}

async function deleteConnection(provider: string): Promise<void> {
  const d = getDb();
  await d.execute('DELETE FROM connections WHERE provider = ?', [provider]);
}

async function updateConnectionStatus(
  provider: string,
  status: string,
  error?: string | null
): Promise<void> {
  const d = getDb();
  await d.execute(
    'UPDATE connections SET status = ?, error = ? WHERE provider = ?',
    [status, error || null, provider]
  );
}

// ─── Project Connections ──────────────────────────────────────

interface DBProjectConnection {
  project_id: string;
  provider: string;
  token: string;
  token_label: string | null;
  status: string;
  account_info: string | null;
  connected_at: string | null;
  last_tested_at: string | null;
  error: string | null;
}

interface ProjectConnectionInput {
  projectId: string;
  provider: string;
  token: string;
  tokenLabel: string | null;
  status: string;
  accountInfo: any | null;
  connectedAt: number | null;
  lastTestedAt: number | null;
  error: string | null;
}

async function getProjectConnections(projectId: string): Promise<Record<string, any>> {
  const d = getDb();
  const rows = await d.select<DBProjectConnection[]>(
    'SELECT * FROM project_connections WHERE project_id = ?',
    [projectId]
  );

  const result: Record<string, any> = {};
  for (const row of rows) {
    result[row.provider] = {
      provider: row.provider,
      token: row.token,
      tokenLabel: row.token_label,
      status: row.status,
      accountInfo: row.account_info ? JSON.parse(row.account_info) : undefined,
      connectedAt: row.connected_at ? new Date(row.connected_at + 'Z').getTime() : undefined,
      lastTestedAt: row.last_tested_at ? new Date(row.last_tested_at + 'Z').getTime() : undefined,
      error: row.error || undefined,
    };
  }
  return result;
}

async function saveProjectConnection(conn: ProjectConnectionInput): Promise<void> {
  const d = getDb();
  const connectedIso = conn.connectedAt
    ? new Date(conn.connectedAt).toISOString().replace('T', ' ').replace('Z', '')
    : null;
  const testedIso = conn.lastTestedAt
    ? new Date(conn.lastTestedAt).toISOString().replace('T', ' ').replace('Z', '')
    : null;

  await d.execute(
    `INSERT OR REPLACE INTO project_connections
       (project_id, provider, token, token_label, status, account_info, connected_at, last_tested_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conn.projectId,
      conn.provider,
      conn.token,
      conn.tokenLabel,
      conn.status,
      conn.accountInfo ? JSON.stringify(conn.accountInfo) : null,
      connectedIso,
      testedIso,
      conn.error,
    ]
  );
}

async function deleteProjectConnection(projectId: string, provider: string): Promise<void> {
  const d = getDb();
  await d.execute(
    'DELETE FROM project_connections WHERE project_id = ? AND provider = ?',
    [projectId, provider]
  );
}

async function updateProjectConnectionStatus(
  projectId: string,
  provider: string,
  status: string,
  error?: string | null
): Promise<void> {
  const d = getDb();
  await d.execute(
    'UPDATE project_connections SET status = ?, error = ? WHERE project_id = ? AND provider = ?',
    [status, error || null, projectId, provider]
  );
}

// ─── Assistant Accounts Cache ─────────────────────────────────
// Local cache of connected personal integrations (Gmail, Outlook, etc.)
// Source of truth is Supabase assistant_email_accounts table.
// This cache is synced on Assistant section open so the UI loads instantly.

export interface AssistantAccount {
  id: string;           // matches Supabase UUID
  userId: string;
  provider: string;     // 'gmail' | 'outlook' | future providers
  providerType: string; // 'email' | 'calendar' | 'messaging' | 'other'
  email: string;
  displayName: string | null;
  accountLabel: string | null; // user-given nickname
  isActive: boolean;
  connectedAt: string | null;
  syncedAt: string;
}

async function getAssistantAccounts(userId: string): Promise<AssistantAccount[]> {
  const d = getDb();
  const rows = await d.select<DBAssistantAccount[]>(
    'SELECT * FROM assistant_accounts_cache WHERE user_id = ? AND is_active = 1 ORDER BY connected_at ASC',
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    providerType: r.provider_type,
    email: r.email,
    displayName: r.display_name,
    accountLabel: r.account_label,
    isActive: r.is_active === 1,
    connectedAt: r.connected_at,
    syncedAt: r.synced_at,
  }));
}

async function upsertAssistantAccount(account: AssistantAccount): Promise<void> {
  const d = getDb();
  const syncedIso = new Date().toISOString().replace('T', ' ').replace('Z', '');
  await d.execute(
    `INSERT OR REPLACE INTO assistant_accounts_cache
       (id, user_id, provider, provider_type, email, display_name, account_label, is_active, connected_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      account.id,
      account.userId,
      account.provider,
      account.providerType,
      account.email,
      account.displayName,
      account.accountLabel,
      account.isActive ? 1 : 0,
      account.connectedAt,
      syncedIso,
    ]
  );
}

async function updateAssistantAccountLabel(id: string, label: string): Promise<void> {
  const d = getDb();
  await d.execute(
    'UPDATE assistant_accounts_cache SET account_label = ? WHERE id = ?',
    [label, id]
  );
}

async function deleteAssistantAccount(id: string): Promise<void> {
  const d = getDb();
  await d.execute(
    'DELETE FROM assistant_accounts_cache WHERE id = ?',
    [id]
  );
}

async function clearAssistantAccountsForUser(userId: string): Promise<void> {
  const d = getDb();
  await d.execute(
    'DELETE FROM assistant_accounts_cache WHERE user_id = ?',
    [userId]
  );
}

// ─── Memory System ────────────────────────────────────────────
// user_memory: stores the user context file (single row, id=1)
// memory_observations: raw observations extracted after conversations
// memory_settings: per-toggle on/off + sync preference

async function getUserMemory(): Promise<DBUserMemory | null> {
  const d = getDb();
  const rows = await d.select<DBUserMemory[]>(
    'SELECT * FROM user_memory WHERE id = 1'
  );
  return rows.length > 0 ? rows[0] : null;
}

async function saveUserMemory(contextText: string): Promise<void> {
  const d = getDb();
  await d.execute(
    `INSERT OR REPLACE INTO user_memory (id, context_text, updated_at)
     VALUES (1, ?, datetime('now'))`,
    [contextText]
  );
}

async function addMemoryObservation(obs: {
  content: string;
  source: string;
  session_id: string | null;
}): Promise<void> {
  const d = getDb();
  await d.execute(
    `INSERT INTO memory_observations (content, source, session_id, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [obs.content, obs.source, obs.session_id]
  );
}

async function getRecentMemoryObservations(limit: number): Promise<DBMemoryObservation[]> {
  const d = getDb();
  return d.select<DBMemoryObservation[]>(
    'SELECT * FROM memory_observations ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
}

async function getMemoryObservationCount(): Promise<number> {
  const d = getDb();
  const rows = await d.select<{ cnt: number }[]>(
    'SELECT COUNT(*) as cnt FROM memory_observations'
  );
  return rows[0]?.cnt ?? 0;
}

async function clearProcessedObservations(): Promise<void> {
  const d = getDb();
  await d.execute('DELETE FROM memory_observations');
}

async function clearAllMemoryObservations(): Promise<void> {
  const d = getDb();
  await d.execute('DELETE FROM memory_observations');
}

async function getMemorySettings(): Promise<{
  learn_assistant: number;
  learn_projects: number;
  learn_voice: number;
  sync_enabled: number;
} | null> {
  const d = getDb();
  const rows = await d.select<DBMemorySettings[]>(
    'SELECT * FROM memory_settings WHERE id = 1'
  );
  return rows.length > 0 ? rows[0] : null;
}

async function saveMemorySettings(settings: {
  learn_assistant: number;
  learn_projects: number;
  learn_voice: number;
  sync_enabled: number;
}): Promise<void> {
  const d = getDb();
  await d.execute(
    `INSERT OR REPLACE INTO memory_settings (id, learn_assistant, learn_projects, learn_voice, sync_enabled)
     VALUES (1, ?, ?, ?, ?)`,
    [settings.learn_assistant, settings.learn_projects, settings.learn_voice, settings.sync_enabled]
  );
}

async function getLastConsolidatedAt(): Promise<string | null> {
  const d = getDb();
  const rows = await d.select<{ last_consolidated_at: string | null }[]>(
    'SELECT last_consolidated_at FROM memory_settings WHERE id = 1'
  );
  return rows.length > 0 ? rows[0].last_consolidated_at : null;
}

async function setLastConsolidatedAt(): Promise<void> {
  const d = getDb();
  // Ensure the row exists first (upsert-safe)
  await d.execute(
    `INSERT OR IGNORE INTO memory_settings (id) VALUES (1)`
  );
  await d.execute(
    `UPDATE memory_settings SET last_consolidated_at = datetime('now') WHERE id = 1`
  );
}

// ─── Notifications Cache ──────────────────────────────────────
// Local cache of unread notifications from watching agents.
// Source of truth is Supabase assistant_notifications table.
// Only unread notifications are cached — read ones are removed.

export interface CachedNotification {
  id: string;
  userId: string;
  source: string;
  title: string;
  body: string | null;
  sourceMeta: Record<string, any>;
  isRead: boolean;
  createdAt: string;
}

async function getUnreadNotifications(userId: string): Promise<CachedNotification[]> {
  const d = getDb();
  const rows = await d.select<DBNotification[]>(
    'SELECT * FROM notifications_cache WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC',
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    source: r.source,
    title: r.title,
    body: r.body,
    sourceMeta: r.source_meta ? JSON.parse(r.source_meta) : {},
    isRead: r.is_read === 1,
    createdAt: r.created_at,
  }));
}

async function cacheNotification(n: CachedNotification): Promise<void> {
  const d = getDb();
  await d.execute(
    `INSERT OR REPLACE INTO notifications_cache
       (id, user_id, source, title, body, source_meta, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      n.id,
      n.userId,
      n.source,
      n.title,
      n.body,
      JSON.stringify(n.sourceMeta),
      n.isRead ? 1 : 0,
      n.createdAt,
    ]
  );
}

async function deleteNotification(id: string): Promise<void> {
  const d = getDb();
  await d.execute('DELETE FROM notifications_cache WHERE id = ?', [id]);
}

async function clearNotificationsForUser(userId: string): Promise<void> {
  const d = getDb();
  await d.execute('DELETE FROM notifications_cache WHERE user_id = ?', [userId]);
}

// ─── Last Project ────────────────────────────────────────────

async function getLastProjectId(): Promise<string | null> {
  const raw = await getSetting('lastProject');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function setLastProjectId(projectId: string): Promise<void> {
  await setSetting('lastProject', JSON.stringify(projectId));
}

// ─── Auth Tokens (Supabase session persistence) ────────────

interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
}

async function loadAuthTokens(): Promise<AuthTokens | null> {
  const d = getDb();
  const rows = await d.select<{
    access_token: string;
    refresh_token: string;
    expires_at: number | null;
  }[]>('SELECT access_token, refresh_token, expires_at FROM auth_tokens WHERE id = 1');

  if (rows.length === 0) return null;

  return {
    access_token: rows[0].access_token,
    refresh_token: rows[0].refresh_token,
    expires_at: rows[0].expires_at,
  };
}

async function saveAuthTokens(tokens: AuthTokens): Promise<void> {
  const d = getDb();
  await d.execute(
    `INSERT OR REPLACE INTO auth_tokens (id, access_token, refresh_token, expires_at, updated_at)
     VALUES (1, ?, ?, ?, datetime('now'))`,
    [tokens.access_token, tokens.refresh_token, tokens.expires_at]
  );
}

async function clearAuthTokens(): Promise<void> {
  const d = getDb();
  await d.execute('DELETE FROM auth_tokens WHERE id = 1');
}

// ─── Export ──────────────────────────────────────────────────

export const dbService = {
  // Init
  init,

  // Projects
  getProjects,
  saveProject,
  deleteProject,
  updateLastOpened,

  // Chat history
  getChatHistory,
  saveChat,
  deleteChat,
  updateChatMessages,
  updateChatTitle,
  updateChatPinned,

  // Settings
  getSetting,
  setSetting,
  getAllSettings,
  deleteSetting,

  // Usage
  recordUsage,
  getMonthlyUsage,
  getAllTimeUsage,
  getAllUsageEntries,
  clearAllUsage,
  migrateCostRecalculation,
  getUsageInRange,
  getProjectNamesFromUsage,

  // Usage budget
  getBudgetSettings,
  saveBudgetSettings,

  // Usage sessions
  saveUsageSession,
  getSessionHistory,
  getSessionDetail,

  // Connections
  getConnections,
  saveConnection,
  deleteConnection,
  updateConnectionStatus,

  // Project Connections
  getProjectConnections,
  saveProjectConnection,
  deleteProjectConnection,
  updateProjectConnectionStatus,

  // Assistant accounts cache
  getAssistantAccounts,
  upsertAssistantAccount,
  updateAssistantAccountLabel,
  deleteAssistantAccount,
  clearAssistantAccountsForUser,

  // Notifications cache
  getUnreadNotifications,
  cacheNotification,
  deleteNotification,
  clearNotificationsForUser,

  // Memory system
  getUserMemory,
  saveUserMemory,
  addMemoryObservation,
  getRecentMemoryObservations,
  getMemoryObservationCount,
  clearProcessedObservations,
  clearAllMemoryObservations,
  getMemorySettings,
  saveMemorySettings,
  getLastConsolidatedAt,
  setLastConsolidatedAt,

  // Last project
  getLastProjectId,
  setLastProjectId,

  // Auth tokens (Supabase session)
  loadAuthTokens,
  saveAuthTokens,
  clearAuthTokens,
};