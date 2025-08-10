use rusqlite::{params, Connection, Result as SqlResult};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use anyhow::Result;
use chrono::{DateTime, Utc, TimeZone};
use crate::para_core::types::{Session, SessionStatus, GitStats};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(db_path: Option<PathBuf>) -> Result<Self> {
        let path = db_path.unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap()
                .join("para-ui")
                .join("sessions.db")
        });
        
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        
        let conn = Connection::open(&path)?;
        
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        
        db.initialize_schema()?;
        
        Ok(db)
    }
    
    fn initialize_schema(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                branch TEXT NOT NULL,
                parent_branch TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_activity INTEGER,
                initial_prompt TEXT,
                ready_to_merge BOOLEAN DEFAULT FALSE,
                UNIQUE(repository_path, name)
            )",
            [],
        )?;
        
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repository_path)",
            [],
        )?;
        
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)",
            [],
        )?;
        
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(last_activity)",
            [],
        )?;
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS git_stats (
                session_id TEXT PRIMARY KEY,
                files_changed INTEGER NOT NULL,
                lines_added INTEGER NOT NULL,
                lines_removed INTEGER NOT NULL,
                has_uncommitted BOOLEAN NOT NULL,
                calculated_at INTEGER NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
            [],
        )?;
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS app_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                skip_permissions BOOLEAN DEFAULT FALSE
            )",
            [],
        )?;
        
        conn.execute(
            "INSERT OR IGNORE INTO app_config (id, skip_permissions) VALUES (1, FALSE)",
            [],
        )?;
        
        // Add ready_to_merge column if it doesn't exist (migration)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN ready_to_merge BOOLEAN DEFAULT FALSE",
            [],
        );
        
        Ok(())
    }
    
    pub fn create_session(&self, session: &Session) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT INTO sessions (
                id, name, repository_path, repository_name,
                branch, parent_branch, worktree_path,
                status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                session.id,
                session.name,
                session.repository_path.to_string_lossy(),
                session.repository_name,
                session.branch,
                session.parent_branch,
                session.worktree_path.to_string_lossy(),
                session.status.as_str(),
                session.created_at.timestamp(),
                session.updated_at.timestamp(),
                session.last_activity.map(|dt| dt.timestamp()),
                session.initial_prompt,
                session.ready_to_merge,
            ],
        )?;
        
        Ok(())
    }
    
    pub fn get_session_by_name(&self, repo_path: &Path, name: &str) -> Result<Session> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT id, name, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge
             FROM sessions
             WHERE repository_path = ?1 AND name = ?2"
        )?;
        
        let session = stmt.query_row(
            params![repo_path.to_string_lossy(), name],
            |row| {
                Ok(Session {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    repository_path: PathBuf::from(row.get::<_, String>(2)?),
                    repository_name: row.get(3)?,
                    branch: row.get(4)?,
                    parent_branch: row.get(5)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(6)?),
                    status: row.get::<_, String>(7)?.parse().unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(8)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(9)?, 0).unwrap(),
                    last_activity: row.get::<_, Option<i64>>(10)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    initial_prompt: row.get(11)?,
                    ready_to_merge: row.get(12).unwrap_or(false),
                })
            }
        )?;
        
        Ok(session)
    }
    
    pub fn get_session_by_id(&self, id: &str) -> Result<Session> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT id, name, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge
             FROM sessions
             WHERE id = ?1"
        )?;
        
        let session = stmt.query_row(
            params![id],
            |row| {
                Ok(Session {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    repository_path: PathBuf::from(row.get::<_, String>(2)?),
                    repository_name: row.get(3)?,
                    branch: row.get(4)?,
                    parent_branch: row.get(5)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(6)?),
                    status: row.get::<_, String>(7)?.parse().unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(8)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(9)?, 0).unwrap(),
                    last_activity: row.get::<_, Option<i64>>(10)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    initial_prompt: row.get(11)?,
                    ready_to_merge: row.get(12).unwrap_or(false),
                })
            }
        )?;
        
        Ok(session)
    }
    
    pub fn list_sessions(&self, repo_path: &Path) -> Result<Vec<Session>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT id, name, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge
             FROM sessions
             WHERE repository_path = ?1
             ORDER BY ready_to_merge ASC, COALESCE(last_activity, updated_at) DESC"
        )?;
        
        let sessions = stmt.query_map(
            params![repo_path.to_string_lossy()],
            |row| {
                Ok(Session {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    repository_path: PathBuf::from(row.get::<_, String>(2)?),
                    repository_name: row.get(3)?,
                    branch: row.get(4)?,
                    parent_branch: row.get(5)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(6)?),
                    status: row.get::<_, String>(7)?.parse().unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(8)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(9)?, 0).unwrap(),
                    last_activity: row.get::<_, Option<i64>>(10)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    initial_prompt: row.get(11)?,
                    ready_to_merge: row.get(12).unwrap_or(false),
                })
            }
        )?
        .collect::<SqlResult<Vec<_>>>()?;
        
        Ok(sessions)
    }
    
    pub fn list_all_active_sessions(&self) -> Result<Vec<Session>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT id, name, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge
             FROM sessions
             WHERE status = 'active'
             ORDER BY ready_to_merge ASC, COALESCE(last_activity, updated_at) DESC"
        )?;
        
        let sessions = stmt.query_map(
            [],
            |row| {
                Ok(Session {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    repository_path: PathBuf::from(row.get::<_, String>(2)?),
                    repository_name: row.get(3)?,
                    branch: row.get(4)?,
                    parent_branch: row.get(5)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(6)?),
                    status: row.get::<_, String>(7)?.parse().unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(8)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(9)?, 0).unwrap(),
                    last_activity: row.get::<_, Option<i64>>(10)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    initial_prompt: row.get(11)?,
                    ready_to_merge: row.get(12).unwrap_or(false),
                })
            }
        )?
        .collect::<SqlResult<Vec<_>>>()?;
        
        Ok(sessions)
    }
    
    pub fn update_session_status(&self, id: &str, status: SessionStatus) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE sessions
             SET status = ?1, updated_at = ?2
             WHERE id = ?3",
            params![status.as_str(), Utc::now().timestamp(), id],
        )?;
        
        Ok(())
    }
    
    pub fn update_session_activity(&self, id: &str, timestamp: DateTime<Utc>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE sessions
             SET last_activity = ?1
             WHERE id = ?2 AND (last_activity IS NULL OR last_activity < ?1)",
            params![timestamp.timestamp(), id],
        )?;
        
        Ok(())
    }
    
    pub fn update_session_ready_to_merge(&self, id: &str, ready: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE sessions
             SET ready_to_merge = ?1, updated_at = ?2
             WHERE id = ?3",
            params![ready, Utc::now().timestamp(), id],
        )?;
        
        Ok(())
    }
    
    pub fn save_git_stats(&self, stats: &GitStats) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT OR REPLACE INTO git_stats
             (session_id, files_changed, lines_added, lines_removed, has_uncommitted, calculated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                stats.session_id,
                stats.files_changed,
                stats.lines_added,
                stats.lines_removed,
                stats.has_uncommitted,
                stats.calculated_at.timestamp(),
            ],
        )?;
        
        Ok(())
    }
    
    
    pub fn should_update_stats(&self, session_id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        
        let result: SqlResult<i64> = conn.query_row(
            "SELECT calculated_at FROM git_stats WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        );
        
        match result {
            Ok(last_calculated) => {
                let now = Utc::now().timestamp();
                Ok(now - last_calculated > 30)
            }
            Err(_) => Ok(true),
        }
    }
    
    pub fn get_skip_permissions(&self) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        
        let result: SqlResult<bool> = conn.query_row(
            "SELECT skip_permissions FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        
        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok(false),
        }
    }
    
    pub fn set_skip_permissions(&self, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE app_config SET skip_permissions = ?1 WHERE id = 1",
            params![enabled],
        )?;
        
        Ok(())
    }
}

