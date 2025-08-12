use std::path::{Path, PathBuf};
use std::process::Command;
use std::collections::{HashSet, HashMap};
use anyhow::{Result, anyhow};
use chrono::Utc;
use crate::para_core::types::{GitStats, ChangedFile};
use git2::{Repository, DiffOptions, StatusOptions, Oid};
use std::sync::{Mutex, OnceLock};

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

pub fn get_default_branch(repo_path: &Path) -> Result<String> {
    log::info!("Getting default branch for repo: {}", repo_path.display());
    
    // Try to get the default branch from remote origin
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "symbolic-ref", "refs/remotes/origin/HEAD"
        ])
        .output();
    
    if let Ok(output) = output {
        if output.status.success() {
            let full_ref = String::from_utf8_lossy(&output.stdout).trim().to_string();
            log::debug!("Found remote origin HEAD: {full_ref}");
            // Extract branch name from "refs/remotes/origin/main" -> "main"
            if let Some(branch) = full_ref.strip_prefix("refs/remotes/origin/") {
                log::info!("Using default branch from remote: {branch}");
                return Ok(branch.to_string());
            }
        } else {
            log::debug!("Remote origin HEAD not set, trying to set it up");
            // Try to set up the remote HEAD
            let setup_output = Command::new("git")
                .args([
                    "-C", repo_path.to_str().unwrap(),
                    "remote", "set-head", "origin", "--auto"
                ])
                .output();
            
            if let Ok(setup_output) = setup_output {
                if setup_output.status.success() {
                    log::info!("Successfully set up remote HEAD, retrying");
                    // Try again after setting up
                    if let Ok(retry_output) = Command::new("git")
                        .args([
                            "-C", repo_path.to_str().unwrap(),
                            "symbolic-ref", "refs/remotes/origin/HEAD"
                        ])
                        .output() 
                    {
                        if retry_output.status.success() {
                            let full_ref = String::from_utf8_lossy(&retry_output.stdout).trim().to_string();
                            if let Some(branch) = full_ref.strip_prefix("refs/remotes/origin/") {
                                log::info!("Using default branch from remote after setup: {branch}");
                                return Ok(branch.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Fallback: try to get current branch
    if let Ok(current) = get_current_branch(repo_path) {
        log::info!("Using current branch as default: {current}");
        return Ok(current);
    }
    
    // Last resort: check which branches exist and pick a common default
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "branch", "--list", "--format=%(refname:short)"
        ])
        .output()?;
    
    if output.status.success() {
        let branches = String::from_utf8_lossy(&output.stdout);
        let branch_names: Vec<&str> = branches.lines().collect();
        log::debug!("Available branches: {branch_names:?}");
        
        // Check for common default branch names in priority order
        for default_name in &["main", "master", "develop", "dev"] {
            if branch_names.contains(default_name) {
                log::info!("Using common default branch: {default_name}");
                return Ok(default_name.to_string());
            }
        }
        
        // If no common defaults found, use the first available branch
        if let Some(first_branch) = branch_names.first() {
            log::info!("Using first available branch: {first_branch}");
            return Ok(first_branch.to_string());
        }
    }
    
    log::error!("No branches found in repository: {}", repo_path.display());
    Err(anyhow!("No branches found in repository"))
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

// Small in-memory cache to speed up repeated calls
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct StatsCacheKey {
    head: Option<Oid>,
    index_signature: Option<u64>,
    status_signature: u64,
}

type StatsCacheMap = HashMap<(PathBuf, String), (StatsCacheKey, GitStats)>;
static STATS_CACHE: OnceLock<Mutex<StatsCacheMap>> = OnceLock::new();

pub fn calculate_git_stats_fast(worktree_path: &Path, parent_branch: &str) -> Result<GitStats> {
    let repo = Repository::discover(worktree_path)?;

    // Resolve base and head commits/trees
    let head_oid = repo.head().ok().and_then(|h| h.target());
    let head_commit = head_oid.and_then(|oid| repo.find_commit(oid).ok());
    let head_tree = head_commit.as_ref().and_then(|c| c.tree().ok());

    let base_ref = repo.revparse_single(parent_branch).ok();
    let base_commit = base_ref
        .and_then(|obj| obj.peel_to_commit().ok());
    let base_tree = base_commit.as_ref().and_then(|c| c.tree().ok());

    // Compute status signature to detect workdir changes cheaply
    let mut status_opts = StatusOptions::new();
    status_opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut status_opts))?;
    let mut status_sig: u64 = 1469598103934665603; // FNV offset basis
    for entry in statuses.iter() {
        let s = entry.status().bits() as u64;
        status_sig ^= s.wrapping_mul(1099511628211);
        if let Some(path) = entry.path() {
            for b in path.as_bytes() { status_sig ^= (*b as u64).wrapping_mul(1099511628211); }
        }
    }

    // Compute a simple signature for the index contents
    let index_signature = repo.index().ok().map(|idx| {
        let mut sig: u64 = 1469598103934665603;
        for entry in idx.iter() {
            for b in entry.path.iter() { sig ^= (*b as u64).wrapping_mul(1099511628211); }
            let id = entry.id;
            for b in id.as_bytes() { sig ^= (*b as u64).wrapping_mul(1099511628211); }
        }
        sig
    });

    // Cache lookup
    let key = StatsCacheKey { head: head_oid, index_signature, status_signature: status_sig };
    let cache_key = (worktree_path.to_path_buf(), parent_branch.to_string());
    if let Some(m) = STATS_CACHE.get() {
        if let Some((k, v)) = m.lock().unwrap().get(&cache_key) {
            if *k == key { return Ok(v.clone()); }
        }
    }

    // Accumulate stats from three diffs: committed, staged, unstaged+untracked
    let mut files: HashSet<String> = HashSet::new();
    let mut insertions: u32 = 0;
    let mut deletions: u32 = 0;

    let mut add_from_diff = |diff: git2::Diff| {
        if let Ok(stats) = diff.stats() {
            insertions = insertions.saturating_add(stats.insertions() as u32);
            deletions = deletions.saturating_add(stats.deletions() as u32);
        }
        // Collect file paths from deltas
        for d in diff.deltas() {
            if let Some(p) = d.new_file().path().or_else(|| d.old_file().path()) {
                if let Some(s) = p.to_str() { files.insert(s.to_string()); }
            }
        }
    };

    let mut opts = DiffOptions::new();

    // Committed changes: base_tree -> head_tree
    if let (Some(bt), Some(ht)) = (base_tree.as_ref(), head_tree.as_ref()) {
        if let Ok(diff) = repo.diff_tree_to_tree(Some(bt), Some(ht), Some(&mut opts)) {
            add_from_diff(diff);
        }
    }

    // Staged changes: head_tree -> index
    if let Some(ht) = head_tree.as_ref() {
        if let Ok(idx) = repo.index() {
            if let Ok(diff) = repo.diff_tree_to_index(Some(ht), Some(&idx), Some(&mut opts)) {
                add_from_diff(diff);
            }
        }
    }

    // Unstaged + untracked: index -> workdir
    if let Ok(idx) = repo.index() {
        let mut workdir_opts = DiffOptions::new();
        workdir_opts.include_untracked(true).recurse_untracked_dirs(true);
        if let Ok(diff) = repo.diff_index_to_workdir(Some(&idx), Some(&mut workdir_opts)) {
            add_from_diff(diff);
        }
    }

    let stats = GitStats {
        session_id: String::new(),
        files_changed: files.len() as u32,
        lines_added: insertions,
        lines_removed: deletions,
        has_uncommitted: !statuses.is_empty(),
        calculated_at: Utc::now(),
    };

    // Save to cache
    let map = STATS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    map.lock().unwrap().insert(cache_key, (key, stats.clone()));

    Ok(stats)
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

pub fn rename_branch(repo_path: &Path, old_branch: &str, new_branch: &str) -> Result<()> {
    // First check if the old branch exists
    if !branch_exists(repo_path, old_branch)? {
        return Err(anyhow!("Branch '{old_branch}' does not exist"));
    }
    
    // Check if the new branch name already exists
    if branch_exists(repo_path, new_branch)? {
        return Err(anyhow!("Branch '{new_branch}' already exists"));
    }
    
    // Rename the branch
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "branch", "-m", old_branch, new_branch
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to rename branch: {stderr}"));
    }
    
    Ok(())
}

pub fn update_worktree_branch(worktree_path: &Path, new_branch: &str) -> Result<()> {
    // First, check if there are uncommitted changes
    if has_uncommitted_changes(worktree_path)? {
        // Stash changes temporarily
        let stash_output = Command::new("git")
            .args([
                "-C", worktree_path.to_str().unwrap(),
                "stash", "push", "-m", "Auto-stash before branch rename"
            ])
            .output()?;
        
        if !stash_output.status.success() {
            log::warn!("Failed to stash changes, proceeding anyway");
        }
    }
    
    // Update the worktree to track the new branch
    let output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "switch", new_branch
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to update worktree to new branch: {stderr}"));
    }
    
    // Try to pop the stash if we stashed anything
    let stash_list = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "stash", "list"
        ])
        .output()?;
    
    if stash_list.status.success() && !stash_list.stdout.is_empty() {
        let pop_output = Command::new("git")
            .args([
                "-C", worktree_path.to_str().unwrap(),
                "stash", "pop"
            ])
            .output()?;
        
        if !pop_output.status.success() {
            log::warn!("Failed to restore stashed changes, they remain in stash");
        }
    }
    
    Ok(())
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
        let worktree_path = temp_dir.path().join(".schaltwerk/worktrees/test");
        
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
        
        // Create worktree from current branch (master)
        let current_branch = get_current_branch(&repo_path).unwrap();
        create_worktree_from_base(&repo_path, "test-branch", &worktree_path, &current_branch).unwrap();
        
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
        let (_temp, repo_path, worktree_path) = setup_test_repo_with_many_files(100);
        let current_branch = get_current_branch(&repo_path).unwrap();
        
        // Test old version
        let start = Instant::now();
        let stats = calculate_git_stats(&worktree_path, &current_branch).unwrap();
        let old_duration = start.elapsed();
        println!("Old git stats calculation with 100 files took: {old_duration:?}");
        
        // Test new fast version
        let start = Instant::now();
        let fast_stats = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
        let fast_duration = start.elapsed();
        println!("Fast git stats calculation with 100 files took: {fast_duration:?}");
        
        assert_eq!(stats.files_changed, fast_stats.files_changed, "Stats should match");
        assert!(fast_duration <= old_duration, "Fast version should be faster or equal");
        assert!(fast_duration.as_millis() < 500, "Fast git stats took too long: {fast_duration:?}");
    }
    
    #[test]
    fn test_git_stats_performance_repeated_calls() {
        let (_temp, repo_path, worktree_path) = setup_test_repo_with_many_files(50);
        let current_branch = get_current_branch(&repo_path).unwrap();
        
        // Test old version
        let start = Instant::now();
        for _ in 0..5 {
            let _ = calculate_git_stats(&worktree_path, &current_branch).unwrap();
        }
        let old_duration = start.elapsed();
        println!("5 repeated old git stats calculations took: {old_duration:?}");
        
        // Test new fast version
        let start = Instant::now();
        for _ in 0..5 {
            let _ = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
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
        let worktree_path = temp_dir.path().join(".schaltwerk/worktrees/test");
        let current_branch = get_current_branch(&repo_path).unwrap();
        create_worktree_from_base(&repo_path, "test-branch", &worktree_path, &current_branch).unwrap();
        
        // Test that fast version is very quick when no changes
        let start = Instant::now();
        let stats = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
        let duration = start.elapsed();
        
        println!("Fast git stats with no changes took: {duration:?}");
        assert_eq!(stats.files_changed, 0);
        assert_eq!(stats.lines_added, 0);
        assert_eq!(stats.lines_removed, 0);
        assert!(!stats.has_uncommitted);
        assert!(duration.as_millis() < 150, "Should be very fast with no changes: {duration:?}");
    }
}

