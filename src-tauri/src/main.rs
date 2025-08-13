// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![warn(dead_code)]
#![warn(unused_imports)]
#![warn(unused_variables)]

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod cleanup;
mod diff_commands;
mod logging;
mod terminal;
mod para_core;
mod open_apps;
mod projects;
mod project_manager;

use std::sync::Arc;
use project_manager::ProjectManager;
use tokio::sync::OnceCell;
use std::collections::HashMap;
use tokio::sync::Mutex;

static PROJECT_MANAGER: OnceCell<Arc<ProjectManager>> = OnceCell::const_new();

#[derive(Clone, Debug)]
struct QueuedMessage {
    message: String,
    message_type: String,
    timestamp: u64,
}

type MessageQueue = Arc<Mutex<HashMap<String, Vec<QueuedMessage>>>>;
static QUEUED_MESSAGES: OnceCell<MessageQueue> = OnceCell::const_new();

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

async fn get_project_manager() -> Arc<ProjectManager> {
    PROJECT_MANAGER.get_or_init(|| async {
        Arc::new(ProjectManager::new())
    }).await.clone()
}

async fn get_terminal_manager() -> Result<Arc<terminal::TerminalManager>, String> {
    let manager = get_project_manager().await;
    manager.current_terminal_manager().await
        .map_err(|e| format!("Failed to get terminal manager: {e}"))
}

async fn get_para_core() -> Result<Arc<tokio::sync::Mutex<para_core::SchaltwerkCore>>, String> {
    let manager = get_project_manager().await;
    manager.current_para_core().await
        .map_err(|e| format!("Failed to get para core: {e}"))
}

async fn get_message_queue() -> MessageQueue {
    QUEUED_MESSAGES.get_or_init(|| async {
        Arc::new(Mutex::new(HashMap::new()))
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
            
            let manager = match get_terminal_manager().await {
                Ok(m) => m,
                Err(_) => {
                    // Skip monitoring when no active project - this is normal during startup
                    continue;
                }
            };
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
                        
                        if let Err(e) = app.emit("schaltwerk:terminal-stuck", &notification) {
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
                        
                        if let Err(e) = app.emit("schaltwerk:terminal-unstuck", &notification) {
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
    
    let core = get_para_core().await?;
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
    let manager = get_terminal_manager().await?;
    manager.set_app_handle(app.clone()).await;
    manager.create_terminal(id.clone(), cwd).await?;
    
    // Check for and deliver any queued messages for this terminal
    let queue = get_message_queue().await;
    let mut queue_lock = queue.lock().await;
    if let Some(messages) = queue_lock.remove(&id) {
        log::info!("Delivering {} queued messages to terminal {}", messages.len(), id);
        drop(queue_lock); // Release the lock before async operations
        
        for queued_msg in messages {
            let message = &queued_msg.message;
            let formatted_message = match queued_msg.message_type.as_str() {
                "system" => format!("\n📢 System: {message}\n"),
                _ => format!("\n💬 Follow-up: {message}\n"),
            };
            
            if let Err(e) = manager.write_terminal(id.clone(), formatted_message.as_bytes().to_vec()).await {
                log::warn!("Failed to deliver queued message to terminal {id}: {e}");
            } else {
                log::info!("Successfully delivered queued message to terminal {id}");
            }
            
            // Also emit event for frontend notification
            use tauri::Emitter;
            #[derive(serde::Serialize, Clone)]
            struct FollowUpMessagePayload {
                session_name: String,
                message: String,
                message_type: String,
                timestamp: u64,
                terminal_id: String,
            }
            
            let session_name = if id.starts_with("session-") {
                id.split('-').nth(1).unwrap_or("unknown").to_string()
            } else {
                "orchestrator".to_string()
            };
            
            let message_payload = FollowUpMessagePayload {
                session_name,
                message: queued_msg.message,
                message_type: queued_msg.message_type,
                timestamp: queued_msg.timestamp,
                terminal_id: id.clone(),
            };
            
            if let Err(e) = app.emit("schaltwerk:follow-up-message", &message_payload) {
                log::error!("Failed to emit queued follow-up-message event: {e}");
            }
        }
    }
    
    Ok(id)
}

#[tauri::command]
async fn write_terminal(id: String, data: String) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    manager.write_terminal(id, data.into_bytes()).await
}

#[tauri::command]
async fn resize_terminal(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    manager.resize_terminal(id, cols, rows).await
}

#[tauri::command]
async fn close_terminal(id: String) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    manager.close_terminal(id).await
}

#[tauri::command]
async fn terminal_exists(id: String) -> Result<bool, String> {
    let manager = get_terminal_manager().await?;
    manager.terminal_exists(&id).await
}

#[tauri::command]
async fn get_terminal_buffer(id: String) -> Result<String, String> {
    let manager = get_terminal_manager().await?;
    manager.get_terminal_buffer(id).await
}

#[tauri::command]
async fn get_terminal_activity_status(id: String) -> Result<(bool, u64), String> {
    let manager = get_terminal_manager().await?;
    manager.get_terminal_activity_status(id).await
}

#[tauri::command]
async fn get_all_terminal_activity() -> Result<Vec<(String, bool, u64)>, String> {
    let manager = get_terminal_manager().await?;
    Ok(manager.get_all_terminal_activity().await)
}

#[tauri::command]
async fn get_current_directory() -> Result<String, String> {
    // Use the current active project path if available, otherwise fallback to current directory
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        Ok(project.path.to_string_lossy().to_string())
    } else {
        // Fallback for when no project is active (needed for Claude sessions)
        let current_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {e}"))?;
        
        if current_dir.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
            current_dir.parent()
                .map(|p| p.to_string_lossy().to_string())
                .ok_or_else(|| "Failed to get parent directory".to_string())
        } else {
            Ok(current_dir.to_string_lossy().to_string())
        }
    }
}

