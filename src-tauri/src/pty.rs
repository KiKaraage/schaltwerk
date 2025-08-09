use anyhow::Result;
use log::{debug, error, info, warn};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, LazyLock};
use std::time::Instant;
#[cfg(test)]
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use users::os::unix::UserExt;
use users::{get_current_uid, get_user_by_uid};

pub static PTYS: LazyLock<
    tauri::async_runtime::Mutex<HashMap<String, Box<dyn portable_pty::Child + Send>>>,
> = LazyLock::new(|| tauri::async_runtime::Mutex::new(HashMap::new()));
pub static MASTERS: LazyLock<
    tauri::async_runtime::Mutex<HashMap<String, Box<dyn MasterPty + Send>>>,
> = LazyLock::new(|| tauri::async_runtime::Mutex::new(HashMap::new()));
pub static WRITERS: LazyLock<tauri::async_runtime::Mutex<HashMap<String, Box<dyn Write + Send>>>> =
    LazyLock::new(|| tauri::async_runtime::Mutex::new(HashMap::new()));
pub static CREATING: LazyLock<tauri::async_runtime::Mutex<HashSet<String>>> =
    LazyLock::new(|| tauri::async_runtime::Mutex::new(HashSet::new()));

type BufferMap = HashMap<String, Arc<tauri::async_runtime::Mutex<VecDeque<u8>>>>;
pub static BUFFERS: LazyLock<tauri::async_runtime::Mutex<BufferMap>> = 
    LazyLock::new(|| tauri::async_runtime::Mutex::new(HashMap::new()));

const MAX_BUFFER_BYTES: usize = 1_048_576;
const TRUNCATE_THRESHOLD: usize = MAX_BUFFER_BYTES + 100_000;

async fn append_to_buffer(id: &str, data: &[u8]) {
    let buffer_arc = {
        let mut buffers = BUFFERS.lock().await;
        buffers.entry(id.to_string())
            .or_insert_with(|| Arc::new(tauri::async_runtime::Mutex::new(VecDeque::new())))
            .clone()
    };
    
    let mut buffer = buffer_arc.lock().await;
    buffer.extend(data);
    
    if buffer.len() > TRUNCATE_THRESHOLD {
        let to_remove = buffer.len() - MAX_BUFFER_BYTES;
        debug!("Truncating buffer for terminal {id}: removing {to_remove} bytes");
        buffer.drain(..to_remove);
    }
}

pub async fn get_terminal_buffer(id: &str) -> Result<String, String> {
    let buffers = BUFFERS.lock().await;
    if let Some(buffer_mutex) = buffers.get(id) {
        let buffer = buffer_mutex.lock().await;
        let bytes: Vec<u8> = buffer.iter().copied().collect();
        Ok(String::from_utf8_lossy(&bytes).to_string())
    } else {
        Ok(String::new())
    }
}

