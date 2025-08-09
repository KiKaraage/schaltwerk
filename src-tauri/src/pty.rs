use anyhow::Result;
use log::{debug, info, warn};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::LazyLock;
use tauri::AppHandle;
use tauri::Emitter;
use users::os::unix::UserExt;
use users::{get_current_uid, get_user_by_uid};

pub static PTYS: LazyLock<
    tauri::async_runtime::Mutex<HashMap<String, Box<dyn portable_pty::Child + Send>>>,
> = LazyLock::new(|| tauri::async_runtime::Mutex::new(HashMap::new()));
pub static MASTERS: LazyLock<
    tauri::async_runtime::Mutex<HashMap<String, Box<dyn MasterPty + Send>>>,
> = LazyLock::new(|| tauri::async_runtime::Mutex::new(HashMap::new()));
pub static WRITERS: LazyLock<tauri::async_runtime::Mutex<HashMap<String, Box<dyn Write + Send>>>> =
    LazyLock::new(|| tauri::async_runtime::Mutex::new(HashMap::new()));

pub async fn create_terminal(app: AppHandle, id: String, cwd: String) -> Result<String, String> {
    info!("Creating terminal: id={id}, cwd={cwd}");
    
    let pty_system = native_pty_system();
    // Start with a more reasonable default size that's closer to typical terminal dimensions
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    // Resolve user shell: prefer SHELL env, fallback to account default, finally zsh
    let shell_path = std::env::var("SHELL")
        .ok()
        .or_else(|| {
            let uid = get_current_uid();
            get_user_by_uid(uid).and_then(|u| u.shell().to_str().map(|s| s.to_string()))
        })
        .unwrap_or_else(|| "/bin/zsh".to_string());

    debug!("Starting shell: {shell_path}");

    // Create the command builder for the shell
    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.cwd(cwd);

    // Common terminal env so apps behave well
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Ensure HOME is set
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }

    // For fish shell, we need to ensure it's running in interactive mode
    // Fish doesn't use the same -i flag as bash/zsh
    if shell_path.contains("fish") {
        // Fish automatically runs in interactive mode when connected to a tty
        // No special flags needed
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    {
        let mut m = PTYS.lock().await;
        m.insert(id.clone(), child);
    }
    {
        let mut m = MASTERS.lock().await;
        m.insert(id.clone(), pair.master);
    }
    {
        let mut writers = WRITERS.lock().await;
        if !writers.contains_key(&id) {
            let masters = MASTERS.lock().await;
            let writer = masters
                .get(&id)
                .unwrap()
                .take_writer()
                .map_err(|e| e.to_string())?;
            writers.insert(id.clone(), writer);
        }
    }

    // spawn reader task to emit events
    let app_handle = app.clone();
    let id_for_task = id.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = {
            let masters = MASTERS.lock().await;
            masters
                .get(&id_for_task)
                .unwrap()
                .try_clone_reader()
                .unwrap()
        };
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let s = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(&format!("terminal-output-{id_for_task}"), s);
                }
                _ => break,
            }
        }
    });

    info!("Terminal created successfully: id={id}");
    Ok(id)
}

pub async fn write_terminal(id: &str, data: &str) -> Result<(), String> {
    let mut writers = WRITERS.lock().await;
    if let Some(writer) = writers.get_mut(id) {
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn resize_terminal(id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let masters = MASTERS.lock().await;
    if let Some(master) = masters.get(id) {
        master
            .resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn close_terminal(id: &str) -> Result<(), String> {
    // First, try to kill the child process
    {
        let mut m = PTYS.lock().await;
        if let Some(mut child) = m.remove(id) {
            // Try to kill the child process
            if let Err(e) = child.kill() {
                warn!("Failed to kill terminal process {id}: {e:?}");
            }
            // Wait for the process to exit
            let _ = child.wait();
        }
    }

    // Then clean up the master and writer
    {
        let mut m = MASTERS.lock().await;
        m.remove(id);
    }
    {
        let mut m = WRITERS.lock().await;
        m.remove(id);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_close_nonexistent_terminal() {
        // Closing a non-existent terminal should not panic
        let result = close_terminal("nonexistent").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_write_to_nonexistent_terminal() {
        // Writing to non-existent terminal should not panic
        let result = write_terminal("nonexistent", "test").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_resize_nonexistent_terminal() {
        // Resizing non-existent terminal should not panic
        let result = resize_terminal("nonexistent", 80, 24).await;
        assert!(result.is_ok());
    }
}
