use std::process::Command;
// no serde derives used in this module
use crate::get_para_core;
use crate::para_core::{git, types::ChangedFile};

#[tauri::command]
pub async fn get_changed_files_from_main(session_name: Option<String>) -> Result<Vec<ChangedFile>, String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    git::get_changed_files(std::path::Path::new(&repo_path), &base_branch)
        .map_err(|e| format!("Failed to compute changed files: {e}"))
}

#[tauri::command]
pub async fn get_file_diff_from_main(
    session_name: Option<String>, 
    file_path: String
) -> Result<(String, String), String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    
    let base_content = Command::new("git")
        .args(["-C", &repo_path, "show", &format!("{base_branch}:{file_path}")])
        .output()
        .map_err(|e| format!("Failed to get base content: {e}"))?;
    
    let base_text = if base_content.status.success() {
        String::from_utf8_lossy(&base_content.stdout).to_string()
    } else {
        String::new()
    };
    
    let worktree_path = std::path::Path::new(&repo_path).join(&file_path);
    let worktree_text = if worktree_path.exists() {
        std::fs::read_to_string(worktree_path)
            .map_err(|e| format!("Failed to read worktree file: {e}"))?
    } else {
        String::new()
    };
    
    Ok((base_text, worktree_text))
}

#[tauri::command]
pub async fn get_base_branch_name(session_name: Option<String>) -> Result<String, String> {
    get_base_branch(session_name).await
}

#[tauri::command]
pub async fn get_current_branch_name(session_name: Option<String>) -> Result<String, String> {
    let repo_path = get_repo_path(session_name).await?;
    
    let output = Command::new("git")
        .args(["-C", &repo_path, "branch", "--show-current"])
        .output()
        .map_err(|e| format!("Failed to get branch name: {e}"))?;
    
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn get_commit_comparison_info(session_name: Option<String>) -> Result<(String, String), String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    
    let base_output = Command::new("git")
        .args(["-C", &repo_path, "rev-parse", "--short", &base_branch])
        .output()
        .map_err(|e| format!("Failed to get base commit: {e}"))?;
    
    let base_commit = String::from_utf8_lossy(&base_output.stdout).trim().to_string();
    
    let head_output = Command::new("git")
        .args(["-C", &repo_path, "rev-parse", "--short", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to get HEAD commit: {e}"))?;
    
    let head_commit = String::from_utf8_lossy(&head_output.stdout).trim().to_string();
    
    Ok((base_commit, head_commit))
}

async fn get_repo_path(session_name: Option<String>) -> Result<String, String> {
    if let Some(name) = session_name {
        let core = get_para_core().await?;
        let core = core.lock().await;
        let manager = core.session_manager();
        
        let sessions = manager.list_enriched_sessions()
            .map_err(|e| format!("Failed to get sessions: {e}"))?;
        
        let session = sessions.into_iter().find(|s| s.info.session_id == name);
        
        if let Some(session) = session {
            Ok(session.info.worktree_path)
        } else {
            Err(format!("Session '{name}' not found"))
        }
    } else {
        // For diff commands without session, use current project path if available,
        // otherwise fall back to current directory for backward compatibility
        let manager = crate::get_project_manager().await;
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
}

async fn get_base_branch(session_name: Option<String>) -> Result<String, String> {
    if let Some(name) = session_name {
        let core = get_para_core().await?;
        let core = core.lock().await;
        let manager = core.session_manager();
        
        let sessions = manager.list_enriched_sessions()
            .map_err(|e| format!("Failed to get sessions: {e}"))?;
        
        let session = sessions.into_iter().find(|s| s.info.session_id == name);
        
        if let Some(session) = session {
            Ok(session.info.base_branch)
        } else {
            Err(format!("Session '{name}' not found"))
        }
    } else {
        // No session specified, get default branch from current project
        let manager = crate::get_project_manager().await;
        if let Ok(project) = manager.current_project().await {
            crate::para_core::git::get_default_branch(&project.path)
                .map_err(|e| format!("Failed to get default branch: {e}"))
        } else {
            // Fallback for when no project is active (needed for Claude sessions)
            let current_dir = std::env::current_dir()
                .map_err(|e| format!("Failed to get current directory: {e}"))?;
            crate::para_core::git::get_default_branch(&current_dir)
                .map_err(|e| format!("Failed to get default branch: {e}"))
        }
    }
}

// Tests removed: diff_commands functions now use active project instead of current working directory