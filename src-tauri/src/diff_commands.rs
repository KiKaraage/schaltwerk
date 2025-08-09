use std::process::Command;
use serde::{Serialize, Deserialize};
use crate::get_para_core;

#[derive(Debug, Serialize, Deserialize)]
pub struct ChangedFile {
    pub path: String,
    pub change_type: String,
}

#[tauri::command]
pub async fn get_changed_files_from_main(session_name: Option<String>) -> Result<Vec<ChangedFile>, String> {
    let repo_path = get_repo_path(session_name).await?;
    
    let output = Command::new("git")
        .args(["-C", &repo_path, "diff", "--name-status", "main...HEAD"])
        .output()
        .map_err(|e| format!("Failed to get changed files: {e}"))?;
    
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();
    
    for line in stdout.lines() {
        if line.is_empty() { continue; }
        
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() != 2 { continue; }
        
        let status = parts[0];
        let path = parts[1];
        
        let change_type = match status.chars().next().unwrap_or('?') {
            'M' => "modified",
            'A' => "added", 
            'D' => "deleted",
            'R' => "renamed",
            'C' => "copied",
            _ => "unknown"
        };
        
        files.push(ChangedFile {
            path: path.to_string(),
            change_type: change_type.to_string(),
        });
    }
    
    Ok(files)
}

#[tauri::command]
pub async fn get_file_diff_from_main(
    session_name: Option<String>, 
    file_path: String
) -> Result<(String, String), String> {
    let repo_path = get_repo_path(session_name).await?;
    
    let main_content = Command::new("git")
        .args(["-C", &repo_path, "show", &format!("main:{file_path}")])
        .output()
        .map_err(|e| format!("Failed to get main content: {e}"))?;
    
    let main_text = if main_content.status.success() {
        String::from_utf8_lossy(&main_content.stdout).to_string()
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
    
    Ok((main_text, worktree_text))
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
    let repo_path = get_repo_path(session_name).await?;
    
    let main_output = Command::new("git")
        .args(["-C", &repo_path, "rev-parse", "--short", "main"])
        .output()
        .map_err(|e| format!("Failed to get main commit: {e}"))?;
    
    let main_commit = String::from_utf8_lossy(&main_output.stdout).trim().to_string();
    
    let head_output = Command::new("git")
        .args(["-C", &repo_path, "rev-parse", "--short", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to get HEAD commit: {e}"))?;
    
    let head_commit = String::from_utf8_lossy(&head_output.stdout).trim().to_string();
    
    Ok((main_commit, head_commit))
}

async fn get_repo_path(session_name: Option<String>) -> Result<String, String> {
    if let Some(name) = session_name {
        let core = get_para_core().await;
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