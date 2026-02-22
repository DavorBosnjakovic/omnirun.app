// ── Scheduled Tasks — Level 1 (App Open) ──────────────────────
//
// Tokio-based cron scheduler that checks tasks every 60 seconds.
// Tasks are stored as JSON in the app data directory.
// Each task has ordered steps with different executors (Local, Web, AI).

use chrono::{DateTime, Utc};
use cron::Schedule;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tokio::time::{interval, Duration};

// ── Data Model ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Human-readable schedule: "Every Monday at 8:00 AM"
    pub schedule: String,
    /// Internal cron expression: "0 8 * * 1"
    pub cron_expression: String,
    /// Which project this task belongs to (None = general)
    pub project_id: Option<String>,
    pub enabled: bool,
    pub steps: Vec<TaskStep>,
    pub on_failure: FailureAction,
    pub last_run: Option<TaskRun>,
    pub next_run: Option<String>, // ISO 8601 string
    pub created_at: String,       // ISO 8601 string
    pub updated_at: String,       // ISO 8601 string
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStep {
    pub id: String,
    pub name: String,
    pub executor: Executor,
    pub action: StepAction,
    /// If true, this step won't run if the previous step failed
    pub depends_on_previous: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Executor {
    /// File ops, git, scripts, shell commands — zero tokens
    Local,
    /// HTTP calls, API requests, webhooks — zero tokens
    Web,
    /// Needs Claude API call — costs tokens
    Ai,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StepAction {
    /// Run a shell command
    RunCommand { command: String, cwd: Option<String> },
    /// Back up files from source to destination
    BackupFiles { source: String, destination: String },
    /// Git commit with message
    GitCommit { message: String },
    /// Git push to remote
    GitPush { remote: Option<String>, branch: Option<String> },
    /// Run a script file
    RunScript { path: String },
    /// Delete files matching a pattern
    DeleteFiles { path: String, pattern: String },
    /// Make an HTTP request
    HttpRequest {
        url: String,
        method: String,
        headers: Option<std::collections::HashMap<String, String>>,
        body: Option<String>,
    },
    /// Trigger a deployment
    DeployTrigger { provider: String, project_id: String },
    /// Send a webhook
    SendWebhook { url: String, payload: Option<String> },
    /// AI: Generate content (costs tokens)
    GenerateContent { prompt: String, output_path: Option<String> },
    /// AI: Analyze and act (costs tokens)
    AnalyzeAndAct { prompt: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FailureAction {
    /// Stop the entire task on first failure
    Stop,
    /// Skip the failed step and continue with the next
    SkipAndContinue,
    /// Retry the failed step N times before giving up
    Retry { max_attempts: u32 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRun {
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: RunStatus,
    pub step_results: Vec<StepResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    Success,
    PartialSuccess,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub step_id: String,
    pub status: StepStatus,
    pub output: Option<String>,
    pub error: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Running,
    Success,
    Failed,
    Skipped,
}

// ── Task History (last N runs per task) ───────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskHistory {
    pub task_id: String,
    pub runs: Vec<TaskRun>,
}

// ── Storage ───────────────────────────────────────────────────

/// All tasks stored in a single JSON file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TaskStore {
    tasks: Vec<ScheduledTask>,
    history: Vec<TaskHistory>,
}

impl TaskStore {
    fn new() -> Self {
        Self {
            tasks: Vec::new(),
            history: Vec::new(),
        }
    }
}

/// Get the path to the tasks JSON file in the app data directory
fn get_tasks_file_path() -> PathBuf {
    // Use the user's home directory + .mydevify for now
    // (Tauri's app data path will be wired up from the frontend)
    let home = dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let data_dir = home.join(".mydevify").join("data");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("scheduled_tasks.json")
}

/// Load all tasks from disk
fn load_store() -> TaskStore {
    let path = get_tasks_file_path();
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| TaskStore::new()),
            Err(_) => TaskStore::new(),
        }
    } else {
        TaskStore::new()
    }
}

/// Save all tasks to disk
fn save_store(store: &TaskStore) -> Result<(), String> {
    let path = get_tasks_file_path();
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

// ── Shared State ──────────────────────────────────────────────

/// Thread-safe handle to the task store (loaded into memory on init)
pub static TASK_STORE: once_cell::sync::Lazy<Arc<Mutex<TaskStore>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(load_store())));

