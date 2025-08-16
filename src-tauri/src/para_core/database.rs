use rusqlite::{params, Connection, Result as SqlResult};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use anyhow::Result;
use chrono::{DateTime, Utc, TimeZone};
use crate::para_core::types::{Session, SessionStatus, SessionState, GitStats};

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
                display_name TEXT,
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
                original_agent_type TEXT,
                original_skip_permissions BOOLEAN,
                pending_name_generation BOOLEAN DEFAULT FALSE,
                was_auto_generated BOOLEAN DEFAULT FALSE,
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
                skip_permissions BOOLEAN DEFAULT FALSE,
                agent_type TEXT DEFAULT 'claude',
                default_open_app TEXT DEFAULT 'finder',
                default_base_branch TEXT,
                terminal_font_size INTEGER DEFAULT 13,
                ui_font_size INTEGER DEFAULT 12
            )",
            [],
        )?;
        
        // Handle migration: Add agent_type column if it doesn't exist
        let column_exists = {
            let result = conn.prepare("SELECT agent_type FROM app_config LIMIT 1");
            match result {
                Ok(mut stmt) => stmt.query([]).is_ok(),
                Err(_) => false,
            }
        };
        
        if !column_exists {
            conn.execute("ALTER TABLE app_config ADD COLUMN agent_type TEXT DEFAULT 'claude'", [])?;
        }
        
        // Migration: Add default_open_app column if it doesn't exist
        let default_open_app_exists = {
            let result = conn.prepare("SELECT default_open_app FROM app_config LIMIT 1");
            match result {
                Ok(mut stmt) => stmt.query([]).is_ok(),
                Err(_) => false,
            }
        };
        if !default_open_app_exists {
            let _ = conn.execute("ALTER TABLE app_config ADD COLUMN default_open_app TEXT DEFAULT 'finder'", []);
        }
        
        // Migration: Add default_base_branch column if it doesn't exist
        let default_base_branch_exists = {
            let result = conn.prepare("SELECT default_base_branch FROM app_config LIMIT 1");
            match result {
                Ok(mut stmt) => stmt.query([]).is_ok(),
                Err(_) => false,
            }
        };
        if !default_base_branch_exists {
            let _ = conn.execute("ALTER TABLE app_config ADD COLUMN default_base_branch TEXT", []);
        }
        
        // Migration: Add terminal_font_size and ui_font_size columns if they don't exist
        let terminal_font_size_exists = {
            let result = conn.prepare("SELECT terminal_font_size FROM app_config LIMIT 1");
            result.is_ok()
        };
        
        if !terminal_font_size_exists {
            // Check if old font_size column exists and migrate
            let old_font_size_exists = {
                let result = conn.prepare("SELECT font_size FROM app_config LIMIT 1");
                result.is_ok()
            };
            
            if old_font_size_exists {
                // Migrate from old font_size to new columns
                let old_size: SqlResult<i32> = conn.query_row(
                    "SELECT font_size FROM app_config WHERE id = 1",
                    [],
                    |row| row.get(0),
                );
                
                let font_value = old_size.unwrap_or(13);
                let ui_value = if font_value == 13 { 12 } else { font_value - 1 };
                
                conn.execute("ALTER TABLE app_config ADD COLUMN terminal_font_size INTEGER", [])?;
                conn.execute("ALTER TABLE app_config ADD COLUMN ui_font_size INTEGER", [])?;
                conn.execute(
                    "UPDATE app_config SET terminal_font_size = ?1, ui_font_size = ?2 WHERE id = 1",
                    params![font_value, ui_value],
                )?;
            } else {
                conn.execute("ALTER TABLE app_config ADD COLUMN terminal_font_size INTEGER DEFAULT 13", [])?;
                conn.execute("ALTER TABLE app_config ADD COLUMN ui_font_size INTEGER DEFAULT 12", [])?;
            }
        }
        
        conn.execute(
            "INSERT OR IGNORE INTO app_config (id, skip_permissions, agent_type, default_open_app, terminal_font_size, ui_font_size) VALUES (1, FALSE, 'claude', 'finder', 13, 12)",
            [],
        )?;
        
        // Add ready_to_merge column if it doesn't exist (migration)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN ready_to_merge BOOLEAN DEFAULT FALSE",
            [],
        );
        // Add original_agent_type column if it doesn't exist (migration)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN original_agent_type TEXT",
            [],
        );
        // Add original_skip_permissions column if it doesn't exist (migration)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN original_skip_permissions BOOLEAN",
            [],
        );
        // Add display_name column if it doesn't exist (migration)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN display_name TEXT",
            [],
        );
        // Add pending_name_generation column if it doesn't exist (migration)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN pending_name_generation BOOLEAN DEFAULT FALSE",
            [],
        );
        // Add was_auto_generated column if it doesn't exist (migration)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN was_auto_generated BOOLEAN DEFAULT FALSE",
            [],
        );
        // Add draft_content column if it doesn't exist (migration)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN draft_content TEXT",
            [],
        );
        // Add session_state column if it doesn't exist (migration), default to 'running' for backward compatibility
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN session_state TEXT DEFAULT 'running'",
            [],
        );
        
        // Create project_config table for project-specific settings
        conn.execute(
            "CREATE TABLE IF NOT EXISTS project_config (
                repository_path TEXT PRIMARY KEY,
                setup_script TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;
        
        Ok(())
    }
    
    pub fn create_session(&self, session: &Session) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT INTO sessions (
                id, name, display_name, repository_path, repository_name,
                branch, parent_branch, worktree_path,
                status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                draft_content, session_state
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
            params![
                session.id,
                session.name,
                session.display_name,
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
                session.original_agent_type,
                session.original_skip_permissions,
                session.pending_name_generation,
                session.was_auto_generated,
                session.draft_content,
                session.session_state.as_str(),
            ],
        )?;
        
        Ok(())
    }
    
    pub fn get_session_by_name(&self, repo_path: &Path, name: &str) -> Result<Session> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                    draft_content, session_state
             FROM sessions
             WHERE repository_path = ?1 AND name = ?2"
        )?;
        
        let session = stmt.query_row(
            params![repo_path.to_string_lossy(), name],
            |row| {
                Ok(Session {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    display_name: row.get(2).ok(),
                    repository_path: PathBuf::from(row.get::<_, String>(3)?),
                    repository_name: row.get(4)?,
                    branch: row.get(5)?,
                    parent_branch: row.get(6)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(7)?),
                    status: row.get::<_, String>(8)?.parse().unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(9)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(10)?, 0).unwrap(),
                    last_activity: row.get::<_, Option<i64>>(11)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    initial_prompt: row.get(12)?,
                    ready_to_merge: row.get(13).unwrap_or(false),
                    original_agent_type: row.get(14).ok(),
                    original_skip_permissions: row.get(15).ok(),
                    pending_name_generation: row.get(16).unwrap_or(false),
                    was_auto_generated: row.get(17).unwrap_or(false),
                    draft_content: row.get(18).ok(),
                    session_state: row.get::<_, String>(19).ok()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(SessionState::Running),
                })
            }
        )?;
        
        Ok(session)
    }
    
    pub fn get_session_by_id(&self, id: &str) -> Result<Session> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                    draft_content, session_state
             FROM sessions
             WHERE id = ?1"
        )?;
        
        let session = stmt.query_row(
            params![id],
            |row| {
                Ok(Session {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    display_name: row.get(2).ok(),
                    repository_path: PathBuf::from(row.get::<_, String>(3)?),
                    repository_name: row.get(4)?,
                    branch: row.get(5)?,
                    parent_branch: row.get(6)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(7)?),
                    status: row.get::<_, String>(8)?.parse().unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(9)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(10)?, 0).unwrap(),
                    last_activity: row.get::<_, Option<i64>>(11)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    initial_prompt: row.get(12)?,
                    ready_to_merge: row.get(13).unwrap_or(false),
                    original_agent_type: row.get(14).ok(),
                    original_skip_permissions: row.get(15).ok(),
                    pending_name_generation: row.get(16).unwrap_or(false),
                    was_auto_generated: row.get(17).unwrap_or(false),
                    draft_content: row.get(18).ok(),
                    session_state: row.get::<_, String>(19).ok()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(SessionState::Running),
                })
            }
        )?;
        
        Ok(session)
    }
    
    pub fn list_sessions(&self, repo_path: &Path) -> Result<Vec<Session>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                    draft_content, session_state
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
                    display_name: row.get(2).ok(),
                    repository_path: PathBuf::from(row.get::<_, String>(3)?),
                    repository_name: row.get(4)?,
                    branch: row.get(5)?,
                    parent_branch: row.get(6)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(7)?),
                    status: row.get::<_, String>(8)?.parse().unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(9)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(10)?, 0).unwrap(),
                    last_activity: row.get::<_, Option<i64>>(11)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    initial_prompt: row.get(12)?,
                    ready_to_merge: row.get(13).unwrap_or(false),
                    original_agent_type: row.get(14).ok(),
                    original_skip_permissions: row.get(15).ok(),
                    pending_name_generation: row.get(16).unwrap_or(false),
                    was_auto_generated: row.get(17).unwrap_or(false),
                    draft_content: row.get(18).ok(),
                    session_state: row.get::<_, String>(19).ok()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(SessionState::Running),
                })
            }
        )?
        .collect::<SqlResult<Vec<_>>>()?;
        
        Ok(sessions)
    }
    
    pub fn list_all_active_sessions(&self) -> Result<Vec<Session>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                    draft_content, session_state
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
                    display_name: row.get(2).ok(),
                    repository_path: PathBuf::from(row.get::<_, String>(3)?),
                    repository_name: row.get(4)?,
                    branch: row.get(5)?,
                    parent_branch: row.get(6)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(7)?),
                    status: row.get::<_, String>(8)?.parse().unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(9)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(10)?, 0).unwrap(),
                    last_activity: row.get::<_, Option<i64>>(11)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    initial_prompt: row.get(12)?,
                    ready_to_merge: row.get(13).unwrap_or(false),
                    original_agent_type: row.get(14).ok(),
                    original_skip_permissions: row.get(15).ok(),
                    pending_name_generation: row.get(16).unwrap_or(false),
                    was_auto_generated: row.get(17).unwrap_or(false),
                    draft_content: row.get(18).ok(),
                    session_state: row.get::<_, String>(19).ok()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(SessionState::Running),
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
    
    pub fn update_session_display_name(&self, id: &str, display_name: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET display_name = ?1, pending_name_generation = FALSE, updated_at = ?2 WHERE id = ?3",
            params![display_name, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }
    
    pub fn update_session_branch(&self, id: &str, new_branch: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET branch = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_branch, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    pub fn set_pending_name_generation(&self, id: &str, pending: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET pending_name_generation = ?1 WHERE id = ?2",
            params![pending, id],
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
    
    pub fn get_git_stats(&self, session_id: &str) -> Result<Option<GitStats>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT session_id, files_changed, lines_added, lines_removed, has_uncommitted, calculated_at
             FROM git_stats WHERE session_id = ?1",
        )?;
        let result: SqlResult<GitStats> = stmt.query_row(params![session_id], |row| {
            Ok(GitStats {
                session_id: row.get(0)?,
                files_changed: row.get(1)?,
                lines_added: row.get(2)?,
                lines_removed: row.get(3)?,
                has_uncommitted: row.get(4)?,
                calculated_at: Utc.timestamp_opt(row.get(5)?, 0).unwrap(),
            })
        });
        match result {
            Ok(stats) => Ok(Some(stats)),
            Err(_) => Ok(None),
        }
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
                Ok(now - last_calculated > 60)
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
    
    pub fn get_agent_type(&self) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        
        let result: SqlResult<String> = conn.query_row(
            "SELECT agent_type FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        
        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok("claude".to_string()),
        }
    }
    
    pub fn set_agent_type(&self, agent_type: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE app_config SET agent_type = ?1 WHERE id = 1",
            params![agent_type],
        )?;
        
        Ok(())
    }
    
    pub fn get_font_sizes(&self) -> Result<(i32, i32)> {
        let conn = self.conn.lock().unwrap();
        
        // Try new columns first
        let result: SqlResult<(i32, i32)> = conn.query_row(
            "SELECT terminal_font_size, ui_font_size FROM app_config WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        
        match result {
            Ok(value) => Ok(value),
            Err(_) => {
                // Fallback to old font_size column if new ones don't exist
                let old_result: SqlResult<i32> = conn.query_row(
                    "SELECT font_size FROM app_config WHERE id = 1",
                    [],
                    |row| row.get(0),
                );
                
                match old_result {
                    Ok(size) => {
                        let ui_size = if size == 13 { 12 } else { size - 1 };
                        Ok((size, ui_size))
                    },
                    Err(_) => Ok((13, 12)),
                }
            }
        }
    }
    
    pub fn set_font_sizes(&self, terminal_font_size: i32, ui_font_size: i32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE app_config SET terminal_font_size = ?1, ui_font_size = ?2 WHERE id = 1",
            params![terminal_font_size, ui_font_size],
        )?;
        
        Ok(())
    }
    
    pub fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        
        // Canonicalize the path for consistent storage/retrieval
        let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
        
        let result: SqlResult<String> = conn.query_row(
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
    
    pub fn set_project_setup_script(&self, repo_path: &Path, setup_script: &str) -> Result<()> {
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

    pub fn get_default_base_branch(&self) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        
        let result: SqlResult<Option<String>> = conn.query_row(
            "SELECT default_base_branch FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        
        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok(None),
        }
    }
    
    pub fn set_default_base_branch(&self, branch: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE app_config SET default_base_branch = ?1 WHERE id = 1",
            params![branch],
        )?;
        
        Ok(())
    }

    pub fn get_default_open_app(&self) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        let result: SqlResult<String> = conn.query_row(
            "SELECT default_open_app FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok("finder".to_string()),
        }
    }

    pub fn set_default_open_app(&self, app_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE app_config SET default_open_app = ?1 WHERE id = 1",
            params![app_id],
        )?;
        Ok(())
    }

    pub fn set_session_original_settings(&self, session_id: &str, agent_type: &str, skip_permissions: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET original_agent_type = ?1, original_skip_permissions = ?2 WHERE id = ?3",
            params![agent_type, skip_permissions, session_id],
        )?;
        Ok(())
    }

    pub fn list_sessions_by_state(&self, repo_path: &Path, state: SessionState) -> Result<Vec<Session>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                    draft_content, session_state
             FROM sessions
             WHERE repository_path = ?1 AND session_state = ?2
             ORDER BY ready_to_merge ASC, COALESCE(last_activity, updated_at) DESC"
        )?;
        
        let sessions = stmt.query_map(
            params![repo_path.to_string_lossy(), state.as_str()],
            |row| {
                Ok(Session {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    display_name: row.get(2).ok(),
                    repository_path: PathBuf::from(row.get::<_, String>(3)?),
                    repository_name: row.get(4)?,
                    branch: row.get(5)?,
                    parent_branch: row.get(6)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(7)?),
                    status: row.get::<_, String>(8)?.parse().unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(9)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(10)?, 0).unwrap(),
                    last_activity: row.get::<_, Option<i64>>(11)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    initial_prompt: row.get(12)?,
                    ready_to_merge: row.get(13).unwrap_or(false),
                    original_agent_type: row.get(14).ok(),
                    original_skip_permissions: row.get(15).ok(),
                    pending_name_generation: row.get(16).unwrap_or(false),
                    was_auto_generated: row.get(17).unwrap_or(false),
                    draft_content: row.get(18).ok(),
                    session_state: row.get::<_, String>(19).ok()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(SessionState::Running),
                })
            }
        )?
        .collect::<SqlResult<Vec<_>>>()?;
        
        Ok(sessions)
    }

    pub fn update_session_state(&self, id: &str, state: SessionState) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE sessions
             SET session_state = ?1, updated_at = ?2
             WHERE id = ?3",
            params![state.as_str(), Utc::now().timestamp(), id],
        )?;
        
        Ok(())
    }

    pub fn update_draft_content(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE sessions
             SET draft_content = ?1, updated_at = ?2
             WHERE id = ?3",
            params![content, Utc::now().timestamp(), id],
        )?;
        
        Ok(())
    }

    pub fn append_draft_content(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE sessions
             SET draft_content = CASE 
                 WHEN draft_content IS NULL OR draft_content = '' THEN ?1
                 ELSE draft_content || char(10) || ?1
             END,
             updated_at = ?2
             WHERE id = ?3",
            params![content, Utc::now().timestamp(), id],
        )?;
        
        Ok(())
    }
    
    pub fn update_session_initial_prompt(&self, id: &str, prompt: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE sessions
             SET initial_prompt = ?1, updated_at = ?2
             WHERE id = ?3",
            params![prompt, Utc::now().timestamp(), id],
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
    
    #[test]
    fn test_get_agent_type_default() {
        let (db, _temp_dir) = create_test_database();
        
        let result = db.get_agent_type().unwrap();
        assert_eq!(result, "claude");
    }
    
    #[test]
    fn test_set_agent_type_cursor() {
        let (db, _temp_dir) = create_test_database();
        
        db.set_agent_type("cursor").unwrap();
        let result = db.get_agent_type().unwrap();
        assert_eq!(result, "cursor");
    }
    
    #[test]
    fn test_agent_type_persistence() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("agent_type_persistence_test.db");
        
        {
            let db = Database::new(Some(db_path.clone())).unwrap();
            db.set_agent_type("cursor").unwrap();
        }
        
        let db = Database::new(Some(db_path)).unwrap();
        let result = db.get_agent_type().unwrap();
        assert_eq!(result, "cursor");
    }
    
    #[test]
    fn test_agent_type_toggle() {
        let (db, _temp_dir) = create_test_database();
        
        assert_eq!(db.get_agent_type().unwrap(), "claude");
        
        db.set_agent_type("cursor").unwrap();
        assert_eq!(db.get_agent_type().unwrap(), "cursor");
        
        db.set_agent_type("claude").unwrap();
        assert_eq!(db.get_agent_type().unwrap(), "claude");
    }
    
    #[test]
    fn test_migration_adds_agent_type_column() {
        use tempfile::TempDir;
        use rusqlite::Connection;
        
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("migration_test.db");
        
        // Create database with old schema (without agent_type)
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "CREATE TABLE app_config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    skip_permissions BOOLEAN DEFAULT FALSE
                )",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO app_config (id, skip_permissions) VALUES (1, FALSE)",
                [],
            ).unwrap();
        }
        
        // Open with our Database struct which should run migration
        let db = Database::new(Some(db_path)).unwrap();
        
        // Verify the column was added and works
        assert_eq!(db.get_agent_type().unwrap(), "claude");
        db.set_agent_type("cursor").unwrap();
        assert_eq!(db.get_agent_type().unwrap(), "cursor");
    }

    #[test]
    fn test_append_draft_content_sql_logic() {
        use tempfile::NamedTempFile;
        
        let temp_file = NamedTempFile::new().unwrap();
        let db_path = temp_file.path().to_str().unwrap();
        let db = Database::new(Some(db_path.into())).unwrap();
        
        // Test the SQL logic directly by creating a session first 
        let conn = db.conn.lock().unwrap();
        
        // Create a test session
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, repository_name, branch, parent_branch, worktree_path, status, created_at, updated_at, draft_content) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                "test_id",
                "test_session", 
                "/test/repo",
                "test-repo",
                "test-branch",
                "main",
                "/test/worktree",
                "draft",
                chrono::Utc::now().timestamp(),
                chrono::Utc::now().timestamp(),
                "initial content"
            ],
        ).unwrap();
        
        // Test append functionality
        conn.execute(
            "UPDATE sessions
             SET draft_content = CASE 
                 WHEN draft_content IS NULL OR draft_content = '' THEN ?1
                 ELSE draft_content || char(10) || ?1
             END,
             updated_at = ?2
             WHERE id = ?3",
            params!["appended content", chrono::Utc::now().timestamp(), "test_id"],
        ).unwrap();
        
        // Verify the result
        let content: String = conn.query_row(
            "SELECT draft_content FROM sessions WHERE id = ?1",
            params!["test_id"],
            |row| row.get(0)
        ).unwrap();
        
        assert_eq!(content, "initial content\nappended content");
        
        // Test appending to empty content
        conn.execute(
            "UPDATE sessions SET draft_content = NULL WHERE id = ?1",
            params!["test_id"],
        ).unwrap();
        
        conn.execute(
            "UPDATE sessions
             SET draft_content = CASE 
                 WHEN draft_content IS NULL OR draft_content = '' THEN ?1
                 ELSE draft_content || char(10) || ?1
             END
             WHERE id = ?2",
            params!["first content", "test_id"],
        ).unwrap();
        
        let content: String = conn.query_row(
            "SELECT draft_content FROM sessions WHERE id = ?1",
            params!["test_id"],
            |row| row.get(0)
        ).unwrap();
        
        assert_eq!(content, "first content");
    }
}