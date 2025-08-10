use std::path::{Path, PathBuf};
use std::process::Command;
use anyhow::{Result, anyhow};
use chrono::Utc;
use crate::para_core::types::GitStats;

pub fn discover_repository() -> Result<PathBuf> {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()?;
    
    if !output.status.success() {
        return Err(anyhow!("Not in a git repository. Please run Para UI from within a git repository."));
    }
    
    let path = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string();
    
    Ok(PathBuf::from(path))
}

pub fn get_current_branch(repo_path: &Path) -> Result<String> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "rev-parse", "--abbrev-ref", "HEAD"
        ])
        .output()?;
    
    if !output.status.success() {
        return Err(anyhow!("Failed to get current branch"));
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}


pub fn delete_branch(repo_path: &Path, branch_name: &str) -> Result<()> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "branch", "-D", branch_name
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to delete branch {}: {}", branch_name, stderr));
    }
    
    Ok(())
}

pub fn create_worktree_with_new_branch(repo_path: &Path, branch: &str, worktree_path: &Path) -> Result<()> {
    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    
    // First check if branch already exists and delete it if it does
    let branch_check = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")
        ])
        .output();
    
    if branch_check.is_ok() && branch_check.unwrap().status.success() {
        // Branch exists, delete it first
        let _ = delete_branch(repo_path, branch);
    }
    
    // Create worktree with new branch based on current HEAD
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "worktree", "add",
            "-b", branch,
            worktree_path.to_str().unwrap()
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to create worktree: {}", stderr));
    }
    
    Ok(())
}

// Keep the old function for compatibility
pub fn create_worktree(repo_path: &Path, branch: &str, worktree_path: &Path) -> Result<()> {
    create_worktree_with_new_branch(repo_path, branch, worktree_path)
}

pub fn create_worktree_from_base(
    repo_path: &Path,
    branch_name: &str,
    worktree_path: &Path,
    base_branch: &str
) -> Result<()> {
    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    
    // First check if branch already exists and delete it if it does
    let branch_check = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "show-ref", "--verify", "--quiet", &format!("refs/heads/{branch_name}")
        ])
        .output()?;
    
    if branch_check.status.success() {
        // Branch exists, delete it
        let _ = Command::new("git")
            .args([
                "-C", repo_path.to_str().unwrap(),
                "branch", "-D", branch_name
            ])
            .output()?;
    }
    
    // Create worktree with new branch from specified base
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "worktree", "add", "-b", branch_name,
            worktree_path.to_str().unwrap(),
            base_branch
        ])
        .output()?;
    
    if !output.status.success() {
        return Err(anyhow!(
            "Failed to create worktree: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    
    Ok(())
}

pub fn remove_worktree(repo_path: &Path, worktree_path: &Path) -> Result<()> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "worktree", "remove", worktree_path.to_str().unwrap(), "--force"
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to remove worktree: {}", stderr));
    }
    
    Ok(())
}

pub fn calculate_git_stats(worktree_path: &Path, parent_branch: &str) -> Result<GitStats> {
    let diff_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "diff", "--numstat", &format!("{parent_branch}...HEAD")
        ])
        .output()?;
    
    if !diff_output.status.success() {
        return Err(anyhow!("Failed to get diff statistics"));
    }
    
    let mut files_changed = 0u32;
    let mut lines_added = 0u32;
    let mut lines_removed = 0u32;
    
    for line in String::from_utf8_lossy(&diff_output.stdout).lines() {
        if line.is_empty() { continue; }
        
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            files_changed += 1;
            
            if parts[0] != "-" {
                lines_added += parts[0].parse::<u32>().unwrap_or(0);
            }
            if parts[1] != "-" {
                lines_removed += parts[1].parse::<u32>().unwrap_or(0);
            }
        }
    }
    
    let status_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "status", "--porcelain"
        ])
        .output()?;
    
    let has_uncommitted = !status_output.stdout.is_empty();
    
    Ok(GitStats {
        session_id: String::new(),
        files_changed,
        lines_added,
        lines_removed,
        has_uncommitted,
        calculated_at: Utc::now(),
    })
}

pub fn has_uncommitted_changes(worktree_path: &Path) -> Result<bool> {
    let output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "status", "--porcelain"
        ])
        .output()?;
    
    Ok(!output.stdout.is_empty())
}


pub fn list_worktrees(repo_path: &Path) -> Result<Vec<PathBuf>> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "worktree", "list", "--porcelain"
        ])
        .output()?;
    
    if !output.status.success() {
        return Ok(Vec::new());
    }
    
    let mut worktrees = Vec::new();
    let lines = String::from_utf8_lossy(&output.stdout);
    
    for line in lines.lines() {
        if line.starts_with("worktree ") {
            let path = line.strip_prefix("worktree ").unwrap();
            worktrees.push(PathBuf::from(path));
        }
    }
    
    Ok(worktrees)
}

pub fn is_valid_session_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 100 {
        return false;
    }
    
    name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

pub fn archive_branch(repo_path: &Path, branch_name: &str, session_name: &str) -> Result<String> {
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let archived_branch = format!("para/archived/{timestamp}/{session_name}");
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "branch", "-m", branch_name, &archived_branch
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to archive branch {}: {}", branch_name, stderr));
    }
    
    Ok(archived_branch)
}

pub fn branch_exists(repo_path: &Path, branch_name: &str) -> Result<bool> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch_name}")
        ])
        .output();
    
    match output {
        Ok(result) => Ok(result.status.success()),
        Err(_) => Ok(false)
    }
}

