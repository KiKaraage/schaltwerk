use std::path::{Path, PathBuf};
use std::process::Command;
use std::collections::HashSet;
use anyhow::{Result, anyhow};
use chrono::Utc;
use crate::para_core::types::{GitStats, ChangedFile};

pub fn discover_repository() -> Result<PathBuf> {
    // 1) Allow explicit override via environment variable for packaged runs
    if let Ok(repo_env) = std::env::var("PARA_REPO_PATH") {
        if !repo_env.trim().is_empty() {
            let output = Command::new("git")
                .args(["-C", &repo_env, "rev-parse", "--show-toplevel"])
                .output()?;
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return Ok(PathBuf::from(path));
            }
        }
    }

    // 2) Fallback to current working directory
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
        // If the directory is not a registered worktree anymore, treat as already removed
        if stderr.contains("is not a working tree") || stderr.contains("not a working tree") {
            return Ok(());
        }
        return Err(anyhow!("Failed to remove worktree: {}", stderr));
    }
    
    Ok(())
}

#[cfg(test)]
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

pub fn calculate_git_stats_fast(worktree_path: &Path, parent_branch: &str) -> Result<GitStats> {
    // Quick check if anything changed at all using git status
    let status_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "status", "--porcelain"
        ])
        .output()?;
    
    let has_uncommitted = !status_output.stdout.is_empty();
    
    // Check if there are any commits
    let head_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "rev-list", "--count", &format!("{parent_branch}..HEAD")
        ])
        .output()?;
    
    let commit_count: u32 = if head_output.status.success() {
        String::from_utf8_lossy(&head_output.stdout)
            .trim()
            .parse()
            .unwrap_or(0)
    } else {
        0
    };
    
    // If no changes and no commits, return early
    if !has_uncommitted && commit_count == 0 {
        return Ok(GitStats {
            session_id: String::new(),
            files_changed: 0,
            lines_added: 0,
            lines_removed: 0,
            has_uncommitted: false,
            calculated_at: Utc::now(),
        });
    }
    
    // For small changes, use simplified calculation
    let mut changed_files = HashSet::new();
    let mut total_lines_added = 0u32;
    let mut total_lines_removed = 0u32;
    
    // Get a quick summary of changes without detailed parsing
    if commit_count > 0 {
        let shortstat_output = Command::new("git")
            .args([
                "-C", worktree_path.to_str().unwrap(),
                "diff", "--shortstat", &format!("{parent_branch}...HEAD")
            ])
            .output()?;
        
        if shortstat_output.status.success() {
            let stat_line = String::from_utf8_lossy(&shortstat_output.stdout);
            if let Some((files, added, removed)) = parse_shortstat(&stat_line) {
                for i in 0..files {
                    changed_files.insert(format!("committed_{i}"));
                }
                total_lines_added += added;
                total_lines_removed += removed;
            }
        }
    }
    
    // Add uncommitted changes count from status
    if has_uncommitted {
        for line in String::from_utf8_lossy(&status_output.stdout).lines() {
            if !line.is_empty() {
                if let Some(file) = line.split_whitespace().nth(1) {
                    changed_files.insert(file.to_string());
                }
            }
        }
    }
    
    Ok(GitStats {
        session_id: String::new(),
        files_changed: changed_files.len() as u32,
        lines_added: total_lines_added,
        lines_removed: total_lines_removed,
        has_uncommitted,
        calculated_at: Utc::now(),
    })
}

