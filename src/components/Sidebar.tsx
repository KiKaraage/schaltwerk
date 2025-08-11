import { useState, useEffect, useMemo, startTransition } from 'react'
import { clsx } from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { sortSessions } from '../utils/sessionSort'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useFocus } from '../contexts/FocusContext'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { useSelection } from '../contexts/SelectionContext'
import { computeNextSelectedSessionId } from '../utils/selectionNext'
import { MarkReadyConfirmation } from './MarkReadyConfirmation'
import { SessionButton } from './SessionButton'

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

export function Sidebar() {
    const { selection, setSelection } = useSelection()
    const { setFocusForSession, setCurrentFocus } = useFocus()
    const [sessions, setSessions] = useState<EnrichedSession[]>([])
    const [loading, setLoading] = useState(true)
    const [stuckTerminals, setStuckTerminals] = useState<Set<string>>(new Set())
    const [markReadyModal, setMarkReadyModal] = useState<{ open: boolean; sessionName: string; hasUncommitted: boolean }>({
        open: false,
        sessionName: '',
        hasUncommitted: false
    })
    
    // Memoize sorted sessions to prevent re-sorting on every render
    const sortedSessions = useMemo(() => sortSessions(sessions), [sessions])

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
                    window.dispatchEvent(new CustomEvent('para-ui:session-action', {
                        detail: {
                            action: 'cancel-immediate',
                            sessionId: selectedSession.info.session_id,
                            sessionName: selectedSession.info.session_id,
                            hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false
                        }
                    }))
                } else {
                    window.dispatchEvent(new CustomEvent('para-ui:session-action', {
                        detail: {
                            action: 'cancel',
                            sessionId: selectedSession.info.session_id,
                            sessionName: selectedSession.info.session_id,
                            hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false
                        }
                    }))
                }
            }
        }
    }

    const selectPrev = async () => {
        if (sortedSessions.length === 0) return
        let index = 0
        if (selection.kind === 'session') {
            const currentIndex = sortedSessions.findIndex(s => s.info.session_id === selection.payload)
            index = currentIndex > 0 ? currentIndex - 1 : 0
        }
        await handleSelectSession(index)
    }

    const selectNext = async () => {
        if (sortedSessions.length === 0) return
        let index = 0
        if (selection.kind === 'session') {
            const currentIndex = sortedSessions.findIndex(s => s.info.session_id === selection.payload)
            index = Math.min(currentIndex + 1, sortedSessions.length - 1)
        }
        await handleSelectSession(index)
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
        },
        onFocusClaude: () => {
            const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : (selection.payload || 'unknown')
            setFocusForSession(sessionKey, 'claude')
            // Focus will be applied by TerminalGrid effect
        },
        onOpenDiffViewer: () => {
            // Only open if a session is selected
            if (selection.kind !== 'session') return
            window.dispatchEvent(new CustomEvent('para-ui:open-diff-view'))
        }
    })

    // Initial load only; push updates keep it fresh thereafter
    useEffect(() => {
        const loadSessions = async () => {
            try {
                const result = await invoke<EnrichedSession[]>('para_core_list_enriched_sessions')
                setSessions(result)
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
            const unlisten = await listen<EnrichedSession[]>('para-ui:sessions-refreshed', (event) => {
                console.log('Sessions refreshed event received, updating session list')
                setSessions(event.payload)
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

    // Subscribe to backend push updates and merge into sessions list incrementally
    useEffect(() => {
        let unlisteners: UnlistenFn[] = []
        
        const attach = async () => {
            // Activity updates (last_modified)
            const u1 = await listen<{
                session_id: string
                session_name: string
                last_activity_ts: number
            }>('para-ui:session-activity', (event) => {
                const { session_name, last_activity_ts } = event.payload
                setSessions(prev => prev.map(s => {
                    if (s.info.session_id !== session_name) return s
                    return {
                        ...s,
                        info: {
                            ...s.info,
                            last_modified: new Date(last_activity_ts * 1000).toISOString(),
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
            }>('para-ui:session-git-stats', (event) => {
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
            }>('para-ui:session-added', (event) => {
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
            const u4 = await listen<{ session_name: string }>('para-ui:session-removed', async (event) => {
                const { session_name } = event.payload
                const currentSelectedId = selection.kind === 'session' ? (selection.payload || null) : null
                const nextSelectionId = computeNextSelectedSessionId(sortedSessions, session_name, currentSelectedId)

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
            const u5 = await listen<TerminalStuckNotification>('para-ui:terminal-stuck', (event) => {
                const { session_id } = event.payload
                if (session_id) {
                    setStuckTerminals(prev => new Set([...prev, session_id]))
                }
            })
            unlisteners.push(u5)
            
            // Listen for unstuck terminal notifications
            const u6 = await listen<TerminalUnstuckNotification>('para-ui:terminal-unstuck', (event) => {
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
            unlisteners.forEach(u => u())
        }
    }, [selection, setSelection, sortedSessions])

    return (
        <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-slate-800 text-sm text-slate-300">Repository (Orchestrator)</div>
            <div className="px-2 pt-2">
                <button
                    onClick={handleSelectOrchestrator}
                    className={clsx('w-full text-left px-3 py-2 rounded-md mb-2 group', selection.kind === 'orchestrator' ? 'bg-slate-800/60 session-ring session-ring-blue' : 'hover:bg-slate-800/30')}
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
            </div>

            <div className="px-3 py-2 border-t border-b border-slate-800 text-sm text-slate-300">
                Sessions {sessions.length > 0 && <span className="text-slate-500">({sessions.length})</span>}
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
                                    window.dispatchEvent(new CustomEvent('para-ui:session-action', {
                                        detail: {
                                            action: 'cancel',
                                            sessionId,
                                            sessionName: sessionId,
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
        </div>
    )
}