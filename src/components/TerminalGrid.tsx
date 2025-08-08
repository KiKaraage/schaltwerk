import React, { useEffect, useState } from 'react'
import Split from 'react-split'
import { Terminal } from './Terminal'
import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'

export function TerminalGrid() {
    const [selection, setSelection] = useState<{ kind: 'session' | 'orchestrator', payload?: string }>({ kind: 'orchestrator' })
    const [terminalIds, setTerminalIds] = useState<{ top: string; bottom: string }>({ 
        top: 'orchestrator-top', 
        bottom: 'orchestrator-bottom' 
    })

    useEffect(() => {
        // Initialize terminals with proper working directories
        const initTerminals = async () => {
            const home = await homeDir()
            const repoPath = '/Users/marius.wichtner/Documents/git/para' // TODO: Get from para integration
            
            // Create top terminal (for Claude/AI agent)
            await invoke('create_terminal', { 
                id: terminalIds.top, 
                cwd: selection.kind === 'orchestrator' ? repoPath : `${repoPath}/worktrees/${selection.payload}`
            }).catch(console.error)
            
            // Create bottom terminal (for user)
            await invoke('create_terminal', { 
                id: terminalIds.bottom, 
                cwd: selection.kind === 'orchestrator' ? repoPath : `${repoPath}/worktrees/${selection.payload}`
            }).catch(console.error)
        }
        
        initTerminals()

        // Listen for selection changes
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { kind: 'session' | 'orchestrator', payload?: string, color?: 'blue' | 'green' | 'violet' | 'amber' }
            setSelection(detail)
            
            // Update terminal IDs based on selection
            const newIds = detail.kind === 'orchestrator' 
                ? { top: 'orchestrator-top', bottom: 'orchestrator-bottom' }
                : { top: `session-${detail.payload}-top`, bottom: `session-${detail.payload}-bottom` }
            
            if (newIds.top !== terminalIds.top) {
                // Close old terminals and create new ones
                invoke('close_terminal', { id: terminalIds.top }).catch(console.error)
                invoke('close_terminal', { id: terminalIds.bottom }).catch(console.error)
                setTerminalIds(newIds)
            }
            
            // Update the center unified ring color to match selection
            const el = document.getElementById('work-ring')
            if (el) {
                const map: Record<string, string> = {
                    blue: 'rgba(59,130,246,0.45)',
                    green: 'rgba(34,197,94,0.45)',
                    violet: 'rgba(139,92,246,0.45)',
                    amber: 'rgba(245,158,11,0.45)'
                }
                const color = detail.kind === 'orchestrator' ? map.blue : map[detail.color || 'green']
                el.style.boxShadow = `0 0 0 2px ${color}`
            }
        }
        window.addEventListener('para-ui:selection', handler as any)
        return () => window.removeEventListener('para-ui:selection', handler as any)
    }, [terminalIds])

    return (
        <div className="h-full p-2">
            <Split className="h-full flex flex-col gap-2" direction="vertical" sizes={[70, 30]} minSize={120} gutterSize={8}>
                <div className={"bg-panel rounded border border-slate-800 overflow-hidden"}>
                    <div className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800">
                        {selection.kind === 'orchestrator' ? 'Orchestrator — main repo' : `Claude session — ${selection.payload ?? ''}`}
                    </div>
                    <div className="session-header-ruler" />
                    <Terminal terminalId={terminalIds.top} className="h-full min-h-[180px]" />
                </div>
                <div className={"bg-panel rounded border border-slate-800 overflow-hidden"}>
                    <div className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800">
                        Terminal — {selection.kind === 'orchestrator' ? 'main' : selection.payload}
                    </div>
                    <Terminal terminalId={terminalIds.bottom} className="h-full min-h-[140px]" />
                </div>
            </Split>
        </div>
    )
}