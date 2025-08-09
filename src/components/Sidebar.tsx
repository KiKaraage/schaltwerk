import { useMemo, useState } from 'react'
import { clsx } from 'clsx'

type SessionStatus = 'active' | 'idle' | 'review' | 'stale'

interface SessionInfo {
    name: string
    branch: string
    status: SessionStatus
    lastActivity: string
    task: string
    color: 'green' | 'violet' | 'amber'
    testStatus: 'passed' | 'failed' | 'unknown'
    progressPercent: number
    additions: number
    deletions: number
}

const MOCK_SESSIONS: SessionInfo[] = [
    {
        name: 'eager_cosmos',
        branch: 'feature/cosmos',
        status: 'active',
        lastActivity: '2m',
        task: 'Refactor docker integration tests',
        color: 'green',
        testStatus: 'passed',
        progressPercent: 80,
        additions: 926,
        deletions: 1,
    },
    {
        name: 'codex-support',
        branch: 'feat/codex-cli',
        status: 'idle',
        lastActivity: '12m',
        task: 'Add mcp docs sync',
        color: 'amber',
        testStatus: 'unknown',
        progressPercent: 45,
        additions: 296,
        deletions: 250,
    },
    {
        name: 'gemini-cli-support',
        branch: 'feat/gemini-cli',
        status: 'review',
        lastActivity: '1h',
        task: 'Finish squash + branch metadata',
        color: 'violet',
        testStatus: 'failed',
        progressPercent: 67,
        additions: 512,
        deletions: 103,
    },
]

function emitSelection(kind: 'session' | 'orchestrator', payload?: string, color?: 'blue' | 'green' | 'violet' | 'amber') {
    window.dispatchEvent(new CustomEvent('para-ui:selection', { detail: { kind, payload, color } }))
}

export function Sidebar() {
    const [selectedIdx, setSelectedIdx] = useState(0)
    const [selectedKind, setSelectedKind] = useState<'session' | 'orchestrator'>('orchestrator')
    const sessions = useMemo(() => MOCK_SESSIONS, [])

    return (
        <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-slate-800 text-sm text-slate-300">Repository (Orchestrator)</div>
            <div className="px-2 pt-2">
                <button
                    onClick={() => { setSelectedKind('orchestrator'); emitSelection('orchestrator', undefined, 'blue') }}
                    className={clsx('w-full text-left px-3 py-2 rounded-md mb-2', selectedKind === 'orchestrator' ? 'bg-slate-800/60 session-ring session-ring-blue' : 'hover:bg-slate-800/30')}
                >
                    <div className="flex items-center justify-between">
                        <div className="font-medium text-slate-100">main (orchestrator)</div>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">main repo</span>
                    </div>
                    <div className="text-xs text-slate-500">Original repository from which sessions are created</div>
                </button>
            </div>

            <div className="px-3 py-2 border-t border-b border-slate-800 text-sm text-slate-300">Sessions</div>
            <div className="flex-1 overflow-y-auto px-2 pt-2">
                {sessions.map((s, i) => (
                    <button
                        key={`c-${s.name}`}
                        onClick={() => { setSelectedKind('session'); setSelectedIdx(i); emitSelection('session', s.name, s.color === 'green' ? 'green' : s.color === 'violet' ? 'violet' : 'amber') }}
                        className={clsx('group w-full text-left p-3 rounded-md mb-2 border border-slate-800 bg-slate-900/40',
                            selectedKind === 'session' && selectedIdx === i
                                ? clsx('session-ring', s.color === 'green' && 'session-ring-green', s.color === 'violet' && 'session-ring-violet', s.color === 'amber' && 'session-ring-amber')
                                : 'hover:bg-slate-800/30')}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium text-slate-100">{s.name}</div>
                                <div className="text-[11px] text-slate-400">{s.branch}</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span
                                    className={clsx('text-xs px-1.5 py-0.5 rounded', {
                                        'bg-green-600/20 text-green-400': s.status === 'active',
                                        'bg-amber-600/20 text-amber-400': s.status === 'idle',
                                        'bg-violet-600/20 text-violet-400': s.status === 'review',
                                        'bg-slate-600/20 text-slate-400': s.status === 'stale',
                                    })}
                                >
                                    {s.status}
                                </span>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                    <button className="text-[11px] px-2 py-0.5 rounded bg-slate-800/60 hover:bg-slate-700/60">PR</button>
                                    <button className="text-[11px] px-2 py-0.5 rounded bg-slate-800/60 hover:bg-slate-700/60">Finish</button>
                                    <button className="text-[11px] px-2 py-0.5 rounded bg-slate-800/60 hover:bg-slate-700/60">Cancel</button>
                                </div>
                            </div>
                        </div>
                        <div className="mt-2 text-[12px] text-slate-400 truncate">{s.task}</div>
                        <div className="mt-3 h-2 bg-slate-800 rounded">
                            <div className={clsx('h-2 rounded', s.color === 'green' && 'bg-green-500', s.color === 'violet' && 'bg-violet-500', s.color === 'amber' && 'bg-amber-500')} style={{ width: `${s.progressPercent}%` }} />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                            <div>Tests: {s.testStatus}</div>
                            <div>Δ {`+${s.additions}`} {`-${s.deletions}`}</div>
                            <div>Last: {s.lastActivity}</div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    )
}


