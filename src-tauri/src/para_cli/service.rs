use super::{client::ParaCliClient, types::*};
use anyhow::Result;
use std::collections::HashMap;
use log::{info, debug};
use tokio::sync::RwLock;
use std::sync::Arc;

pub struct ParaService {
    client: ParaCliClient,
    cache: Arc<RwLock<SessionCache>>,
}

struct SessionCache {
    sessions: Vec<EnrichedSession>,
    last_updated: std::time::Instant,
}

impl ParaService {
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: ParaCliClient::new()?,
            cache: Arc::new(RwLock::new(SessionCache {
                sessions: Vec::new(),
                last_updated: std::time::Instant::now(),
            })),
        })
    }
    
    pub async fn get_all_sessions(&self, include_archived: bool) -> Result<Vec<EnrichedSession>> {
        {
            let cache = self.cache.read().await;
            if cache.last_updated.elapsed().as_secs() < 5 && !cache.sessions.is_empty() {
                debug!("Returning cached sessions");
                return Ok(cache.sessions.clone());
            }
        }
        
        info!("Fetching fresh session data from para CLI");
        
        let sessions = self.fetch_sessions(include_archived).await?;
        
        {
            let mut cache = self.cache.write().await;
            cache.sessions = sessions.clone();
            cache.last_updated = std::time::Instant::now();
        }
        
        Ok(sessions)
    }
    
    pub async fn fetch_sessions(&self, include_archived: bool) -> Result<Vec<EnrichedSession>> {
        let session_infos = self.client.list_sessions(include_archived).await?;
        debug!("Found {} sessions", session_infos.len());
        
        // Try to get additional status data, but don't fail if unavailable
        let statuses = match self.client.get_all_statuses().await {
            Ok(s) => s,
            Err(e) => {
                debug!("Using monitor data from session info, status command failed: {e}");
                Vec::new()
            }
        };
        
        let status_map: HashMap<String, SessionStatus> = statuses
            .into_iter()
            .map(|s| (s.session_name.clone(), s))
            .collect();
        
        let enriched: Vec<EnrichedSession> = session_infos
            .into_iter()
            .map(|info| {
                // First try to get status from the separate status command
                let mut status = status_map.get(&info.session_id).cloned();
                
                // If no separate status but we have monitor data in SessionInfo, create a status from it
                if status.is_none() && (info.current_task.is_some() || info.test_status.is_some()) {
                    status = Some(self.create_status_from_monitor_data(&info));
                }
                
                let terminals = self.get_session_terminals(&info.session_id);
                
                EnrichedSession {
                    info,
                    status,
                    terminals,
                }
            })
            .collect();
        
        Ok(enriched)
    }
    
    fn create_status_from_monitor_data(&self, info: &SessionInfo) -> SessionStatus {
        use chrono::Utc;
        
        SessionStatus {
            session_name: info.session_id.clone(),
            current_task: info.current_task.clone().unwrap_or_else(|| format!("Working on {}", info.session_id)),
            test_status: match info.test_status.as_deref() {
                Some("passed") => TestStatus::Passed,
                Some("failed") => TestStatus::Failed,
                _ => TestStatus::Unknown,
            },
            diff_stats: info.diff_stats.clone(),
            todos_completed: info.todo_percentage.map(|pct| (pct as u32 * 10) / 100),
            todos_total: info.todo_percentage.map(|_| 10), // Default estimate
            is_blocked: info.is_blocked.unwrap_or(false),
            blocked_reason: if info.is_blocked.unwrap_or(false) {
                Some("Blocked".to_string())
            } else {
                None
            },
            last_update: info.last_modified.unwrap_or_else(Utc::now),
        }
    }
    
    pub async fn get_session(&self, session_name: &str) -> Result<Option<EnrichedSession>> {
        let sessions = self.get_all_sessions(false).await?;
        Ok(sessions.into_iter().find(|s| s.info.session_id == session_name))
    }
    
    pub async fn get_summary(&self) -> Result<SessionsSummary> {
        let sessions = self.get_all_sessions(false).await?;
        
        let total_sessions = sessions.len();
        let active_sessions = sessions.iter()
            .filter(|s| {
                // Check session_state first, then fall back to status
                if let Some(ref state) = s.info.session_state {
                    state == "active"
                } else {
                    matches!(s.info.status, SessionStatusType::Active)
                }
            })
            .count();
        
        let blocked_sessions = sessions.iter()
            .filter(|s| {
                // Check info.is_blocked first, then status
                s.info.is_blocked.unwrap_or(false) || 
                s.status.as_ref().is_some_and(|st| st.is_blocked)
            })
            .count();
        
        let container_sessions = sessions.iter()
            .filter(|s| matches!(s.info.session_type, SessionType::Container))
            .count();
        
        let tests_passing = sessions.iter()
            .filter(|s| {
                // Check info.test_status first, then status
                if let Some(ref test) = s.info.test_status {
                    test == "passed"
                } else if let Some(ref status) = s.status {
                    matches!(status.test_status, TestStatus::Passed)
                } else {
                    false
                }
            })
            .count();
        
        let tests_failing = sessions.iter()
            .filter(|s| {
                // Check info.test_status first, then status
                if let Some(ref test) = s.info.test_status {
                    test == "failed"
                } else if let Some(ref status) = s.status {
                    matches!(status.test_status, TestStatus::Failed)
                } else {
                    false
                }
            })
            .count();
        
        let total_todos: u32 = sessions.iter()
            .filter_map(|s| s.status.as_ref()?.todos_total)
            .sum();
        let completed_todos: u32 = sessions.iter()
            .filter_map(|s| s.status.as_ref()?.todos_completed)
            .sum();
        
        Ok(SessionsSummary {
            total_sessions,
            active_sessions,
            blocked_sessions,
            container_sessions,
            tests_passing,
            tests_failing,
            total_todos,
            completed_todos,
        })
    }
    
    pub async fn invalidate_cache(&self) {
        let mut cache = self.cache.write().await;
        cache.last_updated = std::time::Instant::now() - std::time::Duration::from_secs(60);
    }
    
    pub async fn finish_session(&self, session_id: &str, message: &str, branch: Option<&str>) -> Result<()> {
        info!("Finishing session {session_id} with message: {message}");
        self.client.finish_session(session_id, message, branch).await?;
        self.invalidate_cache().await;
        Ok(())
    }
    
    pub async fn cancel_session(&self, session_id: &str, force: bool) -> Result<()> {
        info!("Cancelling session {session_id} (force: {force})");
        self.client.cancel_session(session_id, force).await?;
        self.invalidate_cache().await;
        Ok(())
    }
    
    fn get_session_terminals(&self, session_id: &str) -> Vec<String> {
        if session_id == "orchestrator" {
            vec![
                "orchestrator-top".to_string(),
                "orchestrator-bottom".to_string(),
                "orchestrator-right".to_string(),
            ]
        } else {
            vec![
                format!("session-{}-top", session_id),
                format!("session-{}-bottom", session_id),
                format!("session-{}-right", session_id),
            ]
        }
    }
}