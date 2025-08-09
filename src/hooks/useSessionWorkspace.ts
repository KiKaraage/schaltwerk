import { useEffect, useState, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Selection {
    kind: 'session' | 'orchestrator'
    payload?: string
    color?: 'blue' | 'green' | 'violet' | 'amber' | 'gray'
    worktreePath?: string
}

interface WorkspaceTerminals {
    top: string
    bottom: string
    right: string
}

interface SessionWorkspace {
    selection: Selection
    terminals: WorkspaceTerminals
    ensureWorkspaceReady: () => Promise<void>
}

/**
 * Unified hook for managing all session terminals as a workspace.
 * Manages the complete set of terminals (top, bottom, right) for each session.
 */
export function useSessionWorkspace(): SessionWorkspace {
    const [selection, setSelection] = useState<Selection>({ kind: 'orchestrator' })
    const [mainRepoPath, setMainRepoPath] = useState<string>('.')
    const [currentTerminals, setCurrentTerminals] = useState<WorkspaceTerminals>({
        top: 'orchestrator-top',
        bottom: 'orchestrator-bottom',
        right: 'orchestrator-right'
    })
    
    // Track which terminals have been created to avoid duplicate creation
    const createdTerminals = useRef(new Set<string>())
    
    // Generate terminal IDs for a given selection
    const getTerminalIds = useCallback((sel: Selection): WorkspaceTerminals => {
        const prefix = sel.kind === 'orchestrator' ? 'orchestrator' : `session-${sel.payload}`
        return {
            top: `${prefix}-top`,
            bottom: `${prefix}-bottom`,
            right: `${prefix}-right`
        }
    }, [])
    
    // Create a single terminal if it doesn't exist
    const createTerminal = useCallback(async (id: string, cwd: string) => {
        // Check if we've already created or are creating this terminal
        if (createdTerminals.current.has(id)) {
            return
        }
        
        try {
            const exists = await invoke<boolean>('terminal_exists', { id })
            if (!exists) {
                console.log(`[SessionWorkspace] Creating terminal: ${id} in ${cwd}`)
                createdTerminals.current.add(id)
                await invoke('create_terminal', { id, cwd })
                
                // Special handling for orchestrator top terminal - start Claude
                if (id === 'orchestrator-top') {
                    setTimeout(async () => {
                        try {
                            await invoke('write_terminal', { 
                                id, 
                                data: 'claude\r\n'
                            })
                        } catch (err) {
                            console.error(`Failed to start Claude in terminal ${id}:`, err)
                        }
                    }, 500)
                }
            } else {
                // Terminal already exists, add to our tracking
                createdTerminals.current.add(id)
            }
        } catch (err) {
            console.error(`Failed to create terminal ${id}:`, err)
            // Remove from created set on failure so we can retry
            createdTerminals.current.delete(id)
            throw err
        }
    }, [])
    
    // Ensure all terminals for a workspace exist
    const ensureWorkspaceReady = useCallback(async (ids: WorkspaceTerminals, cwd: string) => {
        console.log(`[SessionWorkspace] Ensuring workspace ready with terminals:`, ids, `in ${cwd}`)
        
        // Create all terminals in parallel
        await Promise.all([
            createTerminal(ids.top, cwd),
            createTerminal(ids.bottom, cwd),
            createTerminal(ids.right, cwd)
        ])
    }, [createTerminal])
    
    // Initialize main repo path and orchestrator workspace on mount
    useEffect(() => {
        invoke<string>('get_current_directory').then(path => {
            console.log(`[SessionWorkspace] Main repo path: ${path}`)
            setMainRepoPath(path)
            
            // Initialize orchestrator workspace
            const orchestratorIds = getTerminalIds({ kind: 'orchestrator' })
            ensureWorkspaceReady(orchestratorIds, path).then(() => {
                console.log('[SessionWorkspace] Orchestrator workspace ready')
            })
        }).catch(err => {
            console.error('Failed to get current directory:', err)
            // Fall back to current directory
            const orchestratorIds = getTerminalIds({ kind: 'orchestrator' })
            ensureWorkspaceReady(orchestratorIds, '.')
        })
    }, [getTerminalIds, ensureWorkspaceReady])
    
    // Listen for selection changes
    useEffect(() => {
        const handler = async (e: Event) => {
            const detail = (e as CustomEvent).detail as Selection
            console.log('[SessionWorkspace] Selection changed:', detail)
            
            setSelection(detail)
            
            // Get the terminal IDs for the new selection
            const newIds = getTerminalIds(detail)
            
            // Determine the working directory
            const workingDir = detail.kind === 'orchestrator' 
                ? mainRepoPath 
                : (detail.worktreePath || mainRepoPath)
            
            // Ensure the new workspace exists before switching
            await ensureWorkspaceReady(newIds, workingDir)
            
            // Update current terminals
            setCurrentTerminals(newIds)
            
            // Update the center unified ring color to match selection
            const el = document.getElementById('work-ring')
            if (el) {
                const colorMap: Record<string, string> = {
                    blue: 'rgba(59,130,246,0.45)',
                    green: 'rgba(34,197,94,0.45)',
                    violet: 'rgba(139,92,246,0.45)',
                    amber: 'rgba(245,158,11,0.45)',
                    gray: 'rgba(107,114,128,0.45)'
                }
                const color = detail.kind === 'orchestrator' 
                    ? colorMap.blue 
                    : colorMap[detail.color || 'green']
                el.style.boxShadow = `0 0 0 2px ${color}`
            }
        }
        
        window.addEventListener('para-ui:selection', handler as any)
        return () => window.removeEventListener('para-ui:selection', handler as any)
    }, [getTerminalIds, ensureWorkspaceReady, mainRepoPath])
    
    return {
        selection,
        terminals: currentTerminals,
        ensureWorkspaceReady: async () => {
            const workingDir = selection.kind === 'orchestrator'
                ? mainRepoPath
                : (selection.worktreePath || mainRepoPath)
            await ensureWorkspaceReady(currentTerminals, workingDir)
        }
    }
}