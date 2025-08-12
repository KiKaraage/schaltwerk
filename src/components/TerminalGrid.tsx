import { Terminal, TerminalHandle } from './Terminal'
import Split from 'react-split'
import { useSelection } from '../contexts/SelectionContext'
import { useFocus } from '../contexts/FocusContext'
import { useRef, useEffect, useState } from 'react'
import { UiEvents } from '../events'

export function TerminalGrid() {
    const { selection, terminals, isReady } = useSelection()
    const { getFocusForSession, setFocusForSession, currentFocus } = useFocus()
    const [terminalKey, setTerminalKey] = useState(0)
    
    const claudeTerminalRef = useRef<TerminalHandle>(null)
    const regularTerminalRef = useRef<TerminalHandle>(null)
    

    const getSessionKey = () => {
        return selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    }
    
    // Listen for terminal reset events
    useEffect(() => {
        const handleTerminalReset = () => {
            setTerminalKey(prev => prev + 1)
        }
        
        window.addEventListener(UiEvents.resetTerminals as any, handleTerminalReset)
        return () => window.removeEventListener(UiEvents.resetTerminals as any, handleTerminalReset)
    }, [])

    // Focus appropriate terminal when selection changes
    useEffect(() => {
        if (!selection) return
        
        const sessionKey = getSessionKey()
        const focusArea = getFocusForSession(sessionKey)
        
        
        // Focus the appropriate terminal after a short delay to ensure it's rendered
        setTimeout(() => {
            if (focusArea === 'claude' && claudeTerminalRef.current) {
                claudeTerminalRef.current.focus()
            } else if (focusArea === 'terminal' && regularTerminalRef.current) {
                regularTerminalRef.current.focus()
            }
            // TODO: Add diff focus handling when we implement it
        }, 150)
    }, [selection, getFocusForSession])

    // If global focus changes to claude/terminal, apply it immediately
    useEffect(() => {
        if (!selection || !currentFocus) return
        if (currentFocus === 'claude') {
            claudeTerminalRef.current?.focus()
        } else if (currentFocus === 'terminal') {
            regularTerminalRef.current?.focus()
        }
    }, [currentFocus, selection])

    const handleClaudeSessionClick = async () => {
        const sessionKey = getSessionKey()
        setFocusForSession(sessionKey, 'claude')
        
        // Only focus the terminal, don't restart Claude
        // Claude is already auto-started by the Terminal component when first mounted
        setTimeout(() => {
            claudeTerminalRef.current?.focus()
        }, 100)
    }

    const handleTerminalClick = () => {
        const sessionKey = getSessionKey()
        setFocusForSession(sessionKey, 'terminal')
        setTimeout(() => {
            regularTerminalRef.current?.focus()
        }, 100)
    }

    // No prompt UI here anymore; moved to right panel dock

    // Don't render terminals until selection is ready
    if (!isReady) {
        return (
            <div className="h-full p-2 relative flex items-center justify-center">
                <div className="text-slate-500 text-sm">Initializing terminals...</div>
            </div>
        )
    }

    return (
        <div className="h-full p-2 relative">
            <Split className="h-full flex flex-col" direction="vertical" sizes={[65, 35]} minSize={120} gutterSize={8}>
                <div className="bg-panel rounded border border-slate-800 overflow-hidden min-h-0 flex flex-col">
                    <div 
                        className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800 cursor-pointer hover:bg-slate-800 flex-shrink-0 flex items-center justify-between"
                        onClick={handleClaudeSessionClick}
                    >
                        <span className="flex-1 text-center">
                            {selection.kind === 'orchestrator' ? 'Orchestrator — main repo' : `Session — ${selection.payload ?? ''}`}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 mr-1" title="Focus Claude (⌘T)">⌘T</span>
                    </div>
                    <div className="session-header-ruler flex-shrink-0" />
                    <div className="flex-1 min-h-0" onClick={handleClaudeSessionClick}>
                        <Terminal 
                            key={`${terminals.top}-${terminalKey}`}
                            ref={claudeTerminalRef}
                            terminalId={terminals.top} 
                            className="h-full w-full" 
                            sessionName={selection.kind === 'session' ? selection.payload ?? undefined : undefined}
                            isOrchestrator={selection.kind === 'orchestrator'}
                        />
                    </div>
                </div>
                <div className="bg-panel rounded border border-slate-800 overflow-hidden min-h-0 flex flex-col">
                    <div 
                        className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800 cursor-pointer hover:bg-slate-800 flex-shrink-0 flex items-center justify-between"
                        onClick={handleTerminalClick}
                    >
                        <span className="flex-1 text-center">
                            Terminal — {selection.kind === 'orchestrator' ? 'main' : selection.payload}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 mr-1" title="Focus Terminal (⌘/)">⌘/</span>
                    </div>
                    <div className="flex-1 min-h-0" onClick={handleTerminalClick}>
                        <Terminal 
                            key={`${terminals.bottom}-${terminalKey}`}
                            ref={regularTerminalRef}
                            terminalId={terminals.bottom} 
                            className="h-full w-full" 
                        />
                    </div>
                </div>
            </Split>

            {/* Prompt dock moved to right diff panel */}
        </div>
    )
}