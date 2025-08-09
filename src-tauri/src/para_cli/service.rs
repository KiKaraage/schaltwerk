use super::{client::ParaCliClient, types::*};
use anyhow::Result;
use std::collections::HashMap;
use log::{info, debug, warn};
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
        
        let statuses = match self.client.get_all_statuses().await {
            Ok(s) => s,
            Err(e) => {
                warn!("Failed to get session statuses: {e}");
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
                let status = status_map.get(&info.session_id).cloned();
                
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
    
    pub async fn get_session(&self, session_name: &str) -> Result<Option<EnrichedSession>> {
        let sessions = self.get_all_sessions(false).await?;
        Ok(sessions.into_iter().find(|s| s.info.session_id == session_name))
    }
    
    pub async fn get_summary(&self) -> Result<SessionsSummary> {
        let sessions = self.get_all_sessions(false).await?;
        
        let total_sessions = sessions.len();
        let active_sessions = sessions.iter()
            .filter(|s| matches!(s.info.status, SessionStatusType::Active))
            .count();
        let blocked_sessions = sessions.iter()
            .filter(|s| s.status.as_ref().is_some_and(|st| st.is_blocked))
            .count();
        let container_sessions = sessions.iter()
            .filter(|s| matches!(s.info.session_type, SessionType::Container))
            .count();
        
        let tests_passing = sessions.iter()
            .filter(|s| s.status.as_ref()
                .is_some_and(|st| matches!(st.test_status, TestStatus::Passed)))
            .count();
        let tests_failing = sessions.iter()
            .filter(|s| s.status.as_ref()
                .is_some_and(|st| matches!(st.test_status, TestStatus::Failed)))
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