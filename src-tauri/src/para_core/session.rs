use std::path::PathBuf;
use anyhow::{Result, anyhow};
use uuid::Uuid;
use chrono::Utc;
use crate::para_core::{
    database::Database,
    git,
    types::{Session, SessionStatus, SessionInfo, SessionStatusType, SessionType, EnrichedSession, DiffStats},
};

pub struct SessionManager {
    db: Database,
    repo_path: PathBuf,
}

impl SessionManager {
    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        Self { db, repo_path }
    }
    
    pub fn create_session(&self, name: &str, prompt: Option<&str>) -> Result<Session> {
        if !git::is_valid_session_name(name) {
            return Err(anyhow!("Invalid session name: use only letters, numbers, hyphens, and underscores"));
        }
        
        let session_id = Uuid::new_v4().to_string();
        let branch = format!("para/{name}");
        let worktree_path = self.repo_path
            .join(".para")
            .join("worktrees")
            .join(name);
        
        let parent_branch = git::get_current_branch(&self.repo_path)?;
        let repo_name = self.repo_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        
        let now = Utc::now();
        
        let session = Session {
            id: session_id.clone(),
            name: name.to_string(),
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
        };
        
        // Create worktree with new branch (this creates both the branch and worktree)
        if let Err(e) = git::create_worktree(&self.repo_path, &branch, &worktree_path) {
            return Err(anyhow!("Failed to create worktree: {}", e));
        }
        
        if let Err(e) = self.db.create_session(&session) {
            let _ = git::remove_worktree(&self.repo_path, &worktree_path);
            let _ = git::delete_branch(&self.repo_path, &branch);
            return Err(anyhow!("Failed to save session to database: {}", e));
        }
        
        let mut git_stats = git::calculate_git_stats(&worktree_path, &parent_branch)?;
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
                return Err(anyhow!("Failed to remove worktree: {}", e));
            }
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
        let mut stats = git::calculate_git_stats(&session.worktree_path, &session.parent_branch)?;
        stats.session_id = session_id.to_string();
        self.db.save_git_stats(&stats)?;
        Ok(())
    }
    
    pub fn cleanup_orphaned_worktrees(&self) -> Result<()> {
        let worktrees = git::list_worktrees(&self.repo_path)?;
        
        for worktree_path in worktrees {
            if !worktree_path.to_string_lossy().contains("/.para/worktrees/") {
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
            let has_uncommitted = if let Ok(stats) = self.db.should_update_stats(&session.id) {
                if !stats {
                    git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false)
                } else {
                    false
                }
            } else {
                false
            };
            
            let git_stats = git::calculate_git_stats(&session.worktree_path, &session.parent_branch).ok();
            
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
                branch: session.branch.clone(),
                worktree_path: session.worktree_path.to_string_lossy().to_string(),
                base_branch: session.parent_branch.clone(),
                merge_mode: "rebase".to_string(),
                status: status_type,
                last_modified: session.last_activity,
                has_uncommitted_changes: Some(has_uncommitted),
                is_current: false,
                session_type: SessionType::Worktree,
                container_status: None,
                session_state: Some(session.status.as_str().to_string()),
                current_task: session.initial_prompt.clone(),
                test_status: None,
                todo_percentage: None,
                is_blocked: None,
                diff_stats: diff_stats.clone(),
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
}