#[cfg(test)]
mod database_tests {
    use super::*;
    use tempfile::TempDir;
    
    fn create_test_database() -> (Database, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test_skip_permissions.db");
        let db = Database::new(Some(db_path)).unwrap();
        (db, temp_dir)
    }
    
    #[test]
    fn test_get_skip_permissions_default() {
        let (db, _temp_dir) = create_test_database();
        
        let result = db.get_skip_permissions().unwrap();
        assert!(!result);
    }
    
    #[test]
    fn test_set_skip_permissions_enabled() {
        let (db, _temp_dir) = create_test_database();
        
        db.set_skip_permissions(true).unwrap();
        let result = db.get_skip_permissions().unwrap();
        assert!(result);
    }
    
    #[test]
    fn test_set_skip_permissions_disabled() {
        let (db, _temp_dir) = create_test_database();
        
        db.set_skip_permissions(false).unwrap();
        let result = db.get_skip_permissions().unwrap();
        assert!(!result);
    }
    
    #[test]
    fn test_skip_permissions_persistence() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("persistence_test.db");
        
        {
            let db = Database::new(Some(db_path.clone())).unwrap();
            db.set_skip_permissions(true).unwrap();
        }
        
        let db = Database::new(Some(db_path)).unwrap();
        let result = db.get_skip_permissions().unwrap();
        assert!(result);
    }
    
    #[test]
    fn test_skip_permissions_toggle() {
        let (db, _temp_dir) = create_test_database();
        
        assert!(!db.get_skip_permissions().unwrap());
        
        db.set_skip_permissions(true).unwrap();
        assert!(db.get_skip_permissions().unwrap());
        
        db.set_skip_permissions(false).unwrap();
        assert!(!db.get_skip_permissions().unwrap());
        
        db.set_skip_permissions(true).unwrap();
        assert!(db.get_skip_permissions().unwrap());
    }
    
    #[test]
    fn test_skip_permissions_multiple_updates() {
        let (db, _temp_dir) = create_test_database();
        
        for i in 0..10 {
            let enable = i % 2 == 0;
            db.set_skip_permissions(enable).unwrap();
            assert_eq!(db.get_skip_permissions().unwrap(), enable);
        }
    }
    
    #[test]
    fn test_skip_permissions_error_handling() {
        let (db, _temp_dir) = create_test_database();
        
        let result_get = db.get_skip_permissions();
        assert!(result_get.is_ok());
        
        let result_set = db.set_skip_permissions(true);
        assert!(result_set.is_ok());
    }
}