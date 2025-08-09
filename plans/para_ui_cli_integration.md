# Para-UI: CLI Integration Implementation Plan

## Objective
Integrate para CLI into para-ui backend to display all session information in the UI, assuming para CLI already supports JSON output.

## CLI Commands and Expected Output

### Available Commands

#### 1. `para list --json`
Returns array of sessions with basic information:
```json
[
  {
    "session_id": "auth-feature",
    "branch": "para/auth-feature",
    "worktree_path": "/Users/user/project/.para/worktrees/auth-feature",
    "base_branch": "main",
    "merge_mode": "squash",
    "status": "active",
    "last_modified": "2024-01-15T14:30:00Z",
    "has_uncommitted_changes": false,
    "is_current": true,
    "session_type": "worktree",
    "container_status": null
  }
]
```

#### 2. `para status show --json`
Returns array of all session statuses:
```json
[
  {
    "session_name": "auth-feature",
    "current_task": "Implementing JWT validation",
    "test_status": "passed",
    "diff_stats": {
      "files_changed": 5,
      "insertions": 245,
      "deletions": 32
    },
    "todos_completed": 3,
    "todos_total": 5,
    "is_blocked": false,
    "blocked_reason": null,
    "last_update": "2024-01-15T14:28:00Z"
  }
]
```

#### 3. `para status show <session-name> --json`
Returns single session status (same structure as above)

## Backend Implementation

### Module Structure
```
src-tauri/src/
├── para_cli/
│   ├── mod.rs           # Module exports
│   ├── client.rs        # CLI execution wrapper
│   ├── types.rs         # Data structures
│   ├── service.rs       # Business logic
│   └── monitor.rs       # Auto-refresh functionality
```

### 1. CLI Client (`src-tauri/src/para_cli/client.rs`)
```rust
use anyhow::{Result, anyhow};
use log::{debug, warn, error};
use std::process::Stdio;
use tokio::process::Command;
use serde::de::DeserializeOwned;

pub struct ParaCliClient {
    para_binary: String,
}

impl ParaCliClient {
    pub fn new() -> Result<Self> {
        // Try to find para in PATH
        let para_binary = which::which("para")
            .map_err(|_| anyhow!("para CLI not found in PATH. Please install para first."))?
            .to_string_lossy()
            .to_string();
        
        debug!("Found para CLI at: {}", para_binary);
        Ok(Self { para_binary })
    }
    
    pub fn with_path(para_binary: String) -> Self {
        Self { para_binary }
    }
    
    /// Execute a para command and parse JSON output
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
            error!("Para command failed: {}", stderr);
            return Err(anyhow!("Para command failed: {}", stderr));
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout)
            .map_err(|e| anyhow!("Failed to parse JSON output: {}. Output: {}", e, stdout))
    }
    
    /// Get list of all sessions
    pub async fn list_sessions(&self, include_archived: bool) -> Result<Vec<SessionInfo>> {
        let mut args = vec!["list", "--json"];
        if include_archived {
            args.push("--archived");
        }
        
        self.execute_json(&args).await
    }
    
    /// Get status for all sessions
    pub async fn get_all_statuses(&self) -> Result<Vec<SessionStatus>> {
        self.execute_json(&["status", "show", "--json"]).await
    }
    
    /// Get status for specific session
    pub async fn get_session_status(&self, session_name: &str) -> Result<SessionStatus> {
        self.execute_json(&["status", "show", session_name, "--json"]).await
    }
    
    /// Check if para CLI is available
    pub async fn check_availability(&self) -> Result<String> {
        let output = Command::new(&self.para_binary)
            .arg("--version")
            .output()
            .await
            .map_err(|e| anyhow!("Failed to check para version: {}", e))?;
        
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err(anyhow!("Para CLI is not working properly"))
        }
    }
}
```

