## Terminal architecture, stability, and performance remediation plan

This plan consolidates the CPU analysis in `plans/terminal_cpu_analysis.md` with stability/tech-debt findings across the terminal stack. It specifies low‑effort wins and structural fixes, with concrete implementation steps, acceptance criteria, and a validation plan.

### Goals
- Reduce terminal CPU usage under heavy output by 10–100x (event/write batching and resize hygiene)
- Eliminate terminal lifecycle leaks; ensure clean state on EOF and session cancel
- Decouple agent auto‑start from UI rendering; centralize orchestration with retry/health semantics
- Simplify terminal creation idempotence to one source of truth (backend)

### Scope
- Frontend: `src/components/Terminal.tsx`, `src/components/TerminalGrid.tsx`, `src/contexts/SelectionContext.tsx` (+ new service)
- Backend: `src-tauri/src/terminal/local.rs`, `src-tauri/src/terminal/manager.rs`, `src-tauri/src/main.rs`
- Non-goals: diff viewer optimization beyond basic gating; database/para_core internals unrelated to terminal stream

---

## Workstream A — Throughput and CPU

Problem summary (from terminal_cpu_analysis.md):
- Flood of small PTY chunks -> many Tauri events -> many `xterm.write()` calls and frequent fits/resizes
- Logging on hot paths and repeated mount-time fits exacerbate CPU

### A1. Frontend write batching (requestAnimationFrame)
- Buffer incoming terminal payloads and flush at most once per frame.
- Coalesce hydration flush into a single write.

Implementation sketch (in `src/components/Terminal.tsx`):
```ts
// at top-level of component
const writeQueueRef = useRef<string[]>([])
const rafIdRef = useRef<number | null>(null)

const scheduleFlush = () => {
  if (rafIdRef.current != null) return
  rafIdRef.current = requestAnimationFrame(() => {
    rafIdRef.current = null
    if (!terminal.current || writeQueueRef.current.length === 0) return
    const chunk = writeQueueRef.current.join('')
    writeQueueRef.current = []
    terminal.current.write(chunk)
  })
}

// in tauri event listener for terminal-output-<id>
// instead of terminal.current.write(output):
writeQueueRef.current.push(output)
scheduleFlush()

// during hydration
if (snapshot && terminal.current) {
  writeQueueRef.current.push(snapshot)
}
// after flushing any pending outputs, rely on scheduled flush
```

Acceptance criteria:
- Under a sustained `git diff` stream, `xterm.write` call count drops by at least 10x vs. current
- Visual latency remains < 1 frame (<=16ms typical; <=32ms worst)

### A2. Resize hygiene and throttling
- Replace multiple mount-time timers with a single RAF-scheduled `fit()` once container is measurable; keep dimension-change guard.
- Increase resize debounce to 120–200ms (or RAF + last-size check) to reduce chatter during layout.

Implementation sketch:
```ts
// schedule a single RAF fit after mount when element has non-zero size
const scheduleInitialFit = () => {
  requestAnimationFrame(() => {
    if (isReadyForFit()) {
      try { fitAddon.current!.fit() } catch {}
      invoke('resize_terminal', { id: terminalId, cols: terminal.current!.cols, rows: terminal.current!.rows })
    }
  })
}

// ResizeObserver -> debounce 150–200ms, then fit; only invoke resize if cols/rows changed
```

Acceptance criteria:
- Resize-induced `resize_terminal` invocations reduced substantially during window resizes, without breaking UX

### A3. Reduce logging on hot paths
- Remove/gate per-keystroke and per-chunk logs in `Terminal.tsx` behind a debug flag (e.g., `import.meta.env.VITE_DEBUG_TERMINAL`).

Acceptance criteria:
- No console spam during typing or streaming unless debug enabled

### A4. Backend coalesced emissions and string payloads
- Aggregate PTY reads per terminal and emit to frontend at ~10–20ms intervals or when buffer > 32–64KB.
- Convert bytes to UTF‑8 string with `String::from_utf8_lossy` and emit that string (avoid JSON serialization of `Vec<u8>`). Frontend already expects strings.

Implementation sketch (in `src-tauri/src/terminal/local.rs`):
- Introduce a per-terminal emitter state (buffer `Vec<u8>`, last flush `Instant`).
- On PTY read, append to buffer and, if not scheduled, schedule a timed/interval flush on the Tokio runtime.
- On flush, clone & clear buffer, convert to string (lossy), and `emit("terminal-output-<id>", string)`.

Acceptance criteria:
- Event rate on the Tauri bridge reduced by >=10x under heavy output
- No visible output corruption in typical scenarios (lossy conversion acceptable for control sequences)

---

## Workstream B — Lifecycle and state correctness

### B1. Proper cleanup on EOF/child exit
- When PTY reader hits EOF or a non-recoverable error, remove `id` from all global maps and `terminals`, and emit `para-ui:terminal-closed` with `{ terminal_id }`.
- Update `TerminalManager.active_ids` accordingly.
- Optionally, update `exists(id)` to reflect cleaned state immediately (or verify child state if API allows `try_wait`).

Implementation sketch (in `local.rs` reader loop):
```rust
Ok(0) => {
    info!("Terminal {id} EOF");
    // cleanup(id)
    if let Some(handle) = app_handle_clone.lock().await.as_ref() {
        let _ = handle.emit("para-ui:terminal-closed", &serde_json::json!({"terminal_id": id}));
    }
    break;
}
```

Acceptance criteria:
- After a terminal process exits, `terminal_exists(id)` returns false and the frontend stops listening/writing

