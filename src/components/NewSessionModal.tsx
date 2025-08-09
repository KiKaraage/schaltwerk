import { useState } from 'react'

interface Props {
    open: boolean
    onClose: () => void
    onCreate: (data: {
        name: string
        prompt?: string
        baseBranch: string
        dangerousSkipPermissions: boolean
        sandboxEnabled: boolean
        sandboxProfile?: string
        color: 'green' | 'violet' | 'amber'
    }) => void
}

export function NewSessionModal({ open, onClose, onCreate }: Props) {
    const [name, setName] = useState('')
    const [prompt, setPrompt] = useState('')
    const [baseBranch, setBaseBranch] = useState('main')
    const [dangerousSkipPermissions, setDangerous] = useState(false)
    const [sandboxEnabled, setSandbox] = useState(false)
    const [sandboxProfile, setSandboxProfile] = useState('standard')
    const [color, setColor] = useState<'green' | 'violet' | 'amber'>('green')
    const [validationError, setValidationError] = useState('')

    const validateSessionName = (sessionName: string): string | null => {
        if (!sessionName.trim()) {
            return 'Session name is required'
        }
        if (sessionName.length > 100) {
            return 'Session name must be 100 characters or less'
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
            return 'Session name can only contain letters, numbers, hyphens, and underscores'
        }
        return null
    }

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value
        setName(newName)
        
        // Clear validation error when user starts typing again
        if (validationError) {
            setValidationError('')
        }
    }

    const handleCreate = () => {
        const error = validateSessionName(name)
        if (error) {
            setValidationError(error)
            return
        }
        
        onCreate({ 
            name, 
            prompt: prompt || undefined, 
            baseBranch, 
            dangerousSkipPermissions, 
            sandboxEnabled, 
            sandboxProfile: sandboxEnabled ? sandboxProfile : undefined, 
            color 
        })
    }

    if (!open) return null

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
            <div className="w-[720px] max-w-[95vw] bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 text-slate-200 font-medium">Start new Para session</div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Session name</label>
                        <input 
                            value={name} 
                            onChange={handleNameChange} 
                            className={`w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border ${
                                validationError ? 'border-red-500' : 'border-slate-700'
                            }`} 
                            placeholder="e.g. eager_cosmos" 
                        />
                        {validationError && (
                            <p className="text-xs text-red-400 mt-1">{validationError}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-1">Only letters, numbers, hyphens, and underscores allowed</p>
                    </div>

                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Initial prompt (optional)</label>
                        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} className="w-full h-28 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700" placeholder="Describe the task for the Claude session" />
                        <p className="text-xs text-slate-400 mt-1">Equivalent to: para start &lt;name&gt; -p "&lt;prompt&gt;"</p>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-sm text-slate-300 mb-1">Base branch</label>
                            <input value={baseBranch} onChange={e => setBaseBranch(e.target.value)} className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700" />
                            <p className="text-xs text-slate-400 mt-1">--branch from which to create the worktree</p>
                        </div>
                        <div>
                            <label className="block text-sm text-slate-300 mb-1">Session color</label>
                            <div className="flex gap-2">
                                {(['green', 'violet', 'amber'] as const).map(c => (
                                    <button key={c} type="button" onClick={() => setColor(c)} className={`w-8 h-8 rounded-full border ${color === c ? 'ring-2 ring-offset-2 ring-slate-300' : ''}`} style={{ backgroundColor: c === 'green' ? '#22c55e' : c === 'violet' ? '#8b5cf6' : '#f59e0b' }} />
                                ))}
                            </div>
                            <p className="text-xs text-slate-400 mt-1">Used for the session ring and accents</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <input id="dangerous" type="checkbox" checked={dangerousSkipPermissions} onChange={e => setDangerous(e.target.checked)} />
                            <label htmlFor="dangerous" className="text-sm text-slate-300">Dangerous: skip permissions</label>
                        </div>
                        <div className="flex items-center gap-2">
                            <input id="sandbox" type="checkbox" checked={sandboxEnabled} onChange={e => setSandbox(e.target.checked)} />
                            <label htmlFor="sandbox" className="text-sm text-slate-300">Sandbox enabled</label>
                        </div>
                    </div>

                    {sandboxEnabled && (
                        <div>
                            <label className="block text-sm text-slate-300 mb-1">Sandbox profile</label>
                            <select value={sandboxProfile} onChange={e => setSandboxProfile(e.target.value)} className="bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700">
                                <option value="standard">standard</option>
                                <option value="permissive">permissive</option>
                            </select>
                            <p className="text-xs text-slate-400 mt-1">Matches para sandbox profiles</p>
                        </div>
                    )}
                </div>
                <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded">Cancel</button>
                    <button 
                        onClick={handleCreate} 
                        disabled={!name.trim()}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-white"
                    >
                        Create
                    </button>
                </div>
            </div>
        </div>
    )
}


