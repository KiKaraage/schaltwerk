use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use std::sync::{OnceLock, Mutex as StdMutex, Arc};
use anyhow::{Result, anyhow};
use uuid::Uuid;
use chrono::Utc;
use crate::para_core::{
    database::Database,
    git,
    types::{Session, SessionStatus, SessionInfo, SessionStatusType, SessionType, EnrichedSession, DiffStats},
};

// Track which sessions have already had their initial prompt sent
// Use worktree path as key for uniqueness
static PROMPTED_SESSIONS: OnceLock<StdMutex<HashSet<PathBuf>>> = OnceLock::new();

fn has_session_been_prompted(worktree_path: &Path) -> bool {
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let prompted = set.lock().unwrap();
    prompted.contains(worktree_path)
}

fn mark_session_prompted(worktree_path: &Path) {
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let mut prompted = set.lock().unwrap();
    prompted.insert(worktree_path.to_path_buf());
}

pub struct SessionManager {
    db: Database,
    repo_path: PathBuf,
}

impl SessionManager {
    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        log::info!("Creating SessionManager with repo path: {}", repo_path.display());
        Self { db, repo_path }
    }
    
    // Global per-repository mutexes to serialize worktree operations
    fn get_repo_lock(repo_path: &PathBuf) -> Arc<StdMutex<()>> {
        static REPO_LOCKS: OnceLock<StdMutex<HashMap<PathBuf, Arc<StdMutex<()>>>>> = OnceLock::new();
        let map_mutex = REPO_LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
        let mut map = map_mutex.lock().unwrap();
        if let Some(lock) = map.get(repo_path) {
            return lock.clone();
        }
        let lock = Arc::new(StdMutex::new(()));
        map.insert(repo_path.clone(), lock.clone());
        lock
    }
    
    #[cfg(test)]
    pub fn create_session(&self, name: &str, prompt: Option<&str>, base_branch: Option<&str>) -> Result<Session> {
        self.create_session_with_auto_flag(name, prompt, base_branch, false)
    }
    
    pub fn create_session_with_auto_flag(&self, name: &str, prompt: Option<&str>, base_branch: Option<&str>, was_auto_generated: bool) -> Result<Session> {
        log::info!("Creating session '{}' in repository: {}", name, self.repo_path.display());
        
        // Serialize session creation per repository to avoid git worktree races
        let repo_lock = Self::get_repo_lock(&self.repo_path);
        let _guard = repo_lock.lock().unwrap();
        if !git::is_valid_session_name(name) {
            return Err(anyhow!("Invalid session name: use only letters, numbers, hyphens, and underscores"));
        }
        
        let session_id = Uuid::new_v4().to_string();
        let branch = format!("schaltwerk/{name}");
        let worktree_path = self.repo_path
            .join(".schaltwerk")
            .join("worktrees")
            .join(name);
        
        let parent_branch = if let Some(base) = base_branch {
            base.to_string()
        } else {
            log::info!("No base branch specified, detecting default branch for session creation");
            match git::get_default_branch(&self.repo_path) {
                Ok(default) => {
                    log::info!("Using detected default branch: {default}");
                    default
                }
                Err(e) => {
                    log::error!("Failed to detect default branch: {e}");
                    return Err(anyhow!("Failed to detect default branch: {}. Please ensure the repository has at least one branch (e.g., 'main' or 'master')", e));
                }
            }
        };
        let repo_name = self.repo_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        
        let now = Utc::now();
        
        let session = Session {
            id: session_id.clone(),
            name: name.to_string(),
            display_name: None,
            repository_path: self.repo_path.clone(),
            repository_name: repo_name,
            branch: branch.clone(),
            parent_branch: parent_branch.clone(),
            worktree_path: worktree_path.clone(),
            status: SessionStatus::Active,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: prompt.map(String::from),
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            // Mark for name generation when the session name was auto-generated,
            // regardless of whether a prompt was provided. The generator uses a default prompt.
            pending_name_generation: was_auto_generated,
            was_auto_generated,
        };
        
        // Always create worktree from the parent branch (either specified or detected)
        let create_result = git::create_worktree_from_base(
            &self.repo_path, 
            &branch, 
            &worktree_path, 
            &parent_branch
        );
        
        if let Err(e) = create_result {
            return Err(anyhow!("Failed to create worktree: {}", e));
        }
        
        if let Err(e) = self.db.create_session(&session) {
            let _ = git::remove_worktree(&self.repo_path, &worktree_path);
            let _ = git::delete_branch(&self.repo_path, &branch);
            return Err(anyhow!("Failed to save session to database: {}", e));
        }

        // Persist original opening settings at creation time from global config
        let global_agent = self.db.get_agent_type().unwrap_or_else(|_| "claude".to_string());
        let global_skip = self.db.get_skip_permissions().unwrap_or(false);
        let _ = self.db.set_session_original_settings(&session.id, &global_agent, global_skip);
        
        let mut git_stats = git::calculate_git_stats_fast(&worktree_path, &parent_branch)?;
        git_stats.session_id = session_id;
        self.db.save_git_stats(&git_stats)?;
        
        Ok(session)
    }
    
    pub fn cancel_session(&self, name: &str) -> Result<()> {
        let session = self.db.get_session_by_name(&self.repo_path, name)?;
        
        // Check for uncommitted changes and warn (following Para CLI pattern)
        let has_uncommitted = if session.worktree_path.exists() {
            git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false)
        } else {
            false
        };
        
        if has_uncommitted {
            // In Para CLI, this would prompt for confirmation, but for UI we'll proceed with warning
            log::warn!("Canceling session '{name}' with uncommitted changes");
        }
        
        // Remove worktree first (required before branch operations)
        if session.worktree_path.exists() {
            if let Err(e) = git::remove_worktree(&self.repo_path, &session.worktree_path) {
                // If removal fails for reasons other than "not a worktree", surface the error
                return Err(anyhow!("Failed to remove worktree: {}", e));
            }
        } else {
            // If directory is already gone, continue cancellation flow
            log::warn!(
                "Worktree path missing, continuing cancellation: {}",
                session.worktree_path.display()
            );
        }
        
        // Archive branch instead of deleting (following Para CLI pattern)
        if git::branch_exists(&self.repo_path, &session.branch)? {
            match git::archive_branch(&self.repo_path, &session.branch, &session.name) {
                Ok(archived_name) => {
                    log::info!("Archived branch '{}' to '{}'", session.branch, archived_name);
                },
                Err(e) => {
                    log::warn!("Failed to archive branch '{}': {}", session.branch, e);
                    // Continue with session cancellation even if archiving fails
                }
            }
        }
        
        // Update database status
        self.db.update_session_status(&session.id, SessionStatus::Cancelled)?;
        
        Ok(())
    }
    
    
    pub fn get_session(&self, name: &str) -> Result<Session> {
        self.db.get_session_by_name(&self.repo_path, name)
    }
    
    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let sessions = self.db.list_sessions(&self.repo_path)?;
        // Filter out cancelled sessions - they should not appear in UI lists
        Ok(sessions.into_iter()
            .filter(|session| session.status != SessionStatus::Cancelled)
            .collect())
    }
    
    pub fn update_git_stats(&self, session_id: &str) -> Result<()> {
        let session = self.db.get_session_by_id(session_id)?;
        let mut stats = git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch)?;
        stats.session_id = session_id.to_string();
        self.db.save_git_stats(&stats)?;
        Ok(())
    }
    
    pub fn cleanup_orphaned_worktrees(&self) -> Result<()> {
        let worktrees = git::list_worktrees(&self.repo_path)?;
        
        for worktree_path in worktrees {
            if !worktree_path.to_string_lossy().contains("/.schaltwerk/worktrees/") {
                continue;
            }
            
            // Canonicalize paths to handle symlinks (like /var -> /private/var on macOS)
            let canonical_worktree = worktree_path.canonicalize()
                .unwrap_or_else(|_| worktree_path.clone());
            
            let sessions = self.db.list_sessions(&self.repo_path)?;
            let exists = sessions.iter().any(|s| {
                let canonical_session = s.worktree_path.canonicalize()
                    .unwrap_or_else(|_| s.worktree_path.clone());
                canonical_session == canonical_worktree
            });
            
            if !exists {
                log::info!("Removing orphaned worktree: {}", worktree_path.display());
                git::remove_worktree(&self.repo_path, &worktree_path)?;
            }
        }
        
        Ok(())
    }
    
    pub fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>> {
        let sessions = self.db.list_sessions(&self.repo_path)?;
        let mut enriched = Vec::new();
        
        for session in sessions {
            // Skip cancelled sessions - they should not appear in the UI list
            if session.status == SessionStatus::Cancelled {
                continue;
            }
            // Use cached git stats where fresh; compute only when stale
            let git_stats = match self.db.get_git_stats(&session.id)? {
                Some(existing) => {
                    let is_stale = (Utc::now() - existing.calculated_at).num_seconds() > 60;
                    if is_stale {
                        let mut updated = git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch).ok();
                        if let Some(ref mut s) = updated { s.session_id = session.id.clone(); let _ = self.db.save_git_stats(s); }
                        updated.or(Some(existing))
                    } else {
                        Some(existing)
                    }
                }
                None => {
                    let mut computed = git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch).ok();
                    if let Some(ref mut s) = computed { s.session_id = session.id.clone(); let _ = self.db.save_git_stats(s); }
                    computed
                }
            };
            let has_uncommitted = git_stats.as_ref().map(|s| s.has_uncommitted).unwrap_or(false);
            
            let diff_stats = git_stats.as_ref().map(|stats| DiffStats {
                files_changed: stats.files_changed as usize,
                additions: stats.lines_added as usize,
                deletions: stats.lines_removed as usize,
                insertions: stats.lines_added as usize,
            });
            
            let status_type = match session.status {
                SessionStatus::Active => SessionStatusType::Active,
                SessionStatus::Cancelled => SessionStatusType::Archived,
            };
            
            let info = SessionInfo {
                session_id: session.name.clone(),
                display_name: session.display_name.clone(),
                branch: session.branch.clone(),
                worktree_path: session.worktree_path.to_string_lossy().to_string(),
                base_branch: session.parent_branch.clone(),
                merge_mode: "rebase".to_string(),
                status: status_type,
                created_at: Some(session.created_at),
                last_modified: session.last_activity.or(Some(session.updated_at)),
                has_uncommitted_changes: Some(has_uncommitted),
                is_current: false,
                session_type: SessionType::Worktree,
                container_status: None,
                current_task: session.initial_prompt.clone(),
                todo_percentage: None,
                is_blocked: None,
                diff_stats: diff_stats.clone(),
                ready_to_merge: session.ready_to_merge,
            };
            
            let terminals = vec![
                format!("session-{}-top", session.name),
                format!("session-{}-bottom", session.name),
                format!("session-{}-right", session.name),
            ];
            
            enriched.push(EnrichedSession {
                info,
                status: None,
                terminals,
            });
        }
        
        Ok(enriched)
    }
    
    pub fn start_claude_in_session(&self, session_name: &str) -> Result<String> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        // Use per-session original settings if available, falling back to current globals
        let skip_permissions = session.original_skip_permissions.unwrap_or(self.db.get_skip_permissions()?);
        let agent_type = session.original_agent_type.clone().unwrap_or(self.db.get_agent_type()?);
        
        let command = match agent_type.as_str() {
            "cursor" => {
                let session_id = crate::para_core::cursor::find_cursor_session(&session.worktree_path);
                let prompt_to_use = if session_id.is_none() && !has_session_been_prompted(&session.worktree_path) {
                    session.initial_prompt.as_ref().map(|p| {
                        mark_session_prompted(&session.worktree_path);
                        p.as_str()
                    })
                } else {
                    None
                };
                
                crate::para_core::cursor::build_cursor_command(
                    &session.worktree_path,
                    session_id.as_deref(),
                    prompt_to_use,
                    skip_permissions,
                )
            }
            _ => {
                let session_id = crate::para_core::claude::find_claude_session(&session.worktree_path);
                let prompt_to_use = if session_id.is_none() && !has_session_been_prompted(&session.worktree_path) {
                    session.initial_prompt.as_ref().map(|p| {
                        mark_session_prompted(&session.worktree_path);
                        p.as_str()
                    })
                } else {
                    None
                };
                
                crate::para_core::claude::build_claude_command(
                    &session.worktree_path,
                    session_id.as_deref(),
                    prompt_to_use,
                    skip_permissions,
                )
            }
        };
        
        Ok(command)
    }
    
    pub fn start_claude_in_orchestrator(&self) -> Result<String> {
        let skip_permissions = self.db.get_skip_permissions()?;
        let agent_type = self.db.get_agent_type()?;
        
        let command = match agent_type.as_str() {
            "cursor" => {
                let session_id = crate::para_core::cursor::find_cursor_session(&self.repo_path);
                crate::para_core::cursor::build_cursor_command(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                )
            }
            _ => {
                let session_id = crate::para_core::claude::find_claude_session(&self.repo_path);
                crate::para_core::claude::build_claude_command(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                )
            }
        };
        
        Ok(command)
    }
    
    pub fn mark_session_ready(&self, session_name: &str, auto_commit: bool) -> Result<bool> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        
        // Check for uncommitted changes
        let has_uncommitted = git::has_uncommitted_changes(&session.worktree_path)?;
        
        if has_uncommitted && auto_commit {
            // Auto-commit changes
            git::commit_all_changes(
                &session.worktree_path,
                &format!("Mark session {session_name} as reviewed")
            )?;
        }
        
        // Update database
        self.db.update_session_ready_to_merge(&session.id, true)?;
        
        Ok(!has_uncommitted || auto_commit)
    }
    
    pub fn unmark_session_ready(&self, session_name: &str) -> Result<()> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        self.db.update_session_ready_to_merge(&session.id, false)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn db_ref(&self) -> &Database {
        &self.db
    }
}

