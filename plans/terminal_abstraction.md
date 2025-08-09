### Goal
Deliver a clean TerminalBackend abstraction and a fully functional LocalPtyAdapter that preserves current behavior (Tauri events + invoke), while making a later switch to a cloud backend trivial.

### Scope and outcomes
- Introduce a backend-agnostic terminal service API in Rust.
- Implement `LocalPtyAdapter` using portable-pty, ring buffer, and seq numbers.
- Keep existing Tauri commands and `terminal-output-{id}` events working unchanged.
- Centralize lifecycle/cleanup; add tests; no GUI terminals open.

### File/module layout
- `ui/src-tauri/src/terminal/mod.rs` (trait, types)
- `ui/src-tauri/src/terminal/local.rs` (LocalPtyAdapter)
- `ui/src-tauri/src/terminal/manager.rs` (singleton service, event bridge)
- Update:
  - `ui/src-tauri/src/main.rs` (commands call manager)
  - `ui/src-tauri/src/cleanup.rs` (close all via manager)
  - Remove/ignore any duplicate old `pty.rs` to avoid confusion.

### TerminalBackend contract
```rust
// ui/src-tauri/src/terminal/mod.rs
use futures_core::Stream;

pub struct CreateParams {
  pub id: String,
  pub cwd: String,
  pub app: Option<ApplicationSpec>, // optional, reserved for future "apps"
}

pub struct ApplicationSpec {
  pub command: String,
  pub args: Vec<String>,
  pub env: Vec<(String, String)>,
  pub ready_timeout_ms: u64,
}

pub struct OutputChunk {
  pub id: String,
  pub seq: u64,
  pub data: Vec<u8>, // raw bytes
}

#[async_trait::async_trait]
pub trait TerminalBackend: Send + Sync {
  async fn create(&self, params: CreateParams) -> Result<(), String>;
  async fn write(&self, id: &str, data: &[u8]) -> Result<(), String>;
  async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String>;
  async fn close(&self, id: &str) -> Result<(), String>;
  async fn exists(&self, id: &str) -> Result<bool, String>;
  async fn snapshot(&self, id: &str, from_seq: Option<u64>) -> Result<(u64, Vec<u8>), String>;
  fn subscribe(&self, id: &str) -> Result<Box<dyn Stream<Item = OutputChunk> + Unpin + Send>, String>;
}
```

### LocalPtyAdapter implementation
- Data structures (all behind `Arc<Self>` with async Mutexes):
  - `ptys: HashMap<String, Box<dyn portable_pty::Child + Send>>`
  - `masters: HashMap<String, Box<dyn MasterPty + Send>>`
  - `writers: HashMap<String, Box<dyn Write + Send>>`
  - `creating: HashSet<String>` (dedupe concurrent create)
  - `buffers: HashMap<String, Vec<u8>>` (ring buffer, cap e.g. 2–5 MiB)
  - `seq: HashMap<String, u64>` (monotonic per-id)
  - `tx: HashMap<String, tokio::sync::broadcast::Sender<OutputChunk>>` (fanout to subscribers)

- Create:
  - Dedupe via `creating`; await existing if needed.
  - Spawn PTY with shell defaults:
    - zsh: `-i -f` (or set `ZDOTDIR` to an empty dir if you need to avoid profile entirely)
    - bash: `-i --noprofile --norc`
    - fish: `--no-config`
  - Set env: `TERM=xterm-256color`, `COLORTERM=truecolor`, ensure `HOME`, set `PATH` if you disable rc files: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`.
  - Create writer and master maps.
  - Start a reader task:
    - Read raw bytes, append to ring buffer, increment `seq`, send `OutputChunk` on broadcast channel.
    - Also emit Tauri event `terminal-output-{id}` with the raw data (preserves current UI behavior).

- Write/resize/close/exists:
  - `write`: no-op if writer missing; return Ok; log warn.
  - `resize`: call `master.resize`, Ok if missing.
  - `close`: kill child if present, remove maps, drop broadcast sender, drop buffer and seq.

- Snapshot:
  - If `from_seq` is None: return `(current_seq, full_buffer)`.
  - If provided and still within buffer window (detected by retained byte count vs. seq distance), return slice from that seq forward; otherwise, return full buffer with current `seq`.

- Subscribe:
  - Create or reuse a `broadcast::Sender` per id; return a `Receiver` wrapped as `Stream` (e.g., via `tokio_stream::wrappers::BroadcastStream`), mapping to `OutputChunk`.
  - Multiple subscribers supported.

- Ring buffer:
  - Push bytes; if `len > MAX`, drop from front to fit.
  - Keep it bytes; do not transcode.

### Manager and Tauri integration
- `TerminalManager`:
  - Holds `Arc<dyn TerminalBackend>`, initialized with `LocalPtyAdapter`.
  - Provides thin async fns mirroring commands:
    - `create_terminal(id, cwd)`, `write_terminal`, `resize_terminal`, `close_terminal`, `terminal_exists`, `get_terminal_buffer`.
  - On `create` (or first subscribe), spawn a task that reads from `backend.subscribe(id)` and forwards `OutputChunk.data` to Tauri events `terminal-output-{id}` to keep the existing UI working.
  - Provide `close_all()` that enumerates known IDs and calls `close`.

- `main.rs`:
  - Keep Tauri commands and wire them to `TerminalManager`.
  - Add `get_terminal_buffer(id)` that calls `snapshot(None)` and returns lossless string (UTF-8 lossy acceptable for now to match UI write path).
  - Keep existing window close hook to call `close_all()`.

### Frontend compatibility (unchanged now)
- UI continues to:
  - `invoke('create_terminal' | 'write_terminal' | 'resize_terminal' | 'terminal_exists' | 'get_terminal_buffer')`.
  - Listen to `terminal-output-{id}`.
- Your ring-buffer hydration fix remains valid and benefits from the new snapshot API (same method).

### Testing
- Rust unit tests (tokio):
  - Create → exists true → snapshot returns empty buffer with seq=0.
  - Write small data → snapshot returns it; seq increments as expected.
  - Ring buffer truncation at cap; seq increments monotonically; snapshot respects `from_seq` within window and falls back when stale.
  - Close cleans all maps; subsequent operations are no-ops (Ok).
  - Subscribe delivers chunks in order; multiple subscribers receive same seq.
- Clippy, build, tests:
  - `npm run test` should pass (includes `lint:rust`, `test:rust`, `build:rust`).

### Acceptance criteria
- Behavior identical for the current UI: event names and commands unchanged.
- Terminals don’t open an OS terminal window.
- Snapshot/subscribe available through the backend API (even if UI still uses events).
- All operations safe under rapid create/switch/resize; no panics; bounded memory.
- Cleanup on exit shuts down all terminals.

### Future-proof hooks (no behavior change yet)
- `ApplicationSpec` accepted by `create`, but optional. For now, if `app` is None, run the user shell; later, run `app.command` with args/env.
- The `TerminalBackend` trait is transport-agnostic; a `RemoteAdapter` can be added that proxies to a WS server with the same contract.
- The event bridge can later be replaced by a WS server without touching the UI logic if you switch the frontend to a WebSocket client.

- Deliver a trait-based terminal backend with `LocalPtyAdapter`, ring buffer + seq, and a manager that maintains current Tauri event behavior.
- Keep UI unchanged now; enable easy swap to a remote backend later.