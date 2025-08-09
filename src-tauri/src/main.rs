// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![warn(dead_code)]
#![warn(unused_imports)]
#![warn(unused_variables)]

mod cleanup;
mod logging;
mod terminal;
mod para_cli;

use std::sync::Arc;
use terminal::TerminalManager;
use tokio::sync::OnceCell;
use para_cli::{EnrichedSession, SessionsSummary, ParaService};

static TERMINAL_MANAGER: OnceCell<Arc<TerminalManager>> = OnceCell::const_new();

async fn get_terminal_manager() -> Arc<TerminalManager> {
    TERMINAL_MANAGER.get_or_init(|| async {
        Arc::new(TerminalManager::new())
    }).await.clone()
}

#[tauri::command]
async fn get_para_sessions(include_archived: bool) -> Result<Vec<EnrichedSession>, String> {
    let service = ParaService::new()
        .map_err(|e| format!("Failed to initialize para service: {e}"))?;
    
    service.get_all_sessions(include_archived)
        .await
        .map_err(|e| format!("Failed to get sessions: {e}"))
}

#[tauri::command]
async fn get_para_session(session_name: String) -> Result<Option<EnrichedSession>, String> {
    let service = ParaService::new()
        .map_err(|e| format!("Failed to initialize para service: {e}"))?;
    
    service.get_session(&session_name)
        .await
        .map_err(|e| format!("Failed to get session: {e}"))
}

#[tauri::command]
async fn get_para_summary() -> Result<SessionsSummary, String> {
    let service = ParaService::new()
        .map_err(|e| format!("Failed to initialize para service: {e}"))?;
    
    service.get_summary()
        .await
        .map_err(|e| format!("Failed to get summary: {e}"))
}

#[tauri::command]
async fn refresh_para_sessions() -> Result<(), String> {
    let service = ParaService::new()
        .map_err(|e| format!("Failed to initialize para service: {e}"))?;
    
    service.invalidate_cache().await;
    Ok(())
}

#[tauri::command]
async fn para_finish_session(session_id: String, message: String, branch: Option<String>) -> Result<(), String> {
    let service = ParaService::new()
        .map_err(|e| format!("Failed to initialize para service: {e}"))?;
    
    service.finish_session(&session_id, &message, branch.as_deref())
        .await
        .map_err(|e| format!("Failed to finish session: {e}"))
}

#[tauri::command]
async fn para_cancel_session(session_id: String, force: bool) -> Result<(), String> {
    let service = ParaService::new()
        .map_err(|e| format!("Failed to initialize para service: {e}"))?;
    
    service.cancel_session(&session_id, force)
        .await
        .map_err(|e| format!("Failed to cancel session: {e}"))
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
    manager.terminal_exists(id).await
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
            get_para_sessions,
            get_para_session,
            get_para_summary,
            refresh_para_sessions,
            para_finish_session,
            para_cancel_session
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                para_cli::start_session_monitor(app_handle).await;
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
