// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![warn(dead_code)]
#![warn(unused_imports)]
#![warn(unused_variables)]

mod cleanup;
mod diff_commands;
mod logging;
mod terminal;
mod para_core;

use std::sync::Arc;
use terminal::TerminalManager;
// Manager not directly used anymore; remove import
use tokio::sync::{OnceCell, Mutex};

static TERMINAL_MANAGER: OnceCell<Arc<TerminalManager>> = OnceCell::const_new();
static PARA_CORE: OnceCell<Arc<Mutex<para_core::ParaCore>>> = OnceCell::const_new();

fn parse_agent_command(command: &str) -> Result<(String, String, Vec<String>), String> {
    // Command format: "cd /path/to/worktree && {claude|cursor-agent} [args]"
    let parts: Vec<&str> = command.split(" && ").collect();
    if parts.len() != 2 {
        return Err(format!("Invalid command format: {command}"));
    }
    
    // Extract working directory from cd command
    let cd_part = parts[0];
    if !cd_part.starts_with("cd ") {
        return Err(format!("Command doesn't start with 'cd': {command}"));
    }
    let cwd = cd_part[3..].to_string();
    
    // Parse agent command and arguments
    let agent_part = parts[1];
    let agent_name = if agent_part.starts_with("claude") {
        "claude"
    } else if agent_part.starts_with("cursor-agent") {
        "cursor-agent"
    } else {
        return Err(format!("Second part doesn't start with 'claude' or 'cursor-agent': {command}"));
    };
    
    // Split the agent command into arguments, handling quoted strings
    let mut args = Vec::new();
    let mut current_arg = String::new();
    let mut in_quotes = false;
    let mut chars = agent_part.chars().peekable();
    
    // Skip agent name part
    for _ in 0..agent_name.len() {
        chars.next();
    }
    
    // Skip any leading whitespace
    while chars.peek() == Some(&' ') {
        chars.next();
    }
    
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                if !in_quotes && !current_arg.is_empty() {
                    args.push(current_arg.clone());
                    current_arg.clear();
                }
            }
            ' ' if !in_quotes => {
                if !current_arg.is_empty() {
                    args.push(current_arg.clone());
                    current_arg.clear();
                }
            }
            '\\' if in_quotes => {
                // Handle escaped characters in quotes
                if let Some(next_ch) = chars.next() {
                    if next_ch == '"' {
                        current_arg.push('"');
                    } else {
                        current_arg.push('\\');
                        current_arg.push(next_ch);
                    }
                }
            }
            _ => {
                current_arg.push(ch);
            }
        }
    }
    
    // Add any remaining argument
    if !current_arg.is_empty() {
        args.push(current_arg);
    }
    
    Ok((cwd, agent_name.to_string(), args))
}

async fn get_terminal_manager() -> Arc<TerminalManager> {
    TERMINAL_MANAGER.get_or_init(|| async {
        Arc::new(TerminalManager::new())
    }).await.clone()
}

async fn get_para_core() -> Arc<Mutex<para_core::ParaCore>> {
    PARA_CORE.get_or_init(|| async {
        let core = para_core::ParaCore::new(None)
            .expect("Failed to initialize para core");
        Arc::new(Mutex::new(core))
    }).await.clone()
}

