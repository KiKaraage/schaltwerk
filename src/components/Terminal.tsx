import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import 'xterm/css/xterm.css';

interface TerminalProps {
    terminalId: string;
    className?: string;
}

export function Terminal({ terminalId, className = '' }: TerminalProps) {
    const termRef = useRef<HTMLDivElement>(null);
    const terminal = useRef<XTerm | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    const [isVisible, setIsVisible] = useState(true);
    const lastSize = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });

    useEffect(() => {
        if (!termRef.current) return;

        // Create terminal with styling that matches web-ui prototype
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
            convertEol: true,
        });

        // Add fit addon for proper sizing
        fitAddon.current = new FitAddon();
        terminal.current.loadAddon(fitAddon.current);
        terminal.current.open(termRef.current);
        
        // Do an immediate fit to get initial size
        fitAddon.current.fit();
        const initialCols = terminal.current.cols;
        const initialRows = terminal.current.rows;
        lastSize.current = { cols: initialCols, rows: initialRows };
        
        // Send initial size to backend immediately
        invoke('resize_terminal', { id: terminalId, cols: initialCols, rows: initialRows }).catch(console.error);

        // Listen for terminal output from backend
        const unlisten = listen(`terminal-output-${terminalId}`, (event) => {
            if (terminal.current) {
                terminal.current.write(event.payload as string);
            }
        });

        // Send input to backend only if this terminal is visible
        terminal.current.onData((data) => {
            if (isVisible) {
                invoke('write_terminal', { id: terminalId, data }).catch(console.error);
            }
        });

        // Handle terminal resize - only send if size actually changed
        const handleResize = () => {
            if (!fitAddon.current || !terminal.current) return;
            
            fitAddon.current.fit();
            const { cols, rows } = terminal.current;
            
            // Only send resize if dimensions actually changed
            if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                lastSize.current = { cols, rows };
                invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
            }
        };

        // Use ResizeObserver without debouncing for immediate response
        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        resizeObserver.observe(termRef.current);
        
        // Single delayed resize to catch any layout shifts
        const mountTimeout = setTimeout(() => {
            handleResize();
        }, 100);

        // Cleanup - dispose UI but keep terminal process running
        // Terminal processes will be cleaned up when the app exits
        return () => {
            clearTimeout(mountTimeout);
            unlisten.then(fn => fn());
            terminal.current?.dispose();
            resizeObserver.disconnect();
            // Note: We intentionally don't close terminals here to allow switching between sessions
            // All terminals are cleaned up when the app exits via the backend cleanup handler
        };
    }, [terminalId, isVisible]);

    // Add visibility detection using IntersectionObserver
    useEffect(() => {
        if (!termRef.current) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    setIsVisible(entry.isIntersecting);
                });
            },
            { threshold: 0.1 }
        );

        observer.observe(termRef.current);

        return () => {
            observer.disconnect();
        };
    }, []);

    return <div ref={termRef} className={`h-full w-full ${className}`} />;
}