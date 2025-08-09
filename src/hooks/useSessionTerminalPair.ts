import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Selection {
    kind: 'session' | 'orchestrator'
    payload?: string
    color?: 'blue' | 'green' | 'violet' | 'amber'
}

/**
 * Hook for managing a pair of session-aware terminals (top and bottom)
 * Used by TerminalGrid component
 */
export function useSessionTerminalPair() {
    const [selection, setSelection] = useState<Selection>({ kind: 'orchestrator' })
    const [currentTerminalIds, setCurrentTerminalIds] = useState<{ top: string; bottom: string }>({ 
        top: 'orchestrator-top', 
        bottom: 'orchestrator-bottom' 
    })

    // Create terminals only once when they're first needed
    const ensureTerminalsExist = useCallback(async (ids: { top: string; bottom: string }) => {
        const repoPath = '/Users/marius.wichtner/Documents/git/para/ui' // TODO: Make configurable
        
        const topExists = await invoke<boolean>('terminal_exists', { id: ids.top })
        if (!topExists) {
            console.log(`[TerminalPair] Creating top terminal: ${ids.top}`)
            await invoke('create_terminal', { 
                id: ids.top, 
                cwd: repoPath
            })
            
            console.log(`[TerminalPair] Starting Claude in terminal: ${ids.top}`)
            setTimeout(async () => {
                await invoke('write_terminal', { 
                    id: ids.top, 
                    data: 'claude\r\n'
                }).catch(console.error)
            }, 500)
        }
        
        const bottomExists = await invoke<boolean>('terminal_exists', { id: ids.bottom })
        if (!bottomExists) {
            console.log(`[TerminalPair] Creating bottom terminal: ${ids.bottom}`)
            await invoke('create_terminal', { 
                id: ids.bottom, 
                cwd: repoPath
            })
        }
    }, [])

    useEffect(() => {
        // Initialize first terminals
        ensureTerminalsExist(currentTerminalIds)

        // Listen for selection changes
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as Selection
            setSelection(detail)
            
            // Update terminal IDs based on selection
            const newIds = detail.kind === 'orchestrator' 
                ? { top: 'orchestrator-top', bottom: 'orchestrator-bottom' }
                : { top: `session-${detail.payload}-top`, bottom: `session-${detail.payload}-bottom` }
            
            // Ensure the new terminals exist before switching
            console.log(`[TerminalPair] Switching from ${currentTerminalIds.top}/${currentTerminalIds.bottom} to ${newIds.top}/${newIds.bottom}`)
            ensureTerminalsExist(newIds).then(() => {
                // Switch to the new terminals
                if (newIds.top !== currentTerminalIds.top) {
                    console.log(`[TerminalPair] Terminal IDs updated`)
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
    }, [currentTerminalIds, ensureTerminalsExist])

    return {
        selection,
        currentTerminalIds
    }
}