use std::process::Command;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{body::Incoming as IncomingBody, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use http_body_util::BodyExt;

static MCP_SERVER_PROCESS: OnceCell<Arc<tokio::sync::Mutex<Option<std::process::Child>>>> = OnceCell::const_new();

async fn start_webhook_server(app: tauri::AppHandle) {
    async fn handle_webhook(
        app: tauri::AppHandle,
        req: Request<IncomingBody>,
    ) -> Result<Response<String>, hyper::Error> {
        let method = req.method();
        let path = req.uri().path();
        
        log::debug!("Webhook request: {method} {path}");
        
        match (method, path) {
            (&hyper::Method::POST, "/webhook/session-added") => {
                // Parse the JSON body
                let body = req.into_body();
                let body_bytes = body.collect().await?.to_bytes();
                
                if let Ok(body_str) = String::from_utf8(body_bytes.to_vec()) {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body_str) {
                        log::info!("Received session-added webhook: {payload}");
                        
                        // Extract session information and emit the event
                        if let Some(session_name) = payload.get("session_name").and_then(|v| v.as_str()) {
                            #[derive(serde::Serialize, Clone)]
                            struct SessionAddedPayload {
                                session_name: String,
                                branch: String,
                                worktree_path: String,
                                parent_branch: String,
                            }
                            
                            let session_payload = SessionAddedPayload {
                                session_name: session_name.to_string(),
                                branch: payload.get("branch").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                worktree_path: payload.get("worktree_path").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                parent_branch: payload.get("parent_branch").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            };
                            
                            if let Err(e) = app.emit("schaltwerk:session-added", &session_payload) {
                                log::error!("Failed to emit session-added event: {e}");
                            }
                        }
                    }
                }
                
                Ok(Response::new("OK".to_string()))
            }
            (&hyper::Method::POST, "/webhook/session-removed") => {
                // Parse the JSON body for session removal
                let body = req.into_body();
                let body_bytes = body.collect().await?.to_bytes();
                
                if let Ok(body_str) = String::from_utf8(body_bytes.to_vec()) {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body_str) {
                        log::info!("Received session-removed webhook: {payload}");
                        
                        if let Some(session_name) = payload.get("session_name").and_then(|v| v.as_str()) {
                            #[derive(serde::Serialize, Clone)]
                            struct SessionRemovedPayload {
                                session_name: String,
                            }
                            
                            let session_payload = SessionRemovedPayload {
                                session_name: session_name.to_string(),
                            };
                            
                            if let Err(e) = app.emit("schaltwerk:session-removed", &session_payload) {
                                log::error!("Failed to emit session-removed event: {e}");
                            }
                        }
                    }
                }
                
                Ok(Response::new("OK".to_string()))
            }
            (&hyper::Method::POST, "/webhook/follow-up-message") => {
                // Parse the JSON body for follow-up message
                let body = req.into_body();
                let body_bytes = body.collect().await?.to_bytes();
                
                if let Ok(body_str) = String::from_utf8(body_bytes.to_vec()) {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body_str) {
                        log::info!("Received follow-up-message webhook: {payload}");
                        
                        if let (Some(session_name), Some(message)) = (
                            payload.get("session_name").and_then(|v| v.as_str()),
                            payload.get("message").and_then(|v| v.as_str())
                        ) {
                            let message_type = payload.get("message_type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("user");
                            let timestamp = payload.get("timestamp")
                                .and_then(|v| v.as_u64())
                                .unwrap_or_else(|| std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap().as_millis() as u64);
                            
                            // Format the message for terminal display
                            let formatted_message = match message_type {
                                "system" => format!("\n📢 System: {message}\n"),
                                _ => format!("\n💬 Follow-up: {message}\n"),
                            };
                            
                            // Try to write to the session's top terminal (where agent is usually active)
                            let terminal_id = format!("session-{session_name}-top");
                            
                            if let Ok(manager) = get_terminal_manager().await {
                                match manager.terminal_exists(&terminal_id).await {
                                    Ok(true) => {
                                        // Terminal exists, write the message directly
                                        if let Err(e) = manager.write_terminal(terminal_id.clone(), formatted_message.as_bytes().to_vec()).await {
                                            log::warn!("Failed to write follow-up message to terminal {terminal_id}: {e}");
                                        } else {
                                            log::info!("Successfully delivered follow-up message to terminal {terminal_id}");
                                        }
                                    },
                                    Ok(false) => {
                                        // Terminal doesn't exist yet - queue the message for later delivery
                                        log::info!("Terminal {terminal_id} doesn't exist yet, queuing message");
                                        let queue = get_message_queue().await;
                                        let mut queue_lock = queue.lock().await;
                                        let queued_msg = QueuedMessage {
                                            message: message.to_string(),
                                            message_type: message_type.to_string(),
                                            timestamp,
                                        };
                                        queue_lock.entry(terminal_id.clone()).or_insert_with(Vec::new).push(queued_msg);
                                        log::info!("Queued message for terminal {terminal_id}: {message}");
                                    },
                                    Err(e) => {
                                        log::warn!("Failed to check if terminal {terminal_id} exists: {e}");
                                    }
                                }
                            } else {
                                log::warn!("Could not get terminal manager for follow-up message");
                            }
                            
                            // Always emit event for frontend notification
                            #[derive(serde::Serialize, Clone)]
                            struct FollowUpMessagePayload {
                                session_name: String,
                                message: String,
                                message_type: String,
                                timestamp: u64,
                                terminal_id: String,
                            }
                            
                            let message_payload = FollowUpMessagePayload {
                                session_name: session_name.to_string(),
                                message: message.to_string(),
                                message_type: message_type.to_string(),
                                timestamp,
                                terminal_id,
                            };
                            
                            if let Err(e) = app.emit("schaltwerk:follow-up-message", &message_payload) {
                                log::error!("Failed to emit follow-up-message event: {e}");
                            }
                        }
                    }
                }
                
                Ok(Response::new("OK".to_string()))
            }
            _ => {
                let mut response = Response::new("Not Found".to_string());
                *response.status_mut() = StatusCode::NOT_FOUND;
                Ok(response)
            }
        }
    }
    
    // Start the webhook server on a local port
    let addr = "127.0.0.1:8547";
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            log::warn!("Failed to start webhook server on {addr}: {e}");
            return;
        }
    };
    
    log::info!("Webhook server listening on http://{addr}");
    
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                log::error!("Failed to accept webhook connection: {e}");
                continue;
            }
        };
        
        let io = TokioIo::new(stream);
        let app_clone = app.clone();
        
        tokio::task::spawn(async move {
            if let Err(err) = http1::Builder::new()
                .serve_connection(io, service_fn(move |req| handle_webhook(app_clone.clone(), req)))
                .await
            {
                log::error!("Error serving webhook connection: {err:?}");
            }
        });
    }
}