async fn start_terminal_monitoring(app: tauri::AppHandle) {
    use tauri::Emitter;
    use tokio::time::{interval, Duration};
    use serde::Serialize;
    use std::collections::HashSet;
    
    #[derive(Serialize, Clone)]
    struct TerminalStuckNotification {
        terminal_id: String,
        session_id: Option<String>,
        elapsed_seconds: u64,
    }
    
    #[derive(Serialize, Clone)]
    struct TerminalUnstuckNotification {
        terminal_id: String,
        session_id: Option<String>,
    }
    
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(5)); // Check more frequently for better responsiveness
        let mut previously_stuck = HashSet::new();
        
        loop {
            interval.tick().await;
            
            let manager = get_terminal_manager().await;
            let stuck_terminals = manager.get_all_terminal_activity().await;
            let mut currently_stuck = HashSet::new();
            
            for (terminal_id, is_stuck, elapsed) in stuck_terminals {
                if is_stuck {
                    currently_stuck.insert(terminal_id.clone());
                    
                    // Only notify if this terminal wasn't previously stuck
                    if !previously_stuck.contains(&terminal_id) {
                        let session_id = if terminal_id.starts_with("session-") {
                            terminal_id.split('-').nth(1).map(|s| s.to_string())
                        } else {
                            None
                        };
                        
                        let notification = TerminalStuckNotification {
                            terminal_id: terminal_id.clone(),
                            session_id,
                            elapsed_seconds: elapsed,
                        };
                        
                        log::info!("Terminal {terminal_id} became idle after {elapsed} seconds");
                        
                        if let Err(e) = app.emit("para-ui:terminal-stuck", &notification) {
                            log::error!("Failed to emit terminal stuck notification: {e}");
                        }
                    }
                } else {
                    // Terminal is not stuck - check if it was previously stuck to emit unstuck event
                    if previously_stuck.contains(&terminal_id) {
                        let session_id = if terminal_id.starts_with("session-") {
                            terminal_id.split('-').nth(1).map(|s| s.to_string())
                        } else {
                            None
                        };
                        
                        let notification = TerminalUnstuckNotification {
                            terminal_id: terminal_id.clone(),
                            session_id,
                        };
                        
                        log::info!("Terminal {terminal_id} became active again");
                        
                        if let Err(e) = app.emit("para-ui:terminal-unstuck", &notification) {
                            log::error!("Failed to emit terminal unstuck notification: {e}");
                        }
                    }
                }
            }
            
            // Update the set of previously stuck terminals for next iteration
            previously_stuck = currently_stuck;
        }
    });
}

#[tauri::command]
async fn para_core_list_enriched_sessions() -> Result<Vec<para_core::EnrichedSession>, String> {
    log::debug!("Listing enriched sessions from para_core");
    
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    match manager.list_enriched_sessions() {
        Ok(sessions) => {
            log::debug!("Found {} sessions", sessions.len());
            Ok(sessions)
        },
        Err(e) => {
            log::error!("Failed to list enriched sessions: {e}");
            Err(format!("Failed to get sessions: {e}"))
        }
    }
}

#[tauri::command]
async fn create_terminal(app: tauri::AppHandle, id: String, cwd: String) -> Result<String, String> {
    let manager = get_terminal_manager().await;
    manager.set_app_handle(app).await;
    manager.create_terminal(id.clone(), cwd).await?;
    Ok(id)
}

#[tauri::command]
async fn write_terminal(id: String, data: String) -> Result<(), String> {
    let manager = get_terminal_manager().await;
    manager.write_terminal(id, data.into_bytes()).await
}

#[tauri::command]
async fn resize_terminal(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let manager = get_terminal_manager().await;
    manager.resize_terminal(id, cols, rows).await
}

#[tauri::command]
async fn close_terminal(id: String) -> Result<(), String> {
    let manager = get_terminal_manager().await;
    manager.close_terminal(id).await
}

#[tauri::command]
async fn terminal_exists(id: String) -> Result<bool, String> {
    let manager = get_terminal_manager().await;
    manager.terminal_exists(&id).await
}

#[tauri::command]
async fn get_terminal_buffer(id: String) -> Result<String, String> {
    let manager = get_terminal_manager().await;
    manager.get_terminal_buffer(id).await
}

#[tauri::command]
async fn get_terminal_activity_status(id: String) -> Result<(bool, u64), String> {
    let manager = get_terminal_manager().await;
    manager.get_terminal_activity_status(id).await
}

#[tauri::command]
async fn get_all_terminal_activity() -> Result<Vec<(String, bool, u64)>, String> {
    let manager = get_terminal_manager().await;
    Ok(manager.get_all_terminal_activity().await)
}

