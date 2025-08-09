# Para CLI Integration Plan for Para-UI Backend

## Goal
Integrate the para CLI into the para-ui backend to retrieve and display active sessions, their states, and all relevant details in the UI's sessions tab, providing a real-time view of all para sessions.

## Current State Analysis

### Available Para CLI Commands
1. **`para list`** - Lists sessions but currently only supports text output (compact/verbose/quiet)
   - Returns: session_id, branch, worktree_path, status, last_modified, etc.
   - No JSON output currently available

2. **`para status show --json`** - Shows session status with JSON output
   - Returns: session_name, current_task, test_status, diff_stats, todos, blocked status, last_update
   - Supports showing single session or all sessions

3. **`para monitor`** - Interactive TUI for session management (not suitable for programmatic use)

## Required Changes to Para CLI

### 1. Add JSON Output to `para list` Command
**File**: `/Users/marius.wichtner/Documents/git/para/src/cli/parser.rs`
```rust
#[derive(Args, Debug)]
pub struct ListArgs {
    /// Show additional session details
    #[arg(long, short = 'v', help = "Show verbose session information")]
    pub verbose: bool,

    /// Show archived sessions
    #[arg(long, short = 'a', help = "Show archived sessions")]
    pub archived: bool,

    /// Quiet output (minimal formatting for completion)
    #[arg(long, short = 'q', help = "Quiet output for completion")]
    pub quiet: bool,
    
    /// Output as JSON
    #[arg(long, help = "Output as JSON")]
    pub json: bool,  // NEW FIELD
}
```

**File**: `/Users/marius.wichtner/Documents/git/para/src/cli/commands/list/formatters.rs`
- Add `display_json_sessions()` function that serializes `SessionInfo` structs to JSON
- Modify `display_sessions()` to check for `args.json` flag

### 2. Ensure SessionInfo is Serializable
**File**: `/Users/marius.wichtner/Documents/git/para/src/cli/commands/list/formatters.rs`
```rust
#[derive(Debug, Clone, serde::Serialize)]  // Add serde::Serialize
pub struct SessionInfo {
    pub session_id: String,
    pub branch: String,
    pub worktree_path: PathBuf,
    pub base_branch: String,
    pub merge_mode: String,
    pub status: SessionStatus,
    pub last_modified: Option<DateTime<Utc>>,
    pub has_uncommitted_changes: Option<bool>,
    pub is_current: bool,
    pub session_type: SessionType,
    pub container_status: Option<String>,
}
```

## Para-UI Backend Integration

### 1. New Module Structure
```
src-tauri/src/
├── para/
│   ├── mod.rs          # Main para integration module
│   ├── client.rs       # Para CLI client wrapper
│   ├── types.rs        # Rust types matching para's output
│   └── service.rs      # Service layer for para operations
```

### 2. Para CLI Client Implementation

**File**: `src-tauri/src/para/client.rs`
```rust
use serde::{Deserialize, Serialize};
use std::process::Command;
use anyhow::Result;

pub struct ParaClient {
    para_binary: String,
}

impl ParaClient {
    pub fn new() -> Result<Self> {
        // Auto-detect para binary location
        let para_binary = which::which("para")
            .map_err(|_| anyhow::anyhow!("para CLI not found in PATH"))?
            .to_string_lossy()
            .to_string();
        
        Ok(Self { para_binary })
    }
    
    pub async fn list_sessions(&self, include_archived: bool) -> Result<Vec<SessionInfo>> {
        let mut cmd = Command::new(&self.para_binary);
        cmd.arg("list").arg("--json");
        
        if include_archived {
            cmd.arg("--archived");
        }
        
        let output = tokio::process::Command::from(cmd)
            .output()
            .await?;
        
        if !output.status.success() {
            return Err(anyhow::anyhow!("para list failed: {}", 
                String::from_utf8_lossy(&output.stderr)));
        }
        
        let sessions: Vec<SessionInfo> = serde_json::from_slice(&output.stdout)?;
        Ok(sessions)
    }
    
    pub async fn get_session_status(&self, session_name: Option<&str>) -> Result<Vec<SessionStatus>> {
        let mut cmd = Command::new(&self.para_binary);
        cmd.arg("status").arg("show").arg("--json");
        
        if let Some(name) = session_name {
            cmd.arg(name);
        }
        
        let output = tokio::process::Command::from(cmd)
            .output()
            .await?;
        
        if !output.status.success() {
            return Err(anyhow::anyhow!("para status show failed: {}", 
                String::from_utf8_lossy(&output.stderr)));
        }
        
        // Handle both single status and array of statuses
        let json_str = String::from_utf8_lossy(&output.stdout);
        if json_str.trim().starts_with('[') {
            // Array of statuses
            let statuses: Vec<SessionStatus> = serde_json::from_str(&json_str)?;
            Ok(statuses)
        } else {
            // Single status
            let status: SessionStatus = serde_json::from_str(&json_str)?;
            Ok(vec![status])
        }
    }
}
```

