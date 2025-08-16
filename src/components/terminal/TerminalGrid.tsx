import { Terminal, TerminalHandle } from './Terminal'
import { TerminalTabs, TerminalTabsHandle } from './TerminalTabs'
import { DraftPlaceholder } from '../drafts/DraftPlaceholder'
import Split from 'react-split'
import { useSelection } from '../../contexts/SelectionContext'
import { useFocus } from '../../contexts/FocusContext'
import { useTerminalUIPreferences } from '../../hooks/useTerminalUIPreferences'
import { useRef, useEffect, useState } from 'react'

export function TerminalGrid() {
    const { selection, terminals, isReady, isDraft } = useSelection()
    const { getFocusForSession, setFocusForSession, currentFocus } = useFocus()
    const { isCollapsed, dividerPosition, setCollapsed, setDividerPosition } = useTerminalUIPreferences()
    const [terminalKey, setTerminalKey] = useState(0)
    const [localFocus, setLocalFocus] = useState<'claude' | 'terminal' | null>(null)
    
    const claudeTerminalRef = useRef<TerminalHandle>(null)
    const terminalTabsRef = useRef<TerminalTabsHandle>(null)
    

    const getSessionKey = () => {
        return selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    }
    
    // Listen for terminal reset events
    useEffect(() => {
        const handleTerminalReset = () => {
            setTerminalKey(prev => prev + 1)
        }
        
        window.addEventListener('schaltwerk:reset-terminals', handleTerminalReset)
        return () => window.removeEventListener('schaltwerk:reset-terminals', handleTerminalReset)
    }, [])

    // Focus appropriate terminal when selection changes
    useEffect(() => {
        if (!selection) return
        
        const sessionKey = getSessionKey()
        const focusArea = getFocusForSession(sessionKey)
        setLocalFocus(focusArea === 'claude' || focusArea === 'terminal' ? focusArea : null)
        
        // Focus the appropriate terminal after a short delay to ensure it's rendered
        setTimeout(() => {
            if (focusArea === 'claude' && claudeTerminalRef.current) {
                claudeTerminalRef.current.focus()
            } else if (focusArea === 'terminal' && terminalTabsRef.current) {
                terminalTabsRef.current.focus()
            }
            // TODO: Add diff focus handling when we implement it
        }, 150)
    }, [selection, getFocusForSession])

    // If global focus changes to claude/terminal, apply it immediately
    useEffect(() => {
        if (!selection || !currentFocus) return
        if (currentFocus === 'claude') {
            setLocalFocus('claude')
            claudeTerminalRef.current?.focus()
        } else if (currentFocus === 'terminal') {
            setLocalFocus('terminal')
            terminalTabsRef.current?.focus()
        } else {
            setLocalFocus(null)
        }
    }, [currentFocus, selection])

    const handleClaudeSessionClick = async () => {
        const sessionKey = getSessionKey()
        setFocusForSession(sessionKey, 'claude')
        setLocalFocus('claude')
        
        // Only focus the terminal, don't restart Claude
        // Claude is already auto-started by the Terminal component when first mounted
        setTimeout(() => {
            claudeTerminalRef.current?.focus()
        }, 100)
    }

    const handleTerminalClick = () => {
        const sessionKey = getSessionKey()
        setFocusForSession(sessionKey, 'terminal')
        setLocalFocus('terminal')
        setTimeout(() => {
            terminalTabsRef.current?.focus()
        }, 100)
    }

    const toggleTerminalCollapsed = () => {
        setCollapsed(!isCollapsed)
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

    // Draft sessions show placeholder instead of terminals
    if (selection.kind === 'session' && isDraft) {
        return (
            <div className="h-full p-2 relative">
                <div className="bg-panel rounded border border-slate-800 overflow-hidden min-h-0 h-full">
                    <DraftPlaceholder />
                </div>
            </div>
        )
    }

    const claudeSection = (
        <div className={`bg-panel rounded overflow-hidden min-h-0 flex flex-col transition-all duration-200 ${localFocus === 'claude' ? 'border-2 border-blue-500/60 shadow-lg shadow-blue-500/20' : 'border border-slate-800'}`}>
            <div 
                className={`h-8 px-3 text-xs border-b cursor-pointer flex-shrink-0 flex items-center justify-between transition-colors duration-200 ${
                    localFocus === 'claude' 
                        ? 'bg-blue-900/30 text-blue-200 border-blue-800/50 hover:bg-blue-900/40' 
                        : 'text-slate-400 border-slate-800 hover:bg-slate-800'
                }`}
                onClick={handleClaudeSessionClick}
            >
                <span className="flex-1 text-center font-medium">
                    {selection.kind === 'orchestrator' ? 'Orchestrator — main repo' : `Session — ${selection.payload ?? ''}`}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded mr-1 transition-colors duration-200 ${
                    localFocus === 'claude' 
                        ? 'bg-blue-600/40 text-blue-200' 
                        : 'bg-slate-700/50 text-slate-400'
                }`} title="Focus Claude (⌘T)">⌘T</span>
            </div>
            <div className={`h-[2px] flex-shrink-0 transition-opacity duration-200 ${
                localFocus === 'claude' 
                    ? 'bg-gradient-to-r from-transparent via-blue-500/50 to-transparent' 
                    : 'bg-gradient-to-r from-transparent via-slate-600/30 to-transparent'
            }`} />
            <div className={`flex-1 min-h-0 ${localFocus === 'claude' ? 'terminal-focused-claude' : ''}`} onClick={handleClaudeSessionClick}>
                <Terminal 
                    key={`top-terminal-${terminalKey}`}
                    ref={claudeTerminalRef}
                    terminalId={terminals.top} 
                    className="h-full w-full" 
                    sessionName={selection.kind === 'session' ? selection.payload ?? undefined : undefined}
                    isOrchestrator={selection.kind === 'orchestrator'}
                />
            </div>
        </div>
    )

    const terminalSection = (
        <div className={`bg-panel rounded border border-slate-800 overflow-hidden min-h-0 flex flex-col ${isCollapsed ? 'hidden' : ''}`}>
            <div 
                className="h-8 px-3 text-xs text-slate-400 border-b border-slate-800 cursor-pointer hover:bg-slate-800 flex-shrink-0 flex items-center justify-between"
                onClick={handleTerminalClick}
            >
                <span className="flex-1 text-center">
                    Terminal — {selection.kind === 'orchestrator' ? 'main' : selection.payload}
                </span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            toggleTerminalCollapsed()
                        }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 hover:bg-slate-600/50 transition-colors"
                        title="Toggle Terminal (⌘B)"
                    >
                        ▲
                    </button>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400" title="Focus Terminal (⌘/)">⌘/</span>
                </div>
            </div>
            <div className="flex-1 min-h-0" onClick={handleTerminalClick}>
                <TerminalTabs
                    key={`terminal-tabs-${terminalKey}`}
                    ref={terminalTabsRef}
                    baseTerminalId={terminals.bottomBase}
                    workingDirectory={terminals.workingDirectory}
                    className="h-full"
                    sessionName={selection.kind === 'session' ? selection.payload : undefined}
                    isOrchestrator={selection.kind === 'orchestrator'}
                />
            </div>
        </div>
    )

    if (isCollapsed) {
        return (
            <div className="h-full px-2 pb-2 pt-0 relative">
                {claudeSection}
                <div className="mt-2 flex justify-center">
                    <button
                        onClick={toggleTerminalCollapsed}
                        className="px-3 py-1 text-xs bg-slate-700/50 text-slate-400 hover:bg-slate-600/50 rounded border border-slate-600 transition-colors flex items-center gap-1"
                        title="Show Terminal (⌘B)"
                    >
                        <span>▼</span>
                        <span>Show Terminal</span>
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="h-full px-2 pb-2 pt-0 relative">
            <Split 
                className="h-full flex flex-col" 
                direction="vertical" 
                sizes={dividerPosition ? [dividerPosition * 100, (1 - dividerPosition) * 100] : [65, 35]} 
                minSize={120} 
                gutterSize={8}
                onDragEnd={(sizes) => {
                    const newPosition = sizes[0] / 100
                    setDividerPosition(newPosition)
                }}
            >
                {claudeSection}
                {terminalSection}
            </Split>

            {/* Prompt dock moved to right diff panel */}
        </div>
    )
}