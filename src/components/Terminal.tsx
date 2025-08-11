import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import 'xterm/css/xterm.css';

// Global guard to avoid starting Claude multiple times for the same terminal id across remounts
const startedGlobal = new Set<string>();

interface TerminalProps {
    terminalId: string;
    className?: string;
    sessionName?: string; // explicitly provided session name
    isOrchestrator?: boolean; // explicitly provided orchestrator flag
}

export interface TerminalHandle {
    focus: () => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(({ terminalId, className = '', sessionName, isOrchestrator = false }, ref) => {
    const termRef = useRef<HTMLDivElement>(null);
    const terminal = useRef<XTerm | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    const lastSize = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
    const [hydrated, setHydrated] = useState(false);
    const hydratedRef = useRef<boolean>(false);
    const pendingOutput = useRef<string[]>([]);
    // Batch terminal writes to reduce xterm parse/render overhead
    const writeQueueRef = useRef<string[]>([]);
    const rafIdRef = useRef<number | null>(null);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unlistenRef = useRef<UnlistenFn | null>(null);
    const unlistenPromiseRef = useRef<Promise<UnlistenFn> | null>(null);
    const startAttempts = useRef<Map<string, number>>(new Map());
    const mountedRef = useRef<boolean>(false);
    const startingTerminals = useRef<Map<string, boolean>>(new Map());

    useImperativeHandle(ref, () => ({
        focus: () => {
            if (terminal.current) {
                terminal.current.focus();
            }
        }
    }), []);

    // Keep hydratedRef in sync so listeners see the latest state
    useEffect(() => {
        hydratedRef.current = hydrated;
    }, [hydrated]);

    useEffect(() => {
        console.log(`[Terminal ${terminalId}] Mounting/re-mounting terminal component`);
        mountedRef.current = true;
        let cancelled = false;
        if (!termRef.current) {
            console.error(`[Terminal ${terminalId}] No ref available!`);
            return;
        }

        setHydrated(false);
        hydratedRef.current = false;
        pendingOutput.current = [];
        writeQueueRef.current = [];
        if (rafIdRef.current != null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }

        terminal.current = new XTerm({
            theme: {
                background: '#0b1220', // Match bg-panel color from web-ui
                foreground: '#e4e4e7',
                cursor: '#e4e4e7',
                black: '#1e293b',
                red: '#ef4444',
                green: '#22c55e',
                yellow: '#eab308',
                blue: '#3b82f6',
                magenta: '#a855f7',
                cyan: '#06b6d4',
                white: '#e4e4e7',
                brightBlack: '#475569',
                brightRed: '#f87171',
                brightGreen: '#86efac',
                brightYellow: '#fde047',
                brightBlue: '#60a5fa',
                brightMagenta: '#c084fc',
                brightCyan: '#67e8f9',
                brightWhite: '#f1f5f9',
            },
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: 13,
            cursorBlink: true,
            scrollback: 10000,
            // Important: Keep TUI control sequences intact (e.g., from cursor-agent)
            // Converting EOLs breaks carriage-return based updates and causes visual jumping
            convertEol: false,
        });

        // Add fit addon for proper sizing
        fitAddon.current = new FitAddon();
        terminal.current.loadAddon(fitAddon.current);
        terminal.current.open(termRef.current);

        // Intercept global shortcuts before xterm.js processes them
        terminal.current.attachCustomKeyEventHandler((event: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
            const modifierKey = isMac ? event.metaKey : event.ctrlKey
            
            if (modifierKey && (event.key === 'n' || event.key === 'N')) {
                // Dispatch a custom event to trigger the global new session handler
                window.dispatchEvent(new CustomEvent('global-new-session-shortcut'))
                return false // Prevent xterm.js from processing this event
            }
            if (modifierKey && (event.key === 'r' || event.key === 'R')) {
                // Dispatch a custom event to trigger the global mark reviewed handler
                window.dispatchEvent(new CustomEvent('global-mark-ready-shortcut'))
                return false
            }
            
            return true // Allow xterm.js to process other events
        })
        
        // Helper to ensure element is laid out before fitting
        const isReadyForFit = () => {
            const el = termRef.current;
            return !!el && el.isConnected && el.clientWidth > 0 && el.clientHeight > 0;
        };

        // Do an initial fit via RAF once container is measurable
        const scheduleInitialFit = () => {
            requestAnimationFrame(() => {
                if (!isReadyForFit() || !fitAddon.current) return;
                try {
                    fitAddon.current.fit();
                } catch {
                    // ignore single-shot fit error; RO will retry
                }
            });
        };
        if (isReadyForFit()) {
            scheduleInitialFit();
        }

        const initialCols = terminal.current.cols;
        const initialRows = terminal.current.rows;
        lastSize.current = { cols: initialCols, rows: initialRows };

        // Send initial size to backend immediately
        invoke('resize_terminal', { id: terminalId, cols: initialCols, rows: initialRows }).catch(console.error);

        // Flush queued writes once per frame
        const flushQueuedWrites = () => {
            if (flushTimerRef.current) return;
            // Use a short timeout to coalesce multiple events and be test-friendly with fake timers
            flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                if (!terminal.current || writeQueueRef.current.length === 0) return;
                const chunk = writeQueueRef.current.join('');
                writeQueueRef.current = [];
                terminal.current.write(chunk);
            }, 16);
        };

        // Immediate flush helper (no debounce), used during hydration transitions
        const flushNow = () => {
            if (!terminal.current || writeQueueRef.current.length === 0) return;
            const chunk = writeQueueRef.current.join('');
            writeQueueRef.current = [];
            terminal.current.write(chunk);
        };

        // Listen for terminal output from backend (buffer until hydrated)
        unlistenRef.current = null;
        unlistenPromiseRef.current = listen(`terminal-output-${terminalId}`, (event) => {
            if (cancelled) return;
            const output = event.payload as string;
            if (!hydratedRef.current) {
                pendingOutput.current.push(output);
            } else {
                writeQueueRef.current.push(output);
                flushQueuedWrites();
            }
        }).then((fn) => { unlistenRef.current = fn; return fn; });

        // Hydrate from buffer
        const hydrateTerminal = async () => {
            try {
                console.log(`[Terminal ${terminalId}] Fetching buffer for hydration`);
                const snapshot = await invoke<string>('get_terminal_buffer', { id: terminalId });
                
                if (snapshot) {
                    writeQueueRef.current.push(snapshot);
                }
                // Queue any pending output that arrived during hydration
                if (pendingOutput.current.length > 0) {
                    for (const output of pendingOutput.current) {
                        writeQueueRef.current.push(output);
                    }
                    pendingOutput.current = [];
                }
                setHydrated(true);
                hydratedRef.current = true;
                // Flush immediately to avoid dropping output on rapid remounts/tests
                flushNow();
            } catch (error) {
                console.error(`[Terminal ${terminalId}] Failed to hydrate:`, error);
                // On failure, still shift to live streaming and flush any buffered output to avoid drops
                setHydrated(true);
                hydratedRef.current = true;
                if (pendingOutput.current.length > 0) {
                    for (const output of pendingOutput.current) {
                        writeQueueRef.current.push(output);
                    }
                    pendingOutput.current = [];
                    // Flush immediately; subsequent events will be batched
                    flushNow();
                }
            }
        };

        hydrateTerminal();

        // Send input to backend
        terminal.current.onData((data) => {
            // Gate noisy logs behind a debug flag if needed
            // if (import.meta.env.VITE_DEBUG_TERMINAL) {
            //     console.log(`[Terminal ${terminalId}] Input length=${data.length}`)
            // }
            invoke('write_terminal', { id: terminalId, data }).catch(console.error);
        });

        // Handle terminal resize - only send if size actually changed
        const handleResize = () => {
            if (!fitAddon.current || !terminal.current) return;

            const el = termRef.current;
            if (!el || !el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) {
                return;
            }

            try {
                fitAddon.current.fit();
            } catch (e) {
                console.warn(`[Terminal ${terminalId}] fit() failed during resize; skipping this tick`, e);
                return;
            }
            const { cols, rows } = terminal.current;
            
            // Only send resize if dimensions actually changed
            if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                lastSize.current = { cols, rows };
                invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
            }
        };

        // Use ResizeObserver with a more conservative debounce for better performance
        let resizeTimeout: NodeJS.Timeout | null = null;
        const resizeObserver = new ResizeObserver(() => {
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                handleResize();
            }, 160); // reduce chatter during layout changes
        });
        resizeObserver.observe(termRef.current);
        // Initial fit pass after mount
        const mountTimeout = setTimeout(() => handleResize(), 60);

        // Cleanup - dispose UI but keep terminal process running
        // Terminal processes will be cleaned up when the app exits
        return () => {
            console.log(`[Terminal ${terminalId}] Unmounting terminal component`);
            mountedRef.current = false;
            cancelled = true;
            if (resizeTimeout) clearTimeout(resizeTimeout);
            clearTimeout(mountTimeout);
            // Synchronously detach if possible to avoid races in tests
            const fn = unlistenRef.current;
            if (fn) { try { fn(); } catch { /* ignore */ } }
            else if (unlistenPromiseRef.current) {
                // Detach once promise resolves
                unlistenPromiseRef.current.then((resolved) => { try { resolved(); } catch { /* ignore */ } });
            }
            terminal.current?.dispose();
            terminal.current = null;
            resizeObserver.disconnect();
            setHydrated(false);
            pendingOutput.current = [];
            writeQueueRef.current = [];
            if (rafIdRef.current != null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            // Note: We intentionally don't close terminals here to allow switching between sessions
            // All terminals are cleaned up when the app exits via the backend cleanup handler
        };
    }, [terminalId]); // Only recreate when terminalId changes, not visibility


    // Automatically start Claude for top terminals when hydrated and first ready
    useEffect(() => {
        if (!hydrated) return;
        if (!terminalId.endsWith('-top')) return;
        if (startedGlobal.has(terminalId)) return;

        const start = async () => {
            if (startingTerminals.current.get(terminalId)) {
                return;
            }
            startingTerminals.current.set(terminalId, true);
            try {
                if (isOrchestrator || terminalId === 'orchestrator-top') {
                    const exists = await invoke<boolean>('terminal_exists', { id: terminalId });
                    if (!exists) {
                        const attempts = (startAttempts.current.get(terminalId) || 0) + 1;
                        if (attempts <= 10) {
                            startAttempts.current.set(terminalId, attempts);
                            startingTerminals.current.set(terminalId, false);
                            setTimeout(start, 150);
                            return;
                        }
                        console.warn(`[Terminal ${terminalId}] Terminal not ready after retries; skipping auto-start.`);
                        startingTerminals.current.set(terminalId, false);
                        return;
                    }
                    console.log('[Terminal orchestrator-top] Auto-starting Claude');
                    // Mark as started BEFORE invoking to prevent overlaps
                    startedGlobal.add(terminalId);
                    try {
                        await invoke('para_core_start_claude_orchestrator');
                        console.log(`[Terminal ${terminalId}] Claude started successfully`);
                    } catch (e) {
                        // Roll back start flags on failure to allow retry
                        startedGlobal.delete(terminalId);
                        console.error(`[Terminal ${terminalId}] Failed to start Claude:`, e);
                        throw e;
                    }
                    startingTerminals.current.set(terminalId, false);
                } else {
                    const expectedId = sessionName ? `session-${sessionName}-top` : null;
                    if (!sessionName) {
                        console.warn(`[Terminal ${terminalId}] Missing sessionName prop; cannot start Claude reliably.`);
                        startingTerminals.current.set(terminalId, false);
                        return;
                    }
                    if (expectedId !== terminalId) {
                        console.warn(`[Terminal ${terminalId}] Terminal ID mismatch for session ${sessionName}. Expected ${expectedId}, got ${terminalId}. Skipping auto-start.`);
                        startingTerminals.current.set(terminalId, false);
                        return;
                    }
                    const exists = await invoke<boolean>('terminal_exists', { id: terminalId });
                    if (!exists) {
                        const attempts = (startAttempts.current.get(terminalId) || 0) + 1;
                        if (attempts <= 10) {
                            startAttempts.current.set(terminalId, attempts);
                            startingTerminals.current.set(terminalId, false);
                            setTimeout(start, 150);
                            return;
                        }
                        console.warn(`[Terminal ${terminalId}] Terminal not ready after retries; skipping auto-start.`);
                        startingTerminals.current.set(terminalId, false);
                        return;
                    }
                    console.log(`[Terminal ${terminalId}] Auto-starting Claude for session: ${sessionName}`);
                    // Mark as started BEFORE invoking to prevent overlaps
                    startedGlobal.add(terminalId);
                    try {
                        await invoke('para_core_start_claude', { sessionName });
                        console.log(`[Terminal ${terminalId}] Claude started successfully for session ${sessionName}`);
                    } catch (e) {
                        // Roll back start flags on failure to allow retry
                        startedGlobal.delete(terminalId);
                        console.error(`[Terminal ${terminalId}] Failed to start Claude for session ${sessionName}:`, e);
                        throw e;
                    }
                    startingTerminals.current.set(terminalId, false);
                }
            } catch (error) {
                console.error(`[Terminal ${terminalId}] Failed to auto-start Claude:`, error);
                startingTerminals.current.set(terminalId, false);
            }
        };

        // Delay a tick to ensure xterm is laid out
        const t = setTimeout(start, 0);
        return () => clearTimeout(t);
    }, [hydrated, terminalId]);


    return <div ref={termRef} className={`h-full w-full ${className}`} />;
});

Terminal.displayName = 'Terminal';