#[tauri::command]
async fn start_mcp_server(_port: Option<u16>) -> Result<(), String> {
    let process_mutex = MCP_SERVER_PROCESS.get_or_init(|| async {
        Arc::new(tokio::sync::Mutex::new(None))
    }).await;
    
    let mut process_guard = process_mutex.lock().await;
    
    // Check if already running
    if let Some(ref mut process) = *process_guard {
        match process.try_wait() {
            Ok(Some(_)) => {
                // Process has exited, continue to start new one
            }
            Ok(None) => {
                // Process is still running
                return Ok(());
            }
            Err(_) => {
                // Error checking status, continue to start new one
            }
        }
    }
    
    // Get the path to the MCP server
    let app_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {e}"))?;
    
    let mcp_server_path = if app_dir.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
        app_dir.parent()
            .map(|p| p.join("mcp-server").join("build").join("schaltwerk-mcp-server.js"))
            .ok_or_else(|| "Failed to get parent directory".to_string())?
    } else {
        app_dir.join("mcp-server").join("build").join("schaltwerk-mcp-server.js")
    };
    
    if !mcp_server_path.exists() {
        return Err(format!("MCP server not found at: {}", mcp_server_path.display()));
    }
    
    // Start the MCP server as a subprocess
    let child = Command::new("node")
        .arg(mcp_server_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start MCP server: {e}"))?;
    
    *process_guard = Some(child);
    
    Ok(())
}