### 2. Data Types (`src-tauri/src/para_cli/types.rs`)
```rust
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub branch: String,
    pub worktree_path: String,
    pub base_branch: String,
    pub merge_mode: String,
    pub status: SessionStatusType,
    pub last_modified: Option<DateTime<Utc>>,
    pub has_uncommitted_changes: Option<bool>,
    pub is_current: bool,
    pub session_type: SessionType,
    pub container_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatusType {
    Active,
    Dirty,
    Missing,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionType {
    Worktree,
    Container,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStatus {
    pub session_name: String,
    pub current_task: String,
    pub test_status: TestStatus,
    pub diff_stats: Option<DiffStats>,
    pub todos_completed: Option<u32>,
    pub todos_total: Option<u32>,
    pub is_blocked: bool,
    pub blocked_reason: Option<String>,
    pub last_update: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TestStatus {
    Passed,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffStats {
    pub files_changed: usize,
    pub insertions: usize,
    pub deletions: usize,
}

/// Combined session data for UI
#[derive(Debug, Clone, Serialize)]
pub struct EnrichedSession {
    pub info: SessionInfo,
    pub status: Option<SessionStatus>,
    pub terminals: Vec<String>, // Terminal IDs active for this session
}

/// Summary statistics for dashboard
#[derive(Debug, Clone, Serialize)]
pub struct SessionsSummary {
    pub total_sessions: usize,
    pub active_sessions: usize,
    pub blocked_sessions: usize,
    pub container_sessions: usize,
    pub tests_passing: usize,
    pub tests_failing: usize,
    pub total_todos: u32,
    pub completed_todos: u32,
}
```

### 3. Service Layer (`src-tauri/src/para_cli/service.rs`)
```rust
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
    
    /// Get all sessions with their status, using cache if fresh
    pub async fn get_all_sessions(&self, include_archived: bool) -> Result<Vec<EnrichedSession>> {
        // Check cache (5 second TTL)
        {
            let cache = self.cache.read().await;
            if cache.last_updated.elapsed().as_secs() < 5 && !cache.sessions.is_empty() {
                debug!("Returning cached sessions");
                return Ok(cache.sessions.clone());
            }
        }
        
        info!("Fetching fresh session data from para CLI");
        
        // Fetch fresh data
        let sessions = self.fetch_sessions(include_archived).await?;
        
        // Update cache
        {
            let mut cache = self.cache.write().await;
            cache.sessions = sessions.clone();
            cache.last_updated = std::time::Instant::now();
        }
        
        Ok(sessions)
    }
    
    /// Fetch sessions without cache
    pub async fn fetch_sessions(&self, include_archived: bool) -> Result<Vec<EnrichedSession>> {
        // Get basic session info
        let session_infos = self.client.list_sessions(include_archived).await?;
        debug!("Found {} sessions", session_infos.len());
        
        // Get all statuses
        let statuses = match self.client.get_all_statuses().await {
            Ok(s) => s,
            Err(e) => {
                warn!("Failed to get session statuses: {}", e);
                Vec::new()
            }
        };
        
        // Create status map for quick lookup
        let status_map: HashMap<String, SessionStatus> = statuses
            .into_iter()
            .map(|s| (s.session_name.clone(), s))
            .collect();
        
        // Combine and enrich
        let enriched: Vec<EnrichedSession> = session_infos
            .into_iter()
            .map(|info| {
                let status = status_map.get(&info.session_id).cloned();
                
                // Determine which terminals would be active for this session
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
    
    /// Get specific session
    pub async fn get_session(&self, session_name: &str) -> Result<Option<EnrichedSession>> {
        let sessions = self.get_all_sessions(false).await?;
        Ok(sessions.into_iter().find(|s| s.info.session_id == session_name))
    }
    
    /// Get summary statistics
    pub async fn get_summary(&self) -> Result<SessionsSummary> {
        let sessions = self.get_all_sessions(false).await?;
        
        let total_sessions = sessions.len();
        let active_sessions = sessions.iter()
            .filter(|s| matches!(s.info.status, SessionStatusType::Active))
            .count();
        let blocked_sessions = sessions.iter()
            .filter(|s| s.status.as_ref().map_or(false, |st| st.is_blocked))
            .count();
        let container_sessions = sessions.iter()
            .filter(|s| matches!(s.info.session_type, SessionType::Container))
            .count();
        
        let tests_passing = sessions.iter()
            .filter(|s| s.status.as_ref()
                .map_or(false, |st| matches!(st.test_status, TestStatus::Passed)))
            .count();
        let tests_failing = sessions.iter()
            .filter(|s| s.status.as_ref()
                .map_or(false, |st| matches!(st.test_status, TestStatus::Failed)))
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
    
    /// Invalidate cache to force refresh
    pub async fn invalidate_cache(&self) {
        let mut cache = self.cache.write().await;
        cache.last_updated = std::time::Instant::now() - std::time::Duration::from_secs(60);
    }
    
    fn get_session_terminals(&self, session_id: &str) -> Vec<String> {
        // Map session to expected terminal IDs
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
```

