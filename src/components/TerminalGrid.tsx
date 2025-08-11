import { Terminal, TerminalHandle } from './Terminal'
import Split from 'react-split'
import { useSelection } from '../contexts/SelectionContext'
import { useFocus } from '../contexts/FocusContext'
import { useRef, useEffect } from 'react'

export function TerminalGrid() {
    const { selection, terminals } = useSelection()
    const { getFocusForSession, setFocusForSession, currentFocus } = useFocus()
    
    const claudeTerminalRef = useRef<TerminalHandle>(null)
    const regularTerminalRef = useRef<TerminalHandle>(null)
    
    console.log('[TerminalGrid] Current state:', {
        selection,
        terminals,
        isOrchestrator: selection.kind === 'orchestrator'
    })

    const getSessionKey = () => {
        return selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    }

    // Focus appropriate terminal when selection changes
    useEffect(() => {
        if (!selection) return
        
        const sessionKey = getSessionKey()
        const focusArea = getFocusForSession(sessionKey)
        
        console.log('[TerminalGrid] Session changed, focusing:', { sessionKey, focusArea })
        
        // Focus the appropriate terminal after a short delay to ensure it's rendered
        setTimeout(() => {
            if (focusArea === 'claude' && claudeTerminalRef.current) {
                claudeTerminalRef.current.focus()
                console.log('[TerminalGrid] Focused Claude terminal')
            } else if (focusArea === 'terminal' && regularTerminalRef.current) {
                regularTerminalRef.current.focus()
                console.log('[TerminalGrid] Focused regular terminal')
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
        console.log('[TerminalGrid] Claude session tab clicked', selection)
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

    return (
        <div className="h-full p-2">
            <Split className="h-full flex flex-col" direction="vertical" sizes={[65, 35]} minSize={120} gutterSize={8}>
                <div className="bg-panel rounded border border-slate-800 overflow-hidden min-h-0 flex flex-col">
                    <div 
                        className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800 cursor-pointer hover:bg-slate-800 flex-shrink-0 text-center"
                        onClick={handleClaudeSessionClick}
                    >
                        {selection.kind === 'orchestrator' ? 'Orchestrator — main repo' : `Session — ${selection.payload ?? ''}`}
                    </div>
                    <div className="session-header-ruler flex-shrink-0" />
                    <div className="flex-1 min-h-0" onClick={handleClaudeSessionClick}>
                        <Terminal 
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
                        className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800 cursor-pointer hover:bg-slate-800 flex-shrink-0 text-center"
                        onClick={handleTerminalClick}
                    >
                        Terminal — {selection.kind === 'orchestrator' ? 'main' : selection.payload}
                    </div>
                    <div className="flex-1 min-h-0" onClick={handleTerminalClick}>
                        <Terminal 
                            ref={regularTerminalRef}
                            terminalId={terminals.bottom} 
                            className="h-full w-full" 
                        />
                    </div>
                </div>
            </Split>
        </div>
    )
}