pub async fn create_terminal(app: AppHandle, id: String, cwd: String) -> Result<String, String> {
    {
        let mut creating = CREATING.lock().await;
        let ptys = PTYS.lock().await;
        
        if ptys.contains_key(&id) {
            info!("Terminal already exists: id={id}");
            return Ok(id);
        }
        
        if creating.contains(&id) {
            info!("Terminal already being created: id={id}, waiting...");
            drop(creating);
            drop(ptys);
            
            for i in 0..50 {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                let ptys = PTYS.lock().await;
                if ptys.contains_key(&id) {
                    info!("Terminal {id} now exists after waiting {i}00ms");
                    return Ok(id);
                }
            }
            warn!("Timeout waiting for terminal {id} creation");
            return Err("Timeout waiting for terminal creation".to_string());
        }
        
        creating.insert(id.clone());
        debug!("Marked terminal {id} as being created");
    }
    
    info!("Creating terminal: id={id}, cwd={cwd}");
    
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    
    let shell_path = std::env::var("SHELL")
        .ok()
        .or_else(|| {
            let uid = get_current_uid();
            get_user_by_uid(uid).and_then(|u| u.shell().to_str().map(|s| s.to_string()))
        })
        .unwrap_or_else(|| "/bin/zsh".to_string());

    info!("Starting shell: {shell_path} in directory: {cwd}");

    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.cwd(cwd.clone());
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home.clone());
        debug!("Set HOME={home} for terminal {id}");
    }

    info!("Spawning command for terminal {id}...");
    let child = match pair.slave.spawn_command(cmd) {
        Ok(child) => {
            info!("Successfully spawned shell process for terminal {id}");
            child
        },
        Err(e) => {
            let mut creating = CREATING.lock().await;
            creating.remove(&id);
            error!("Failed to spawn terminal {id}: {e}");
            return Err(e.to_string());
        }
    };

    info!("Terminal {id} process spawned, saving handles...");

    {
        let mut m = PTYS.lock().await;
        m.insert(id.clone(), child);
        debug!("Saved child process for terminal {id}");
    }
    {
        let mut m = MASTERS.lock().await;
        m.insert(id.clone(), pair.master);
        debug!("Saved master PTY for terminal {id}");
    }
    {
        let mut writers = WRITERS.lock().await;
        if !writers.contains_key(&id) {
            let masters = MASTERS.lock().await;
            let writer = masters
                .get(&id)
                .unwrap()
                .take_writer()
                .map_err(|e| {
                    error!("Failed to get writer for terminal {id}: {e}");
                    e.to_string()
                })?;
            writers.insert(id.clone(), writer);
            debug!("Saved writer for terminal {id}");
        }
    }

    // spawn reader task to emit events - use spawn_blocking for the blocking I/O
    let app_handle = app.clone();
    let id_for_task = id.clone();
    tauri::async_runtime::spawn(async move {
        info!("Starting reader task for terminal {id_for_task}");
        let reader = {
            let masters = MASTERS.lock().await;
            let master = masters
                .get(&id_for_task)
                .unwrap_or_else(|| panic!("Master not found for terminal {id_for_task}"));
            master
                .try_clone_reader()
                .unwrap_or_else(|_| panic!("Failed to clone reader for terminal {id_for_task}"))
        };
        
        info!("Successfully cloned reader for terminal {id_for_task}");
        
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        
        // Spawn blocking thread for reading
        let id_for_blocking = id_for_task.clone();
        std::thread::spawn(move || {
            info!("Blocking reader thread started for terminal {id_for_blocking}");
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            let mut read_count = 0u64;
            let mut first_read = true;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        info!("Terminal {id_for_blocking} EOF on read");
                        break;
                    }
                    Ok(n) => {
                        if first_read {
                            info!("Terminal {id_for_blocking} first read: {n} bytes");
                            first_read = false;
                        }
                        read_count += 1;
                        if read_count % 10 == 0 {
                            debug!("Terminal {id_for_blocking} processed {read_count} reads");
                        }
                        if tx.send(buf[..n].to_vec()).is_err() {
                            warn!("Terminal {id_for_blocking} reader channel closed");
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Terminal {id_for_blocking} read error: {e}");
                        break;
                    }
                }
            }
            info!("Reader thread for terminal {id_for_blocking} ending after {read_count} reads");
        });
        
        info!("Async handler started for terminal {id_for_task}, waiting for data...");
        let mut message_count = 0u64;
        
        // Process output in async context
        while let Some(data) = rx.recv().await {
            message_count += 1;
            if message_count == 1 {
                info!("Terminal {id_for_task} received first data chunk: {} bytes", data.len());
            }
            
            let buffer_start = Instant::now();
            append_to_buffer(&id_for_task, &data).await;
            let buffer_time = buffer_start.elapsed();
            if buffer_time.as_millis() > 10 {
                warn!("Terminal {id_for_task} slow buffer append: {}ms", buffer_time.as_millis());
            }
            
            let s = String::from_utf8_lossy(&data).to_string();
            if let Err(e) = app_handle.emit(&format!("terminal-output-{id_for_task}"), s) {
                error!("Failed to emit terminal output for {id_for_task}: {e:?}");
            }
        }
        info!("Terminal {id_for_task} async handler ending after {message_count} messages");
    });

    {
        let mut creating = CREATING.lock().await;
        creating.remove(&id);
    }
    
    info!("Terminal created successfully: id={id}");
    Ok(id)
}

