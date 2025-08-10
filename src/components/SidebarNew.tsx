import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from '../contexts/SelectionContext'
import clsx from 'clsx'

interface EnrichedSession {
    info: {
        session_id: string
        current_task?: string
        test_status?: string
        todo_percentage?: number
        diff_stats?: {
            insertions?: number
            additions?: number
            deletions?: number
            files_changed?: number
        }
        last_modified?: string
        is_blocked?: boolean
        worktree_path: string
    }
}

function getSessionStateColor(): 'green' | 'violet' | 'amber' | 'gray' {
    return 'green'
}

function formatLastActivity(lastModified?: string): string {
    if (!lastModified) return 'Unknown'
    
    const now = new Date()
    const modified = new Date(lastModified)
    const diffMs = now.getTime() - modified.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
}

export function SidebarNew() {
    const { selection, setSelection } = useSelection()
    const [sessions, setSessions] = useState<EnrichedSession[]>([])
    const [loading, setLoading] = useState(true)
    
    // Load sessions
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
        
        // Refresh every 5 seconds
        const interval = setInterval(loadSessions, 5000)
        
        return () => clearInterval(interval)
    }, [])
    
    const handleSelectOrchestrator = async () => {
        await setSelection({ kind: 'orchestrator', color: 'blue' })
    }
    
    const handleSelectSession = async (session: EnrichedSession) => {
        const color = getSessionStateColor()
        await setSelection({
            kind: 'session',
            payload: session.info.session_id,
            color,
            worktreePath: session.info.worktree_path
        })
    }
    
    return (
        <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-slate-800 text-sm text-slate-300">Repository (Orchestrator)</div>
            
            <button 
                onClick={handleSelectOrchestrator}
                className={clsx(
                    'mx-3 mt-3 px-3 py-2 rounded-md border transition-all',
                    selection.kind === 'orchestrator'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                        : 'border-slate-800 hover:border-slate-700 text-slate-400'
                )}
            >
                <div className="text-sm font-medium">Orchestrator</div>
                <div className="text-xs opacity-70">Main repository</div>
            </button>
            
            <div className="px-3 pt-4 pb-2 text-xs text-slate-500 font-medium">SESSIONS</div>
            
            <div className="flex-1 overflow-y-auto px-3 pb-3">
                {loading ? (
                    <div className="text-center text-slate-500 py-4">Loading sessions...</div>
                ) : sessions.length === 0 ? (
                    <div className="text-center text-slate-500 py-4">No active sessions</div>
                ) : (
                    sessions.map((session) => {
                        const s = session.info
                        const color = getSessionStateColor()
                        const task = s.current_task || `Working on ${s.session_id}`
                        const testStatus = s.test_status || 'unknown'
                        const progressPercent = s.todo_percentage || 0
                        const lastActivity = formatLastActivity(s.last_modified)
                        const isBlocked = s.is_blocked || false
                        const isSelected = selection.kind === 'session' && selection.payload === s.session_id

                        return (
                            <button
                                key={`session-${s.session_id}`}
                                onClick={() => handleSelectSession(session)}
                                className={clsx('group w-full text-left p-3 rounded-md mb-2 border border-slate-800 bg-slate-900/40',
                                    isSelected
                                        ? clsx('session-ring', 
                                            color === 'green' && 'session-ring-green',
                                            color === 'violet' && 'session-ring-violet',
                                            color === 'amber' && 'session-ring-amber',
                                            color === 'gray' && 'session-ring-gray')
                                        : 'hover:border-slate-700'
                                )}
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <span className={clsx('text-sm font-medium',
                                        isSelected 
                                            ? clsx(
                                                color === 'green' && 'text-green-400',
                                                color === 'violet' && 'text-violet-400',
                                                color === 'amber' && 'text-amber-400',
                                                color === 'gray' && 'text-gray-400'
                                            )
                                            : 'text-slate-300'
                                    )}>
                                        {s.session_id}
                                    </span>
                                    <span className="text-xs text-slate-500">{lastActivity}</span>
                                </div>
                                
                                <div className="text-xs text-slate-400 mb-2 line-clamp-2">{task}</div>
                                
                                <div className="flex items-center gap-2">
                                    {testStatus !== 'unknown' && (
                                        <span className={clsx('text-xs px-1.5 py-0.5 rounded',
                                            testStatus === 'passed' && 'bg-green-500/20 text-green-400',
                                            testStatus === 'failed' && 'bg-red-500/20 text-red-400',
                                            testStatus === 'unknown' && 'bg-slate-500/20 text-slate-400'
                                        )}>
                                            {testStatus}
                                        </span>
                                    )}
                                    
                                    {progressPercent > 0 && (
                                        <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                                            <div 
                                                className={clsx('h-full transition-all',
                                                    color === 'green' && 'bg-green-500',
                                                    color === 'violet' && 'bg-violet-500',
                                                    color === 'amber' && 'bg-amber-500',
                                                    color === 'gray' && 'bg-gray-500'
                                                )}
                                                style={{ width: `${progressPercent}%` }}
                                            />
                                        </div>
                                    )}
                                    
                                    {isBlocked && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                                            blocked
                                        </span>
                                    )}
                                </div>
                            </button>
                        )
                    })
                )}
            </div>
        </div>
    )
}