use std::process::Command;
use crate::para_core::db_app_config::AppConfigMethods;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OpenApp {
    pub id: String,   // e.g., "finder", "cursor", "vscode", "ghostty", "warp", "terminal"
    pub name: String, // Display name
    pub kind: String, // "editor" | "terminal" | "system"
}

fn is_command_available(cmd: &str) -> bool {
    which::which(cmd).is_ok()
}

fn is_macos_app_installed(app_name: &str) -> bool {
    // We rely on `open -Ra` which returns exit status 0 if app exists
    Command::new("open")
        .args(["-Ra", app_name])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn detect_available_apps() -> Vec<OpenApp> {
    let mut apps: Vec<OpenApp> = Vec::new();

    // Finder (always available on macOS)
    if cfg!(target_os = "macos") {
        apps.push(OpenApp { id: "finder".into(), name: "Finder".into(), kind: "system".into() });
    }

    // Cursor editor
    if is_command_available("cursor") || (cfg!(target_os = "macos") && is_macos_app_installed("Cursor")) {
        apps.push(OpenApp { id: "cursor".into(), name: "Cursor".into(), kind: "editor".into() });
    }

    // VS Code
    if is_command_available("code") || (cfg!(target_os = "macos") && is_macos_app_installed("Visual Studio Code")) {
        apps.push(OpenApp { id: "vscode".into(), name: "VS Code".into(), kind: "editor".into() });
    }

    // Ghostty
    if is_command_available("ghostty") || (cfg!(target_os = "macos") && is_macos_app_installed("Ghostty")) {
        apps.push(OpenApp { id: "ghostty".into(), name: "Ghostty".into(), kind: "terminal".into() });
    }

    // Warp
    if is_command_available("warp") || (cfg!(target_os = "macos") && is_macos_app_installed("Warp")) {
        apps.push(OpenApp { id: "warp".into(), name: "Warp".into(), kind: "terminal".into() });
    }

    // Apple Terminal
    if cfg!(target_os = "macos") {
        apps.push(OpenApp { id: "terminal".into(), name: "Terminal".into(), kind: "terminal".into() });
    }

    apps
}

fn open_path_in(app_id: &str, path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        match app_id {
            "finder" => {
                Command::new("open").arg(path).status().map_err(|e| e.to_string())?
                    .success().then_some(()).ok_or_else(|| "Failed to open in Finder".to_string())
            }
            "cursor" => {
                if is_command_available("cursor") {
                    Command::new("cursor").arg(path).status()
                } else {
                    Command::new("open").args(["-a", "Cursor", path]).status()
                }.map_err(|e| e.to_string())?
                .success().then_some(()).ok_or_else(|| "Failed to open in Cursor".to_string())
            }
            "vscode" => {
                if is_command_available("code") {
                    Command::new("code").arg(path).status()
                } else {
                    Command::new("open").args(["-a", "Visual Studio Code", path]).status()
                }.map_err(|e| e.to_string())?
                .success().then_some(()).ok_or_else(|| "Failed to open in VS Code".to_string())
            }
            "ghostty" => {
                // Ghostty CLI does not launch the app directly; use macOS open with --args
                Command::new("open").args(["-a", "Ghostty", "--args", "--working-directory", path]).status()
                    .map_err(|e| e.to_string())?
                    .success().then_some(()).ok_or_else(|| "Failed to open in Ghostty".to_string())
            }
            "warp" => {
                if is_command_available("warp") {
                    // Warp CLI can open a directory focus
                    Command::new("warp").arg("--cwd").arg(path).status()
                } else {
                    Command::new("open").args(["-a", "Warp", path]).status()
                }.map_err(|e| e.to_string())?
                .success().then_some(()).ok_or_else(|| "Failed to open in Warp".to_string())
            }
            "terminal" => {
                Command::new("open").args(["-a", "Terminal", path]).status()
                    .map_err(|e| e.to_string())?
                    .success().then_some(()).ok_or_else(|| "Failed to open in Terminal".to_string())
            }
            other => Err(format!("Unsupported app id: {other}")),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app_id, path);
        Err("Only macOS is supported for external open currently".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_available_apps_includes_finder_on_macos_or_empty_elsewhere() {
        let apps = detect_available_apps();
        if cfg!(target_os = "macos") {
            assert!(apps.iter().any(|a| a.id == "finder"));
        } else {
            // On non-mac, list may be empty or contain CLI detected entries
            // Ensure any discovered app entries have non-empty ids
            assert!(apps.iter().all(|a| !a.id.is_empty()));
        }
    }
}

#[tauri::command]
pub async fn list_available_open_apps() -> Result<Vec<OpenApp>, String> {
    Ok(detect_available_apps())
}

#[tauri::command]
pub async fn get_default_open_app() -> Result<String, String> {
    let core = crate::para_core::SchaltwerkCore::new(None)
        .map_err(|e| format!("Failed to init core: {e}"))?;
    Ok(core.db.get_default_open_app().unwrap_or_else(|_| "finder".to_string()))
}

#[tauri::command]
pub async fn set_default_open_app(app_id: String) -> Result<(), String> {
    let core = crate::para_core::SchaltwerkCore::new(None)
        .map_err(|e| format!("Failed to init core: {e}"))?;
    core.db.set_default_open_app(&app_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_in_app(app_id: String, worktree_path: String) -> Result<(), String> {
    open_path_in(&app_id, &worktree_path)
}