### 3. Data Types

**File**: `src-tauri/src/para/types.rs`
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

// Combined session data for UI
#[derive(Debug, Clone, Serialize)]
pub struct EnrichedSession {
    pub info: SessionInfo,
    pub status: Option<SessionStatus>,
}
```

### 4. Service Layer

**File**: `src-tauri/src/para/service.rs`
```rust
use super::{client::ParaClient, types::*};
use anyhow::Result;
use std::collections::HashMap;

pub struct ParaService {
    client: ParaClient,
}

impl ParaService {
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: ParaClient::new()?,
        })
    }
    
    pub async fn get_all_sessions(&self, include_archived: bool) -> Result<Vec<EnrichedSession>> {
        // Get basic session info
        let sessions = self.client.list_sessions(include_archived).await?;
        
        // Get all statuses in one call
        let statuses = self.client.get_session_status(None).await?;
        
        // Create a map for quick status lookup
        let status_map: HashMap<String, SessionStatus> = statuses
            .into_iter()
            .map(|s| (s.session_name.clone(), s))
            .collect();
        
        // Combine session info with status
        let enriched: Vec<EnrichedSession> = sessions
            .into_iter()
            .map(|info| {
                let status = status_map.get(&info.session_id).cloned();
                EnrichedSession { info, status }
            })
            .collect();
        
        Ok(enriched)
    }
    
    pub async fn get_session(&self, session_name: &str) -> Result<Option<EnrichedSession>> {
        let sessions = self.client.list_sessions(false).await?;
        
        let info = sessions
            .into_iter()
            .find(|s| s.session_id == session_name);
        
        match info {
            Some(info) => {
                let statuses = self.client.get_session_status(Some(session_name)).await?;
                let status = statuses.into_iter().next();
                Ok(Some(EnrichedSession { info, status }))
            }
            None => Ok(None)
        }
    }
}
```

### 5. Tauri Commands

**File**: `src-tauri/src/main.rs` (add to existing)
```rust
mod para;

#[tauri::command]
async fn get_para_sessions(include_archived: bool) -> Result<Vec<para::types::EnrichedSession>, String> {
    let service = para::service::ParaService::new()
        .map_err(|e| e.to_string())?;
    
    service.get_all_sessions(include_archived)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_para_session(session_name: String) -> Result<Option<para::types::EnrichedSession>, String> {
    let service = para::service::ParaService::new()
        .map_err(|e| e.to_string())?;
    
    service.get_session(&session_name)
        .await
        .map_err(|e| e.to_string())
}

// In tauri::Builder
.invoke_handler(tauri::generate_handler![
    // ... existing handlers
    get_para_sessions,
    get_para_session,
])
```

### 6. Auto-refresh Mechanism

**File**: `src-tauri/src/para/monitor.rs`
```rust
use tokio::time::{interval, Duration};
use tauri::{AppHandle, Emitter};

pub async fn start_session_monitor(app: AppHandle) {
    let mut interval = interval(Duration::from_secs(5)); // Poll every 5 seconds
    
    loop {
        interval.tick().await;
        
        if let Ok(service) = ParaService::new() {
            if let Ok(sessions) = service.get_all_sessions(false).await {
                let _ = app.emit("para-sessions-updated", sessions);
            }
        }
    }
}

// Start in main.rs after app initialization
tauri::async_runtime::spawn(para::monitor::start_session_monitor(app.clone()));
```

## Frontend Integration

### 1. TypeScript Types
```typescript
// src/types/para.ts
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
}
```

### 2. React Hook for Sessions
```typescript
// src/hooks/useParaSessions.ts
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { EnrichedSession } from '../types/para';

