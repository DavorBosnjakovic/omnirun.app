// ── Task Runner — Step-Based Executor ──────────────────────────
//
// Executes a ScheduledTask by running its steps in order.
// Each step has its own executor type (Local, Web, AI).
// Handles failure modes: Stop, SkipAndContinue, Retry.
// Emits Tauri events so the frontend can show live progress.

use crate::scheduler::{
    self, Executor, FailureAction, RunStatus, ScheduledTask, StepAction, StepResult, StepStatus,
    TaskRun,
};
use chrono::Utc;
use serde::Serialize;
use std::path::PathBuf;
use tauri::Emitter;

// ── Events emitted to frontend ────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TaskEvent {
    pub task_id: String,
    pub task_name: String,
    pub event_type: TaskEventType,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TaskEventType {
    /// Task execution started
    Started,
    /// A step completed (success or failure)
    StepCompleted {
        step_id: String,
        step_name: String,
        status: StepStatus,
        output: Option<String>,
        error: Option<String>,
    },
    /// Entire task finished
    Finished { status: RunStatus },
}

// ── Main Executor ─────────────────────────────────────────────

/// Execute a scheduled task — runs all steps in order.
/// Called by the scheduler loop or "Run Now" from the frontend.
pub async fn execute_task(app_handle: &tauri::AppHandle, task: &ScheduledTask) {
    let started_at = Utc::now().to_rfc3339();

    // Emit: task started
    let _ = app_handle.emit(
        "task-event",
        TaskEvent {
            task_id: task.id.clone(),
            task_name: task.name.clone(),
            event_type: TaskEventType::Started,
        },
    );

    let mut step_results: Vec<StepResult> = Vec::new();
    let mut had_failure = false;
    let mut all_skipped_or_success = true;

    for (i, step) in task.steps.iter().enumerate() {
        // Check if we should skip due to previous failure
        if had_failure && step.depends_on_previous {
            let result = StepResult {
                step_id: step.id.clone(),
                status: StepStatus::Skipped,
                output: None,
                error: Some("Skipped: previous step failed".to_string()),
                started_at: Utc::now().to_rfc3339(),
                finished_at: Some(Utc::now().to_rfc3339()),
            };

            emit_step_completed(app_handle, task, &result);
            step_results.push(result);
            all_skipped_or_success = false;
            continue;
        }

        // Determine how many attempts to make
        let max_attempts = match &task.on_failure {
            FailureAction::Retry { max_attempts } => *max_attempts,
            _ => 1,
        };

        let mut step_succeeded = false;

        for attempt in 0..max_attempts {
            let step_started = Utc::now().to_rfc3339();

            // Execute the step based on its executor type
            let (status, output, error) = execute_step(step, task).await;

            let result = StepResult {
                step_id: step.id.clone(),
                status: status.clone(),
                output: output.clone(),
                error: error.clone(),
                started_at: step_started,
                finished_at: Some(Utc::now().to_rfc3339()),
            };

            match status {
                StepStatus::Success => {
                    emit_step_completed(app_handle, task, &result);
                    step_results.push(result);
                    step_succeeded = true;
                    break;
                }
                StepStatus::Failed => {
                    // If this is the last attempt, record the failure
                    if attempt == max_attempts - 1 {
                        emit_step_completed(app_handle, task, &result);
                        step_results.push(result);
                    }
                    // Otherwise, retry (don't push result yet)
                }
                _ => {
                    emit_step_completed(app_handle, task, &result);
                    step_results.push(result);
                    break;
                }
            }
        }

        if !step_succeeded {
            had_failure = true;
            all_skipped_or_success = false;

            match &task.on_failure {
                FailureAction::Stop => {
                    // Mark remaining steps as skipped
                    for remaining in &task.steps[i + 1..] {
                        let skipped = StepResult {
                            step_id: remaining.id.clone(),
                            status: StepStatus::Skipped,
                            output: None,
                            error: Some("Skipped: task stopped due to earlier failure".to_string()),
                            started_at: Utc::now().to_rfc3339(),
                            finished_at: Some(Utc::now().to_rfc3339()),
                        };
                        emit_step_completed(app_handle, task, &skipped);
                        step_results.push(skipped);
                    }
                    break;
                }
                FailureAction::SkipAndContinue | FailureAction::Retry { .. } => {
                    // Continue to next step
                    continue;
                }
            }
        }
    }

    // Determine overall status
    let overall_status = if !had_failure {
        RunStatus::Success
    } else if all_skipped_or_success {
        RunStatus::Success
    } else if step_results.iter().any(|r| matches!(r.status, StepStatus::Success)) {
        RunStatus::PartialSuccess
    } else {
        RunStatus::Failed
    };

    let run = TaskRun {
        started_at,
        finished_at: Some(Utc::now().to_rfc3339()),
        status: overall_status.clone(),
        step_results,
    };

    // Record the run in history
    let _ = scheduler::record_run(&task.id, run);

    // Emit: task finished
    let _ = app_handle.emit(
        "task-event",
        TaskEvent {
            task_id: task.id.clone(),
            task_name: task.name.clone(),
            event_type: TaskEventType::Finished {
                status: overall_status,
            },
        },
    );
}

