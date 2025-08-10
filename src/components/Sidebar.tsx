import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { formatLastActivity } from '../utils/time'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { useSelection } from '../contexts/SelectionContext'

interface DiffStats {
    files_changed: number
    additions: number
    deletions: number
    insertions: number
}

interface SessionInfo {
    session_id: string
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
    test_status?: string
    todo_percentage?: number
    is_blocked?: boolean
    diff_stats?: DiffStats
}

interface EnrichedSession {
    info: SessionInfo
    status?: any // Additional status if available
    terminals: string[]
}

function getSessionStateColor(state?: string): 'green' | 'violet' | 'amber' | 'gray' {
    switch (state) {
        case 'active': return 'green'
        case 'idle': return 'amber'
        case 'review':
        case 'ready': return 'violet'
        case 'stale': 
        default: return 'gray'
    }
}

interface TerminalStuckNotification {
    terminal_id: string
    session_id?: string
    elapsed_seconds: number
}

export function Sidebar() {
    const { selection, setSelection } = useSelection()
    const [sessions, setSessions] = useState<EnrichedSession[]>([])
    const [loading, setLoading] = useState(true)
    const [stuckTerminals, setStuckTerminals] = useState<Set<string>>(new Set())

    const handleSelectOrchestrator = async () => {
        await setSelection({ kind: 'orchestrator', color: 'blue' })
    }

    const handleSelectSession = async (index: number) => {
        const session = sessions[index]
        if (session) {
            const s = session.info
            const color = getSessionStateColor(s.session_state)
            
            // Clear stuck terminal indicator when user selects the session
            setStuckTerminals(prev => {
                const updated = new Set(prev)
                updated.delete(s.session_id)
                return updated
            })
            
            await setSelection({
                kind: 'session',
                payload: s.session_id,
                color: color as any,
                worktreePath: s.worktree_path
            })
        }
    }

    useKeyboardShortcuts({
        onSelectOrchestrator: handleSelectOrchestrator,
        onSelectSession: handleSelectSession,
        sessionCount: sessions.length
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
                        test_status: undefined,
                        todo_percentage: undefined,
                        is_blocked: undefined,
                        diff_stats: undefined,
                    }
                    const terminals = [
                        `session-${session_name}-top`,
                        `session-${session_name}-bottom`,
                        `session-${session_name}-right`,
                    ]
                    const enriched: EnrichedSession = { info, status: undefined, terminals }
                    return [enriched, ...prev]
                })
            })
            unlisteners.push(u3)

            // Session removed
            const u4 = await listen<{ session_name: string }>('para-ui:session-removed', async (event) => {
                const { session_name } = event.payload
                setSessions(prev => prev.filter(s => s.info.session_id !== session_name))
                // If the removed session was selected, fallback to orchestrator
                if (selection.kind === 'session' && selection.payload === session_name) {
                    await setSelection({ kind: 'orchestrator', color: 'blue' })
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
        }
        attach()
        
        return () => {
            unlisteners.forEach(u => u())
        }
    }, [selection, setSelection])

    return (
        <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-slate-800 text-sm text-slate-300">Repository (Orchestrator)</div>
            <div className="px-2 pt-2">
                <button
                    onClick={handleSelectOrchestrator}
                    className={clsx('w-full text-left px-3 py-2 rounded-md mb-2', selection.kind === 'orchestrator' ? 'bg-slate-800/60 session-ring session-ring-blue' : 'hover:bg-slate-800/30')}
                >
                    <div className="flex items-center justify-between">
                        <div className="font-medium text-slate-100">main (orchestrator)</div>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">main repo</span>
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
                ) : sessions.length === 0 ? (
                    <div className="text-center text-slate-500 py-4">No active sessions</div>
                ) : (
                    sessions.map((session, i) => {
                        const s = session.info
                        const state = s.session_state || 'unknown'
                        const color = getSessionStateColor(s.session_state)
                        const task = s.current_task || `Working on ${s.session_id}`
                        const testStatus = s.test_status || 'unknown'
                        const progressPercent = s.todo_percentage || 0
                        const additions = s.diff_stats?.insertions || s.diff_stats?.additions || 0
                        const deletions = s.diff_stats?.deletions || 0
                        const filesChanged = s.diff_stats?.files_changed || 0
                        const lastActivity = formatLastActivity(s.last_modified)
                        const isBlocked = s.is_blocked || false
                        const isSelected = selection.kind === 'session' && selection.payload === s.session_id
                        const hasStuckTerminals = stuckTerminals.has(s.session_id)

                        return (
                            <button
                                key={`c-${s.session_id}`}
                                onClick={() => handleSelectSession(i)}
                                className={clsx('group w-full text-left p-3 rounded-md mb-2 border border-slate-800 bg-slate-900/40 transition-all duration-300',
                                    isSelected
                                        ? clsx('session-ring', 
                                            color === 'green' && 'session-ring-green',
                                            color === 'violet' && 'session-ring-violet',
                                            color === 'amber' && 'session-ring-amber',
                                            color === 'gray' && 'session-ring-gray')
                                        : 'hover:bg-slate-800/30',
                                    hasStuckTerminals && !isSelected && 'ring-2 ring-amber-400/50 shadow-lg shadow-amber-400/20 bg-amber-950/20')}
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="font-medium text-slate-100">
                                            {s.session_id}
                                            {isBlocked && <span className="ml-2 text-xs text-red-400">⚠ blocked</span>}
                                            {hasStuckTerminals && (
                                                <span className="ml-2 text-xs text-amber-400" title="Agent is idling and may need input">
                                                    <div className="inline-flex items-center gap-1">
                                                        <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                                                        idle
                                                    </div>
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-slate-400">{s.branch}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={clsx('text-xs px-1.5 py-0.5 rounded', {
                                                'bg-green-600/20 text-green-400': state === 'active',
                                                'bg-amber-600/20 text-amber-400': state === 'idle',
                                                'bg-violet-600/20 text-violet-400': state === 'review' || state === 'ready',
                                                'bg-slate-600/20 text-slate-400': state === 'stale' || state === 'unknown',
                                            })}
                                        >
                                            {state}
                                        </span>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                            <button 
                                                onClick={async (e) => {
                                                    e.stopPropagation()
                                                    try {
                                                        await invoke('open_in_vscode', { worktreePath: s.worktree_path })
                                                    } catch (err) {
                                                        console.error('Failed to open VSCode:', err)
                                                    }
                                                }}
                                                className="text-[11px] px-2 py-0.5 rounded bg-blue-800/60 hover:bg-blue-700/60"
                                                title="Open in VSCode"
                                            >
                                                VSCode
                                            </button>
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    window.dispatchEvent(new CustomEvent('para-ui:session-action', {
                                                        detail: {
                                                            action: 'cancel',
                                                            sessionId: s.session_id,
                                                            sessionName: s.session_id,
                                                            hasUncommittedChanges: s.has_uncommitted_changes || false
                                                        }
                                                    }))
                                                }}
                                                className="text-[11px] px-2 py-0.5 rounded bg-red-800/60 hover:bg-red-700/60"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-2 text-[12px] text-slate-400 truncate">{task}</div>
                                {progressPercent > 0 && (
                                    <>
                                        <div className="mt-3 h-2 bg-slate-800 rounded">
                                            <div className={clsx('h-2 rounded',
                                                color === 'green' && 'bg-green-500',
                                                color === 'violet' && 'bg-violet-500',
                                                color === 'amber' && 'bg-amber-500',
                                                color === 'gray' && 'bg-slate-500')}
                                                style={{ width: `${progressPercent}%` }}
                                            />
                                        </div>
                                        <div className="mt-1 text-[10px] text-slate-500">{progressPercent}% complete</div>
                                    </>
                                )}
                                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                                    <div className={clsx({
                                        'text-green-400': testStatus === 'passed',
                                        'text-red-400': testStatus === 'failed',
                                        'text-slate-500': testStatus === 'unknown',
                                    })}>
                                        Tests: {testStatus}
                                    </div>
                                    <div>
                                        {filesChanged > 0 && <span>{filesChanged} files, </span>}
                                        <span className="text-green-400">+{additions}</span>{' '}
                                        <span className="text-red-400">-{deletions}</span>
                                    </div>
                                    <div>Last: {lastActivity}</div>
                                </div>
                            </button>
                        )
                    })
                )}
            </div>
        </div>
    )
}