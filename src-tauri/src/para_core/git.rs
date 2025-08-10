use std::path::{Path, PathBuf};
use std::process::Command;
use std::collections::HashSet;
use anyhow::{Result, anyhow};
use chrono::Utc;
use crate::para_core::types::{GitStats, ChangedFile};

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
    let mut changed_files: HashSet<String> = HashSet::new();
    let mut total_lines_added = 0u32;
    let mut total_lines_removed = 0u32;
    
    // 1. Get committed changes (parent_branch...HEAD)
    let committed_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "diff", "--numstat", &format!("{parent_branch}...HEAD")
        ])
        .output()?;
    
    if committed_output.status.success() {
        for line in String::from_utf8_lossy(&committed_output.stdout).lines() {
            if let Some((added, removed, file)) = parse_numstat_line(line) {
                changed_files.insert(file.to_string());
                total_lines_added += added;
                total_lines_removed += removed;
            }
        }
    }
    
    // 2. Get staged changes (changes in index)
    let staged_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "diff", "--numstat", "--cached"
        ])
        .output()?;
    
    if staged_output.status.success() {
        for line in String::from_utf8_lossy(&staged_output.stdout).lines() {
            if let Some((added, removed, file)) = parse_numstat_line(line) {
                changed_files.insert(file.to_string());
                total_lines_added += added;
                total_lines_removed += removed;
            }
        }
    }
    
    // 3. Get unstaged changes (working directory changes)
    let unstaged_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "diff", "--numstat"
        ])
        .output()?;
    
    if unstaged_output.status.success() {
        for line in String::from_utf8_lossy(&unstaged_output.stdout).lines() {
            if let Some((added, removed, file)) = parse_numstat_line(line) {
                changed_files.insert(file.to_string());
                total_lines_added += added;
                total_lines_removed += removed;
            }
        }
    }
    
    // 4. Get untracked files
    let untracked_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "ls-files", "--others", "--exclude-standard"
        ])
        .output()?;
    
    if untracked_output.status.success() {
        for line in String::from_utf8_lossy(&untracked_output.stdout).lines() {
            if !line.is_empty() {
                changed_files.insert(line.to_string());
                // Performance: avoid per-file IO to count lines for untracked files.
                // We only mark the file as changed without summing line counts.
            }
        }
    }
    
    // Check if there are any uncommitted changes
    let status_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "status", "--porcelain"
        ])
        .output()?;
    
    let has_uncommitted = !status_output.stdout.is_empty();
    
    Ok(GitStats {
        session_id: String::new(),
        files_changed: changed_files.len() as u32,
        lines_added: total_lines_added,
        lines_removed: total_lines_removed,
        has_uncommitted,
        calculated_at: Utc::now(),
    })
}

pub fn get_changed_files(worktree_path: &Path, parent_branch: &str) -> Result<Vec<ChangedFile>> {
    let mut file_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // 1. Committed changes relative to base
    let committed_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "diff", "--name-status", &format!("{parent_branch}...HEAD")
        ])
        .output()?;
    if committed_output.status.success() {
        for line in String::from_utf8_lossy(&committed_output.stdout).lines() {
            if let Some((status, path)) = parse_name_status_line(line) {
                file_map.insert(path.to_string(), status.to_string());
            }
        }
    }

    // 2. Staged changes
    let staged_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "diff", "--name-status", "--cached"
        ])
        .output()?;
    if staged_output.status.success() {
        for line in String::from_utf8_lossy(&staged_output.stdout).lines() {
            if let Some((status, path)) = parse_name_status_line(line) {
                file_map.insert(path.to_string(), status.to_string());
            }
        }
    }

    // 3. Unstaged changes
    let unstaged_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "diff", "--name-status"
        ])
        .output()?;
    if unstaged_output.status.success() {
        for line in String::from_utf8_lossy(&unstaged_output.stdout).lines() {
            if let Some((status, path)) = parse_name_status_line(line) {
                file_map.insert(path.to_string(), status.to_string());
            }
        }
    }

    // 4. Untracked files
    let untracked_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "ls-files", "--others", "--exclude-standard"
        ])
        .output()?;
    if untracked_output.status.success() {
        for line in String::from_utf8_lossy(&untracked_output.stdout).lines() {
            if !line.is_empty() {
                file_map.insert(line.to_string(), "added".to_string());
            }
        }
    }

    let mut files: Vec<ChangedFile> = file_map
        .into_iter()
        .map(|(path, change_type)| ChangedFile { path, change_type })
        .collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn parse_name_status_line(line: &str) -> Option<(&str, &str)> {
    if line.is_empty() { return None; }
    let parts: Vec<&str> = line.splitn(2, '\t').collect();
    if parts.len() != 2 { return None; }
    let status = parts[0];
    let path = parts[1];
    let change_type = match status.chars().next().unwrap_or('?') {
        'M' => "modified",
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        _ => "unknown",
    };
    Some((change_type, path))
}

fn parse_numstat_line(line: &str) -> Option<(u32, u32, &str)> {
    if line.is_empty() {
        return None;
    }
    
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    
    let added = if parts[0] == "-" { 0 } else { parts[0].parse().unwrap_or(0) };
    let removed = if parts[1] == "-" { 0 } else { parts[1].parse().unwrap_or(0) };
    let file = parts[2];
    
    Some((added, removed, file))
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

pub fn commit_all_changes(worktree_path: &Path, message: &str) -> Result<()> {
    // First add all changes
    let add_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "add", "-A"
        ])
        .output()?;
    
    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(anyhow!("Failed to stage changes: {}", stderr));
    }
    
    // Then commit
    let commit_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "commit", "-m", message
        ])
        .output()?;
    
    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        if stderr.contains("nothing to commit") {
            // This is not really an error
            return Ok(());
        }
        return Err(anyhow!("Failed to commit changes: {}", stderr));
    }
    
    Ok(())
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