/// Flag to signal when a task needs to run immediately
pub static RUN_NOW_QUEUE: once_cell::sync::Lazy<Arc<Mutex<Vec<String>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(Vec::new())));

// ── Cron Helpers ──────────────────────────────────────────────

/// Calculate the next run time for a cron expression
fn next_run_time(cron_expr: &str) -> Option<String> {
    // The cron crate expects 7-field expressions (sec min hour dom mon dow year)
    // Convert 5-field (min hour dom mon dow) to 7-field by adding "0" prefix and "*" suffix
    let parts: Vec<&str> = cron_expr.trim().split_whitespace().collect();
    let full_expr = match parts.len() {
        5 => format!("0 {} *", cron_expr),
        6 => format!("0 {}", cron_expr),
        7 => cron_expr.to_string(),
        _ => return None,
    };

    let schedule = Schedule::from_str(&full_expr).ok()?;
    let next = schedule.upcoming(Utc).next()?;
    Some(next.to_rfc3339())
}

/// Check if a task is due to run now (within the last 60 seconds)
fn is_task_due(task: &ScheduledTask) -> bool {
    if !task.enabled {
        return false;
    }

    if let Some(ref next_run_str) = task.next_run {
        if let Ok(next_run) = DateTime::parse_from_rfc3339(next_run_str) {
            let now = Utc::now();
            let next_utc = next_run.with_timezone(&Utc);
            // Task is due if next_run is in the past (or within the last 60s window)
            return next_utc <= now;
        }
    }

    false
}

// ── CRUD Operations ───────────────────────────────────────────

/// Create a new task and save to disk
pub fn create_task(mut task: ScheduledTask) -> Result<ScheduledTask, String> {
    // Generate ID if empty
    if task.id.is_empty() {
        task.id = uuid::Uuid::new_v4().to_string();
    }

    // Set timestamps
    let now = Utc::now().to_rfc3339();
    task.created_at = now.clone();
    task.updated_at = now;

    // Calculate next run
    task.next_run = next_run_time(&task.cron_expression);

    // Generate step IDs if empty
    for step in &mut task.steps {
        if step.id.is_empty() {
            step.id = uuid::Uuid::new_v4().to_string();
        }
    }

    let mut store = TASK_STORE.lock().map_err(|e| e.to_string())?;
    store.tasks.push(task.clone());
    save_store(&store)?;

    Ok(task)
}

/// Update an existing task
pub fn update_task(updated: ScheduledTask) -> Result<ScheduledTask, String> {
    let mut store = TASK_STORE.lock().map_err(|e| e.to_string())?;

    let pos = store
        .tasks
        .iter()
        .position(|t| t.id == updated.id)
        .ok_or_else(|| format!("Task not found: {}", updated.id))?;

    let mut task = updated;
    task.updated_at = Utc::now().to_rfc3339();
    task.next_run = next_run_time(&task.cron_expression);

    store.tasks[pos] = task.clone();
    save_store(&store)?;

    Ok(task)
}

/// Delete a task by ID
pub fn delete_task(task_id: &str) -> Result<(), String> {
    let mut store = TASK_STORE.lock().map_err(|e| e.to_string())?;

    let initial_len = store.tasks.len();
    store.tasks.retain(|t| t.id != task_id);

    if store.tasks.len() == initial_len {
        return Err(format!("Task not found: {}", task_id));
    }

    // Also remove history for this task
    store.history.retain(|h| h.task_id != task_id);

    save_store(&store)
}

/// Toggle a task's enabled state
pub fn toggle_task(task_id: &str) -> Result<ScheduledTask, String> {
    let mut store = TASK_STORE.lock().map_err(|e| e.to_string())?;

    let task = store
        .tasks
        .iter_mut()
        .find(|t| t.id == task_id)
        .ok_or_else(|| format!("Task not found: {}", task_id))?;

    task.enabled = !task.enabled;
    task.updated_at = Utc::now().to_rfc3339();

    // Recalculate next run if re-enabled
    if task.enabled {
        task.next_run = next_run_time(&task.cron_expression);
    }

    let result = task.clone();
    save_store(&store)?;

    Ok(result)
}

