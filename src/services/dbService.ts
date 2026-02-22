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
  timestamp: string;
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

// ─── Database Instance ───────────────────────────────────────

let db: Database | null = null;

const CURRENT_SCHEMA_VERSION = 2;

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
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
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
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    entry_count INTEGER NOT NULL DEFAULT 0
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
`;

// ─── Initialization ──────────────────────────────────────────

async function init(): Promise<void> {
  if (db) return; // Already initialized

  try {
    db = await Database.load('sqlite:mydevify.db');

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
      // Run any future migrations here based on currentVersion
      // For now, just set the version
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

    console.log('[DB] SQLite initialized successfully');
  } catch (error) {
    console.error('[DB] Failed to initialize database:', error);
    throw error;
  }
}

function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call dbService.init() first.');
  return db;
}

// ─── localStorage Migration (one-time) ──────────────────────

async function migrateFromLocalStorage(): Promise<void> {
  try {
    // Check if migration was already done
    const migrated = await getSetting('localStorage_migrated');
    if (migrated === 'true') return;

    console.log('[DB] Starting localStorage migration...');
    let migrationHappened = false;

    // 1. Migrate projects
    const projectsRaw = localStorage.getItem('mydevify-projects');
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
    const settingsRaw = localStorage.getItem('mydevify-settings');
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
      const chatKey = `mydevify_chats_${project.id}`;
      const chatRaw = localStorage.getItem(chatKey);
      if (chatRaw) {
        try {
          const chats = JSON.parse(chatRaw);
          for (const chat of chats) {
            // Restore Date objects in messages before storing
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
    const usageRaw = localStorage.getItem('mydevify_usage');
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
        // Migrate session summaries
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
    const budgetRaw = localStorage.getItem('mydevify_usage_budget');
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
    const connectionsRaw = localStorage.getItem('mydevify_connections');
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
    const lastProject = localStorage.getItem('mydevify-last-project');
    if (lastProject) {
      await setSetting('lastProject', JSON.stringify(lastProject));
      migrationHappened = true;
    }

    // Mark migration as complete
    await setSetting('localStorage_migrated', 'true');

    if (migrationHappened) {
      // Clean up localStorage after successful migration
      localStorage.removeItem('mydevify-projects');
      localStorage.removeItem('mydevify-settings');
      localStorage.removeItem('mydevify_usage');
      localStorage.removeItem('mydevify_usage_budget');
      localStorage.removeItem('mydevify_connections');
      localStorage.removeItem('mydevify-last-project');

      // Clean up per-project chat keys
      for (const project of projectsForChats) {
        localStorage.removeItem(`mydevify_chats_${project.id}`);
      }

      console.log('[DB] localStorage migration complete — old keys removed');
    } else {
      console.log('[DB] No localStorage data found — fresh install');
    }
  } catch (error) {
    console.error('[DB] Migration error (non-fatal):', error);
    // Don't throw — the app should still work even if migration fails
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
  // Foreign key CASCADE will delete related chat_history rows
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
}

async function recordUsage(entry: UsageInput): Promise<void> {
  const d = getDb();
  const ts = new Date(entry.timestamp).toISOString().replace('T', ' ').replace('Z', '');

  await d.execute(
    `INSERT INTO usage (provider, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_tokens, cost, input_cost, output_cost, task_label, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ts,
    ]
  );
}

interface UsageAggregateRow {
  total_tokens: number;
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_input_cost: number;
  total_output_cost: number;
}

async function getMonthlyUsage(): Promise<{
  tokens: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
}> {
  const d = getDb();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString().replace('T', ' ').replace('Z', '');

  const rows = await d.select<UsageAggregateRow[]>(
    `SELECT
       COALESCE(SUM(total_tokens), 0) as total_tokens,
       COALESCE(SUM(cost), 0) as total_cost,
       COALESCE(SUM(input_tokens), 0) as total_input_tokens,
       COALESCE(SUM(output_tokens), 0) as total_output_tokens,
       COALESCE(SUM(input_cost), 0) as total_input_cost,
       COALESCE(SUM(output_cost), 0) as total_output_cost
     FROM usage
     WHERE timestamp >= ?`,
    [startOfMonth]
  );

  const r = rows[0];
  return {
    tokens: r.total_tokens,
    cost: r.total_cost,
    inputTokens: r.total_input_tokens,
    outputTokens: r.total_output_tokens,
    inputCost: r.total_input_cost,
    outputCost: r.total_output_cost,
  };
}

async function getAllTimeUsage(): Promise<{
  tokens: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
}> {
  const d = getDb();
  const rows = await d.select<UsageAggregateRow[]>(
    `SELECT
       COALESCE(SUM(total_tokens), 0) as total_tokens,
       COALESCE(SUM(cost), 0) as total_cost,
       COALESCE(SUM(input_tokens), 0) as total_input_tokens,
       COALESCE(SUM(output_tokens), 0) as total_output_tokens,
       COALESCE(SUM(input_cost), 0) as total_input_cost,
       COALESCE(SUM(output_cost), 0) as total_output_cost
     FROM usage`
  );

  const r = rows[0];
  return {
    tokens: r.total_tokens,
    cost: r.total_cost,
    inputTokens: r.total_input_tokens,
    outputTokens: r.total_output_tokens,
    inputCost: r.total_input_cost,
    outputCost: r.total_output_cost,
  };
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
  totalTokens: number;
  totalCost: number;
  entryCount: number;
}): Promise<void> {
  const d = getDb();
  await d.execute(
    'INSERT OR REPLACE INTO usage_sessions (id, start_time, total_tokens, total_cost, entry_count) VALUES (?, ?, ?, ?, ?)',
    [session.id, session.startTime, session.totalTokens, session.totalCost, session.entryCount]
  );
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

  // Usage budget
  getBudgetSettings,
  saveBudgetSettings,

  // Usage sessions
  saveUsageSession,

  // Connections
  getConnections,
  saveConnection,
  deleteConnection,
  updateConnectionStatus,

  // Last project
  getLastProjectId,
  setLastProjectId,

  // Auth tokens (Supabase session)
  loadAuthTokens,
  saveAuthTokens,
  clearAuthTokens,
};