/// Emit a step-completed event to the frontend
fn emit_step_completed(app_handle: &tauri::AppHandle, task: &ScheduledTask, result: &StepResult) {
    let step_name = task
        .steps
        .iter()
        .find(|s| s.id == result.step_id)
        .map(|s| s.name.clone())
        .unwrap_or_default();

    let _ = app_handle.emit(
        "task-event",
        TaskEvent {
            task_id: task.id.clone(),
            task_name: task.name.clone(),
            event_type: TaskEventType::StepCompleted {
                step_id: result.step_id.clone(),
                step_name,
                status: result.status.clone(),
                output: result.output.clone(),
                error: result.error.clone(),
            },
        },
    );
}

// ── Step Executors ─────────────────────────────────────────────

/// Execute a single step. Returns (status, output, error).
async fn execute_step(
    step: &crate::scheduler::TaskStep,
    task: &ScheduledTask,
) -> (StepStatus, Option<String>, Option<String>) {
    match &step.executor {
        Executor::Local => execute_local_step(&step.action, task).await,
        Executor::Web => execute_web_step(&step.action).await,
        Executor::Ai => execute_ai_step(&step.action).await,
    }
}

// ── Local Executor ────────────────────────────────────────────
// Runs shell commands, file ops, git — zero token cost.

