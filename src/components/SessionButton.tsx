import { memo } from 'react'
import { clsx } from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { formatLastActivity } from '../utils/time'

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
    session_state?: string
    current_task?: string
    todo_percentage?: number
    is_blocked?: boolean
    diff_stats?: DiffStats
    ready_to_merge?: boolean
}

interface SessionButtonProps {
    session: {
        info: SessionInfo
        status?: any
        terminals: string[]
    }
    index: number
    isSelected: boolean
    hasStuckTerminals: boolean
    onSelect: (index: number) => void
    onMarkReady: (sessionId: string, hasUncommitted: boolean) => void
    onUnmarkReady: (sessionId: string) => void
    onCancel: (sessionId: string, hasUncommitted: boolean) => void
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

export const SessionButton = memo<SessionButtonProps>(({ 
    session, 
    index, 
    isSelected, 
    hasStuckTerminals,
    onSelect,
    onMarkReady,
    onUnmarkReady,
    onCancel
}) => {
    const s = session.info
    const color = getSessionStateColor(s.session_state)
    const sessionName = s.display_name || s.session_id
    const task = s.current_task || `Working on ${sessionName}`
    const progressPercent = s.todo_percentage || 0
    const additions = s.diff_stats?.insertions || s.diff_stats?.additions || 0
    const deletions = s.diff_stats?.deletions || 0
    const filesChanged = s.diff_stats?.files_changed || 0
    const lastActivity = formatLastActivity(s.last_modified)
    const isBlocked = s.is_blocked || false
    const isReadyToMerge = s.ready_to_merge || false

    return (
        <button
            onClick={() => onSelect(index)}
            className={clsx(
                'group w-full text-left p-3 rounded-md mb-2 border transition-all duration-300',
                isReadyToMerge && !isSelected
                    ? 'session-ring session-ring-green border-transparent opacity-75'
                    : isSelected
                    ? 'session-ring session-ring-blue border-transparent'
                    : 'border-slate-800 bg-slate-900/40 hover:bg-slate-800/30',
                hasStuckTerminals && !isSelected &&
                    'ring-2 ring-amber-400/50 shadow-lg shadow-amber-400/20 bg-amber-950/20'
            )}
            title={isSelected 
                ? `Selected session • Cancel: ⌘D (⇧⌘D force) • Mark Ready: ⌘R` 
                : index < 8 
                    ? `Select session (⌘${index + 2})` 
                    : `Select session`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-100 truncate">
                        {sessionName}
                        {isReadyToMerge && (
                            <span className="ml-2 text-xs text-green-400">
                                ✓ Ready
                            </span>
                        )}
                        {isBlocked && <span className="ml-2 text-xs text-red-400">⚠ blocked</span>}
                        {hasStuckTerminals && !isReadyToMerge && (
                            <span className="ml-2 text-xs text-amber-400" title="Agent is idling and may need input">
                                <div className="inline-flex items-center gap-1">
                                    <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                                    idle
                                </div>
                            </span>
                        )}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{s.branch}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {index < 8 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                            ⌘{index + 2}
                        </span>
                    )}
                </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                {!isReadyToMerge ? (
                    <button 
                        onClick={(e) => {
                            e.stopPropagation()
                            onMarkReady(s.session_id, s.has_uncommitted_changes || false)
                        }}
                        className="text-[11px] px-2 py-0.5 rounded bg-green-800/60 hover:bg-green-700/60"
                        title="Mark as ready for merge (⌘R)"
                    >
                        Mark Ready
                    </button>
                ) : (
                    <button 
                        onClick={async (e) => {
                            e.stopPropagation()
                            onUnmarkReady(s.session_id)
                        }}
                        className="text-[11px] px-2 py-0.5 rounded bg-slate-700/60 hover:bg-slate-600/60"
                        title="Unmark as ready"
                    >
                        Unmark
                    </button>
                )}
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
                        onCancel(s.session_id, s.has_uncommitted_changes || false)
                    }}
                    className="text-[11px] px-2 py-0.5 rounded bg-red-800/60 hover:bg-red-700/60"
                    title="Cancel session (⌘D, ⇧⌘D to force)"
                >
                    Cancel
                </button>
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