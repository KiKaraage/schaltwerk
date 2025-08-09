use super::service::ParaService;
use log::{debug, error, warn};
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, Duration};

pub async fn start_session_monitor(app: AppHandle) {
    let mut interval = interval(Duration::from_secs(5));
    let mut last_error_time = None;
    
    loop {
        interval.tick().await;
        
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
                            warn!("Failed to emit sessions update: {e}");
                        }
                        last_error_time = None;
                    }
                    Err(e) => {
                        error!("Failed to fetch para sessions: {e}");
                        last_error_time = Some(std::time::Instant::now());
                    }
                }
                
                match service.get_summary().await {
                    Ok(summary) => {
                        if let Err(e) = app.emit("para-summary-updated", &summary) {
                            warn!("Failed to emit summary update: {e}");
                        }
                    }
                    Err(e) => {
                        warn!("Failed to get session summary: {e}");
                    }
                }
            }
            Err(e) => {
                error!("Failed to create ParaService: {e}");
                last_error_time = Some(std::time::Instant::now());
            }
        }
    }
}