async fn execute_local_step(
    action: &StepAction,
    task: &ScheduledTask,
) -> (StepStatus, Option<String>, Option<String>) {
    match action {
        StepAction::RunCommand { command, cwd } => {
            let work_dir = cwd.clone().unwrap_or_else(|| {
                dirs_next::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .to_string_lossy()
                    .to_string()
            });
            run_shell_command(command, &work_dir)
        }

        StepAction::BackupFiles { source, destination } => {
            // Use platform-appropriate copy command
            let cmd = if cfg!(target_os = "windows") {
                format!("xcopy /E /I /Y \"{}\" \"{}\"", source, destination)
            } else {
                format!("cp -r \"{}\" \"{}\"", source, destination)
            };
            let work_dir = dirs_next::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .to_string_lossy()
                .to_string();
            run_shell_command(&cmd, &work_dir)
        }

        StepAction::GitCommit { message } => {
            // Use project path if available, else home
            let work_dir = task
                .project_id
                .clone()
                .unwrap_or_else(|| {
                    dirs_next::home_dir()
                        .unwrap_or_else(|| PathBuf::from("."))
                        .to_string_lossy()
                        .to_string()
                });
            // Stage all changes, then commit
            let stage_result = run_shell_command("git add -A", &work_dir);
            if matches!(stage_result.0, StepStatus::Failed) {
                return stage_result;
            }
            run_shell_command(&format!("git commit -m \"{}\"", message), &work_dir)
        }

        StepAction::GitPush { remote, branch } => {
            let work_dir = task
                .project_id
                .clone()
                .unwrap_or_else(|| {
                    dirs_next::home_dir()
                        .unwrap_or_else(|| PathBuf::from("."))
                        .to_string_lossy()
                        .to_string()
                });
            let remote_name = remote.as_deref().unwrap_or("origin");
            let branch_name = branch.as_deref().unwrap_or("main");
            run_shell_command(
                &format!("git push {} {}", remote_name, branch_name),
                &work_dir,
            )
        }

        StepAction::RunScript { path } => {
            let script_path = PathBuf::from(path);
            let work_dir = script_path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string());

            // Determine how to run the script based on extension
            let cmd = match script_path.extension().and_then(|e| e.to_str()) {
                Some("sh") | Some("bash") => format!("bash \"{}\"", path),
                Some("py") => format!("python3 \"{}\"", path),
                Some("js") => format!("node \"{}\"", path),
                Some("ps1") => format!("powershell -File \"{}\"", path),
                Some("bat") | Some("cmd") => format!("\"{}\"", path),
                _ => {
                    if cfg!(target_os = "windows") {
                        format!("\"{}\"", path)
                    } else {
                        format!("bash \"{}\"", path)
                    }
                }
            };
            run_shell_command(&cmd, &work_dir)
        }

        StepAction::DeleteFiles { path, pattern } => {
            let cmd = if cfg!(target_os = "windows") {
                format!("del /S /Q \"{}\\{}\"", path, pattern)
            } else {
                format!("find \"{}\" -name \"{}\" -delete", path, pattern)
            };
            let work_dir = dirs_next::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .to_string_lossy()
                .to_string();
            run_shell_command(&cmd, &work_dir)
        }

        // Non-local actions shouldn't reach here, but handle gracefully
        _ => (
            StepStatus::Failed,
            None,
            Some("Action type not supported by Local executor".to_string()),
        ),
    }
}

/// Run a shell command and return the result
fn run_shell_command(
    command: &str,
    cwd: &str,
) -> (StepStatus, Option<String>, Option<String>) {
    let cwd_path = PathBuf::from(cwd);

    let output = if cfg!(target_os = "windows") {
        let mut cmd = std::process::Command::new("cmd.exe");
        cmd.arg("/D").arg("/S").arg("/C").arg(command);
        cmd.current_dir(&cwd_path);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        cmd.output()
    } else {
        std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(command)
            .current_dir(&cwd_path)
            .output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let exit_code = out.status.code().unwrap_or(-1);

            if exit_code == 0 {
                let output_text = if !stdout.is_empty() {
                    Some(stdout.trim().to_string())
                } else {
                    None
                };
                (StepStatus::Success, output_text, None)
            } else {
                let error_text = if !stderr.is_empty() {
                    stderr.trim().to_string()
                } else {
                    format!("Command exited with code {}", exit_code)
                };
                (
                    StepStatus::Failed,
                    if !stdout.is_empty() { Some(stdout.trim().to_string()) } else { None },
                    Some(error_text),
                )
            }
        }
        Err(e) => (
            StepStatus::Failed,
            None,
            Some(format!("Failed to execute: {}", e)),
        ),
    }
}

// ── Web Executor ──────────────────────────────────────────────
// HTTP requests, webhooks, deploy triggers — zero token cost.

async fn execute_web_step(action: &StepAction) -> (StepStatus, Option<String>, Option<String>) {
    match action {
        StepAction::HttpRequest {
            url,
            method,
            headers,
            body,
        } => {
            execute_http_request(url, method, headers.as_ref(), body.as_deref()).await
        }

        StepAction::SendWebhook { url, payload } => {
            let body = payload.as_deref();
            execute_http_request(url, "POST", None, body).await
        }

        StepAction::DeployTrigger {
            provider,
            project_id,
        } => {
            // Deploy triggers are typically POST requests to provider webhooks
            // The actual URL depends on the provider and is stored in connections
            // For now, return a placeholder — this will be wired up with the Connections system
            (
                StepStatus::Failed,
                None,
                Some(format!(
                    "Deploy trigger for {} (project {}) — requires Connections integration (coming soon)",
                    provider, project_id
                )),
            )
        }

        // Non-web actions shouldn't reach here
        _ => (
            StepStatus::Failed,
            None,
            Some("Action type not supported by Web executor".to_string()),
        ),
    }
}