#[tauri::command]
fn get_current_directory() -> Result<String, String> {
    // In dev mode, the current dir is src-tauri, so we need to go up one level
    let current_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {e}"))?;
    
    // Check if we're in src-tauri directory (dev mode)
    if current_dir.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
        // Go up one level to get the project root
        current_dir.parent()
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "Failed to get parent directory".to_string())
    } else {
        // We're already in the project root (production mode)
        Ok(current_dir.to_string_lossy().to_string())
    }
}

use tauri::Emitter;

#[tauri::command]
async fn para_core_create_session(app: tauri::AppHandle, name: String, prompt: Option<String>, base_branch: Option<String>) -> Result<para_core::Session, String> {
    // Check if the name looks auto-generated (docker-style: adjective_noun)
    let was_auto_generated = name.contains('_') && name.split('_').count() == 2;
    
    let core = get_para_core().await;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    let session = manager.create_session_with_auto_flag(&name, prompt.as_deref(), base_branch.as_deref(), was_auto_generated)
        .map_err(|e| format!("Failed to create session: {e}"))?;

    // Clone what we need for the background task
    let session_name_clone = session.name.clone();
    let app_handle = app.clone();
    
    // Emit session-added event for frontend to merge incrementally
    #[derive(serde::Serialize, Clone)]
    struct SessionAddedPayload {
        session_name: String,
        branch: String,
        worktree_path: String,
        parent_branch: String,
    }
    let _ = app.emit(
        "para-ui:session-added",
        SessionAddedPayload {
            session_name: session.name.clone(),
            branch: session.branch.clone(),
            worktree_path: session.worktree_path.to_string_lossy().to_string(),
            parent_branch: session.parent_branch.clone(),
        },
    );

    // Drop the lock before spawning the background task
    drop(core_lock);
    
    // Spawn background task to generate display name if needed
    // Run even without an explicit prompt; the generator has a sensible default
    if was_auto_generated {
        log::info!("Session '{name}' was auto-generated, spawning name generation task");
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            
            // Get session info and database reference
            let (session_info, db_clone) = {
                let core = get_para_core().await;
                let core = core.lock().await;
                let manager = core.session_manager();
                let session = match manager.get_session(&session_name_clone) {
                    Ok(s) => s,
                    Err(e) => { 
                        log::warn!("Cannot load session '{session_name_clone}' for naming: {e}"); 
                        return; 
                    }
                };
                log::info!("Session '{}' loaded: pending_name_generation={}, original_agent_type={:?}", 
                    session_name_clone, session.pending_name_generation, session.original_agent_type);
                
                if !session.pending_name_generation {
                    log::info!("Session '{session_name_clone}' does not have pending_name_generation flag, skipping");
                    return;
                }
                let agent = session.original_agent_type.clone()
                    .unwrap_or_else(|| core.db.get_agent_type().unwrap_or_else(|_| "claude".to_string()));
                
                log::info!("Using agent '{agent}' for name generation of session '{session_name_clone}'");
                
                // Clone what we need and release the lock
                (
                    (session.id.clone(), session.worktree_path.clone(), agent, session.initial_prompt.clone()),
                    core.db.clone()
                )
            };
            
            let (session_id, worktree_path, agent, initial_prompt) = session_info;
            
            log::info!("Starting name generation for session '{}' with prompt: {:?}", 
                session_name_clone, initial_prompt.as_ref().map(|p| &p[..p.len().min(50)]));
            
            // Now do the async operation without holding any locks
            match crate::para_core::naming::generate_display_name(
                &db_clone,
                &session_id,
                &worktree_path,
                &agent,
                initial_prompt.as_deref()
            ).await {
                Ok(Some(display_name)) => {
                    log::info!("Successfully generated display name '{display_name}' for session '{session_name_clone}'");
                    
                    // Re-acquire lock only to get the updated sessions list
                    let core = get_para_core().await;
                    let core = core.lock().await;
                    let manager = core.session_manager();
                    if let Ok(sessions) = manager.list_enriched_sessions() {
                        log::info!("Emitting sessions-refreshed event after name generation");
                        if let Err(e) = app_handle.emit("para-ui:sessions-refreshed", &sessions) {
                            log::warn!("Could not emit sessions refreshed: {e}");
                        }
                    }
                }
                Ok(None) => { 
                    log::warn!("Name generation returned None for session '{session_name_clone}'");
                    let _ = db_clone.set_pending_name_generation(&session_id, false); 
                }
                Err(e) => {
                    log::error!("Failed to generate display name for session '{session_name_clone}': {e}");
                    let _ = db_clone.set_pending_name_generation(&session_id, false);
                }
            }
        });
    } else {
        log::info!("Session '{}' was_auto_generated={}, has_prompt={}, skipping name generation", 
            name, was_auto_generated, prompt.is_some());
    }

    Ok(session)
}

