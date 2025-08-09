import { Terminal } from './Terminal'
import { useSessionTerminals } from '../hooks/useSessionTerminals'

export function LazyGitPanel() {
    const { selection, currentTerminalId } = useSessionTerminals({
        terminalSuffix: 'right'
    })

    const headerText = selection.kind === 'orchestrator' 
        ? 'Terminal — main'
        : `Terminal — ${selection.payload}`

    return (
        <div className="h-full flex flex-col bg-panel">
            <div className="px-3 py-2 text-sm text-slate-400 border-b border-slate-800">
                {headerText}
            </div>
            <div className="flex-1 overflow-hidden">
                <Terminal terminalId={currentTerminalId} className="h-full" />
            </div>
        </div>
    )
}