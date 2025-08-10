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

fn parse_claude_command(command: &str) -> Result<(String, Vec<String>), String> {
    // Command format: "cd /path/to/worktree && claude [args]"
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
    
    // Parse claude command and arguments
    let claude_part = parts[1];
    if !claude_part.starts_with("claude") {
        return Err(format!("Second part doesn't start with 'claude': {command}"));
    }
    
    // Split the claude command into arguments, handling quoted strings
    let mut args = Vec::new();
    let mut current_arg = String::new();
    let mut in_quotes = false;
    let mut chars = claude_part.chars().peekable();
    
    // Skip "claude" part
    for _ in 0..6 {
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
    
    Ok((cwd, args))
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
    let core = get_para_core().await;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    let session = manager.create_session(&name, prompt.as_deref(), base_branch.as_deref())
        .map_err(|e| format!("Failed to create session: {e}"))?;

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
    
    // Parse command to extract working directory and arguments
    let (cwd, claude_args) = parse_claude_command(&command)?;
    
    // Create terminal with Claude directly
    let terminal_id = format!("session-{session_name}-top");
    let terminal_manager = get_terminal_manager().await;
    
    // Close existing terminal if it exists
    if terminal_manager.terminal_exists(&terminal_id).await? {
        terminal_manager.close_terminal(terminal_id.clone()).await?;
    }
    
    // Create new terminal with Claude directly
    log::info!("Creating terminal with Claude directly: {terminal_id}");
    terminal_manager.create_terminal_with_app(
        terminal_id.clone(),
        cwd,
        "claude".to_string(),
        claude_args,
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
    
    // Parse command to extract working directory and arguments
    let (cwd, claude_args) = parse_claude_command(&command)?;
    
    // Create terminal with Claude directly
    let terminal_id = "orchestrator-top".to_string();
    let terminal_manager = get_terminal_manager().await;
    
    // Close existing terminal if it exists
    if terminal_manager.terminal_exists(&terminal_id).await? {
        terminal_manager.close_terminal(terminal_id.clone()).await?;
    }
    
    // Create new terminal with Claude directly
    log::info!("Creating terminal with Claude directly: {terminal_id}");
    terminal_manager.create_terminal_with_app(
        terminal_id.clone(),
        cwd,
        "claude".to_string(),
        claude_args,
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
            open_in_vscode,
            diff_commands::get_changed_files_from_main,
            diff_commands::get_file_diff_from_main,
            diff_commands::get_current_branch_name,
            diff_commands::get_commit_comparison_info
        ])
        .setup(|app| {
            // Start activity tracking for para_core sessions
            let app_handle = app.handle().clone();
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
