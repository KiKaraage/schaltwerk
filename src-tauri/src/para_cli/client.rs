use anyhow::{Result, anyhow};
use log::{debug, error};
use std::process::Stdio;
use tokio::process::Command;
use serde::de::DeserializeOwned;
use super::types::{SessionInfo, SessionStatus};

pub struct ParaCliClient {
    para_binary: String,
}

impl ParaCliClient {
    pub fn new() -> Result<Self> {
        let para_binary = which::which("para")
            .map_err(|_| anyhow!("para CLI not found in PATH. Please install para first."))?
            .to_string_lossy()
            .to_string();
        
        debug!("Found para CLI at: {para_binary}");
        Ok(Self { para_binary })
    }
    
    
    async fn execute_json<T: DeserializeOwned>(&self, args: &[&str]) -> Result<T> {
        debug!("Executing para command: {} {}", self.para_binary, args.join(" "));
        
        let output = Command::new(&self.para_binary)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| anyhow!("Failed to execute para command: {}", e))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("Para command failed: {stderr}");
            return Err(anyhow!("Para command failed: {}", stderr));
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout)
            .map_err(|e| anyhow!("Failed to parse JSON output: {}. Output: {}", e, stdout))
    }
    
    pub async fn list_sessions(&self, include_archived: bool) -> Result<Vec<SessionInfo>> {
        let mut args = vec!["list", "--json"];
        if include_archived {
            args.push("--archived");
        }
        
        self.execute_json(&args).await
    }
    
    pub async fn get_all_statuses(&self) -> Result<Vec<SessionStatus>> {
        self.execute_json(&["status", "show", "--json"]).await
    }
    
    async fn execute_command(&self, args: &[&str]) -> Result<()> {
        debug!("Executing para command: {} {}", self.para_binary, args.join(" "));
        
        let output = Command::new(&self.para_binary)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| anyhow!("Failed to execute para command: {}", e))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("Para command failed: {stderr}");
            return Err(anyhow!("Para command failed: {}", stderr));
        }
        
        Ok(())
    }
    
    pub async fn finish_session(&self, session_id: &str, message: &str, branch: Option<&str>) -> Result<()> {
        let mut args = vec!["finish", "--session", session_id, "--message", message];
        
        if let Some(branch_name) = branch {
            args.push("--branch");
            args.push(branch_name);
        }
        
        self.execute_command(&args).await
    }
    
    pub async fn cancel_session(&self, session_id: &str, force: bool) -> Result<()> {
        let mut args = vec!["cancel", "--session", session_id];
        
        if force {
            args.push("--force");
        }
        
        self.execute_command(&args).await
    }
    
}