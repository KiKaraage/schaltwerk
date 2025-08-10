import { Terminal, TerminalHandle } from './Terminal'
import { useSelection } from '../contexts/SelectionContext'
import { useClaudeSession } from '../hooks/useClaudeSession'
import { useFocus } from '../contexts/FocusContext'
import { useRef, useEffect } from 'react'

export function TerminalGrid() {
    const { selection, terminals } = useSelection()
    const { startClaude } = useClaudeSession()
    const { getFocusForSession, setFocusForSession } = useFocus()
    
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

    const handleClaudeSessionClick = async () => {
        console.log('[TerminalGrid] Claude session tab clicked', selection)
        const sessionKey = getSessionKey()
        setFocusForSession(sessionKey, 'claude')
        
        if (selection.kind === 'orchestrator') {
            console.log('[TerminalGrid] Starting Claude for orchestrator')
            const result = await startClaude({ isOrchestrator: true })
            console.log('[TerminalGrid] Claude start result:', result)
        } else if (selection.payload) {
            console.log('[TerminalGrid] Starting Claude for session:', selection.payload)
            const result = await startClaude({ sessionName: selection.payload })
            console.log('[TerminalGrid] Claude start result:', result)
        }
        
        // Focus the Claude terminal
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
        <div className="h-full flex flex-col p-2 gap-2">
            <div className="flex-[2] bg-panel rounded border border-slate-800 overflow-hidden min-h-0 flex flex-col">
                <div 
                    className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800 cursor-pointer hover:bg-slate-800 flex-shrink-0"
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
            <div className="flex-1 bg-panel rounded border border-slate-800 overflow-hidden min-h-0 flex flex-col">
                <div 
                    className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800 cursor-pointer hover:bg-slate-800 flex-shrink-0"
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
        </div>
    )
}