### 4. Session Monitor (`src-tauri/src/para_cli/monitor.rs`)
```rust
use super::service::ParaService;
use anyhow::Result;
use log::{debug, error, warn};
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, Duration};

/// Start monitoring para sessions and emit updates
pub async fn start_session_monitor(app: AppHandle) {
    let mut interval = interval(Duration::from_secs(5));
    let mut last_error_time = None;
    
    loop {
        interval.tick().await;
        
        // Skip if we recently had an error (backoff)
        if let Some(last_error) = last_error_time {
            if std::time::Instant::now().duration_since(last_error).as_secs() < 30 {
                continue;
            }
        }
        
        match ParaService::new() {
            Ok(service) => {
                match service.fetch_sessions(false).await {
                    Ok(sessions) => {
                        debug!("Emitting para-sessions-updated with {} sessions", sessions.len());
                        if let Err(e) = app.emit("para-sessions-updated", &sessions) {
                            warn!("Failed to emit sessions update: {}", e);
                        }
                        last_error_time = None;
                    }
                    Err(e) => {
                        error!("Failed to fetch para sessions: {}", e);
                        last_error_time = Some(std::time::Instant::now());
                    }
                }
                
                // Also emit summary
                match service.get_summary().await {
                    Ok(summary) => {
                        if let Err(e) = app.emit("para-summary-updated", &summary) {
                            warn!("Failed to emit summary update: {}", e);
                        }
                    }
                    Err(e) => {
                        warn!("Failed to get session summary: {}", e);
                    }
                }
            }
            Err(e) => {
                error!("Failed to create ParaService: {}", e);
                last_error_time = Some(std::time::Instant::now());
            }
        }
    }
}
```

### 5. Module Export (`src-tauri/src/para_cli/mod.rs`)
```rust
pub mod client;
pub mod types;
pub mod service;
pub mod monitor;

pub use types::*;
pub use service::ParaService;
pub use monitor::start_session_monitor;
```

### 6. Tauri Commands (`src-tauri/src/main.rs`)
Add to existing main.rs:
```rust
mod para_cli;

use para_cli::{EnrichedSession, SessionsSummary, ParaService};

#[tauri::command]
async fn get_para_sessions(include_archived: bool) -> Result<Vec<EnrichedSession>, String> {
    let service = ParaService::new()
        .map_err(|e| format!("Failed to initialize para service: {}", e))?;
    
    service.get_all_sessions(include_archived)
        .await
        .map_err(|e| format!("Failed to get sessions: {}", e))
}

#[tauri::command]
async fn get_para_session(session_name: String) -> Result<Option<EnrichedSession>, String> {
    let service = ParaService::new()
        .map_err(|e| format!("Failed to initialize para service: {}", e))?;
    
    service.get_session(&session_name)
        .await
        .map_err(|e| format!("Failed to get session: {}", e))
}

#[tauri::command]
async fn get_para_summary() -> Result<SessionsSummary, String> {
    let service = ParaService::new()
        .map_err(|e| format!("Failed to initialize para service: {}", e))?;
    
    service.get_summary()
        .await
        .map_err(|e| format!("Failed to get summary: {}", e))
}

#[tauri::command]
async fn refresh_para_sessions() -> Result<(), String> {
    let service = ParaService::new()
        .map_err(|e| format!("Failed to initialize para service: {}", e))?;
    
    service.invalidate_cache().await;
    Ok(())
}

fn main() {
    // Initialize logging
    logging::init_logging();
    log::info!("Para UI starting...");
    
    // Create cleanup guard
    let _cleanup_guard = cleanup::TerminalCleanupGuard;

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // Terminal commands
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            terminal_exists,
            get_terminal_buffer,
            // Para CLI commands
            get_para_sessions,
            get_para_session,
            get_para_summary,
            refresh_para_sessions,
        ])
        .setup(|app| {
            // Start session monitor
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait a bit for app to fully initialize
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                para_cli::start_session_monitor(app_handle).await;
            });
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                tauri::async_runtime::block_on(async {
                    cleanup::cleanup_all_terminals().await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 7. Add Dependencies (`src-tauri/Cargo.toml`)
```toml
[dependencies]
# ... existing dependencies ...
which = "6.0"  # For finding para binary in PATH
```

## Frontend Integration

### TypeScript Types (`src/types/para.ts`)
```typescript
export interface SessionInfo {
  session_id: string;
  branch: string;
  worktree_path: string;
  base_branch: string;
  merge_mode: string;
  status: 'active' | 'dirty' | 'missing' | 'archived';
  last_modified?: string;
  has_uncommitted_changes?: boolean;
  is_current: boolean;
  session_type: 'worktree' | 'container';
  container_status?: string;
}

