import React, { useEffect, useRef } from 'react';
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
        fitAddon.current.fit();

        // Listen for terminal output from backend
        const unlisten = listen(`terminal-output-${terminalId}`, (event) => {
            terminal.current?.write(event.payload as string);
        });

        // Send input to backend - use correct command name
        terminal.current.onData((data) => {
            invoke('write_terminal', { id: terminalId, data }).catch(console.error);
        });

        // Handle terminal resize
        const resizeObserver = new ResizeObserver(() => {
            if (fitAddon.current && terminal.current) {
                fitAddon.current.fit();
                const { cols, rows } = terminal.current;
                invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
            }
        });
        resizeObserver.observe(termRef.current);

        // Cleanup - but don't close the terminal process, just clean up the UI
        return () => {
            unlisten.then(fn => fn());
            terminal.current?.dispose();
            resizeObserver.disconnect();
            // Don't close the terminal process - keep it running in background
            // invoke('close_terminal', { id: terminalId }).catch(console.error);
        };
    }, [terminalId]);

    return <div ref={termRef} className={`h-full w-full ${className}`} />;
}