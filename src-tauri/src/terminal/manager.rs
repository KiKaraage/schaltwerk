use super::{CreateParams, LocalPtyAdapter, TerminalBackend};
use log::{debug, error, info};
use std::collections::HashSet;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::RwLock;

pub struct TerminalManager {
    backend: Arc<LocalPtyAdapter>,
    active_ids: Arc<RwLock<HashSet<String>>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        let backend = Arc::new(LocalPtyAdapter::new());
        Self {
            backend,
            active_ids: Arc::new(RwLock::new(HashSet::new())),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }
    
    pub async fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.write().await = Some(handle.clone());
        self.backend.set_app_handle(handle).await;
    }
    
    pub async fn create_terminal(&self, id: String, cwd: String) -> Result<(), String> {
        info!("Creating terminal through manager: id={id}, cwd={cwd}");
        
        let params = CreateParams {
            id: id.clone(),
            cwd,
            app: None,
        };
        
        self.backend.create(params).await?;
        self.active_ids.write().await.insert(id.clone());
        
        // Start event bridge for this terminal
        self.start_event_bridge(id).await;
        
        Ok(())
    }
    
    pub async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String> {
        self.backend.write(&id, &data).await
    }
    
    pub async fn resize_terminal(&self, id: String, cols: u16, rows: u16) -> Result<(), String> {
        debug!("Resizing terminal {id}: {cols}x{rows}");
        self.backend.resize(&id, cols, rows).await
    }
    
    pub async fn close_terminal(&self, id: String) -> Result<(), String> {
        info!("Closing terminal through manager: {id}");
        self.active_ids.write().await.remove(&id);
        self.backend.close(&id).await
    }
    
    pub async fn terminal_exists(&self, id: String) -> Result<bool, String> {
        self.backend.exists(&id).await
    }
    
    pub async fn get_terminal_buffer(&self, id: String) -> Result<String, String> {
        let (_, data) = self.backend.snapshot(&id, None).await?;
        Ok(String::from_utf8_lossy(&data).to_string())
    }
    
    pub async fn close_all(&self) -> Result<(), String> {
        info!("Closing all terminals");
        let ids: Vec<String> = self.active_ids.read().await.iter().cloned().collect();
        
        for id in ids {
            if let Err(e) = self.close_terminal(id.clone()).await {
                error!("Failed to close terminal {id}: {e}");
            }
        }
        
        Ok(())
    }
    
    async fn start_event_bridge(&self, id: String) {
        // Only start if we're using LocalPtyAdapter which already emits events
        // This is a placeholder for future remote adapters that might need explicit bridging
        debug!("Event bridge started for terminal {id}");
    }
}