/// Get all tasks
pub fn get_tasks() -> Result<Vec<ScheduledTask>, String> {
    let store = TASK_STORE.lock().map_err(|e| e.to_string())?;
    Ok(store.tasks.clone())
}

/// Get a single task by ID
pub fn get_task(task_id: &str) -> Result<ScheduledTask, String> {
    let store = TASK_STORE.lock().map_err(|e| e.to_string())?;
    store
        .tasks
        .iter()
        .find(|t| t.id == task_id)
        .cloned()
        .ok_or_else(|| format!("Task not found: {}", task_id))
}

/// Get history for a task
#[allow(dead_code)]
pub fn get_task_history(task_id: &str) -> Result<Vec<TaskRun>, String> {
    let store = TASK_STORE.lock().map_err(|e| e.to_string())?;
    Ok(store
        .history
        .iter()
        .find(|h| h.task_id == task_id)
        .map(|h| h.runs.clone())
        .unwrap_or_default())
}

/// Record a completed run in history (keeps last 20 runs per task)
pub fn record_run(task_id: &str, run: TaskRun) -> Result<(), String> {
    let mut store = TASK_STORE.lock().map_err(|e| e.to_string())?;

    // Update last_run on the task itself
    if let Some(task) = store.tasks.iter_mut().find(|t| t.id == task_id) {
        task.last_run = Some(run.clone());
        // Advance next_run
        task.next_run = next_run_time(&task.cron_expression);
    }

    // Add to history
    let history_entry = store.history.iter_mut().find(|h| h.task_id == task_id);
    match history_entry {
        Some(entry) => {
            entry.runs.push(run);
            // Keep only the last 20 runs
            if entry.runs.len() > 20 {
                entry.runs = entry.runs.split_off(entry.runs.len() - 20);
            }
        }
        None => {
            store.history.push(TaskHistory {
                task_id: task_id.to_string(),
                runs: vec![run],
            });
        }
    }

    save_store(&store)
}

/// Queue a task to run immediately
pub fn queue_run_now(task_id: &str) {
    if let Ok(mut queue) = RUN_NOW_QUEUE.lock() {
        if !queue.contains(&task_id.to_string()) {
            queue.push(task_id.to_string());
        }
    }
}

// ── Scheduler Loop ────────────────────────────────────────────

/// Start the background scheduler. Call this once on app startup.
/// Runs in a tauri async task, checks every 60 seconds for due tasks.
pub fn start_scheduler(app_handle: tauri::AppHandle) {
    let handle = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(Duration::from_secs(60));

        loop {
            ticker.tick().await;

            // Check for "run now" requests first
            let run_now_ids: Vec<String> = {
                let mut queue = match RUN_NOW_QUEUE.lock() {
                    Ok(q) => q,
                    Err(_) => continue,
                };
                let ids = queue.clone();
                queue.clear();
                ids
            };

            for task_id in &run_now_ids {
                if let Ok(task) = get_task(task_id) {
                    let handle_clone = handle.clone();
                    let task_clone = task.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::task_runner::execute_task(&handle_clone, &task_clone).await;
                    });
                }
            }

            // Check scheduled tasks
            let due_tasks: Vec<ScheduledTask> = {
                let store = match TASK_STORE.lock() {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                store
                    .tasks
                    .iter()
                    .filter(|t| is_task_due(t))
                    .cloned()
                    .collect()
            };

            for task in due_tasks {
                // Skip if this task was already triggered by "run now"
                if run_now_ids.contains(&task.id) {
                    continue;
                }

                let handle_clone = handle.clone();
                let task_clone = task.clone();
                tauri::async_runtime::spawn(async move {
                    crate::task_runner::execute_task(&handle_clone, &task_clone).await;
                });
            }
        }
    });
}