#[tauri::command]
async fn para_core_list_sessions() -> Result<Vec<para_core::Session>, String> {
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.list_sessions()
        .map_err(|e| format!("Failed to list sessions: {e}"))
}

#[tauri::command]
async fn para_core_get_session(name: String) -> Result<para_core::Session, String> {
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.get_session(&name)
        .map_err(|e| format!("Failed to get session: {e}"))
}

#[tauri::command]
async fn para_core_cancel_session(app: tauri::AppHandle, name: String) -> Result<(), String> {
    log::info!("Starting cancel session: {name}");
    
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    match manager.cancel_session(&name) {
        Ok(()) => {
            log::info!("Successfully canceled session: {name}");
            #[derive(serde::Serialize, Clone)]
            struct SessionRemovedPayload { session_name: String }
            let _ = app.emit(
                "para-ui:session-removed",
                SessionRemovedPayload { session_name: name.clone() },
            );
            // Best-effort: close known session terminals to avoid orphaned PTYs
            let manager = get_terminal_manager().await;
            let ids = vec![
                format!("session-{}-top", name),
                format!("session-{}-bottom", name),
                format!("session-{}-right", name),
            ];
            for id in ids {
                if let Ok(true) = manager.terminal_exists(&id).await {
                    if let Err(e) = manager.close_terminal(id.clone()).await {
                        log::warn!("Failed to close terminal {id} on cancel: {e}");
                    }
                }
            }
            Ok(())
        },
        Err(e) => {
            log::error!("Failed to cancel session {name}: {e}");
            Err(format!("Failed to cancel session: {e}"))
        }
    }
}


#[tauri::command]
async fn para_core_update_git_stats(session_id: String) -> Result<(), String> {
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.update_git_stats(&session_id)
        .map_err(|e| format!("Failed to update git stats: {e}"))
}

#[tauri::command]
async fn para_core_cleanup_orphaned_worktrees() -> Result<(), String> {
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.cleanup_orphaned_worktrees()
        .map_err(|e| format!("Failed to cleanup orphaned worktrees: {e}"))
}

#[tauri::command]
async fn para_core_start_claude(session_name: String) -> Result<String, String> {
    log::info!("Starting Claude for session: {session_name}");
    
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    let command = manager.start_claude_in_session(&session_name)
        .map_err(|e| {
            log::error!("Failed to build Claude command for session {session_name}: {e}");
            format!("Failed to start Claude in session: {e}")
        })?;
    
    log::info!("Claude command for session {session_name}: {command}");
    
    // Parse command to extract working directory, agent name, and arguments
    let (cwd, agent_name, agent_args) = parse_agent_command(&command)?;
    
    // Create terminal with the appropriate agent
    let terminal_id = format!("session-{session_name}-top");
    let terminal_manager = get_terminal_manager().await;
    
    // Close existing terminal if it exists
    if terminal_manager.terminal_exists(&terminal_id).await? {
        terminal_manager.close_terminal(terminal_id.clone()).await?;
    }
    
    // Create new terminal with the agent directly
    log::info!("Creating terminal with {agent_name} directly: {terminal_id}");
    terminal_manager.create_terminal_with_app(
        terminal_id.clone(),
        cwd,
        agent_name,
        agent_args,
        vec![],
    ).await?;
    
    log::info!("Successfully started Claude in terminal: {terminal_id}");
    Ok(command)
}

