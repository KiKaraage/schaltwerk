import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { formatLastActivity } from '../utils/time'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'

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

function emitSelection(kind: 'session' | 'orchestrator', payload?: string, color?: 'blue' | 'green' | 'violet' | 'amber' | 'gray', worktreePath?: string) {
    window.dispatchEvent(new CustomEvent('para-ui:selection', { detail: { kind, payload, color, worktreePath } }))
}

export function Sidebar() {
    const [selectedIdx, setSelectedIdx] = useState(0)
    const [selectedKind, setSelectedKind] = useState<'session' | 'orchestrator'>('orchestrator')
    const [sessions, setSessions] = useState<EnrichedSession[]>([])
    const [loading, setLoading] = useState(true)

    const handleSelectOrchestrator = () => {
        setSelectedKind('orchestrator')
        emitSelection('orchestrator', undefined, 'blue')
    }

    const handleSelectSession = (index: number) => {
        const session = sessions[index]
        if (session) {
            const s = session.info
            const color = getSessionStateColor(s.session_state)
            setSelectedKind('session')
            setSelectedIdx(index)
            emitSelection('session', s.session_id, color, s.worktree_path)
        }
    }

    useKeyboardShortcuts({
        onSelectOrchestrator: handleSelectOrchestrator,
        onSelectSession: handleSelectSession,
        sessionCount: sessions.length
    })

    useEffect(() => {
        const loadSessions = async () => {
            try {
                const result = await invoke<EnrichedSession[]>('get_para_sessions', { includeArchived: false })
                setSessions(result)
            } catch (err) {
                console.error('Failed to load sessions:', err)
            } finally {
                setLoading(false)
            }
        }

        loadSessions()
        
        // Refresh every 5 seconds
        const interval = setInterval(loadSessions, 5000)
        
        return () => clearInterval(interval)
    }, [])

    return (
        <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-slate-800 text-sm text-slate-300">Repository (Orchestrator)</div>
            <div className="px-2 pt-2">
                <button
                    onClick={handleSelectOrchestrator}
                    className={clsx('w-full text-left px-3 py-2 rounded-md mb-2', selectedKind === 'orchestrator' ? 'bg-slate-800/60 session-ring session-ring-blue' : 'hover:bg-slate-800/30')}
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

                        return (
                            <button
                                key={`c-${s.session_id}`}
                                onClick={() => handleSelectSession(i)}
                                className={clsx('group w-full text-left p-3 rounded-md mb-2 border border-slate-800 bg-slate-900/40',
                                    selectedKind === 'session' && selectedIdx === i
                                        ? clsx('session-ring', 
                                            color === 'green' && 'session-ring-green',
                                            color === 'violet' && 'session-ring-violet',
                                            color === 'amber' && 'session-ring-amber',
                                            color === 'gray' && 'session-ring-gray')
                                        : 'hover:bg-slate-800/30')}
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="font-medium text-slate-100">
                                            {s.session_id}
                                            {isBlocked && <span className="ml-2 text-xs text-red-400">⚠ blocked</span>}
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
                                            <button className="text-[11px] px-2 py-0.5 rounded bg-slate-800/60 hover:bg-slate-700/60">PR</button>
                                            <button className="text-[11px] px-2 py-0.5 rounded bg-slate-800/60 hover:bg-slate-700/60">Finish</button>
                                            <button className="text-[11px] px-2 py-0.5 rounded bg-slate-800/60 hover:bg-slate-700/60">Cancel</button>
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