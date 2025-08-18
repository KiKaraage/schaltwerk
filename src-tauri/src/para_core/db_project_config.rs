use rusqlite::params;
use std::path::Path;
use anyhow::Result;
use chrono::Utc;
use crate::para_core::database::Database;

pub trait ProjectConfigMethods {
    fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>>;
    fn set_project_setup_script(&self, repo_path: &Path, setup_script: &str) -> Result<()>;
}

impl ProjectConfigMethods for Database {
    fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        
        // Canonicalize the path for consistent storage/retrieval
        let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
        
        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT setup_script FROM project_config WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );
        
        match result {
            Ok(script) => Ok(Some(script)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    fn set_project_setup_script(&self, repo_path: &Path, setup_script: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp();
        
        // Canonicalize the path for consistent storage/retrieval
        let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
        
        conn.execute(
            "INSERT INTO project_config (repository_path, setup_script, created_at, updated_at) 
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(repository_path) DO UPDATE SET 
                setup_script = excluded.setup_script,
                updated_at = excluded.updated_at",
            params![canonical_path.to_string_lossy(), setup_script, now, now],
        )?;
        
        Ok(())
    }
}