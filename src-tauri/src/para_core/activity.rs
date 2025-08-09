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

pub struct ActivityTracker {
    db: Arc<Database>,
}

impl ActivityTracker {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
    
    pub async fn start_polling(self) {
        let mut interval = interval(Duration::from_secs(30));
        
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
            }
            
            if self.db.should_update_stats(&session.id)? {
                let mut stats = git::calculate_git_stats(&session.worktree_path, &session.parent_branch)?;
                stats.session_id = session.id.clone();
                self.db.save_git_stats(&stats)?;
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

pub fn start_activity_tracking(db: Arc<Database>) {
    let tracker = ActivityTracker::new(db);
    
    tokio::spawn(async move {
        tracker.start_polling().await;
    });
}