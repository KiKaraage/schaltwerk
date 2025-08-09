use chrono::Local;
use env_logger::Builder;
use log::LevelFilter;
use std::io::Write;

/// Initialize logging to console with timestamps
/// Logs are written to stderr and can be redirected to a file if needed
pub fn init_logging() {
    let mut builder = Builder::new();
    
    // Set log level from env or default to INFO for our crate, WARN for others
    if let Ok(rust_log) = std::env::var("RUST_LOG") {
        builder.parse_filters(&rust_log);
    } else {
        builder.filter_module("ui", LevelFilter::Info);
        builder.filter_level(LevelFilter::Warn);
    }
    
    // Custom format with timestamps and module info
    builder.format(|buf, record| {
        writeln!(
            buf,
            "[{} {} {}] {}",
            Local::now().format("%H:%M:%S%.3f"),
            record.level(),
            record.target(),
            record.args()
        )
    });
    
    // Write to stderr (which Tauri will capture)
    builder.target(env_logger::Target::Stderr);
    
    // Initialize the logger
    builder.init();
    
    log::info!("Para UI logging initialized");
}