#[cfg(test)]
mod session_tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;
    use chrono::Utc;
    use crate::para_core::types::{Session, SessionStatus};
    
    fn create_test_session_manager() -> (SessionManager, TempDir, Session) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        
        let worktree_path = temp_dir.path().join("test-session");
        fs::create_dir_all(&worktree_path).unwrap();
        
        let session = Session {
            id: "test-session-id".to_string(),
            name: "test-session".to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "para/test-session".to_string(),
            parent_branch: "main".to_string(),
            worktree_path,
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: Some("implement feature X".to_string()),
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
        };
        
        manager.db.create_session(&session).unwrap();
        (manager, temp_dir, session)
    }
    
    #[test]
    fn test_start_claude_in_session_fresh_session() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        manager.db.set_skip_permissions(true).unwrap();
        
        let result = manager.start_claude_in_session("test-session").unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("claude"));
        assert!(result.contains("--dangerously-skip-permissions"));
        assert!(result.contains("implement feature X"));
        assert!(!result.contains("-r"));
    }
    
    #[test]
    fn test_start_claude_in_session_without_skip_permissions() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        manager.db.set_skip_permissions(false).unwrap();
        
        let result = manager.start_claude_in_session("test-session").unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("claude"));
        assert!(!result.contains("--dangerously-skip-permissions"));
        assert!(result.contains("implement feature X"));
    }
    
    #[test]
    fn test_start_claude_in_session_no_initial_prompt() {
        let (manager, temp_dir, _) = create_test_session_manager();
        
        let worktree_path = temp_dir.path().join("no-prompt-session");
        fs::create_dir_all(&worktree_path).unwrap();
        
        let session_no_prompt = Session {
            id: "no-prompt-id".to_string(),
            name: "no-prompt-session".to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "para/no-prompt-session".to_string(),
            parent_branch: "main".to_string(),
            worktree_path,
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
        };
        
        manager.db.create_session(&session_no_prompt).unwrap();
        manager.db.set_skip_permissions(false).unwrap();
        
        let result = manager.start_claude_in_session("no-prompt-session").unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("claude"));
        assert!(!result.contains("--dangerously-skip-permissions"));
        assert!(!result.contains("implement"));
    }
    
    #[test]
    fn test_start_claude_in_session_nonexistent() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        let result = manager.start_claude_in_session("nonexistent-session");
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Query returned no rows") || error_msg.contains("no rows returned"));
    }
    
    #[test]
    fn test_start_claude_in_orchestrator() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        manager.db.set_skip_permissions(true).unwrap();
        
        let result = manager.start_claude_in_orchestrator().unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("claude"));
        assert!(result.contains("--dangerously-skip-permissions"));
        assert!(!result.contains("-r"));
    }
    
    #[test]
    fn test_start_claude_in_orchestrator_without_permissions() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        manager.db.set_skip_permissions(false).unwrap();
        
        let result = manager.start_claude_in_orchestrator().unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("claude"));
        assert!(!result.contains("--dangerously-skip-permissions"));
    }
    
    #[test]
    fn test_path_sanitization_in_claude_command() {
        let temp_dir = TempDir::new().unwrap();
        let path_with_spaces = temp_dir.path().join("path with spaces");
        fs::create_dir_all(&path_with_spaces).unwrap();
        
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        
        let session = Session {
            id: "spaces-session-id".to_string(),
            name: "spaces-session".to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "para/spaces-session".to_string(),
            parent_branch: "main".to_string(),
            worktree_path: path_with_spaces,
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: Some("test prompt".to_string()),
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
        };
        
        manager.db.create_session(&session).unwrap();
        manager.db.set_skip_permissions(false).unwrap();
        
        let result = manager.start_claude_in_session("spaces-session").unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("path with spaces"));
        assert!(result.contains("test prompt"));
    }
}