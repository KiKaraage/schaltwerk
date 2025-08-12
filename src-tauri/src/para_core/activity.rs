use std::path::Path;
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tokio::time::{interval, Duration};
use walkdir::WalkDir;
use chrono::{Utc, DateTime, TimeZone};
use anyhow::Result;
use crate::para_core::{
    database::Database,
    git,
};
use tauri::{AppHandle, Emitter};
use serde::Serialize;

pub trait EventEmitter: Send + Sync {
    fn emit_session_activity(&self, payload: SessionActivityUpdated) -> Result<()>;
    fn emit_session_git_stats(&self, payload: SessionGitStatsUpdated) -> Result<()>;
}

impl EventEmitter for AppHandle {
    fn emit_session_activity(&self, payload: SessionActivityUpdated) -> Result<()> {
        self.emit("schaltwerk:session-activity", payload)
            .map_err(|e| anyhow::anyhow!("Failed to emit session activity: {e}"))
    }
    
    fn emit_session_git_stats(&self, payload: SessionGitStatsUpdated) -> Result<()> {
        self.emit("schaltwerk:session-git-stats", payload)
            .map_err(|e| anyhow::anyhow!("Failed to emit git stats: {e}"))
    }
}

pub struct ActivityTracker<E: EventEmitter> {
    db: Arc<Database>,
    emitter: E,
}

impl<E: EventEmitter> ActivityTracker<E> {
    pub fn new(db: Arc<Database>, emitter: E) -> Self {
        Self { db, emitter }
    }
    
    pub async fn start_polling(self) {
        let mut interval = interval(Duration::from_secs(60));
        
        loop {
            interval.tick().await;
            
            if let Err(e) = self.update_all_activities().await {
                log::error!("Failed to update activities: {e}");
            }
        }
    }
    
    async fn update_all_activities(&self) -> Result<()> {
        let active_sessions = self.db.list_all_active_sessions()?;
        
        for session in active_sessions {
            if let Ok(Some(timestamp)) = self.get_last_modification(&session.worktree_path) {
                self.db.update_session_activity(&session.id, timestamp)?;
                // Emit activity update event
                let payload = SessionActivityUpdated {
                    session_id: session.id.clone(),
                    session_name: session.name.clone(),
                    last_activity_ts: timestamp.timestamp(),
                };
                let _ = self.emitter.emit_session_activity(payload);
            }
            
            if self.db.should_update_stats(&session.id)? {
                // Skip stats for missing worktrees; they may have been deleted externally
                if !session.worktree_path.exists() {
                    log::warn!(
                        "Skipping git stats for missing worktree: {}",
                        session.worktree_path.display()
                    );
                } else {
                    match git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch) {
                        Ok(mut stats) => {
                            stats.session_id = session.id.clone();
                            if let Err(e) = self.db.save_git_stats(&stats) {
                                log::warn!("Failed to save git stats for {}: {}", session.name, e);
                            }
                            // Emit git stats update event
                            let payload = SessionGitStatsUpdated {
                                session_id: session.id.clone(),
                                session_name: session.name.clone(),
                                files_changed: stats.files_changed,
                                lines_added: stats.lines_added,
                                lines_removed: stats.lines_removed,
                                has_uncommitted: stats.has_uncommitted,
                            };
                            let _ = self.emitter.emit_session_git_stats(payload);
                        }
                        Err(e) => {
                            log::warn!(
                                "Failed to compute git stats for {}: {}",
                                session.name, e
                            );
                        }
                    }
                }
            }
        }
        
        Ok(())
    }
    
    fn get_last_modification(&self, path: &Path) -> Result<Option<DateTime<Utc>>> {
        if !path.exists() {
            return Ok(None);
        }
        
        let mut latest = 0i64;
        
        for entry in WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.path().components().any(|c| c.as_os_str() == ".git") {
                continue;
            }
            
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    let timestamp = modified
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_secs() as i64;
                    
                    if timestamp > latest {
                        latest = timestamp;
                    }
                }
            }
        }
        
        if latest > 0 {
            Ok(Utc.timestamp_opt(latest, 0).single())
        } else {
            Ok(None)
        }
    }
}

// Removed unused legacy API `start_activity_tracking` to simplify code.

