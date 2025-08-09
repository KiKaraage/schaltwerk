use log::{error, info};

/// Cleanup all running terminals
pub async fn cleanup_all_terminals() {
    info!("Cleaning up all terminals...");
    
    // Use the terminal manager to close all terminals
    if let Some(manager) = crate::TERMINAL_MANAGER.get() {
        if let Err(e) = manager.close_all().await {
            error!("Failed to close all terminals: {e}");
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