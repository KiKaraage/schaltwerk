use std::path::PathBuf;
use std::sync::Arc;
use serde_json::{json, Value};
use anyhow::{Result, anyhow};
use crate::para_core::{
    database::Database,
    session::SessionManager,
    types::{
        CreateSessionParams,
        CancelSessionParams,
        FinishSessionParams,
        GetSessionStatusParams,
        SessionStatusResponse,
    },
};

pub struct ParaMcpServer {
    db: Arc<Database>,
    repo_path: PathBuf,
}

impl ParaMcpServer {
    pub fn new(db: Arc<Database>) -> Result<Self> {
        let repo_path = crate::para_core::git::discover_repository()?;
        
        Ok(Self {
            db,
            repo_path,
        })
    }
    
    pub async fn handle_request(&self, request: Value) -> Result<Value> {
        let method = request["method"]
            .as_str()
            .ok_or_else(|| anyhow!("Missing method"))?;
        let params = &request["params"];
        
        match method {
            "para_start_session" => self.start_session(params).await,
            "para_list_sessions" => self.list_sessions().await,
            "para_cancel_session" => self.cancel_session(params).await,
            "para_finish_session" => self.finish_session(params).await,
            "para_get_session_status" => self.get_session_status(params).await,
            _ => Err(anyhow!("Unknown method: {}", method)),
        }
    }
    
    async fn start_session(&self, params: &Value) -> Result<Value> {
        let params: CreateSessionParams = serde_json::from_value(params.clone())?;
        
        let manager = SessionManager::new((*self.db).clone(), self.repo_path.clone());
        let session = manager.create_session(&params.name, params.prompt.as_deref())?;
        
        Ok(json!({
            "success": true,
            "session": {
                "id": session.id,
                "name": session.name,
                "worktree_path": session.worktree_path,
                "branch": session.branch,
                "status": session.status,
            }
        }))
    }
    
    async fn list_sessions(&self) -> Result<Value> {
        let sessions = self.db.list_sessions(&self.repo_path)?;
        
        Ok(json!({
            "success": true,
            "sessions": sessions.iter().map(|s| json!({
                "id": s.id,
                "name": s.name,
                "repository": s.repository_name,
                "status": s.status,
                "last_activity": s.last_activity,
            })).collect::<Vec<_>>()
        }))
    }
    
    async fn cancel_session(&self, params: &Value) -> Result<Value> {
        let params: CancelSessionParams = serde_json::from_value(params.clone())?;
        
        let manager = SessionManager::new((*self.db).clone(), self.repo_path.clone());
        manager.cancel_session(&params.name)?;
        
        Ok(json!({ "success": true }))
    }
    
    async fn finish_session(&self, params: &Value) -> Result<Value> {
        let params: FinishSessionParams = serde_json::from_value(params.clone())?;
        
        let manager = SessionManager::new((*self.db).clone(), self.repo_path.clone());
        manager.finish_session(&params.name, params.message.as_deref())?;
        
        Ok(json!({ "success": true }))
    }
    
    async fn get_session_status(&self, params: &Value) -> Result<Value> {
        let params: GetSessionStatusParams = serde_json::from_value(params.clone())?;
        
        let session = self.db.get_session_by_name(&self.repo_path, &params.name)?;
        let git_stats = crate::para_core::git::calculate_git_stats(&session.worktree_path, &session.parent_branch)?;
        
        let response = SessionStatusResponse {
            name: session.name,
            status: session.status.as_str().to_string(),
            files_changed: git_stats.files_changed,
            lines_added: git_stats.lines_added,
            has_uncommitted: git_stats.has_uncommitted,
            last_activity: session.last_activity,
        };
        
        Ok(json!({
            "success": true,
            "status": response,
        }))
    }
    
    pub fn generate_mcp_config(&self) -> Result<()> {
        let config = json!({
            "mcpServers": {
                "para-ui": {
                    "type": "stdio",
                    "command": "para-ui",
                    "args": ["mcp-server"],
                    "description": "Para UI session management"
                }
            }
        });
        
        let config_path = std::env::current_dir()?.join(".mcp.json");
        std::fs::write(config_path, serde_json::to_string_pretty(&config)?)?;
        
        Ok(())
    }
}