export function useParaSessions(includeArchived = false) {
  const [sessions, setSessions] = useState<EnrichedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Initial load
    loadSessions();

    // Listen for updates
    const unlisten = listen<EnrichedSession[]>('para-sessions-updated', (event) => {
      setSessions(event.payload);
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [includeArchived]);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const data = await invoke<EnrichedSession[]>('get_para_sessions', { 
        includeArchived 
      });
      setSessions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  return { sessions, loading, error, refresh: loadSessions };
}
```

### 3. Sessions Component Update
```typescript
// src/components/SessionsTab.tsx
import React from 'react';
import { useParaSessions } from '../hooks/useParaSessions';

export function SessionsTab() {
  const { sessions, loading, error, refresh } = useParaSessions();

  if (loading) return <div>Loading sessions...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="sessions-container">
      <div className="sessions-header">
        <h2>Para Sessions ({sessions.length})</h2>
        <button onClick={refresh}>Refresh</button>
      </div>
      
      <div className="sessions-grid">
        {sessions.map((session) => (
          <SessionCard key={session.info.session_id} session={session} />
        ))}
      </div>
    </div>
  );
}

function SessionCard({ session }: { session: EnrichedSession }) {
  const { info, status } = session;
  
  return (
    <div className={`session-card ${info.is_current ? 'current' : ''}`}>
      <div className="session-header">
        <h3>{info.session_id}</h3>
        <span className={`status-badge ${info.status}`}>
          {info.status}
        </span>
      </div>
      
      <div className="session-details">
        <p>Branch: {info.branch}</p>
        <p>Type: {info.session_type}</p>
        {info.container_status && (
          <p>Container: {info.container_status}</p>
        )}
      </div>
      
      {status && (
        <div className="session-status">
          <p>Task: {status.current_task}</p>
          <div className="status-indicators">
            <span className={`test-status ${status.test_status}`}>
              Tests: {status.test_status}
            </span>
            {status.todos_total && (
              <span className="todos">
                Todos: {status.todos_completed}/{status.todos_total}
              </span>
            )}
            {status.is_blocked && (
              <span className="blocked">BLOCKED</span>
            )}
          </div>
          {status.diff_stats && (
            <p className="diff-stats">
              Changes: +{status.diff_stats.insertions} -{status.diff_stats.deletions} 
              ({status.diff_stats.files_changed} files)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

## Implementation Steps

### Phase 1: Para CLI Updates (Required first)
1. Add `--json` flag to `para list` command
2. Make `SessionInfo` serializable with serde
3. Implement JSON output formatter
4. Test JSON output with various session states

### Phase 2: Backend Integration
1. Create para module structure in src-tauri
2. Implement ParaClient for CLI interaction
3. Create data types matching para's output
4. Implement ParaService for business logic
5. Add Tauri commands for frontend access
6. Add session monitoring with periodic updates

### Phase 3: Frontend Integration
1. Create TypeScript types for para data
2. Implement useParaSessions hook
3. Update SessionsTab component
4. Add real-time update handling
5. Style session cards for all states

### Phase 4: Advanced Features
1. Add session actions (resume, finish, cancel)
2. Implement session filtering and search
3. Add session grouping by status/type
4. Implement session detail view with full info
5. Add notifications for session state changes

## Testing Strategy

1. **Unit Tests**
   - Test para CLI JSON parsing
   - Test service layer logic
   - Test data transformation

2. **Integration Tests**
   - Test full flow from CLI to UI
   - Test error handling for missing para CLI
   - Test handling of various session states

3. **E2E Tests**
   - Test UI updates when sessions change
   - Test real-time updates
   - Test session actions

## Error Handling

1. **Para CLI not found**: Show installation instructions
2. **Para CLI errors**: Display user-friendly error messages
3. **Permission errors**: Request appropriate permissions
4. **Network/IPC errors**: Implement retry logic with exponential backoff

## Performance Considerations

1. Cache session data with TTL
2. Debounce refresh requests
3. Use virtual scrolling for large session lists
4. Optimize JSON parsing for large datasets
5. Implement incremental updates instead of full refreshes

## Security Considerations

1. Validate all CLI output before parsing
2. Sanitize session names and paths for display
3. Use proper IPC security in Tauri
4. Limit refresh rate to prevent DoS
5. Validate user permissions for session actions

## Deliverables

1. Updated para CLI with JSON output support
2. Para integration module in para-ui backend
3. Fully functional sessions tab showing all para sessions
4. Real-time updates when sessions change
5. Documentation for the integration