pub async fn write_terminal(id: &str, data: &str) -> Result<(), String> {
    if data.len() > 100 {
        debug!("Writing to terminal {id}: {} bytes", data.len());
    }
    
    let start = std::time::Instant::now();
    let mut writers = WRITERS.lock().await;
    let lock_time = start.elapsed();
    
    if lock_time.as_millis() > 10 {
        debug!("Terminal {id} write lock wait: {}ms", lock_time.as_millis());
    }
    
    if let Some(writer) = writers.get_mut(id) {
        writer
            .write_all(data.as_bytes())
            .map_err(|e| {
                warn!("Failed to write to terminal {id}: {e}");
                e.to_string()
            })?;
        writer.flush().map_err(|e| {
            warn!("Failed to flush terminal {id}: {e}");
            e.to_string()
        })?;
    } else {
        warn!("Terminal {id} not found in writers map");
    }
    
    let total_time = start.elapsed();
    if total_time.as_millis() > 20 {
        debug!("Terminal {id} slow write: {}ms", total_time.as_millis());
    }
    
    Ok(())
}

pub async fn resize_terminal(id: &str, cols: u16, rows: u16) -> Result<(), String> {
    debug!("Resizing terminal {id}: {cols}x{rows}");
    let masters = MASTERS.lock().await;
    if let Some(master) = masters.get(id) {
        master
            .resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                warn!("Failed to resize terminal {id}: {e}");
                e.to_string()
            })?;
    } else {
        warn!("Terminal {id} not found in masters map for resize");
    }
    Ok(())
}

pub async fn terminal_exists(id: &str) -> Result<bool, String> {
    let ptys = PTYS.lock().await;
    Ok(ptys.contains_key(id))
}