export interface SessionStatus {
  session_name: string;
  current_task: string;
  test_status: 'passed' | 'failed' | 'unknown';
  diff_stats?: {
    files_changed: number;
    insertions: number;
    deletions: number;
  };
  todos_completed?: number;
  todos_total?: number;
  is_blocked: boolean;
  blocked_reason?: string;
  last_update: string;
}

export interface EnrichedSession {
  info: SessionInfo;
  status?: SessionStatus;
  terminals: string[];
}

export interface SessionsSummary {
  total_sessions: number;
  active_sessions: number;
  blocked_sessions: number;
  container_sessions: number;
  tests_passing: number;
  tests_failing: number;
  total_todos: number;
  completed_todos: number;
}
```

### React Hook (`src/hooks/useParaSessions.ts`)
```typescript
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { EnrichedSession, SessionsSummary } from '../types/para';

export function useParaSessions(includeArchived = false) {
  const [sessions, setSessions] = useState<EnrichedSession[]>([]);
  const [summary, setSummary] = useState<SessionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      const [sessionsData, summaryData] = await Promise.all([
        invoke<EnrichedSession[]>('get_para_sessions', { includeArchived }),
        invoke<SessionsSummary>('get_para_summary')
      ]);
      setSessions(sessionsData);
      setSummary(summaryData);
      setError(null);
    } catch (err) {
      console.error('Failed to load para sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  const refresh = useCallback(async () => {
    await invoke('refresh_para_sessions');
    await loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    // Initial load
    loadSessions();

    // Listen for updates
    const unlistenSessions = listen<EnrichedSession[]>('para-sessions-updated', (event) => {
      setSessions(event.payload);
      setLoading(false);
    });

    const unlistenSummary = listen<SessionsSummary>('para-summary-updated', (event) => {
      setSummary(event.payload);
    });

    return () => {
      unlistenSessions.then(fn => fn());
      unlistenSummary.then(fn => fn());
    };
  }, [loadSessions]);

  return { 
    sessions, 
    summary,
    loading, 
    error, 
    refresh 
  };
}
```

## Testing Strategy

### Unit Tests
1. Test CLI client command construction
2. Test JSON parsing for various session states
3. Test cache TTL behavior
4. Test error handling for missing para CLI

### Integration Tests
1. Mock para CLI responses and test service layer
2. Test Tauri command handlers
3. Test event emission

### E2E Tests
1. Test with real para sessions
2. Test auto-refresh functionality
3. Test error recovery

## Error Handling

### Para CLI Not Found
```typescript
if (error?.includes('para CLI not found')) {
  return (
    <div className="error-container">
      <h3>Para CLI Not Installed</h3>
      <p>Please install para CLI first:</p>
      <code>brew install para</code>
    </div>
  );
}
```

### Session Fetch Errors
- Log errors but don't crash
- Show cached data if available
- Retry with exponential backoff

## Performance Optimizations

1. **5-second cache TTL** prevents excessive CLI calls
2. **Parallel fetching** of list and status data
3. **Debounced refresh** in frontend
4. **Virtual scrolling** for large session lists
5. **Incremental updates** via events instead of full refresh

## Security Considerations

1. **Validate CLI output** before parsing
2. **Sanitize paths** for display
3. **Rate limit** refresh requests
4. **Validate session names** before passing to CLI
5. **Use Tauri's built-in IPC security**

## Deployment Checklist

- [ ] Para CLI is installed and in PATH
- [ ] Para list supports --json flag
- [ ] Backend module is integrated
- [ ] Tauri commands are registered
- [ ] Frontend types match backend
- [ ] Session monitor is started
- [ ] Error handling is in place
- [ ] Tests are passing
- [ ] Documentation is updated