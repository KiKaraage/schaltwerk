// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![warn(dead_code)]
#![warn(unused_imports)]
#![warn(unused_variables)]

mod cleanup;
mod logging;
mod pty;

#[tauri::command]
async fn create_terminal(app: tauri::AppHandle, id: String, cwd: String) -> Result<String, String> {
    pty::create_terminal(app, id, cwd).await
}

#[tauri::command]
async fn write_terminal(id: String, data: String) -> Result<(), String> {
    pty::write_terminal(&id, &data).await
}

#[tauri::command]
async fn resize_terminal(id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty::resize_terminal(&id, cols, rows).await
}

#[tauri::command]
async fn close_terminal(id: String) -> Result<(), String> {
    pty::close_terminal(&id).await
}

#[tauri::command]
async fn terminal_exists(id: String) -> Result<bool, String> {
    pty::terminal_exists(&id).await
}

#[tauri::command]
async fn get_terminal_buffer(id: String) -> Result<String, String> {
    pty::get_terminal_buffer(&id).await
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
            get_terminal_buffer
        ])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Cleanup terminals when window is closed
                tauri::async_runtime::block_on(async {
                    cleanup::cleanup_all_terminals().await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