#[derive(Serialize, Clone, Debug)]
pub struct SessionActivityUpdated {
    pub session_id: String,
    pub session_name: String,
    pub last_activity_ts: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct SessionGitStatsUpdated {
    pub session_id: String,
    pub session_name: String,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub has_uncommitted: bool,
}

pub fn start_activity_tracking_with_app(db: Arc<Database>, app: AppHandle) {
    let tracker = ActivityTracker::new(db, app);
    tokio::spawn(async move {
        tracker.start_polling().await;
    });
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;
    use crate::para_core::database::Database;
    
    struct MockEmitter {
        activity_events: Arc<Mutex<Vec<SessionActivityUpdated>>>,
        git_stats_events: Arc<Mutex<Vec<SessionGitStatsUpdated>>>,
    }
    
    impl MockEmitter {
        fn new() -> Self {
            Self {
                activity_events: Arc::new(Mutex::new(Vec::new())),
                git_stats_events: Arc::new(Mutex::new(Vec::new())),
            }
        }
        
        fn get_activity_events(&self) -> Vec<SessionActivityUpdated> {
            self.activity_events.lock().unwrap().clone()
        }
        
        fn get_git_stats_events(&self) -> Vec<SessionGitStatsUpdated> {
            self.git_stats_events.lock().unwrap().clone()
        }
    }
    
    impl EventEmitter for MockEmitter {
        fn emit_session_activity(&self, payload: SessionActivityUpdated) -> Result<()> {
            self.activity_events.lock().unwrap().push(payload);
            Ok(())
        }
        
        fn emit_session_git_stats(&self, payload: SessionGitStatsUpdated) -> Result<()> {
            self.git_stats_events.lock().unwrap().push(payload);
            Ok(())
        }
    }
    
    
    #[test]
    fn test_payload_mapping_for_session_activity() {
        let payload = SessionActivityUpdated {
            session_id: "test-session-123".to_string(),
            session_name: "my-feature-branch".to_string(),
            last_activity_ts: 1704067200,
        };
        
        assert_eq!(payload.session_id, "test-session-123");
        assert_eq!(payload.session_name, "my-feature-branch");
        assert_eq!(payload.last_activity_ts, 1704067200);
    }
    
    #[test]
    fn test_event_emitter_trait_methods() {
        let mock_emitter = MockEmitter::new();
        
        let activity_payload = SessionActivityUpdated {
            session_id: "session1".to_string(),
            session_name: "feature".to_string(),
            last_activity_ts: 1704067200,
        };
        
        let stats_payload = SessionGitStatsUpdated {
            session_id: "session1".to_string(),
            session_name: "feature".to_string(),
            files_changed: 5,
            lines_added: 100,
            lines_removed: 20,
            has_uncommitted: true,
        };
        
        mock_emitter.emit_session_activity(activity_payload.clone()).unwrap();
        mock_emitter.emit_session_git_stats(stats_payload.clone()).unwrap();
        
        let activity_events = mock_emitter.get_activity_events();
        let git_events = mock_emitter.get_git_stats_events();
        
        assert_eq!(activity_events.len(), 1);
        assert_eq!(git_events.len(), 1);
        
        assert_eq!(activity_events[0].session_id, "session1");
        assert_eq!(git_events[0].files_changed, 5);
    }
    
    #[test]
    fn test_git_stats_payload_structure() {
        let payload = SessionGitStatsUpdated {
            session_id: "session-456".to_string(),
            session_name: "bug-fix".to_string(),
            files_changed: 3,
            lines_added: 45,
            lines_removed: 12,
            has_uncommitted: false,
        };
        
        assert_eq!(payload.session_id, "session-456");
        assert_eq!(payload.session_name, "bug-fix");
        assert_eq!(payload.files_changed, 3);
        assert_eq!(payload.lines_added, 45);
        assert_eq!(payload.lines_removed, 12);
        assert!(!payload.has_uncommitted);
    }
    
    #[test]
    fn test_get_last_modification_nonexistent_path() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Arc::new(Database::new(Some(db_path)).unwrap());
        let mock_emitter = MockEmitter::new();
        let tracker = ActivityTracker::new(db, mock_emitter);
        
        let nonexistent_path = temp_dir.path().join("nonexistent");
        let result = tracker.get_last_modification(&nonexistent_path).unwrap();
        assert!(result.is_none());
    }
    
    #[test]
    fn test_get_last_modification_with_git_directory() {
        let temp_dir = TempDir::new().unwrap();
        let git_dir = temp_dir.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("config"), "git config").unwrap();
        std::fs::write(temp_dir.path().join("regular.txt"), "content").unwrap();
        
        let db_path = temp_dir.path().join("test.db");
        let db = Arc::new(Database::new(Some(db_path)).unwrap());
        let mock_emitter = MockEmitter::new();
        let tracker = ActivityTracker::new(db, mock_emitter);
        
        let result = tracker.get_last_modification(temp_dir.path()).unwrap();
        assert!(result.is_some());
    }
}