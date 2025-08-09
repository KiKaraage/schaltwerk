import Split from 'react-split'
import { Terminal } from './Terminal'
import { useSessionTerminalPair } from '../hooks/useSessionTerminalPair'

export function TerminalGrid() {
    const { selection, currentTerminalIds } = useSessionTerminalPair()

    return (
        <div className="h-full p-2">
            <Split className="h-full flex flex-col gap-2" direction="vertical" sizes={[70, 30]} minSize={120} gutterSize={8}>
                <div className={"bg-panel rounded border border-slate-800 overflow-hidden"}>
                    <div className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800">
                        {selection.kind === 'orchestrator' ? 'Orchestrator — main repo' : `Claude session — ${selection.payload ?? ''}`}
                    </div>
                    <div className="session-header-ruler" />
                    <Terminal terminalId={currentTerminalIds.top} className="h-full min-h-[180px]" />
                </div>
                <div className={"bg-panel rounded border border-slate-800 overflow-hidden"}>
                    <div className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800">
                        Terminal — {selection.kind === 'orchestrator' ? 'main' : selection.payload}
                    </div>
                    <Terminal terminalId={currentTerminalIds.bottom} className="h-full min-h-[140px]" />
                </div>
            </Split>
        </div>
    )
}