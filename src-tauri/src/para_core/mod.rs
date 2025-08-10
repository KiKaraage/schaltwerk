pub mod database;
pub mod git;
// pub mod mcp;  // Temporarily disabled - will be used for MCP server later
pub mod session;
pub mod activity;
pub mod types;
pub mod claude;
#[cfg(test)]
mod tests;

pub use database::Database;
pub use session::SessionManager;
pub use types::{Session, EnrichedSession};

use std::path::PathBuf;
use anyhow::Result;

pub struct ParaCore {
    pub db: Database,
    pub repo_path: PathBuf,
}

impl ParaCore {
    pub fn new(db_path: Option<PathBuf>) -> Result<Self> {
        let repo_path = git::discover_repository()?;
        let db = Database::new(db_path)?;
        
        Ok(Self {
            db,
            repo_path,
        })
    }
    
    pub fn session_manager(&self) -> SessionManager {
        SessionManager::new(self.db.clone(), self.repo_path.clone())
    }
}