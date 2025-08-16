use std::path::Path;
use std::process::Command;
use std::collections::{HashSet, HashMap};
use anyhow::Result;
use chrono::Utc;
use crate::para_core::types::{GitStats, ChangedFile};
use git2::{Repository, DiffOptions, StatusOptions, Oid};
use std::sync::{Mutex, OnceLock};

#[cfg(test)]
pub fn calculate_git_stats(worktree_path: &Path, parent_branch: &str) -> Result<GitStats> {
    let mut changed_files: HashSet<String> = HashSet::new();
    let mut total_lines_added = 0u32;
    let mut total_lines_removed = 0u32;
    
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

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct StatsCacheKey {
    head: Option<Oid>,
    index_signature: Option<u64>,
    status_signature: u64,
}

type StatsCacheMap = HashMap<(std::path::PathBuf, String), (StatsCacheKey, GitStats)>;
static STATS_CACHE: OnceLock<Mutex<StatsCacheMap>> = OnceLock::new();

pub fn calculate_git_stats_fast(worktree_path: &Path, parent_branch: &str) -> Result<GitStats> {
    let repo = Repository::discover(worktree_path)?;

    let head_oid = repo.head().ok().and_then(|h| h.target());
    let head_commit = head_oid.and_then(|oid| repo.find_commit(oid).ok());
    let head_tree = head_commit.as_ref().and_then(|c| c.tree().ok());

    let base_ref = repo.revparse_single(parent_branch).ok();
    let base_commit = base_ref
        .and_then(|obj| obj.peel_to_commit().ok());
    let base_tree = base_commit.as_ref().and_then(|c| c.tree().ok());

    let mut status_opts = StatusOptions::new();
    status_opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut status_opts))?;
    let mut status_sig: u64 = 1469598103934665603;
    for entry in statuses.iter() {
        let s = entry.status().bits() as u64;
        status_sig ^= s.wrapping_mul(1099511628211);
        if let Some(path) = entry.path() {
            for b in path.as_bytes() { status_sig ^= (*b as u64).wrapping_mul(1099511628211); }
        }
    }

    let index_signature = repo.index().ok().map(|idx| {
        let mut sig: u64 = 1469598103934665603;
        for entry in idx.iter() {
            for b in entry.path.iter() { sig ^= (*b as u64).wrapping_mul(1099511628211); }
            let id = entry.id;
            for b in id.as_bytes() { sig ^= (*b as u64).wrapping_mul(1099511628211); }
        }
        sig
    });

    let key = StatsCacheKey { head: head_oid, index_signature, status_signature: status_sig };
    let cache_key = (worktree_path.to_path_buf(), parent_branch.to_string());
    if let Some(m) = STATS_CACHE.get() {
        if let Some((k, v)) = m.lock().unwrap().get(&cache_key) {
            if *k == key { return Ok(v.clone()); }
        }
    }

    let mut files: HashSet<String> = HashSet::new();
    let mut insertions: u32 = 0;
    let mut deletions: u32 = 0;

    let mut add_from_diff = |diff: git2::Diff| {
        if let Ok(stats) = diff.stats() {
            insertions = insertions.saturating_add(stats.insertions() as u32);
            deletions = deletions.saturating_add(stats.deletions() as u32);
        }
        for d in diff.deltas() {
            if let Some(p) = d.new_file().path().or_else(|| d.old_file().path()) {
                if let Some(s) = p.to_str() { files.insert(s.to_string()); }
            }
        }
    };

    let mut opts = DiffOptions::new();

    if let (Some(bt), Some(ht)) = (base_tree.as_ref(), head_tree.as_ref()) {
        if let Ok(diff) = repo.diff_tree_to_tree(Some(bt), Some(ht), Some(&mut opts)) {
            add_from_diff(diff);
        }
    }

    if let Some(ht) = head_tree.as_ref() {
        if let Ok(idx) = repo.index() {
            if let Ok(diff) = repo.diff_tree_to_index(Some(ht), Some(&idx), Some(&mut opts)) {
                add_from_diff(diff);
            }
        }
    }

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

    let map = STATS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    map.lock().unwrap().insert(cache_key, (key, stats.clone()));

    Ok(stats)
}

pub fn get_changed_files(worktree_path: &Path, parent_branch: &str) -> Result<Vec<ChangedFile>> {
    let mut file_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

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