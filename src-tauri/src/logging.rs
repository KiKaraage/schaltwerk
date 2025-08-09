use chrono::Local;
use env_logger::Builder;
use log::LevelFilter;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

/// Get the log file path
fn get_log_path() -> PathBuf {
    let log_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("para-ui")
        .join("logs");
    
    // Create directory if it doesn't exist
    let _ = fs::create_dir_all(&log_dir);
    
    let log_file = log_dir.join(format!("para-ui-{}.log", Local::now().format("%Y%m%d-%H%M%S")));
    log_file
}

/// Initialize logging to both console and file
pub fn init_logging() {
    let log_path = get_log_path();
    let log_path_for_closure = log_path.clone();
    
    // Create/open log file (just to verify it works)
    let _log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .expect("Failed to open log file");
    
    let mut builder = Builder::new();
    
    // Set log level from env or default to DEBUG for our crate, WARN for others
    if let Ok(rust_log) = std::env::var("RUST_LOG") {
        builder.parse_filters(&rust_log);
    } else {
        builder.filter_module("ui", LevelFilter::Debug);
        builder.filter_level(LevelFilter::Warn);
    }
    
    // Custom format with timestamps and module info
    builder.format(move |buf, record| {
        let log_line = format!(
            "[{} {} {}] {}\n",
            Local::now().format("%H:%M:%S%.3f"),
            record.level(),
            record.target(),
            record.args()
        );
        
        // Write to stderr (console)
        write!(buf, "{log_line}")?;
        
        // Also write to file
        if let Ok(mut file) = OpenOptions::new().append(true).open(&log_path_for_closure) {
            let _ = file.write_all(log_line.as_bytes());
        }
        
        Ok(())
    });
    
    // Write to stderr (which Tauri will capture)
    builder.target(env_logger::Target::Stderr);
    
    // Initialize the logger
    builder.init();
    
    log::info!("Para UI logging initialized");
    log::info!("Log file: {}", log_path.display());
    
    // Print to console so user knows where logs are
    eprintln!("📝 Logs are being written to: {}", log_path.display());
}