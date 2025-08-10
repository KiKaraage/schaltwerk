import Split from 'react-split'
import { Terminal } from './Terminal'
import { useSelection } from '../contexts/SelectionContext'
import { useClaudeSession } from '../hooks/useClaudeSession'

export function TerminalGrid() {
    const { selection, terminals } = useSelection()
    const { startClaude } = useClaudeSession()
    
    console.log('[TerminalGrid] Current state:', {
        selection,
        terminals,
        isOrchestrator: selection.kind === 'orchestrator'
    })

    const handleClaudeSessionClick = async () => {
        console.log('[TerminalGrid] Claude session tab clicked', selection)
        if (selection.kind === 'orchestrator') {
            console.log('[TerminalGrid] Starting Claude for orchestrator')
            const result = await startClaude({ isOrchestrator: true })
            console.log('[TerminalGrid] Claude start result:', result)
        } else if (selection.payload) {
            console.log('[TerminalGrid] Starting Claude for session:', selection.payload)
            const result = await startClaude({ sessionName: selection.payload })
            console.log('[TerminalGrid] Claude start result:', result)
        }
    }

    return (
        <div className="h-full p-2">
            <Split className="h-full flex flex-col gap-2" direction="vertical" sizes={[70, 30]} minSize={120} gutterSize={8}>
                <div className={"bg-panel rounded border border-slate-800 overflow-hidden"}>
                    <div 
                        className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800 cursor-pointer hover:bg-slate-800"
                        onClick={handleClaudeSessionClick}
                    >
                        {selection.kind === 'orchestrator' ? 'Orchestrator — main repo' : `Claude session — ${selection.payload ?? ''}`}
                    </div>
                    <div className="session-header-ruler" />
                    <Terminal 
                        terminalId={terminals.top} 
                        className="h-full min-h-[180px]" 
                        sessionName={selection.kind === 'session' ? selection.payload ?? undefined : undefined}
                        isOrchestrator={selection.kind === 'orchestrator'}
                    />
                </div>
                <div className={"bg-panel rounded border border-slate-800 overflow-hidden"}>
                    <div className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800">
                        Terminal — {selection.kind === 'orchestrator' ? 'main' : selection.payload}
                    </div>
                    <Terminal terminalId={terminals.bottom} className="h-full min-h-[140px]" />
                </div>
            </Split>
        </div>
    )
}