#[tauri::command]
async fn para_core_start_claude_orchestrator() -> Result<String, String> {
    log::info!("Starting Claude for orchestrator");
    
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    let command = manager.start_claude_in_orchestrator()
        .map_err(|e| format!("Failed to start Claude in orchestrator: {e}"))?;
    
    log::info!("Claude command for orchestrator: {command}");
    
    // Parse command to extract working directory, agent name, and arguments
    let (cwd, agent_name, agent_args) = parse_agent_command(&command)?;
    
    // Create terminal with the appropriate agent
    let terminal_id = "orchestrator-top".to_string();
    let terminal_manager = get_terminal_manager().await;
    
    // Close existing terminal if it exists
    if terminal_manager.terminal_exists(&terminal_id).await? {
        terminal_manager.close_terminal(terminal_id.clone()).await?;
    }
    
    // Create new terminal with the agent directly
    log::info!("Creating terminal with {agent_name} directly: {terminal_id}");
    terminal_manager.create_terminal_with_app(
        terminal_id.clone(),
        cwd,
        agent_name,
        agent_args,
        vec![],
    ).await?;
    
    log::info!("Successfully started Claude in terminal: {terminal_id}");
    Ok(command)
}

#[tauri::command]
async fn para_core_set_skip_permissions(enabled: bool) -> Result<(), String> {
    let core = get_para_core().await;
    let core = core.lock().await;
    
    core.db.set_skip_permissions(enabled)
        .map_err(|e| format!("Failed to set skip permissions: {e}"))
}

#[tauri::command]
async fn para_core_get_skip_permissions() -> Result<bool, String> {
    let core = get_para_core().await;
    let core = core.lock().await;
    
    core.db.get_skip_permissions()
        .map_err(|e| format!("Failed to get skip permissions: {e}"))
}

#[tauri::command]
async fn para_core_set_agent_type(agent_type: String) -> Result<(), String> {
    let core = get_para_core().await;
    let core = core.lock().await;
    
    core.db.set_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set agent type: {e}"))
}

#[tauri::command]
async fn para_core_get_agent_type() -> Result<String, String> {
    let core = get_para_core().await;
    let core = core.lock().await;
    
    core.db.get_agent_type()
        .map_err(|e| format!("Failed to get agent type: {e}"))
}

#[tauri::command]
async fn open_in_vscode(worktree_path: String) -> Result<(), String> {
    log::info!("Opening VSCode for worktree: {worktree_path}");
    
    let output = std::process::Command::new("code")
        .arg(&worktree_path)
        .output()
        .map_err(|e| {
            log::error!("Failed to execute VSCode command: {e}");
            format!("Failed to open VSCode: {e}")
        })?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("VSCode command failed: {stderr}");
        return Err(format!("VSCode command failed: {stderr}"));
    }
    
    log::info!("Successfully opened VSCode for: {worktree_path}");
    Ok(())
}

#[tauri::command]
async fn para_core_mark_session_ready(name: String, auto_commit: bool) -> Result<bool, String> {
    log::info!("Marking session {name} as ready for merge (auto_commit: {auto_commit})");
    
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.mark_session_ready(&name, auto_commit)
        .map_err(|e| format!("Failed to mark session as ready: {e}"))
}

#[tauri::command]
async fn para_core_unmark_session_ready(name: String) -> Result<(), String> {
    log::info!("Unmarking session {name} as ready for merge");
    
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.unmark_session_ready(&name)
        .map_err(|e| format!("Failed to unmark session as ready: {e}"))
}

