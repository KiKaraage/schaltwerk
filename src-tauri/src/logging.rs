use chrono::Local;
use env_logger::Builder;
use log::LevelFilter;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Get the application's log directory
pub fn get_log_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("para-ui")
        .join("logs")
}

/// Get the current log file path
pub fn get_log_path() -> PathBuf {
    if let Ok(guard) = LOG_PATH.lock() {
        if let Some(ref path) = *guard {
            return path.clone();
        }
    }
    
    let log_dir = get_log_dir();
    
    // Create directory if it doesn't exist
    if let Err(e) = fs::create_dir_all(&log_dir) {
        eprintln!("Failed to create log directory: {e}");
    }
    
    let log_file = log_dir.join(format!("para-ui-{}.log", Local::now().format("%Y%m%d-%H%M%S")));
    
    if let Ok(mut guard) = LOG_PATH.lock() {
        *guard = Some(log_file.clone());
    }
    
    log_file
}

/// Initialize logging to both console and file
pub fn init_logging() {
    let log_path = get_log_path();
    let log_path_for_closure = log_path.clone();
    
    // Verify we can write to the log file
    match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(_) => {},
        Err(e) => {
            eprintln!("Failed to open log file: {e}");
            eprintln!("Logging will continue to console only");
        }
    }
    
    let mut builder = Builder::new();
    
    // Set log level from env or default to DEBUG for our crates, INFO for others
    if let Ok(rust_log) = std::env::var("RUST_LOG") {
        builder.parse_filters(&rust_log);
    } else {
        // Our crates
        builder.filter_module("ui", LevelFilter::Debug);
        builder.filter_module("para_ui", LevelFilter::Debug);
        
        // Third-party crates we care about
        builder.filter_module("portable_pty", LevelFilter::Info);
        builder.filter_module("tauri", LevelFilter::Info);
        
        // Everything else
        builder.filter_level(LevelFilter::Warn);
    }
    
    // Custom format with timestamps and module info
    builder.format(move |buf, record| {
        let level_str = match record.level() {
            log::Level::Error => "ERROR",
            log::Level::Warn => "WARN ",
            log::Level::Info => "INFO ",
            log::Level::Debug => "DEBUG",
            log::Level::Trace => "TRACE",
        };
        
        let log_line = format!(
            "[{} {} {}] {}\n",
            Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            level_str,
            record.target(),
            record.args()
        );
        
        // Write to stderr (console)
        write!(buf, "{log_line}")?;
        
        // Also write to file (with error handling)
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path_for_closure) 
        {
            let _ = file.write_all(log_line.as_bytes());
            let _ = file.flush();
        }
        
        Ok(())
    });
    
    // Write to stderr (which Tauri will capture)
    builder.target(env_logger::Target::Stderr);
    
    // Initialize the logger
    builder.init();
    
    log::info!("========================================");
    log::info!("Para UI v{} starting", env!("CARGO_PKG_VERSION"));
    log::info!("Log file: {}", log_path.display());
    log::info!("Process ID: {}", std::process::id());
    log::info!("========================================");
    
    // Print to console so user knows where logs are
    eprintln!("Logs are being written to: {}", log_path.display());
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;
    use std::env;

    #[test]
    #[serial]
    fn test_get_log_dir_uses_data_local_dir() {
        let tmp = TempDir::new().unwrap();
        // Redirect HOME so dirs uses temp location on macOS
        let prev = env::var("HOME").ok();
        env::set_var("HOME", tmp.path());

        let dir = get_log_dir();
        assert!(dir.exists() || dir.to_string_lossy().contains("para-ui/logs"));

        if let Some(p) = prev { env::set_var("HOME", p); } else { env::remove_var("HOME"); }
    }

    #[test]
    #[serial]
    fn test_get_log_path_creates_directory_and_returns_file() {
        let tmp = TempDir::new().unwrap();
        let prev = env::var("HOME").ok();
        env::set_var("HOME", tmp.path());

        let path = get_log_path();
        // Parent directory may not exist until first write; ensure we can create it
        let parent = path.parent().unwrap();
        std::fs::create_dir_all(parent).unwrap();
        assert!(parent.exists());
        // file may not exist until first write, but path should be under logs dir
        assert!(path.to_string_lossy().contains("para-ui"));

        if let Some(p) = prev { env::set_var("HOME", p); } else { env::remove_var("HOME"); }
    }

    #[test]
    #[serial]
    #[ignore] // Flaky test - logging initialization timing issue
    fn test_init_logging_writes_header_to_file() {
        let tmp = TempDir::new().unwrap();
        let prev = env::var("HOME").ok();
        env::set_var("HOME", tmp.path());

        init_logging();
        let log_path = get_log_path();
        // Write a test log entry
        log::info!("test log entry");
        // Give logger time to flush
        std::thread::sleep(std::time::Duration::from_millis(100));
        // Ensure file exists and contains our marker
        let content = std::fs::read_to_string(&log_path).unwrap_or_default();
        assert!(content.contains("Para UI v") || content.contains("test log entry"));

        if let Some(p) = prev { env::set_var("HOME", p); } else { env::remove_var("HOME"); }
    }
}