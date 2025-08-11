import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface Selection {
    kind: 'session' | 'orchestrator'
    payload?: string
    worktreePath?: string
    isNewSession?: boolean  // Flag to indicate this is a newly created session
}

interface TerminalSet {
    top: string
    bottom: string
}

interface SelectionContextType {
    selection: Selection
    terminals: TerminalSet
    setSelection: (selection: Selection) => Promise<void>
    isReady: boolean
}

const SelectionContext = createContext<SelectionContextType | null>(null)

export function SelectionProvider({ children }: { children: React.ReactNode }) {
    const [selection, setSelectionState] = useState<Selection>({ kind: 'orchestrator' })
    const [terminals, setTerminals] = useState<TerminalSet>({
        top: 'orchestrator-top',
        bottom: 'orchestrator-bottom'
    })
    const [isReady, setIsReady] = useState(false)
    
    // Track which terminals we've created to avoid duplicates
    const terminalsCreated = useRef(new Set<string>())
    const creationLock = useRef(new Map<string, Promise<void>>())
    
    // Get terminal IDs for a selection
    const getTerminalIds = useCallback((sel: Selection): TerminalSet => {
        const base = sel.kind === 'orchestrator' ? 'orchestrator' : `session-${sel.payload}`
        return {
            top: `${base}-top`,
            bottom: `${base}-bottom`
        }
    }, [])
    
    // Create a single terminal with deduplication
    const createTerminal = useCallback(async (id: string, cwd: string) => {
        // If already created, skip
        if (terminalsCreated.current.has(id)) {
            return
        }
        
        // If already creating, wait for that to finish
        if (creationLock.current.has(id)) {
            await creationLock.current.get(id)
            return
        }
        
        // Create promise for this creation
        const createPromise = (async () => {
            try {
                const exists = await invoke<boolean>('terminal_exists', { id })
                if (!exists) {
                    console.log(`[SelectionContext] Creating terminal: ${id}`)
                    await invoke('create_terminal', { id, cwd })
                }
                terminalsCreated.current.add(id)
            } catch (error) {
                console.error(`Failed to create terminal ${id}:`, error)
                throw error
            }
        })()
        
        // Store promise so others can wait
        creationLock.current.set(id, createPromise)
        
        try {
            await createPromise
        } finally {
            creationLock.current.delete(id)
        }
    }, [])
    
    // Ensure terminals exist for a selection
    const ensureTerminals = useCallback(async (sel: Selection): Promise<TerminalSet> => {
        const ids = getTerminalIds(sel)
        
        // Determine working directory
        let cwd: string
        if (sel.kind === 'orchestrator') {
            cwd = await invoke<string>('get_current_directory')
        } else if (sel.worktreePath) {
            cwd = sel.worktreePath
        } else {
            // Need to fetch the session data to get worktree path
            try {
                const sessionData = await invoke('para_core_get_session', { 
                    name: sel.payload 
                }) as any
                cwd = sessionData.worktree_path
            } catch (e) {
                console.error('Failed to get session worktree path:', e)
                cwd = await invoke<string>('get_current_directory')
            }
        }
        
        // Create terminals in parallel for better performance
        await Promise.all([
            createTerminal(ids.top, cwd),
            createTerminal(ids.bottom, cwd)
        ])
        
        return ids
    }, [getTerminalIds, createTerminal])
    
    // Set selection atomically
    const setSelection = useCallback(async (newSelection: Selection) => {
        console.log('[SelectionContext] Changing selection to:', newSelection)
        
        // Check if we're actually changing selection (but allow initial setup)
        if (isReady && selection.kind === newSelection.kind && selection.payload === newSelection.payload) {
            console.log('[SelectionContext] Selection unchanged, skipping')
            return
        }
        
        // Mark as not ready during transition
        setIsReady(false)
        
        try {
            // Ensure terminals exist BEFORE changing selection
            const terminalIds = await ensureTerminals(newSelection)
            
            // Now atomically update both selection and terminals
            setSelectionState(newSelection)
            setTerminals(terminalIds)
            
            // Persist to localStorage
            localStorage.setItem('para-ui-selection', JSON.stringify({
                kind: newSelection.kind,
                sessionName: newSelection.payload
            }))
            
            // Mark as ready
            setIsReady(true)
            
            // If this is a new session, start Claude after a short delay
            if (newSelection.isNewSession && newSelection.kind === 'session' && newSelection.payload) {
                console.log('[SelectionContext] Starting Claude for new session:', newSelection.payload)
                setTimeout(async () => {
                    try {
                        const command = await invoke<string>('para_core_get_claude_command', { 
                            sessionName: newSelection.payload 
                        })
                        console.log('[SelectionContext] Claude command:', command)
                        
                        // Write command to terminal
                        await invoke('write_terminal', {
                            id: terminalIds.top,
                            data: `${command}\r`
                        })
                        console.log('[SelectionContext] Claude command sent to terminal')
                    } catch (err) {
                        console.error('[SelectionContext] Failed to start Claude:', err)
                    }
                }, 1000) // Give terminal time to initialize
            }
            
            console.log('[SelectionContext] Selection change complete')
        } catch (error) {
            console.error('[SelectionContext] Failed to set selection:', error)
            // Stay on current selection if we fail
            setIsReady(true)
        }
    }, [ensureTerminals])
    
    // Initialize on mount
    useEffect(() => {
        const initialize = async () => {
            console.log('[SelectionContext] Initializing...')
            
            // Try to restore from localStorage
            const stored = localStorage.getItem('para-ui-selection')
            let initialSelection: Selection = { kind: 'orchestrator' }
            
            if (stored) {
                try {
                    const parsed = JSON.parse(stored)
                    if (parsed.kind === 'session' && parsed.sessionName) {
                        // Get session data to have complete selection
                        try {
                            const sessionData = await invoke('para_core_get_session', { 
                                name: parsed.sessionName 
                            }) as any
                            
                            initialSelection = {
                                kind: 'session',
                                payload: parsed.sessionName,
                                worktreePath: sessionData.worktree_path
                            }
                        } catch (e) {
                            console.warn('Session not found, using orchestrator:', e)
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse stored selection:', e)
                }
            }
            
            // Set the initial selection
            await setSelection(initialSelection)
        }
        
        initialize()
    }, []) // Only run once on mount, setSelection is stable
    
    return (
        <SelectionContext.Provider value={{ 
            selection, 
            terminals,
            setSelection,
            isReady
        }}>
            {children}
        </SelectionContext.Provider>
    )
}

export function useSelection() {
    const context = useContext(SelectionContext)
    if (!context) {
        throw new Error('useSelection must be used within SelectionProvider')
    }
    return context
}