fn main() {
    // Initialize logging
    logging::init_logging();
    log::info!("Para UI starting...");
    
    // Create cleanup guard that will run on exit
    let _cleanup_guard = cleanup::TerminalCleanupGuard;

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            terminal_exists,
            get_terminal_buffer,
            get_terminal_activity_status,
            get_all_terminal_activity,
            get_current_directory,
            para_core_create_session,
            para_core_list_sessions,
            para_core_list_enriched_sessions,
            para_core_get_session,
            para_core_cancel_session,
            para_core_update_git_stats,
            para_core_cleanup_orphaned_worktrees,
            para_core_start_claude,
            para_core_start_claude_orchestrator,
            para_core_set_skip_permissions,
            para_core_get_skip_permissions,
            para_core_mark_session_ready,
            para_core_unmark_session_ready,
            para_core_set_agent_type,
            para_core_get_agent_type,
            open_in_vscode,
            diff_commands::get_changed_files_from_main,
            diff_commands::get_file_diff_from_main,
            diff_commands::get_current_branch_name,
            diff_commands::get_base_branch_name,
            diff_commands::get_commit_comparison_info
        ])
        .setup(|app| {
            // Start activity tracking for para_core sessions
            let app_handle = app.handle().clone();
            
            // Start terminal monitoring for stuck detection
            let monitor_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                start_terminal_monitoring(monitor_handle).await;
            });
            tauri::async_runtime::spawn(async move {
                let core = get_para_core().await;
                let db = {
                    let core_lock = core.lock().await;
                    Arc::new(core_lock.db.clone())
                };
                para_core::activity::start_activity_tracking_with_app(db, app_handle);
            });
            
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Cleanup terminals when window is closed
                tauri::async_runtime::block_on(async {
                    let manager = get_terminal_manager().await;
                    let _ = manager.close_all().await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use tempfile::TempDir;
    use serial_test::serial;

    #[test]
    fn test_parse_agent_command_claude_with_prompt() {
        let cmd = r#"cd /tmp/work && claude --dangerously-skip-permissions "do the thing""#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/tmp/work");
        assert_eq!(agent, "claude");
        assert_eq!(args, vec!["--dangerously-skip-permissions", "do the thing"]);
    }

    #[test]
    fn test_parse_agent_command_claude_resume() {
        let cmd = r#"cd /repo && claude -r "1234""#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/repo");
        assert_eq!(agent, "claude");
        assert_eq!(args, vec!["-r", "1234"]);
    }

    #[test]
    fn test_parse_agent_command_cursor_with_force_and_prompt() {
        let cmd = r#"cd /a/b && cursor-agent -f "implement \"feature\"""#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/a/b");
        assert_eq!(agent, "cursor-agent");
        assert_eq!(args, vec!["-f", "implement \"feature\""]);
    }

    #[test]
    fn test_parse_agent_command_invalid_format() {
        let cmd = "echo hi";
        let res = parse_agent_command(cmd);
        assert!(res.is_err());
    }

    #[test]
    #[serial]
    fn test_get_current_directory_from_src_tauri_returns_parent() {
        let tmp = TempDir::new().unwrap();
        let project_root = tmp.path();
        let src_tauri = project_root.join("src-tauri");
        std::fs::create_dir_all(&src_tauri).unwrap();

        let prev = env::current_dir().unwrap();
        env::set_current_dir(&src_tauri).unwrap();

        let dir = get_current_directory().unwrap();
        // canonicalize to handle /private prefix on macOS temp dirs
        let exp = std::fs::canonicalize(project_root).unwrap();
        let got = std::fs::canonicalize(dir).unwrap();
        assert_eq!(got, exp);

        env::set_current_dir(prev).unwrap();
    }

    #[test]
    #[serial]
    fn test_get_current_directory_from_non_src_tauri_returns_current() {
        let tmp = TempDir::new().unwrap();
        let prev = env::current_dir().unwrap();
        env::set_current_dir(tmp.path()).unwrap();

        let dir = get_current_directory().unwrap();
        let exp = std::fs::canonicalize(tmp.path()).unwrap();
        let got = std::fs::canonicalize(dir).unwrap();
        assert_eq!(got, exp);

        env::set_current_dir(prev).unwrap();
    }
}
