### Terminal CPU Performance Analysis

**Summary**
- Sustained high CPU correlates with terminal output volume (e.g., large `git diff`), not session count.
- Profiling shows hotspots in xterm.js (`parse`, `_innerWrite`, `print`, `renderRows`, `resize`) and frequent layout.
- Backend emits one event per PTY read chunk; frontend writes each chunk immediately to xterm, flooding the bridge and renderer.
- Diff viewer and highlight.js show activity but are secondary compared to terminal throughput.

---

### Findings from `localhost-recording.json`
- Recording format: WebKit-style timeline with `recording.records`, `sampleStackTraces`, `sampleDurations`.
- Timeline aggregates:
  - `timeline-record-type-rendering-frame` dominated script/layout bursts.
  - Many `layout` events; script time concentrated in xterm rendering paths.
- Sampled stacks and URLs (top frames/URLs):
  - xterm.js: `parse`, `_innerWrite`, `print`, `renderRows`, `resize`.
  - React DOM internals (commit, updateProperties) appear but much lower aggregate time.
  - Diff viewer and highlight.js visible but not primary under sustained load.

---

### Code paths implicated
- Frontend (`src/components/Terminal.tsx`):
  - Writes every event payload immediately to xterm:
    - `listen(terminal-output-*) => terminal.current.write(output)`
  - Resize observer debounced at ~16ms (60fps), triggering frequent `fit()` during layout changes.
  - Console logging inside terminal `onData` and hydration/flush paths adds overhead under heavy I/O.
- Backend (`src-tauri/src/terminal/local.rs`):
  - PTY reader emits one Tauri event per read (`~8KB`) with raw bytes, causing high event traffic and serialization costs.

---

### Root cause
- High-frequency event emission and per-chunk writes to xterm.js during chatty terminal output (e.g., `git diff`).
- Each small write triggers xterm parsing and DOM/canvas updates; combined with frequent resizes, this amplifies CPU utilization over time.

---

### Secondary contributors
- Diff viewer and syntax highlighting add cost when open with large diffs but are not the main sustained CPU driver.
- Ring buffer cloning during snapshot is not on the hot streaming path.

---

### Recommended fixes (terminal-focused)
1. Frontend batching of terminal writes
   - Buffer incoming payloads and flush at most once per frame (16–32ms) using `requestAnimationFrame`.
   - Join hydration backlog and write once instead of many small writes.
2. Backend coalesced emissions
   - Aggregate read chunks and emit to the frontend on a timer (10–20ms) or when a size threshold is reached (e.g., 32–64KB).
   - Emit as UTF-8 string (lossy if necessary) to reduce JSON serialization overhead compared to `Vec<u8>`.
3. Tame resize overhead
   - Increase `ResizeObserver` debounce to ~120–200ms and avoid overlapping resizes while a flush is pending.
4. Reduce logging in hot paths
   - Remove or gate console logs in terminal event handlers and input paths.

---

### Why this matches the symptom
- CPU increases with the amount of terminal output, not with the number of sessions.
- Batching reduces cross-boundary event count and xterm writes by 10–100x under load, preventing runaway CPU usage.
- Diff viewer optimizations can be deferred; primary wins are in terminal output handling.

---

### Implementation notes
- Frontend: introduce a write buffer and a scheduled flush; coalesce hydration flush; increase resize debounce.
- Backend: coalesce PTY output events, emit strings at an interval/threshold; keep ring buffer updates per read.
- Validate by re-running the profiling scenario and observing reduced CPU and event frequency.