fn parse_shortstat(line: &str) -> Option<(u32, u32, u32)> {
    // Parse format: "X files changed, Y insertions(+), Z deletions(-)"
    let parts: Vec<&str> = line.split(',').collect();
    let mut files_changed = 0;
    let mut insertions = 0;
    let mut deletions = 0;
    
    for part in parts {
        let trimmed = part.trim();
        if trimmed.contains("file") {
            if let Some(num) = trimmed.split_whitespace().next() {
                files_changed = num.parse().unwrap_or(0);
            }
        } else if trimmed.contains("insertion") {
            if let Some(num) = trimmed.split_whitespace().next() {
                insertions = num.parse().unwrap_or(0);
            }
        } else if trimmed.contains("deletion") {
            if let Some(num) = trimmed.split_whitespace().next() {
                deletions = num.parse().unwrap_or(0);
            }
        }
    }
    
    if files_changed > 0 || insertions > 0 || deletions > 0 {
        Some((files_changed, insertions, deletions))
    } else {
        None
    }
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

#[cfg(test)]
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

#[cfg(test)]
mod performance_tests {
    use super::*;
    use std::time::Instant;
    use tempfile::TempDir;
    use std::process::Command as StdCommand;
    
    fn setup_test_repo_with_many_files(num_files: usize) -> (TempDir, PathBuf, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        let worktree_path = temp_dir.path().join(".para/worktrees/test");
        
        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Set git config
        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create many files in the main branch
        for i in 0..num_files/2 {
            std::fs::write(repo_path.join(format!("file_{i}.txt")), format!("content {i}")).unwrap();
        }
        
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create worktree
        create_worktree_with_new_branch(&repo_path, "test-branch", &worktree_path).unwrap();
        
        // Add more files in the worktree
        for i in num_files/2..num_files {
            std::fs::write(worktree_path.join(format!("file_{i}.txt")), format!("content {i}")).unwrap();
        }
        
        // Modify some existing files
        for i in 0..10.min(num_files/2) {
            std::fs::write(worktree_path.join(format!("file_{i}.txt")), format!("modified content {i}")).unwrap();
        }
        
        // Stage some changes
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&worktree_path)
            .output()
            .unwrap();
        
        // Commit some changes
        StdCommand::new("git")
            .args(["commit", "-m", "Add files in worktree"])
            .current_dir(&worktree_path)
            .output()
            .unwrap();
        
        // Create some unstaged changes
        for i in 0..5.min(num_files/4) {
            std::fs::write(worktree_path.join(format!("unstaged_{i}.txt")), format!("unstaged {i}")).unwrap();
        }
        
        (temp_dir, repo_path, worktree_path)
    }
    
    #[test]
    fn test_git_stats_performance_with_many_files() {
        let (_temp, _repo_path, worktree_path) = setup_test_repo_with_many_files(100);
        
        // Test old version
        let start = Instant::now();
        let stats = calculate_git_stats(&worktree_path, "main").unwrap();
        let old_duration = start.elapsed();
        println!("Old git stats calculation with 100 files took: {old_duration:?}");
        
        // Test new fast version
        let start = Instant::now();
        let fast_stats = calculate_git_stats_fast(&worktree_path, "main").unwrap();
        let fast_duration = start.elapsed();
        println!("Fast git stats calculation with 100 files took: {fast_duration:?}");
        
        assert_eq!(stats.files_changed, fast_stats.files_changed, "Stats should match");
        assert!(fast_duration <= old_duration, "Fast version should be faster or equal");
        assert!(fast_duration.as_millis() < 500, "Fast git stats took too long: {fast_duration:?}");
    }
    
    #[test]
    fn test_git_stats_performance_repeated_calls() {
        let (_temp, _repo_path, worktree_path) = setup_test_repo_with_many_files(50);
        
        // Test old version
        let start = Instant::now();
        for _ in 0..5 {
            let _ = calculate_git_stats(&worktree_path, "main").unwrap();
        }
        let old_duration = start.elapsed();
        println!("5 repeated old git stats calculations took: {old_duration:?}");
        
        // Test new fast version
        let start = Instant::now();
        for _ in 0..5 {
            let _ = calculate_git_stats_fast(&worktree_path, "main").unwrap();
        }
        let fast_duration = start.elapsed();
        println!("5 repeated fast git stats calculations took: {fast_duration:?}");
        
        assert!(fast_duration <= old_duration, "Fast version should be faster or equal");
        assert!(fast_duration.as_millis() < 1000, "Repeated fast git stats took too long: {fast_duration:?}");
    }
    
    #[test]
    fn test_fast_version_with_no_changes() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        
        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Set git config
        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create initial commit
        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create worktree with no changes
        let worktree_path = temp_dir.path().join(".para/worktrees/test");
        create_worktree_with_new_branch(&repo_path, "test-branch", &worktree_path).unwrap();
        
        // Test that fast version is very quick when no changes
        let start = Instant::now();
        let stats = calculate_git_stats_fast(&worktree_path, "main").unwrap();
        let duration = start.elapsed();
        
        println!("Fast git stats with no changes took: {duration:?}");
        assert_eq!(stats.files_changed, 0);
        assert_eq!(stats.lines_added, 0);
        assert_eq!(stats.lines_removed, 0);
        assert!(!stats.has_uncommitted);
        assert!(duration.as_millis() < 150, "Should be very fast with no changes: {duration:?}");
    }
}

