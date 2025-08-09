import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Selection {
    kind: 'session' | 'orchestrator'
    payload?: string
    color?: 'blue' | 'green' | 'violet' | 'amber'
}

interface UseSessionTerminalsOptions {
    terminalSuffix: string  // e.g., 'top', 'bottom', 'right'
    autoStartCommand?: string  // Optional command to run on orchestrator terminal creation
}

/**
 * Hook for managing session-aware terminals
 * Handles terminal creation, switching, and lifecycle based on para session selection
 */
export function useSessionTerminals(options: UseSessionTerminalsOptions) {
    const { terminalSuffix, autoStartCommand } = options
    const [selection, setSelection] = useState<Selection>({ kind: 'orchestrator' })
    const [currentTerminalId, setCurrentTerminalId] = useState<string>(`orchestrator-${terminalSuffix}`)

    // Generate terminal ID based on selection
    const getTerminalId = useCallback((sel: Selection) => {
        return sel.kind === 'orchestrator' 
            ? `orchestrator-${terminalSuffix}`
            : `session-${sel.payload}-${terminalSuffix}`
    }, [terminalSuffix])

    // Create terminal only once when first needed
    const ensureTerminalExists = useCallback(async (id: string) => {
        const repoPath = '/Users/marius.wichtner/Documents/git/para/ui' // TODO: Make configurable
        
        const exists = await invoke<boolean>('terminal_exists', { id })
        if (!exists) {
            console.log(`[SessionTerminals] Creating terminal: ${id}`)
            await invoke('create_terminal', { 
                id: id, 
                cwd: repoPath
            })
            
            if (autoStartCommand && id.startsWith('orchestrator-')) {
                setTimeout(async () => {
                    await invoke('write_terminal', { 
                        id: id, 
                        data: autoStartCommand + '\r\n'
                    }).catch(console.error)
                }, 500)
            }
        }
    }, [autoStartCommand])

    useEffect(() => {
        // Initialize first terminal
        ensureTerminalExists(currentTerminalId)

        // Listen for selection changes
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as Selection
            setSelection(detail)
            
            // Update terminal ID based on selection
            const newId = getTerminalId(detail)
            
            // Ensure the new terminal exists before switching
            ensureTerminalExists(newId).then(() => {
                // Switch to the new terminal
                if (newId !== currentTerminalId) {
                    setCurrentTerminalId(newId)
                }
            })
        }
        
        window.addEventListener('para-ui:selection', handler as any)
        return () => window.removeEventListener('para-ui:selection', handler as any)
    }, [currentTerminalId, ensureTerminalExists, getTerminalId])

    return {
        selection,
        currentTerminalId,
        ensureTerminalExists
    }
}