### B2. Close session terminals on cancel/archive
- In `para_core_cancel_session`, after successful cancellation, attempt to close `session-<name>-top`, `-bottom`, `-right` (ignore missing).

Acceptance criteria:
- Canceling a session releases its PTYs and memory; no lingering terminals

### B3. Reduce buffer memory footprint
- Lower `MAX_BUFFER_SIZE` from 5 MB to 2 MB (configurable via env/feature flag if desired).

Acceptance criteria:
- Memory footprint decreases without noticeable UX regression; truncate behavior remains acceptable

---

## Workstream C — Orchestration and responsibilities

### C1. Centralize agent auto‑start and restart logic
- Move auto‑start out of `src/components/Terminal.tsx`.
- Create `src/services/TerminalOrchestrator.ts` (or similar):
  - On selection change, ensure `-top` terminal exists and start agent via Tauri commands.
  - Debounce/retry when `terminal_exists` is false.
  - Listen for `para-ui:terminal-closed` and offer restart when appropriate.
  - Expose explicit `start/stop/restart` APIs for UI.
- Remove the `startedGlobal` Set and the auto-start effect from the Terminal component.

Acceptance criteria:
- Terminal rendering has no side-effects; agent lifecycle is driven by orchestrator state
- If the agent crashes, orchestrator can restart it (manual or policy-based)

### C2. Simplify creation idempotence
- Frontend: remove the `creationLock`/`terminalsCreated` duplication where safe; rely on backend’s idempotent `create_terminal` (returns quickly if exists).

Acceptance criteria:
- Fewer moving parts in the UI for terminal creation; no regressions in race conditions

---

## Milestones and sequencing

1) M0 — Baseline & flags
- Add `VITE_DEBUG_TERMINAL` gating for logs; capture baseline CPU/event counts for a heavy `git diff` replay

2) M1 — Frontend batching and resize hygiene (low effort, high impact)
- Implement A1, A2, A3 in `Terminal.tsx`; keep functionality unchanged otherwise

3) M2 — Backend coalescing and string payloads
- Implement A4 in `local.rs`; add small emitter struct; verify payload type aligns with UI

4) M3 — Lifecycle cleanup and cancel closure
- Implement B1 (EOF cleanup + `para-ui:terminal-closed`), B2 (close on cancel), B3 (buffer cap)

5) M4 — Orchestration refactor
- Implement C1 in new `src/services/TerminalOrchestrator.ts`; remove `startedGlobal` and auto‑start effect from `Terminal.tsx`; implement C2 simplifications

6) M5 — Validation and tuning
- Re-run CPU profiling; tune coalescing interval/thresholds (e.g., 16ms/32KB) and resize debounce (150–200ms)

7) M6 — Cleanups
- Remove dead state (`isNewSession` if unused), tighten typings, add docstrings

---

## Testing and validation plan

Automated:
- Add unit/integration tests for:
  - Terminal event payload is string (UI mock receives string)
  - EOF emits `para-ui:terminal-closed` and `terminal_exists` becomes false
  - Cancel session closes `session-*-top/bottom/right`
  - Frontend batching: multiple event payloads within 1 frame result in a single `xterm.write` call

Manual/perf:
- Stress test with large `git diff` inside terminal; monitor CPU (Activity Monitor) and Tauri event counts
- Resize window repeatedly; confirm low chatter of `resize_terminal` and stable rendering
- Kill underlying agent process; ensure UI receives closed event and orchestrator handles restart

Acceptance targets:
- Sustained CPU under heavy output reduced significantly vs. current baseline
- No lost output in normal usage; acceptable 1-frame latency for display
- No terminal leaks after cancel or EOF

---

## Risks and mitigations
- UTF‑8 lossy conversion may drop some bytes in exotic encodings
  - Mitigation: Use UTF‑8 oriented tools; if necessary, switch to Base64 in future (with UI decode) behind a feature flag
- Batching introduces slight latency
  - Mitigation: Keep intervals at 10–20ms and validate UX; allow tuning via env
- Orchestrator refactor could temporarily break auto‑start paths
  - Mitigation: Land behind a feature flag; ship incremental PRs

---

## Concrete edit checklist

- [ ] `src/components/Terminal.tsx`
  - Add write queue + RAF flush; coalesce hydration; remove hot-path logs; replace mount-time timers with single RAF fit; maintain size-change guard
  - Remove auto‑start logic and `startedGlobal` after orchestrator lands (M4)
- [ ] `src-tauri/src/terminal/local.rs`
  - Add emitter/coalescer per terminal; emit strings; on EOF cleanup maps and emit `para-ui:terminal-closed`; lower `MAX_BUFFER_SIZE` to 2 MB
- [ ] `src-tauri/src/main.rs`
  - In `para_core_cancel_session`, close `session-<name>-{top,bottom,right}`
  - Add handler (if needed) for `para-ui:terminal-closed` consumers or document the event
- [ ] `src/services/TerminalOrchestrator.ts` (new)
  - Centralize agent start/stop/restart keyed by selection; listen to `terminal-closed`; expose APIs for UI
- [ ] Tests
  - Update `Terminal.test.tsx` to assert batched writes and correct payload type; add backend tests for EOF cleanup and cancel closure

---

## Rollout
- Ship M1 (frontend batching/resize/log gating) first — quick perf win, low risk
- Ship M2 (backend coalescing/string payloads) next — largest cross-boundary reduction
- Ship M3 (lifecycle cleanup) — correctness and memory/process hygiene
- Ship M4 (orchestrator) — decouple responsibilities and improve recoverability

Done right, these changes address both the high CPU issue and the main architectural/stability problems without altering core UX.


