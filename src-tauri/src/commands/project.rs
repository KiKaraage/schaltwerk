use crate::{get_project_manager, projects};
use std::path::PathBuf;

#[tauri::command]
pub fn get_recent_projects() -> Result<Vec<projects::RecentProject>, String> {
    let history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    Ok(history.get_recent_projects())
}

#[tauri::command]
pub fn add_recent_project(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history.add_project(&path)
        .map_err(|e| format!("Failed to add project: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn update_recent_project_timestamp(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history.update_timestamp(&path)
        .map_err(|e| format!("Failed to update project: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn remove_recent_project(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history.remove_project(&path)
        .map_err(|e| format!("Failed to remove project: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn is_git_repository(path: String) -> Result<bool, String> {
    Ok(projects::is_git_repository(std::path::Path::new(&path)))
}

#[tauri::command]
pub fn directory_exists(path: String) -> Result<bool, String> {
    Ok(projects::directory_exists(std::path::Path::new(&path)))
}

#[tauri::command]
pub fn create_new_project(name: String, parent_path: String) -> Result<String, String> {
    let project_path = projects::create_new_project(&name, &parent_path)
        .map_err(|e| format!("{e}"))?;
    
    Ok(project_path.to_str()
        .ok_or_else(|| "Invalid path encoding".to_string())?
        .to_string())
}

#[tauri::command]
pub async fn initialize_project(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let manager = get_project_manager().await;
    
    manager.switch_to_project(path)
        .await
        .map_err(|e| format!("Failed to initialize project: {e}"))?;
    
    Ok(())
}

#[tauri::command]
pub async fn get_project_default_branch() -> Result<String, String> {
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        crate::para_core::git::get_default_branch(&project.path)
            .map_err(|e| format!("Failed to get default branch: {e}"))
    } else {
        let current_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {e}"))?;
        crate::para_core::git::get_default_branch(&current_dir)
            .map_err(|e| format!("Failed to get default branch: {e}"))
    }
}

#[tauri::command]
pub async fn list_project_branches() -> Result<Vec<String>, String> {
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        crate::para_core::git::list_branches(&project.path)
            .map_err(|e| format!("Failed to list branches: {e}"))
    } else {
        let current_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {e}"))?;
        crate::para_core::git::list_branches(&current_dir)
            .map_err(|e| format!("Failed to list branches: {e}"))
    }
}