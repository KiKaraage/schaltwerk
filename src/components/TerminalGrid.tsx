import React, { useEffect, useState } from 'react'
import Split from 'react-split'
import { Terminal } from './Terminal'
import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'

export function TerminalGrid() {
    const [selection, setSelection] = useState<{ kind: 'session' | 'orchestrator', payload?: string }>({ kind: 'orchestrator' })
    const [currentTerminalIds, setCurrentTerminalIds] = useState<{ top: string; bottom: string }>({ 
        top: 'orchestrator-top', 
        bottom: 'orchestrator-bottom' 
    })
    const [allTerminals] = useState<Map<string, boolean>>(new Map())

    // Create terminals only once when they're first needed
    const ensureTerminalsExist = async (ids: { top: string; bottom: string }) => {
        const home = await homeDir()
        const repoPath = '/Users/marius.wichtner/Documents/git/para/ui' // Point to UI repo for now
        
        // Create top terminal if it doesn't exist
        if (!allTerminals.has(ids.top)) {
            await invoke('create_terminal', { 
                id: ids.top, 
                cwd: repoPath
            }).catch(console.error)
            allTerminals.set(ids.top, true)
            
            // Auto-start Claude in the top orchestrator terminal
            if (ids.top === 'orchestrator-top') {
                setTimeout(async () => {
                    await invoke('write_terminal', { 
                        id: ids.top, 
                        data: 'claude\r\n'
                    }).catch(console.error)
                }, 500)
            }
        }
        
        // Create bottom terminal if it doesn't exist
        if (!allTerminals.has(ids.bottom)) {
            await invoke('create_terminal', { 
                id: ids.bottom, 
                cwd: repoPath
            }).catch(console.error)
            allTerminals.set(ids.bottom, true)
        }
    }

    useEffect(() => {
        // Initialize first terminals
        ensureTerminalsExist(currentTerminalIds)

        // Listen for selection changes
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { kind: 'session' | 'orchestrator', payload?: string, color?: 'blue' | 'green' | 'violet' | 'amber' }
            setSelection(detail)
            
            // Update terminal IDs based on selection
            const newIds = detail.kind === 'orchestrator' 
                ? { top: 'orchestrator-top', bottom: 'orchestrator-bottom' }
                : { top: `session-${detail.payload}-top`, bottom: `session-${detail.payload}-bottom` }
            
            // Ensure the new terminals exist before switching
            ensureTerminalsExist(newIds).then(() => {
                // Switch to the new terminals
                if (newIds.top !== currentTerminalIds.top) {
                    setCurrentTerminalIds(newIds)
                }
            })
            
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
    }, [currentTerminalIds])

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