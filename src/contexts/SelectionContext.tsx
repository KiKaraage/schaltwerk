import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useProject } from './ProjectContext'

export interface Selection {
    kind: 'session' | 'orchestrator'
    payload?: string
    worktreePath?: string
}

interface TerminalSet {
    top: string
    bottomBase: string
    workingDirectory: string
}

interface SelectionContextType {
    selection: Selection
    terminals: TerminalSet
    setSelection: (selection: Selection, forceRecreate?: boolean) => Promise<void>
    clearTerminalTracking: (terminalIds: string[]) => void
    isReady: boolean
    isDraft: boolean
}

const SelectionContext = createContext<SelectionContextType | null>(null)

export function SelectionProvider({ children }: { children: React.ReactNode }) {
    const { projectPath } = useProject()
    const [selection, setSelectionState] = useState<Selection>({ kind: 'orchestrator' })
    const [terminals, setTerminals] = useState<TerminalSet>({
        top: 'orchestrator-default-top',
        bottomBase: 'orchestrator-default-bottom',
        workingDirectory: ''
    })
    // Start as not ready, will become ready once we have initialized with a project
    const [isReady, setIsReady] = useState(false)
    const [isDraft, setIsDraft] = useState(false)
    const previousProjectPath = useRef<string | null>(null)
    const hasInitialized = useRef(false)
    
    // Track which terminals we've created to avoid duplicates
    const terminalsCreated = useRef(new Set<string>())
    const creationLock = useRef(new Map<string, Promise<void>>())
    
    // Get terminal IDs for a selection
    const getTerminalIds = useCallback((sel: Selection): TerminalSet => {
        let workingDir = projectPath || ''
        
        if (sel.kind === 'orchestrator') {
            // Make orchestrator terminals project-specific by using project path hash
            // Use a simple hash of the full path to ensure uniqueness
            let projectId = 'default'
            if (projectPath) {
                // Get just the last directory name and combine with a hash for uniqueness
                const dirName = projectPath.split(/[/\\]/).pop() || 'unknown'
                // Simple hash: sum of char codes
                let hash = 0
                for (let i = 0; i < projectPath.length; i++) {
                    hash = ((hash << 5) - hash) + projectPath.charCodeAt(i)
                    hash = hash & hash // Convert to 32bit integer
                }
                projectId = `${dirName}-${Math.abs(hash).toString(16).slice(0, 6)}`
            }
            const base = `orchestrator-${projectId}`
            return {
                top: `${base}-top`,
                bottomBase: `${base}-bottom`,
                workingDirectory: workingDir
            }
        } else {
            const base = `session-${sel.payload}`
            const sessionWorkingDir = sel.worktreePath || workingDir
            return {
                top: `${base}-top`,
                bottomBase: `${base}-bottom`,
                workingDirectory: sessionWorkingDir
            }
        }
    }, [projectPath])
    
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

        // Orchestrator always has terminals and is never a draft
        if (sel.kind === 'orchestrator') {
            setIsDraft(false)
            const cwd = projectPath || await invoke<string>('get_current_directory')
            await createTerminal(ids.top, cwd)
            return ids
        }

        // Sessions: determine if draft and working directory
        try {
            const sessionData = await invoke<any>('para_core_get_session', { name: sel.payload })
            const state: string | undefined = sessionData?.state || sessionData?.session_state
            const worktreePath: string | undefined = sel.worktreePath || sessionData?.worktree_path
            const isDraftSession = state === 'draft'
            setIsDraft(!!isDraftSession)

            if (isDraftSession) {
                // Do not create terminals for drafts
                return ids
            }

            const cwd = worktreePath || await invoke<string>('get_current_directory')
            await createTerminal(ids.top, cwd)
            return ids
        } catch (e) {
            console.error('[SelectionContext] Failed to inspect session state; creating terminals with fallback cwd', e)
            setIsDraft(false)
            const cwd = await invoke<string>('get_current_directory')
            await createTerminal(ids.top, cwd)
            return ids
        }
    }, [getTerminalIds, createTerminal, projectPath])
    
    // Clear terminal tracking for specific terminals
    const clearTerminalTracking = useCallback((terminalIds: string[]) => {
        terminalIds.forEach(id => {
            terminalsCreated.current.delete(id)
            creationLock.current.delete(id)
        })
    }, [])
    
    // Set selection atomically
    const setSelection = useCallback(async (newSelection: Selection, forceRecreate = false) => {
        // Check if we're actually changing selection (but allow initial setup or force recreate)
        if (!forceRecreate && isReady && selection.kind === newSelection.kind && selection.payload === newSelection.payload) {
            return
        }
        
        // Mark as not ready during transition
        setIsReady(false)
        
        try {
            // If forcing recreate, clear terminal tracking first
            if (forceRecreate) {
                const ids = getTerminalIds(newSelection)
                clearTerminalTracking([ids.top])
            }
            
            // Ensure terminals exist BEFORE changing selection
            const terminalIds = await ensureTerminals(newSelection)
            
            // Now atomically update both selection and terminals
            setSelectionState(newSelection)
            setTerminals(terminalIds)
            
            // Persist to localStorage
            localStorage.setItem('schaltwerk-selection', JSON.stringify({
                kind: newSelection.kind,
                sessionName: newSelection.payload
            }))
            
            // Mark as ready
            setIsReady(true)

        } catch (error) {
            console.error('[SelectionContext] Failed to set selection:', error)
            // Stay on current selection if we fail
            setIsReady(true)
        }
    }, [ensureTerminals, getTerminalIds, clearTerminalTracking, isReady, selection])

    // React to backend session refreshes (e.g., draft -> running)
    useEffect(() => {
        let unlisten: (() => void) | null = null
        const attach = async () => {
            try {
                const { listen } = await import('@tauri-apps/api/event')
                unlisten = await listen('schaltwerk:sessions-refreshed', async () => {
                    if (selection.kind !== 'session' || !selection.payload) return
                    try {
                        const sessionData = await invoke<any>('para_core_get_session', { name: selection.payload })
                        const state: string | undefined = sessionData?.state || sessionData?.session_state
                        const nowDraft = state === 'draft'
                        setIsDraft(!!nowDraft)
                        if (!nowDraft) {
                            // Session became running - ensure terminals exist now
                            try { await ensureTerminals(selection) } catch {}
                            // Update terminals state to pick up any new ids (same ids, but ensures UI triggers)
                            setTerminals(getTerminalIds(selection))
                        }
                    } catch (e) {
                        console.warn('[SelectionContext] Failed to refresh current session state after event', e)
                    }
                })
            } catch (e) {
                console.warn('[SelectionContext] Failed to attach sessions-refreshed listener', e)
            }
        }
        attach()
        return () => { try { if (unlisten) unlisten() } catch {} }
    }, [selection, ensureTerminals, getTerminalIds])
    
    // Initialize on mount and when project path changes
    useEffect(() => {
        const initialize = async () => {
            // Wait for projectPath to be set before initializing
            if (!projectPath) {
                return
            }
            
            // Skip if already initialized with same project path
            if (hasInitialized.current && previousProjectPath.current === projectPath) {
                return
            }
            
            // Check if we need to force recreate for orchestrator when changing projects
            const shouldForceRecreate = hasInitialized.current && 
                                       previousProjectPath.current !== null && 
                                       projectPath !== null && 
                                       selection.kind === 'orchestrator'
            
            // Set initialized flag and update previous path
            hasInitialized.current = true
            previousProjectPath.current = projectPath
            
            // Try to restore from localStorage
            const stored = localStorage.getItem('schaltwerk-selection')
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
                            
                            if (sessionData && sessionData.worktree_path) {
                                initialSelection = {
                                    kind: 'session',
                                    payload: parsed.sessionName,
                                    worktreePath: sessionData.worktree_path
                                }
                            } else {
                                console.warn('Session data missing worktree_path, using orchestrator')
                            }
                        } catch (e) {
                            console.warn('Session not found, using orchestrator:', e)
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse stored selection:', e)
                }
            }
            
            // Set the initial selection (force recreate if changing projects)
            await setSelection(initialSelection, shouldForceRecreate)
        }
        
        // Only run if not currently initializing
        initialize().catch(error => {
            console.error('[SelectionContext] Failed to initialize:', error)
            // Still mark as ready even on error so UI doesn't hang
            setIsReady(true)
        })
    }, [projectPath, setSelection]) // Re-run when projectPath changes
    
    return (
        <SelectionContext.Provider value={{ 
            selection, 
            terminals,
            setSelection,
            clearTerminalTracking,
            isReady,
            isDraft
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