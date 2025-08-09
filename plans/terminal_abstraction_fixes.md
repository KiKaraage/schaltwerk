# Terminal Abstraction - Critical Fixes Required

## Overview
The terminal abstraction implementation needs critical fixes to meet the original specification. This task addresses compilation errors, architectural issues, and missing functionality identified during code review.

## Critical Fixes Required

### 1. Remove Legacy Code
**FIRST PRIORITY**: Delete the old `pty.rs` file completely
```bash
rm src-tauri/src/pty.rs
```
Then update `src-tauri/src/main.rs` to use the new terminal module instead of `pty`:
- Change `mod pty;` to `mod terminal;`
- Update all command implementations to use `terminal::manager::TerminalManager` instead of direct `pty` calls

### 2. Fix Trait Definition (`src-tauri/src/terminal/mod.rs`)

Add missing imports and types:
```rust
use futures_core::Stream;
use async_trait::async_trait;
use std::pin::Pin;

pub struct OutputChunk {
    pub id: String,
    pub seq: u64,
    pub data: Vec<u8>,
}

#[async_trait]
pub trait TerminalBackend: Send + Sync {
    async fn create(&self, params: CreateParams) -> Result<(), String>;
    async fn write(&self, id: &str, data: &[u8]) -> Result<(), String>;
    async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String>;
    async fn close(&self, id: &str) -> Result<(), String>;
    async fn exists(&self, id: &str) -> Result<bool, String>;
    async fn snapshot(&self, id: &str, from_seq: Option<u64>) -> Result<(u64, Vec<u8>), String>;
    fn subscribe(&self, id: &str) -> Result<Pin<Box<dyn Stream<Item = OutputChunk> + Send>>, String>;
}
```

### 3. Implement subscribe() Method in LocalPtyAdapter

Add to `src-tauri/src/terminal/local.rs`:

```rust
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use futures_core::Stream;
use std::pin::Pin;

// Add to LocalPtyAdapter struct:
struct LocalPtyAdapter {
    // ... existing fields ...
    subscribers: Arc<RwLock<HashMap<String, broadcast::Sender<OutputChunk>>>>,
}

// Implement subscribe method:
fn subscribe(&self, id: &str) -> Result<Pin<Box<dyn Stream<Item = OutputChunk> + Send>>, String> {
    let subscribers = self.subscribers.blocking_read();
    
    let sender = subscribers.get(id)
        .ok_or_else(|| format!("No terminal found with id: {}", id))?;
    
    let receiver = sender.subscribe();
    let stream = BroadcastStream::new(receiver)
        .filter_map(|result| async move { result.ok() });
    
    Ok(Box::pin(stream))
}
```

### 4. Fix State Management Architecture

Choose ONE approach - remove global statics and use only instance-level state:

Remove these global statics from `local.rs`:
```rust
// DELETE THESE:
lazy_static! {
    static ref PTYS: Mutex<HashMap<String, Box<dyn portable_pty::Child + Send>>> = Mutex::new(HashMap::new());
    static ref MASTERS: Mutex<HashMap<String, Box<dyn MasterPty + Send>>> = Mutex::new(HashMap::new());
    // etc...
}
```

Keep only the Arc<RwLock> fields in LocalPtyAdapter struct.

### 5. Fix Ring Buffer Snapshot Implementation

Update the snapshot method to properly handle `from_seq`:

```rust
async fn snapshot(&self, id: &str, from_seq: Option<u64>) -> Result<(u64, Vec<u8>), String> {
    let terminals = self.terminals.read().await;
    let terminal = terminals.get(id)
        .ok_or_else(|| format!("Terminal not found: {}", id))?;
    
    let current_seq = terminal.sequence.load(Ordering::SeqCst);
    
    match from_seq {
        None => {
            // Return full buffer
            let buffer = terminal.ring_buffer.lock().await;
            Ok((current_seq, buffer.make_contiguous().to_vec()))
        }
        Some(seq) => {
            // Calculate how many bytes to skip based on sequence difference
            let buffer = terminal.ring_buffer.lock().await;
            
            // If requested seq is too old, return full buffer
            if current_seq - seq > buffer.len() as u64 {
                Ok((current_seq, buffer.make_contiguous().to_vec()))
            } else {
                // Return partial buffer from requested sequence
                let skip_bytes = (seq as usize).min(buffer.len());
                let data: Vec<u8> = buffer.make_contiguous()[skip_bytes..].to_vec();
                Ok((current_seq, data))
            }
        }
    }
}
```

### 6. Add Broadcast Channel Support

Update the reader task to broadcast OutputChunks:

```rust
// In create() method, after spawning reader:
let (tx, _) = broadcast::channel(100);
self.subscribers.write().await.insert(id.clone(), tx.clone());

// In the reader loop:
let chunk = OutputChunk {
    id: id.clone(),
    seq: sequence.fetch_add(1, Ordering::SeqCst),
    data: data.to_vec(),
};

// Send to subscribers
if let Some(sender) = subscribers.get(&id) {
    let _ = sender.send(chunk.clone());
}

// Also emit Tauri event for backward compatibility
app_handle.emit(&format!("terminal-output-{}", id), String::from_utf8_lossy(&chunk.data).to_string())?;
```

### 7. Fix Async/Blocking Context Issues

Replace the problematic blocking reader with proper async handling:

```rust
// Instead of spawn_blocking with block_on inside:
tokio::spawn(async move {
    let mut reader = BufReader::new(master.try_clone_reader()?);
    let mut buf = [0u8; 4096];
    
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break, // EOF
            Ok(n) => {
                // Process data
                process_output(&buf[..n], &id, &subscribers).await;
            }
            Err(e) => {
                log::error!("Read error for terminal {}: {}", id, e);
                break;
            }
        }
    }
});
```

### 8. Add Required Dependencies

Update `Cargo.toml`:
```toml
[dependencies]
async-trait = "0.1"
futures-core = "0.3"
tokio-stream = { version = "0.1", features = ["sync"] }
```

## Testing After Fixes

1. Verify compilation:
```bash
cargo build
```

2. Run tests:
```bash
cargo test
```

3. Test terminal creation and output:
```bash
npm run tauri dev
# Create a terminal and verify output appears
```

4. Test multiple subscribers:
```rust
#[tokio::test]
async fn test_multiple_subscribers() {
    let backend = LocalPtyAdapter::new();
    let mut sub1 = backend.subscribe("test").unwrap();
    let mut sub2 = backend.subscribe("test").unwrap();
    
    // Both should receive the same chunks
}
```

## Verification Checklist

- [ ] Old pty.rs removed
- [ ] Project compiles without errors
- [ ] All tests pass
- [ ] Terminal output appears in UI
- [ ] Multiple subscribers can receive same output
- [ ] Ring buffer properly handles sequence numbers
- [ ] No race conditions in concurrent operations
- [ ] Memory usage is bounded (ring buffer limit works)

## Final Steps

After implementing all fixes:
1. Commit all changes: `git add . && git commit -m 'Fix terminal abstraction: complete trait implementation, fix state management, add broadcast support'`
2. Verify build works: `npm run test`
3. Run: `para finish 'Complete terminal abstraction with all critical fixes applied'`