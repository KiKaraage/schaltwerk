use log::{info, error};

/// Cleanup all running terminals
pub async fn cleanup_all_terminals() {
    info!("Cleaning up all terminals...");
    
    // Get all terminal IDs
    let terminal_ids: Vec<String> = {
        let ptys = crate::pty::PTYS.lock().await;
        ptys.keys().cloned().collect()
    };
    
    // Close each terminal
    for id in terminal_ids {
        if let Err(e) = crate::pty::close_terminal(&id).await {
            error!("Failed to close terminal {id}: {e}");
        } else {
            info!("Closed terminal: {id}");
        }
    }
    
    info!("Terminal cleanup complete");
}

/// Ensure cleanup happens even on panic
pub struct TerminalCleanupGuard;

impl Drop for TerminalCleanupGuard {
    fn drop(&mut self) {
        // Block on async cleanup
        tauri::async_runtime::block_on(async {
            cleanup_all_terminals().await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_cleanup_with_no_terminals() {
        // Should not panic when no terminals exist
        cleanup_all_terminals().await;
    }
    
    #[test]
    fn test_cleanup_guard_drop() {
        // Test that the guard can be created and dropped without panic
        {
            let _guard = TerminalCleanupGuard;
            // Guard will be dropped here
        }
        // Should complete without panic
    }
}