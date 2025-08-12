import { useState, useEffect, useMemo, useCallback, startTransition, useRef } from 'react'
import { clsx } from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useFocus } from '../contexts/FocusContext'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { useSelection } from '../contexts/SelectionContext'
import { computeNextSelectedSessionId } from '../utils/selectionNext'
import { MarkReadyConfirmation } from './MarkReadyConfirmation'
import { SessionButton } from './SessionButton'
import { SwitchOrchestratorModal } from './SwitchOrchestratorModal'
import { clearTerminalStartedTracking } from './Terminal'

interface DiffStats {
    files_changed: number
    additions: number
    deletions: number
    insertions: number
}

interface SessionInfo {
    session_id: string
    display_name?: string  // Human-friendly name generated from prompt
    branch: string
    worktree_path: string
    base_branch: string
    merge_mode: string
    status: 'active' | 'dirty' | 'missing' | 'archived'
    created_at?: string
    last_modified?: string
    has_uncommitted_changes?: boolean
    is_current: boolean
    session_type: 'worktree' | 'container'
    container_status?: string
    // Monitor fields
    session_state?: string
    current_task?: string
    todo_percentage?: number
    is_blocked?: boolean
    diff_stats?: DiffStats
    ready_to_merge?: boolean
}

interface EnrichedSession {
    info: SessionInfo
    status?: any // Additional status if available
    terminals: string[]
}


interface TerminalStuckNotification {
    terminal_id: string
    session_id?: string
    elapsed_seconds: number
}

interface TerminalUnstuckNotification {
    terminal_id: string
    session_id?: string
}

interface SidebarProps {
    isDiffViewerOpen?: boolean
}

