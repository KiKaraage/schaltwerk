use std::process::Command;
use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use crate::get_para_core;

#[derive(Debug, Serialize, Deserialize)]
pub struct ChangedFile {
    pub path: String,
    pub change_type: String,
}

#[tauri::command]
pub async fn get_changed_files_from_main(session_name: Option<String>) -> Result<Vec<ChangedFile>, String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    
    let mut file_map: HashMap<String, String> = HashMap::new();
    
    // 1. Get changes between base branch and HEAD (committed changes)
    let committed_output = Command::new("git")
        .args(["-C", &repo_path, "diff", "--name-status", &format!("{base_branch}...HEAD")])
        .output()
        .map_err(|e| format!("Failed to get committed changes: {e}"))?;
    
    if committed_output.status.success() {
        let stdout = String::from_utf8_lossy(&committed_output.stdout);
        for line in stdout.lines() {
            if let Some((status, path)) = parse_git_status_line(line) {
                file_map.insert(path.to_string(), status.to_string());
            }
        }
    }
    
    // 2. Get staged changes (changes in index)
    let staged_output = Command::new("git")
        .args(["-C", &repo_path, "diff", "--name-status", "--cached"])
        .output()
        .map_err(|e| format!("Failed to get staged changes: {e}"))?;
    
    if staged_output.status.success() {
        let stdout = String::from_utf8_lossy(&staged_output.stdout);
        for line in stdout.lines() {
            if let Some((status, path)) = parse_git_status_line(line) {
                file_map.insert(path.to_string(), status.to_string());
            }
        }
    }
    
    // 3. Get unstaged changes (working directory changes)
    let unstaged_output = Command::new("git")
        .args(["-C", &repo_path, "diff", "--name-status"])
        .output()
        .map_err(|e| format!("Failed to get unstaged changes: {e}"))?;
    
    if unstaged_output.status.success() {
        let stdout = String::from_utf8_lossy(&unstaged_output.stdout);
        for line in stdout.lines() {
            if let Some((status, path)) = parse_git_status_line(line) {
                file_map.insert(path.to_string(), status.to_string());
            }
        }
    }
    
    // 4. Get untracked files
    let untracked_output = Command::new("git")
        .args(["-C", &repo_path, "ls-files", "--others", "--exclude-standard"])
        .output()
        .map_err(|e| format!("Failed to get untracked files: {e}"))?;
    
    if untracked_output.status.success() {
        let stdout = String::from_utf8_lossy(&untracked_output.stdout);
        for line in stdout.lines() {
            if !line.is_empty() {
                file_map.insert(line.to_string(), "added".to_string());
            }
        }
    }
    
    // Convert to result vector
    let mut files: Vec<ChangedFile> = file_map.into_iter().map(|(path, change_type)| {
        ChangedFile {
            path,
            change_type,
        }
    }).collect();
    
    // Sort by path for consistent ordering
    files.sort_by(|a, b| a.path.cmp(&b.path));
    
    Ok(files)
}

fn parse_git_status_line(line: &str) -> Option<(&str, &str)> {
    if line.is_empty() { 
        return None; 
    }
    
    let parts: Vec<&str> = line.splitn(2, '\t').collect();
    if parts.len() != 2 { 
        return None; 
    }
    
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
    
    Some((change_type, path))
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

async fn get_base_branch(session_name: Option<String>) -> Result<String, String> {
    if let Some(name) = session_name {
        let core = get_para_core().await;
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
        Ok("main".to_string())
    }
}