use tauri::Emitter;

#[tauri::command]
async fn para_core_create_session(app: tauri::AppHandle, name: String, prompt: Option<String>, base_branch: Option<String>, user_edited_name: Option<bool>) -> Result<para_core::Session, String> {
    // Consider it auto-generated only if it matches docker-style pattern
    // AND the user did not edit the field explicitly.
    let looks_docker_style = name.contains('_') && name.split('_').count() == 2;
    let was_user_edited = user_edited_name.unwrap_or(false);
    let was_auto_generated = looks_docker_style && !was_user_edited;
    
    let core = get_para_core().await?;
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
        "schaltwerk:session-added",
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
                let core = match get_para_core().await {
                    Ok(c) => c,
                    Err(e) => {
                        log::warn!("Cannot get para_core for session '{session_name_clone}': {e}");
                        return;
                    }
                };
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
                    (session.id.clone(), session.worktree_path.clone(), session.repository_path.clone(), session.branch.clone(), agent, session.initial_prompt.clone()),
                    core.db.clone()
                )
            };
            
            let (session_id, worktree_path, repo_path, current_branch, agent, initial_prompt) = session_info;
            
            log::info!("Starting name generation for session '{}' with prompt: {:?}", 
                session_name_clone, initial_prompt.as_ref().map(|p| &p[..p.len().min(50)]));
            
            // Now do the async operation without holding any locks
            let ctx = crate::para_core::naming::SessionRenameContext {
                db: &db_clone,
                session_id: &session_id,
                worktree_path: &worktree_path,
                repo_path: &repo_path,
                current_branch: &current_branch,
                agent_type: &agent,
                initial_prompt: initial_prompt.as_deref(),
            };
            match crate::para_core::naming::generate_display_name_and_rename_branch(ctx).await {
                Ok(Some(display_name)) => {
                    log::info!("Successfully generated display name '{display_name}' for session '{session_name_clone}'");
                    
                    // Re-acquire lock only to get the updated sessions list
                    let core = match get_para_core().await {
                        Ok(c) => c,
                        Err(e) => {
                            log::warn!("Cannot get para_core for sessions refresh: {e}");
                            return;
                        }
                    };
                    let core = core.lock().await;
                    let manager = core.session_manager();
                    if let Ok(sessions) = manager.list_enriched_sessions() {
                        log::info!("Emitting sessions-refreshed event after name generation");
                        if let Err(e) = app_handle.emit("schaltwerk:sessions-refreshed", &sessions) {
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
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.list_sessions()
        .map_err(|e| format!("Failed to list sessions: {e}"))
}

#[tauri::command]
async fn para_core_get_session(name: String) -> Result<para_core::Session, String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.get_session(&name)
        .map_err(|e| format!("Failed to get session: {e}"))
}

#[tauri::command]
async fn para_core_cancel_session(app: tauri::AppHandle, name: String) -> Result<(), String> {
    log::info!("Starting cancel session: {name}");
    
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    match manager.cancel_session(&name) {
        Ok(()) => {
            log::info!("Successfully canceled session: {name}");
            #[derive(serde::Serialize, Clone)]
            struct SessionRemovedPayload { session_name: String }
            let _ = app.emit(
                "schaltwerk:session-removed",
                SessionRemovedPayload { session_name: name.clone() },
            );
            // Best-effort: close known session terminals to avoid orphaned PTYs
            if let Ok(manager) = get_terminal_manager().await {
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
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.update_git_stats(&session_id)
        .map_err(|e| format!("Failed to update git stats: {e}"))
}

#[tauri::command]
async fn para_core_cleanup_orphaned_worktrees() -> Result<(), String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.cleanup_orphaned_worktrees()
        .map_err(|e| format!("Failed to cleanup orphaned worktrees: {e}"))
}

#[tauri::command]
async fn para_core_start_claude(session_name: String) -> Result<String, String> {
    log::info!("Starting Claude for session: {session_name}");
    
    let core = get_para_core().await?;
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
    let terminal_manager = get_terminal_manager().await?;
    
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
async fn para_core_start_claude_orchestrator(terminal_id: String) -> Result<String, String> {
    log::info!("Starting Claude for orchestrator in terminal: {terminal_id}");
    
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    let command = manager.start_claude_in_orchestrator()
        .map_err(|e| format!("Failed to start Claude in orchestrator: {e}"))?;
    
    log::info!("Claude command for orchestrator: {command}");
    
    // Parse command to extract working directory, agent name, and arguments
    let (cwd, agent_name, agent_args) = parse_agent_command(&command)?;
    
    // Create terminal with the appropriate agent
    let terminal_manager = get_terminal_manager().await?;
    
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
    let core = get_para_core().await?;
    let core = core.lock().await;
    
    core.db.set_skip_permissions(enabled)
        .map_err(|e| format!("Failed to set skip permissions: {e}"))
}

#[tauri::command]
async fn para_core_get_skip_permissions() -> Result<bool, String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    
    core.db.get_skip_permissions()
        .map_err(|e| format!("Failed to get skip permissions: {e}"))
}

#[tauri::command]
async fn para_core_set_agent_type(agent_type: String) -> Result<(), String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    
    core.db.set_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set agent type: {e}"))
}

#[tauri::command]
async fn para_core_get_agent_type() -> Result<String, String> {
    let core = get_para_core().await?;
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
    log::info!("Marking session {name} as reviewed (auto_commit: {auto_commit})");
    
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.mark_session_ready(&name, auto_commit)
        .map_err(|e| format!("Failed to mark session as reviewed: {e}"))
}

#[tauri::command]
async fn para_core_unmark_session_ready(name: String) -> Result<(), String> {
    log::info!("Unmarking session {name} as reviewed");
    
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.unmark_session_ready(&name)
        .map_err(|e| format!("Failed to unmark session as reviewed: {e}"))
}

fn main() {
    // Initialize logging
    logging::init_logging();
    log::info!("Para UI starting...");
    
    // Create cleanup guard that will run on exit
    let _cleanup_guard = cleanup::TerminalCleanupGuard;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            start_mcp_server,
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
            para_core_create_draft_session,
            para_core_start_draft_session,
            para_core_update_session_state,
            para_core_update_draft_content,
            para_core_list_sessions_by_state,
            open_in_vscode,
            open_apps::get_default_open_app,
            open_apps::set_default_open_app,
            open_apps::list_available_open_apps,
            open_apps::open_in_app,
            diff_commands::get_changed_files_from_main,
            diff_commands::get_file_diff_from_main,
            diff_commands::get_current_branch_name,
            diff_commands::get_base_branch_name,
            diff_commands::get_commit_comparison_info,
            get_recent_projects,
            add_recent_project,
            update_recent_project_timestamp,
            remove_recent_project,
            is_git_repository,
            directory_exists,
            initialize_project,
            get_project_default_branch,
            list_project_branches,
            get_project_default_base_branch,
            set_project_default_base_branch
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
                match get_para_core().await {
                    Ok(core) => {
                        let db = {
                            let core_lock = core.lock().await;
                            Arc::new(core_lock.db.clone())
                        };
                        para_core::activity::start_activity_tracking_with_app(db, app_handle);
                    }
                    Err(e) => {
                        log::debug!("No active project for activity tracking: {e}");
                    }
                }
            });
            
            // Start webhook server for MCP notifications
            let webhook_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                start_webhook_server(webhook_handle).await;
            });
            
            // Try to start MCP server automatically (don't fail if it doesn't work)
            tauri::async_runtime::spawn(async {
                if let Err(e) = start_mcp_server(None).await {
                    log::warn!("Failed to auto-start MCP server: {e}");
                }
            });
            
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Cleanup all project terminals when window is closed
                tauri::async_runtime::block_on(async {
                    let manager = get_project_manager().await;
                    manager.cleanup_all().await;
                });
                
                // Stop MCP server if running
                if let Some(process_mutex) = MCP_SERVER_PROCESS.get() {
                    if let Ok(mut guard) = process_mutex.try_lock() {
                        if let Some(mut process) = guard.take() {
                            let _ = process.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_recent_projects() -> Result<Vec<projects::RecentProject>, String> {
    let history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    Ok(history.get_recent_projects())
}

#[tauri::command]
fn add_recent_project(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history.add_project(&path)
        .map_err(|e| format!("Failed to add project: {e}"))?;
    Ok(())
}

#[tauri::command]
fn update_recent_project_timestamp(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history.update_timestamp(&path)
        .map_err(|e| format!("Failed to update project: {e}"))?;
    Ok(())
}

#[tauri::command]
fn remove_recent_project(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history.remove_project(&path)
        .map_err(|e| format!("Failed to remove project: {e}"))?;
    Ok(())
}

#[tauri::command]
fn is_git_repository(path: String) -> Result<bool, String> {
    Ok(projects::is_git_repository(std::path::Path::new(&path)))
}

#[tauri::command]
fn directory_exists(path: String) -> Result<bool, String> {
    Ok(projects::directory_exists(std::path::Path::new(&path)))
}

#[tauri::command]
async fn initialize_project(path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(path);
    let manager = get_project_manager().await;
    
    // Switch to the project (creates it if it doesn't exist)
    manager.switch_to_project(path)
        .await
        .map_err(|e| format!("Failed to initialize project: {e}"))?;
    
    Ok(())
}

#[tauri::command]
async fn get_project_default_branch() -> Result<String, String> {
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        crate::para_core::git::get_default_branch(&project.path)
            .map_err(|e| format!("Failed to get default branch: {e}"))
    } else {
        // No active project, try current directory
        let current_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {e}"))?;
        crate::para_core::git::get_default_branch(&current_dir)
            .map_err(|e| format!("Failed to get default branch: {e}"))
    }
}

#[tauri::command]
async fn list_project_branches() -> Result<Vec<String>, String> {
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        crate::para_core::git::list_branches(&project.path)
            .map_err(|e| format!("Failed to list branches: {e}"))
    } else {
        // No active project, try current directory
        let current_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {e}"))?;
        crate::para_core::git::list_branches(&current_dir)
            .map_err(|e| format!("Failed to list branches: {e}"))
    }
}

#[tauri::command]
async fn get_project_default_base_branch() -> Result<Option<String>, String> {
    let para_core = get_para_core().await?;
    let core = para_core.lock().await;
    core.db.get_default_base_branch()
        .map_err(|e| format!("Failed to get default base branch: {e}"))
}

#[tauri::command]
async fn set_project_default_base_branch(branch: Option<String>) -> Result<(), String> {
    let para_core = get_para_core().await?;
    let core = para_core.lock().await;
    core.db.set_default_base_branch(branch.as_deref())
        .map_err(|e| format!("Failed to set default base branch: {e}"))
}

#[tauri::command]
async fn para_core_create_draft_session(app: tauri::AppHandle, name: String, draft_content: String) -> Result<para_core::Session, String> {
    log::info!("Creating draft session: {name}");
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    let session = manager.create_draft_session(&name, &draft_content)
        .map_err(|e| format!("Failed to create draft session: {e}"))?;
    
    // Emit sessions-refreshed event after creating draft
    if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after creating draft session");
        if let Err(e) = app.emit("schaltwerk:sessions-refreshed", &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
    }
    
    Ok(session)
}

#[tauri::command]
async fn para_core_start_draft_session(app: tauri::AppHandle, name: String, base_branch: Option<String>) -> Result<(), String> {
    log::info!("Starting draft session: {name}");
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.start_draft_session(&name, base_branch.as_deref())
        .map_err(|e| format!("Failed to start draft session: {e}"))?;
    
    // Emit sessions-refreshed event after starting draft
    if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after starting draft session");
        if let Err(e) = app.emit("schaltwerk:sessions-refreshed", &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
    }
    
    Ok(())
}

#[tauri::command]
async fn para_core_update_session_state(name: String, state: String) -> Result<(), String> {
    log::info!("Updating session state: {name} -> {state}");
    
    let session_state = state.parse::<para_core::SessionState>()
        .map_err(|e| format!("Invalid session state: {e}"))?;
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.update_session_state(&name, session_state)
        .map_err(|e| format!("Failed to update session state: {e}"))
}

#[tauri::command]
async fn para_core_update_draft_content(name: String, content: String) -> Result<(), String> {
    log::info!("Updating draft content for session: {name}");
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.update_draft_content(&name, &content)
        .map_err(|e| format!("Failed to update draft content: {e}"))
}

#[tauri::command]
async fn para_core_list_sessions_by_state(state: String) -> Result<Vec<para_core::Session>, String> {
    log::info!("Listing sessions by state: {state}");
    
    let session_state = state.parse::<para_core::SessionState>()
        .map_err(|e| format!("Invalid session state: {e}"))?;
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.list_sessions_by_state(session_state)
        .map_err(|e| format!("Failed to list sessions by state: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

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

    // Tests removed: get_current_directory now uses active project instead of current working directory
}