export function Sidebar({ isDiffViewerOpen }: SidebarProps) {
    const { selection, setSelection, clearTerminalTracking, terminals } = useSelection()
    const { setFocusForSession, setCurrentFocus } = useFocus()
    const [sessions, setSessions] = useState<EnrichedSession[]>([])
    const [filterMode, setFilterMode] = useState<'all' | 'unreviewed' | 'reviewed'>(() => {
        const saved = typeof window !== 'undefined' ? window.localStorage.getItem('schaltwerk:sessions:filterMode') : null
        return (saved === 'unreviewed' || saved === 'reviewed') ? saved : 'all'
    })
    const [sortMode, setSortMode] = useState<'name' | 'created' | 'last-edited'>(() => {
        if (typeof window === 'undefined') return 'name'
        
        try {
            const saved = window.localStorage.getItem('schaltwerk:sessions:sortMode')
            if (saved === 'name' || saved === 'created' || saved === 'last-edited') {
                return saved
            }
        } catch (error) {
            console.warn('Failed to load sort mode from localStorage:', error)
        }
        
        return 'name'
    })
    const [loading, setLoading] = useState(true)
    const [stuckTerminals, setStuckTerminals] = useState<Set<string>>(new Set())
    const [markReadyModal, setMarkReadyModal] = useState<{ open: boolean; sessionName: string; hasUncommitted: boolean }>({
        open: false,
        sessionName: '',
        hasUncommitted: false
    })
    const [switchOrchestratorModal, setSwitchOrchestratorModal] = useState(false)
    const sidebarRef = useRef<HTMLDivElement>(null)
    
    // Extract sorting logic
    const applySortMode = useCallback((sessionList: EnrichedSession[], mode: typeof sortMode) => {
        switch (mode) {
            case 'last-edited':
                // Sort by last modified time (most recent first)
                return [...sessionList].sort((a, b) => {
                    const aTime = a.info.last_modified ? new Date(a.info.last_modified).getTime() : 0
                    const bTime = b.info.last_modified ? new Date(b.info.last_modified).getTime() : 0
                    return bTime - aTime // Most recent first
                })
            case 'created':
                // Sort by creation time (newest first)
                return [...sessionList].sort((a, b) => {
                    const aTime = a.info.created_at ? new Date(a.info.created_at).getTime() : 0
                    const bTime = b.info.created_at ? new Date(b.info.created_at).getTime() : 0
                    
                    // If both have creation times, sort newest first
                    if (aTime && bTime) {
                        return bTime - aTime
                    }
                    // If only one has creation time, it comes first
                    if (aTime) return -1
                    if (bTime) return 1
                    // Otherwise alphabetical
                    return a.info.session_id.localeCompare(b.info.session_id)
                })
            case 'name':
            default:
                // Alphabetical sort by session_id
                return [...sessionList].sort((a, b) => 
                    a.info.session_id.localeCompare(b.info.session_id)
                )
        }
    }, [])
    
    // Memoize displayed sessions (filter + sort) to prevent re-computation on every render
    const sortedSessions = useMemo(() => {
        let filtered = sessions
        if (filterMode === 'unreviewed') {
            filtered = sessions.filter(s => !s.info.ready_to_merge)
        } else if (filterMode === 'reviewed') {
            filtered = sessions.filter(s => !!s.info.ready_to_merge)
        }
        
        // Separate reviewed and unreviewed
        const reviewed = filtered.filter(s => s.info.ready_to_merge)
        const unreviewed = filtered.filter(s => !s.info.ready_to_merge)
        
        // Apply sorting to each group
        const sortedUnreviewed = applySortMode(unreviewed, sortMode)
        const sortedReviewed = applySortMode(reviewed, 'name') // Always sort reviewed by name
        
        // Unreviewed on top, reviewed at bottom
        return [...sortedUnreviewed, ...sortedReviewed]
    }, [sessions, filterMode, sortMode, applySortMode])

    const handleSelectOrchestrator = async () => {
        await setSelection({ kind: 'orchestrator' })
    }

    const handleSelectSession = async (index: number) => {
        const session = sortedSessions[index]
        if (session) {
            const s = session.info
            
            // Clear stuck terminal indicator when user selects the session
            setStuckTerminals(prev => {
                const updated = new Set(prev)
                updated.delete(s.session_id)
                return updated
            })
            
            // Use startTransition to keep UI responsive during heavy selection changes
            startTransition(() => {
                setSelection({
                    kind: 'session',
                    payload: s.session_id,
                    worktreePath: s.worktree_path
                })
            })
        }
    }

    const handleCancelSelectedSession = (immediate: boolean) => {
        if (selection.kind === 'session') {
            const selectedSession = sortedSessions.find(s => s.info.session_id === selection.payload)
            if (selectedSession) {
                if (immediate) {
                    // immediate cancel without modal
                    window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
                        detail: {
                            action: 'cancel-immediate',
                            sessionId: selectedSession.info.session_id,
                            sessionName: selectedSession.info.session_id,
                            sessionDisplayName: selectedSession.info.display_name || selectedSession.info.session_id,
                            branch: selectedSession.info.branch,
                            hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false
                        }
                    }))
                } else {
                    window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
                        detail: {
                            action: 'cancel',
                            sessionId: selectedSession.info.session_id,
                            sessionName: selectedSession.info.session_id,
                            sessionDisplayName: selectedSession.info.display_name || selectedSession.info.session_id,
                            branch: selectedSession.info.branch,
                            hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false
                        }
                    }))
                }
            }
        }
    }

    const selectPrev = async () => {
        if (sortedSessions.length === 0) return
        if (selection.kind === 'session') {
            const currentIndex = sortedSessions.findIndex(s => s.info.session_id === selection.payload)
            // If at the first session, go to orchestrator
            if (currentIndex <= 0) {
                await handleSelectOrchestrator()
                return
            }
            await handleSelectSession(currentIndex - 1)
            return
        }
        // If orchestrator is selected, do nothing on ArrowUp
    }

    const selectNext = async () => {
        if (sortedSessions.length === 0) return
        if (selection.kind === 'orchestrator') {
            // From orchestrator, go to the first session
            await handleSelectSession(0)
            return
        }
        if (selection.kind === 'session') {
            const currentIndex = sortedSessions.findIndex(s => s.info.session_id === selection.payload)
            const nextIndex = Math.min(currentIndex + 1, sortedSessions.length - 1)
            if (nextIndex !== currentIndex) {
                await handleSelectSession(nextIndex)
            }
            return
        }
    }

    const handleMarkSelectedSessionReady = () => {
        if (selection.kind === 'session') {
            const selectedSession = sortedSessions.find(s => s.info.session_id === selection.payload)
            if (selectedSession && !selectedSession.info.ready_to_merge) {
                setMarkReadyModal({
                    open: true,
                    sessionName: selectedSession.info.session_id,
                    hasUncommitted: selectedSession.info.has_uncommitted_changes || false
                })
            }
        }
    }

    useKeyboardShortcuts({
        onSelectOrchestrator: handleSelectOrchestrator,
        onSelectSession: handleSelectSession,
        onCancelSelectedSession: handleCancelSelectedSession,
        onMarkSelectedSessionReady: handleMarkSelectedSessionReady,
        sessionCount: sortedSessions.length,
        onSelectPrevSession: selectPrev,
        onSelectNextSession: selectNext,
        onFocusSidebar: () => {
            setCurrentFocus('sidebar')
            // Focus the first button in the sidebar
            setTimeout(() => {
                const button = sidebarRef.current?.querySelector('button')
                if (button instanceof HTMLElement) {
                    button.focus()
                }
            }, 50)
        },
        onFocusClaude: () => {
            const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : (selection.payload || 'unknown')
            setFocusForSession(sessionKey, 'claude')
            setCurrentFocus('claude')
            // This will trigger TerminalGrid's currentFocus effect immediately
        },
        onOpenDiffViewer: () => {
            // Only open if a session is selected
            if (selection.kind !== 'session') return
            window.dispatchEvent(new CustomEvent('schaltwerk:open-diff-view'))
        },
        onFocusTerminal: () => {
            const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : (selection.payload || 'unknown')
            setFocusForSession(sessionKey, 'terminal')
            setCurrentFocus('terminal')
        },
        isDiffViewerOpen
    })

    // Persist user preferences
    useEffect(() => {
        try { window.localStorage.setItem('schaltwerk:sessions:filterMode', filterMode) } catch {}
    }, [filterMode])
    
    useEffect(() => {
        try {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem('schaltwerk:sessions:sortMode', sortMode)
            }
        } catch (error) {
            console.warn('Failed to save sort mode to localStorage:', error)
        }
    }, [sortMode])

    // Initial load only; push updates keep it fresh thereafter
    useEffect(() => {
        const addTimestamps = (arr: EnrichedSession[]): EnrichedSession[] => {
            return arr.map(s => ({
                ...s,
                info: {
                    ...s.info,
                    last_modified_ts: s.info.last_modified ? Date.parse(s.info.last_modified) : undefined,
                }
            }))
        }

        const loadSessions = async () => {
            try {
                const result = await invoke<EnrichedSession[]>('para_core_list_enriched_sessions')
                setSessions(addTimestamps(result))
            } catch (err) {
                console.error('Failed to load sessions:', err)
            } finally {
                setLoading(false)
            }
        }

        loadSessions()
    }, [])
    
    // Listen for sessions-refreshed events (e.g., after name generation)
    useEffect(() => {
        const setupRefreshListener = async () => {
            const unlisten = await listen<EnrichedSession[]>('schaltwerk:sessions-refreshed', (event) => {
                setSessions(event.payload.map(s => ({
                    ...s,
                    info: {
                        ...s.info,
                        last_modified_ts: s.info.last_modified ? Date.parse(s.info.last_modified) : undefined,
                    }
                })))
            })
            
            return () => {
                unlisten()
            }
        }
        
        const cleanup = setupRefreshListener()
        return () => {
            cleanup.then(fn => fn())
        }
    }, [])
    
    // Global shortcut from terminal for Mark Reviewed (⌘R)
    useEffect(() => {
        const handler = () => handleMarkSelectedSessionReady()
        window.addEventListener('global-mark-ready-shortcut', handler as any)
        return () => window.removeEventListener('global-mark-ready-shortcut', handler as any)
    }, [selection, sortedSessions])

    // Selection is now restored by SelectionContext itself

    // No longer need to listen for events - context handles everything

    // Keep latest values in refs for use in event handlers without re-attaching listeners
    const latestSelectionRef = useRef(selection)
    const latestSortedSessionsRef = useRef(sortedSessions)

    useEffect(() => { latestSelectionRef.current = selection }, [selection])
    useEffect(() => { latestSortedSessionsRef.current = sortedSessions }, [sortedSessions])

    // Subscribe to backend push updates and merge into sessions list incrementally
    useEffect(() => {
        let unlisteners: UnlistenFn[] = []

        const attach = async () => {
            // Activity updates (last_modified)
            const u1 = await listen<{
                session_id: string
                session_name: string
                last_activity_ts: number
            }>('schaltwerk:session-activity', (event) => {
                const { session_name, last_activity_ts } = event.payload
                setSessions(prev => prev.map(s => {
                    if (s.info.session_id !== session_name) return s
                    return {
                        ...s,
                        info: {
                            ...s.info,
                            last_modified: new Date(last_activity_ts * 1000).toISOString(),
                            last_modified_ts: last_activity_ts * 1000,
                        }
                    }
                }))
            })
            unlisteners.push(u1)
            
            // Git stats updates
            const u2 = await listen<{
                session_id: string
                session_name: string
                files_changed: number
                lines_added: number
                lines_removed: number
                has_uncommitted: boolean
            }>('schaltwerk:session-git-stats', (event) => {
                const { session_name, files_changed, lines_added, lines_removed, has_uncommitted } = event.payload
                setSessions(prev => prev.map(s => {
                    if (s.info.session_id !== session_name) return s
                    const diff = {
                        files_changed: files_changed || 0,
                        additions: lines_added || 0,
                        deletions: lines_removed || 0,
                        insertions: lines_added || 0,
                    }
                    return {
                        ...s,
                        info: {
                            ...s.info,
                            diff_stats: diff,
                            has_uncommitted_changes: has_uncommitted,
                        }
                    }
                }))
            })
            unlisteners.push(u2)

            // Session added
            const u3 = await listen<{
                session_name: string
                branch: string
                worktree_path: string
                parent_branch: string
            }>('schaltwerk:session-added', (event) => {
                const { session_name, branch, worktree_path, parent_branch } = event.payload
                setSessions(prev => {
                    // Avoid duplicates
                    if (prev.some(s => s.info.session_id === session_name)) return prev
                    const info: SessionInfo = {
                        session_id: session_name,
                        branch,
                        worktree_path,
                        base_branch: parent_branch,
                        merge_mode: 'rebase',
                        status: 'active',
                        last_modified: undefined,
                        has_uncommitted_changes: false,
                        is_current: false,
                        session_type: 'worktree',
                        container_status: undefined,
                        session_state: 'active',
                        current_task: undefined,
                        todo_percentage: undefined,
                        is_blocked: undefined,
                        diff_stats: undefined,
                        ready_to_merge: false,
                    }
                    const terminals = [
                        `session-${session_name}-top`,
                        `session-${session_name}-bottom`,
                        `session-${session_name}-right`,
                    ]
                    const enriched: EnrichedSession = { info, status: undefined, terminals }
                    // Add new session without re-sorting - will be sorted by memo
                    return [enriched, ...prev]
                })
            })
            unlisteners.push(u3)

            // Session removed
            const u4 = await listen<{ session_name: string }>('schaltwerk:session-removed', async (event) => {
                const { session_name } = event.payload
                const currentSelection = latestSelectionRef.current
                const currentSorted = latestSortedSessionsRef.current
                const currentSelectedId = currentSelection.kind === 'session' ? (currentSelection.payload || null) : null
                const nextSelectionId = computeNextSelectedSessionId(currentSorted, session_name, currentSelectedId)

                setSessions(prev => prev.filter(s => s.info.session_id !== session_name))

                if (currentSelectedId === session_name) {
                    if (nextSelectionId) {
                        await setSelection({ kind: 'session', payload: nextSelectionId })
                    } else {
                        await setSelection({ kind: 'orchestrator' })
                    }
                }
            })
            unlisteners.push(u4)
            
            // Listen for stuck terminal notifications
            const u5 = await listen<TerminalStuckNotification>('schaltwerk:terminal-stuck', (event) => {
                const { session_id } = event.payload
                if (session_id) {
                    setStuckTerminals(prev => new Set([...prev, session_id]))
                }
            })
            unlisteners.push(u5)
            
            // Listen for unstuck terminal notifications
            const u6 = await listen<TerminalUnstuckNotification>('schaltwerk:terminal-unstuck', (event) => {
                const { session_id } = event.payload
                if (session_id) {
                    setStuckTerminals(prev => {
                        const updated = new Set(prev)
                        updated.delete(session_id)
                        return updated
                    })
                }
            })
            unlisteners.push(u6)
        }
        attach()
        
        return () => {
            unlisteners.forEach(unlisten => {
                try {
                    if (typeof unlisten === 'function') unlisten()
                } catch (e) {
                    console.warn('Failed to unlisten sidebar event', e)
                }
            })
        }
    // Attach once on mount; use refs above for latest values inside handlers
    }, [setSelection])

    return (
        <div ref={sidebarRef} className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-slate-800 text-sm text-slate-300">Repository (Orchestrator)</div>
            <div className="px-2 pt-2">
                <button
                    onClick={handleSelectOrchestrator}
                    className={clsx('w-full text-left px-3 py-2 rounded-md mb-1 group', selection.kind === 'orchestrator' ? 'bg-slate-800/60 session-ring session-ring-blue' : 'hover:bg-slate-800/30')}
                    title="Select orchestrator (⌘1)"
                >
                    <div className="flex items-center justify-between">
                        <div className="font-medium text-slate-100">main (orchestrator)</div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">⌘1</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">main repo</span>
                    </div>
                    </div>
                    <div className="text-xs text-slate-500">Original repository from which sessions are created</div>
                </button>
                <button
                    onClick={() => setSwitchOrchestratorModal(true)}
                    className="w-full text-left px-3 py-1.5 rounded-md mb-2 hover:bg-slate-800/30 group"
                    title="Switch orchestrator model"
                >
                    <div className="flex items-center gap-2 text-xs">
                        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        <span className="text-slate-400">Switch Model</span>
                    </div>
                </button>
            </div>

            <div className="px-3 py-2 border-t border-b border-slate-800 text-sm text-slate-300 flex items-center gap-2">
                <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs">Sessions {sortedSessions.length > 0 && <span className="text-slate-500">({sortedSessions.length})</span>}</span>
                </div>
                <div className="flex items-center gap-0.5 ml-auto">
                    <button
                        className={clsx('text-[10px] px-1.5 py-0.5 rounded', filterMode === 'all' ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                        onClick={() => setFilterMode('all')}
                        title="Show all sessions"
                    >All</button>
                    <button
                        className={clsx('text-[10px] px-1.5 py-0.5 rounded', filterMode === 'unreviewed' ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                        onClick={() => setFilterMode('unreviewed')}
                        title="Show only unreviewed sessions"
                    >New</button>
                    <button
                        className={clsx('text-[10px] px-1.5 py-0.5 rounded', filterMode === 'reviewed' ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                        onClick={() => setFilterMode('reviewed')}
                        title="Show only reviewed sessions"
                    >Reviewed</button>
                    <button
                        className="px-1.5 py-0.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-white flex items-center gap-0.5"
                        onClick={() => {
                            // Cycle through: name -> created -> last-edited -> name
                            const nextMode = sortMode === 'name' ? 'created' : 
                                           sortMode === 'created' ? 'last-edited' : 'name'
                            setSortMode(nextMode)
                        }}
                        title={`Sort: ${sortMode === 'name' ? 'Name (A-Z)' : sortMode === 'created' ? 'Creation Time' : 'Last Edited'}`}
                    >
                        {/* Sort icon - compact */}
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                        {/* Compact text indicator */}
                        <span className="text-[9px] font-medium leading-none">
                            {sortMode === 'name' ? 'A-Z' : sortMode === 'created' ? 'New' : 'Edit'}
                        </span>
                    </button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pt-2">
                {loading ? (
                    <div className="text-center text-slate-500 py-4">Loading sessions...</div>
                ) : sortedSessions.length === 0 ? (
                    <div className="text-center text-slate-500 py-4">No active sessions</div>
                ) : (
                    sortedSessions.map((session, i) => {
                        const isSelected = selection.kind === 'session' && selection.payload === session.info.session_id
                        const hasStuckTerminals = stuckTerminals.has(session.info.session_id)

                        return (
                            <SessionButton
                                key={`c-${session.info.session_id}`}
                                session={session}
                                index={i}
                                isSelected={isSelected}
                                hasStuckTerminals={hasStuckTerminals}
                                onSelect={handleSelectSession}
                                onMarkReady={(sessionId, hasUncommitted) => {
                                    setMarkReadyModal({
                                        open: true,
                                        sessionName: sessionId,
                                        hasUncommitted
                                    })
                                }}
                                onUnmarkReady={async (sessionId) => {
                                    try {
                                        await invoke('para_core_unmark_session_ready', { name: sessionId })
                                        const result = await invoke<EnrichedSession[]>('para_core_list_enriched_sessions')
                                        setSessions(result)
                                    } catch (err) {
                                        console.error('Failed to unmark reviewed session:', err)
                                    }
                                }}
                                onCancel={(sessionId, hasUncommitted) => {
                                    window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
                                        detail: {
                                            action: 'cancel',
                                            sessionId,
                                            sessionName: sessionId,
                                            sessionDisplayName: session.info.display_name || session.info.session_id,
                                            branch: session.info.branch,
                                            hasUncommittedChanges: hasUncommitted
                                        }
                                    }))
                                }}
                            />
                        )
                    })
                )}
            </div>
            <MarkReadyConfirmation
                open={markReadyModal.open}
                sessionName={markReadyModal.sessionName}
                hasUncommittedChanges={markReadyModal.hasUncommitted}
                onClose={() => setMarkReadyModal({ open: false, sessionName: '', hasUncommitted: false })}
                onSuccess={async () => {
                    // Reload sessions
                    const result = await invoke<EnrichedSession[]>('para_core_list_enriched_sessions')
                    setSessions(result)
                }}
            />
            <SwitchOrchestratorModal
                open={switchOrchestratorModal}
                onClose={() => setSwitchOrchestratorModal(false)}
                onSwitch={async (agentType) => {
                    // Get current orchestrator terminal IDs from the selection context
                    const orchestratorTerminals = [terminals.top, terminals.bottom]
                    // Also try to close any 'right' terminal if it exists
                    const allTerminals = [...orchestratorTerminals]
                    if (terminals.top) {
                        // Generate the right terminal ID based on the same pattern
                        const rightId = terminals.top.replace('-top', '-right')
                        allTerminals.push(rightId)
                    }
                    
                    // First close existing orchestrator terminals
                    for (const terminalId of allTerminals) {
                        try {
                            const exists = await invoke<boolean>('terminal_exists', { id: terminalId })
                            if (exists) {
                                await invoke('close_terminal', { id: terminalId })
                            }
                        } catch (e) {
                            console.error(`Failed to close terminal ${terminalId}:`, e)
                        }
                    }
                    
                    // Clear terminal tracking so they can be recreated
                    clearTerminalTracking(allTerminals)
                    
                    // Also clear the Terminal component's global started tracking
                    clearTerminalStartedTracking(allTerminals)
                    
                    // Update the agent type preference
                    await invoke('para_core_set_agent_type', { agentType })
                    
                    // Close the modal
                    setSwitchOrchestratorModal(false)
                    
                    // Dispatch event to reset terminals UI
                    window.dispatchEvent(new Event('para-ui:reset-terminals'))
                    
                    // Small delay to ensure terminals are closed before recreating
                    setTimeout(async () => {
                        // Force recreate terminals with new model
                        await setSelection({ kind: 'orchestrator' }, true)
                    }, 200)
                }}
            />
        </div>
    )
}