/// Make an HTTP request using reqwest-style approach via std
async fn execute_http_request(
    url: &str,
    method: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    body: Option<&str>,
) -> (StepStatus, Option<String>, Option<String>) {
    // Use a simple curl/wget approach via shell for now
    // This avoids adding reqwest as a dependency — keeps binary small
    // Will be replaced with proper HTTP client when needed

    let mut cmd_parts = vec!["curl".to_string(), "-s".to_string(), "-w".to_string(), "\\n%{http_code}".to_string()];

    // Method
    cmd_parts.push("-X".to_string());
    cmd_parts.push(method.to_uppercase());

    // Headers
    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            cmd_parts.push("-H".to_string());
            cmd_parts.push(format!("{}: {}", key, value));
        }
    }

    // Body
    if let Some(b) = body {
        cmd_parts.push("-d".to_string());
        cmd_parts.push(b.to_string());
        // Auto-add content-type if not present
        if headers.map_or(true, |h| !h.keys().any(|k| k.to_lowercase() == "content-type")) {
            cmd_parts.push("-H".to_string());
            cmd_parts.push("Content-Type: application/json".to_string());
        }
    }

    cmd_parts.push(url.to_string());

    let full_cmd = cmd_parts
        .iter()
        .map(|p| {
            if p.contains(' ') || p.contains('"') {
                format!("\"{}\"", p.replace('"', "\\\""))
            } else {
                p.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    let work_dir = dirs_next::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .to_string_lossy()
        .to_string();

    let (status, output, error) = run_shell_command(&full_cmd, &work_dir);

    // Parse HTTP status code from curl output
    if let StepStatus::Success = status {
        if let Some(ref out) = output {
            let lines: Vec<&str> = out.trim().lines().collect();
            if let Some(last_line) = lines.last() {
                if let Ok(http_code) = last_line.trim().parse::<u16>() {
                    let response_body = lines[..lines.len() - 1].join("\n");
                    if http_code >= 200 && http_code < 300 {
                        return (
                            StepStatus::Success,
                            Some(format!("HTTP {} — {}", http_code, response_body.chars().take(500).collect::<String>())),
                            None,
                        );
                    } else {
                        return (
                            StepStatus::Failed,
                            None,
                            Some(format!("HTTP {} — {}", http_code, response_body.chars().take(500).collect::<String>())),
                        );
                    }
                }
            }
        }
    }

    (status, output, error)
}

// ── AI Executor ───────────────────────────────────────────────
// Requires Claude API call — costs tokens.
// Level 1: Placeholder that emits an event for the frontend to handle.
// The frontend (with the user's API key) will make the actual API call.

async fn execute_ai_step(action: &StepAction) -> (StepStatus, Option<String>, Option<String>) {
    match action {
        StepAction::GenerateContent { prompt, output_path } => {
            // For Level 1, AI steps can't run autonomously in the background
            // because the API key is managed on the frontend side.
            // Return a status indicating the frontend needs to handle this.
            (
                StepStatus::Failed,
                None,
                Some(format!(
                    "AI step requires frontend handling — prompt: '{}', output: {:?}. \
                     (AI executor will be fully wired in a future update)",
                    prompt.chars().take(100).collect::<String>(),
                    output_path
                )),
            )
        }

        StepAction::AnalyzeAndAct { prompt } => {
            (
                StepStatus::Failed,
                None,
                Some(format!(
                    "AI step requires frontend handling — prompt: '{}'. \
                     (AI executor will be fully wired in a future update)",
                    prompt.chars().take(100).collect::<String>()
                )),
            )
        }

        _ => (
            StepStatus::Failed,
            None,
            Some("Action type not supported by AI executor".to_string()),
        ),
    }
}