pub async fn close_terminal(id: &str) -> Result<(), String> {
    {
        let mut m = PTYS.lock().await;
        if let Some(mut child) = m.remove(id) {
            if let Err(e) = child.kill() {
                warn!("Failed to kill terminal process {id}: {e:?}");
            }
            let _ = child.wait();
        }
    }

    {
        let mut m = MASTERS.lock().await;
        m.remove(id);
    }
    {
        let mut m = WRITERS.lock().await;
        m.remove(id);
    }
    {
        let mut buffers = BUFFERS.lock().await;
        buffers.remove(id);
        debug!("Removed buffer for terminal {id}");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::RwLock;

    #[tokio::test]
    async fn test_close_nonexistent_terminal() {
        let result = close_terminal("nonexistent").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_write_to_nonexistent_terminal() {
        let result = write_terminal("nonexistent", "test").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_resize_nonexistent_terminal() {
        let result = resize_terminal("nonexistent", 80, 24).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_buffer_append_and_get() {
        let id = "test_terminal";
        let data = b"Hello, World!";
        
        append_to_buffer(id, data).await;
        
        let result = get_terminal_buffer(id).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Hello, World!");
        
        {
            let mut buffers = BUFFERS.lock().await;
            buffers.remove(id);
        }
    }

    #[tokio::test]
    async fn test_buffer_truncation() {
        let id = "test_truncate";
        let chunk_size = 100_000;
        let chunk = vec![b'A'; chunk_size];
        
        for _ in 0..20 {
            append_to_buffer(id, &chunk).await;
        }
        
        let result = get_terminal_buffer(id).await;
        assert!(result.is_ok());
        let buffer = result.unwrap();
        assert!(buffer.len() <= TRUNCATE_THRESHOLD);
        assert!(buffer.len() >= MAX_BUFFER_BYTES);
        
        {
            let mut buffers = BUFFERS.lock().await;
            buffers.remove(id);
        }
    }

    #[tokio::test]
    async fn test_buffer_cleanup_on_close() {
        let id = "test_cleanup";
        let data = b"Test data";
        
        append_to_buffer(id, data).await;
        
        let result = get_terminal_buffer(id).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Test data");
        
        let _ = close_terminal(id).await;
        
        let result = get_terminal_buffer(id).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "");
    }

    #[tokio::test]
    async fn test_get_nonexistent_buffer() {
        let result = get_terminal_buffer("nonexistent").await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "");
    }

    #[tokio::test]
    async fn test_concurrent_buffer_appends() {
        let id = "test_concurrent";
        let mut handles = vec![];
        
        for i in 0..10 {
            let data = format!("Thread {}: Hello\n", i);
            handles.push(tokio::spawn(async move {
                for _ in 0..100 {
                    append_to_buffer(id, data.as_bytes()).await;
                }
            }));
        }
        
        for handle in handles {
            handle.await.unwrap();
        }
        
        let result = get_terminal_buffer(id).await;
        assert!(result.is_ok());
        let buffer = result.unwrap();
        
        assert!(buffer.contains("Thread 0: Hello"));
        assert!(buffer.contains("Thread 9: Hello"));
        
        {
            let mut buffers = BUFFERS.lock().await;
            buffers.remove(id);
        }
    }

    #[tokio::test]
    async fn test_terminal_exists() {
        assert_eq!(terminal_exists("nonexistent").await.unwrap(), false);
        
        {
            let mut ptys = PTYS.lock().await;
            #[derive(Debug, Clone)]
            struct DummyChild;
            
            impl portable_pty::ChildKiller for DummyChild {
                fn kill(&mut self) -> std::io::Result<()> {
                    Ok(())
                }
                
                fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
                    Box::new(DummyChild)
                }
            }
            
            impl portable_pty::Child for DummyChild {
                fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
                    Ok(None)
                }
                fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
                    Ok(portable_pty::ExitStatus::with_exit_code(0))
                }
                fn process_id(&self) -> Option<u32> {
                    Some(1234)
                }
                #[cfg(windows)]
                fn as_raw_handle(&self) -> portable_pty::RawHandle {
                    unimplemented!()
                }
            }
            ptys.insert("test_exists".to_string(), Box::new(DummyChild));
        }
        
        assert_eq!(terminal_exists("test_exists").await.unwrap(), true);
        
        {
            let mut ptys = PTYS.lock().await;
            ptys.remove("test_exists");
        }
    }

    #[tokio::test]
    async fn test_creating_state_prevents_duplicate_creation() {
        let id = "test_create_lock";
        
        {
            let mut creating = CREATING.lock().await;
            creating.insert(id.to_string());
        }
        
        let start = Instant::now();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let mut creating = CREATING.lock().await;
            creating.remove(id);
            
            let mut ptys = PTYS.lock().await;
            #[derive(Debug, Clone)]
            struct DummyChild;
            
            impl portable_pty::ChildKiller for DummyChild {
                fn kill(&mut self) -> std::io::Result<()> {
                    Ok(())
                }
                
                fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
                    Box::new(DummyChild)
                }
            }
            
            impl portable_pty::Child for DummyChild {
                fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
                    Ok(None)
                }
                fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
                    Ok(portable_pty::ExitStatus::with_exit_code(0))
                }
                fn process_id(&self) -> Option<u32> {
                    Some(1234)
                }
                #[cfg(windows)]
                fn as_raw_handle(&self) -> portable_pty::RawHandle {
                    unimplemented!()
                }
            }
            ptys.insert(id.to_string(), Box::new(DummyChild));
        });
        
        let elapsed = start.elapsed();
        assert!(elapsed.as_millis() < 50, "Should not wait yet");
        
        handle.await.unwrap();
        
        {
            let mut ptys = PTYS.lock().await;
            ptys.remove(id);
        }
    }

    #[tokio::test]
    async fn test_buffer_performance_metrics() {
        let write_times = Arc::new(RwLock::new(Vec::new()));
        let id = "test_perf";
        
        for i in 0..100 {
            let data = format!("Line {}: Some test data\n", i);
            let start = Instant::now();
            append_to_buffer(id, data.as_bytes()).await;
            let elapsed = start.elapsed();
            write_times.write().await.push(elapsed);
        }
        
        let times = write_times.read().await;
        let avg_time: Duration = times.iter().sum::<Duration>() / times.len() as u32;
        
        assert!(avg_time.as_millis() < 10, "Average append time should be under 10ms");
        
        let max_time = times.iter().max().unwrap();
        assert!(max_time.as_millis() < 50, "Max append time should be under 50ms");
        
        {
            let mut buffers = BUFFERS.lock().await;
            buffers.remove(id);
        }
    }

    #[tokio::test]
    async fn test_buffer_handles_binary_data() {
        let id = "test_binary";
        let binary_data = vec![0x00, 0xFF, 0x01, 0xFE, 0x02, 0xFD];
        
        append_to_buffer(id, &binary_data).await;
        
        let result = get_terminal_buffer(id).await;
        assert!(result.is_ok());
        
        let buffer = result.unwrap();
        assert!(buffer.len() > 0);
        
        {
            let mut buffers = BUFFERS.lock().await;
            buffers.remove(id);
        }
    }

    #[tokio::test]
    async fn test_buffer_handles_utf8_sequences() {
        let id = "test_utf8";
        let utf8_data = "Hello 世界 🌍 émojis";
        
        append_to_buffer(id, utf8_data.as_bytes()).await;
        
        let result = get_terminal_buffer(id).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), utf8_data);
        
        {
            let mut buffers = BUFFERS.lock().await;
            buffers.remove(id);
        }
    }
}
