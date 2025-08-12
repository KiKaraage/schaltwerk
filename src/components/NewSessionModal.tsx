import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { useClaudeSession } from '../hooks/useClaudeSession'
import { generateDockerStyleName } from '../utils/dockerNames'
import { invoke } from '@tauri-apps/api/core'
import { BranchAutocomplete } from './BranchAutocomplete'

interface Props {
    open: boolean
    onClose: () => void
    onCreate: (data: {
        name: string
        prompt?: string
        baseBranch: string
        userEditedName?: boolean
    }) => void | Promise<void>
}

export function NewSessionModal({ open, onClose, onCreate }: Props) {
    const [name, setName] = useState(() => generateDockerStyleName())
    const [, setWasEdited] = useState(false)
    const [prompt, setPrompt] = useState('')
    const [baseBranch, setBaseBranch] = useState('')
    const [branches, setBranches] = useState<string[]>([])
    const [loadingBranches, setLoadingBranches] = useState(false)
    const [skipPermissions, setSkipPermissions] = useState(false)
    const [agentType, setAgentType] = useState<'claude' | 'cursor'>('claude')
    const [validationError, setValidationError] = useState('')
    const [creating, setCreating] = useState(false)
    const { getSkipPermissions, setSkipPermissions: saveSkipPermissions, getAgentType, setAgentType: saveAgentType } = useClaudeSession()
    const nameInputRef = useRef<HTMLInputElement>(null)
    const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
    const wasEditedRef = useRef(false)
    const createRef = useRef<() => void>(() => {})
    const initialGeneratedNameRef = useRef<string>('')

    const handleSkipPermissionsChange = async (checked: boolean) => {
        setSkipPermissions(checked)
        await saveSkipPermissions(checked)
    }

    const handleAgentTypeChange = async (type: 'claude' | 'cursor') => {
        setAgentType(type)
        await saveAgentType(type)
    }

    const validateSessionName = useCallback((sessionName: string): string | null => {
        if (!sessionName.trim()) {
            return 'Session name is required'
        }
        if (sessionName.length > 100) {
            return 'Session name must be 100 characters or less'
        }
        if (!/^[a-zA-Z0-9_\- ]+$/.test(sessionName)) {
            return 'Session name can only contain letters, numbers, hyphens, and underscores'
        }
        return null
    }, [])

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value
        setName(newName)
        setWasEdited(true)
        wasEditedRef.current = true
        
        // Clear validation error when user starts typing again
        if (validationError) {
            setValidationError('')
        }
    }

    const handleCreate = useCallback(async () => {
        if (creating) return
        // Read directly from input when available to avoid any stale state in tests
        const currentValue = nameInputRef.current?.value ?? name
        // Generate new name if current value is empty
        let finalName = currentValue.trim() || generateDockerStyleName()
        
        const error = validateSessionName(finalName)
        if (error) {
            setValidationError(error)
            return
        }
        
        // Validate that base branch is selected
        if (!baseBranch) {
            setValidationError('Please select a base branch')
            return
        }
        
        // Replace spaces with underscores for the actual session name
        finalName = finalName.replace(/ /g, '_')
        
        const userEdited = wasEditedRef.current || (
            initialGeneratedNameRef.current && currentValue.trim() !== initialGeneratedNameRef.current
        )

        try {
            setCreating(true)
            
            // Save the selected branch as the project default for next time
            await invoke('set_project_default_base_branch', { branch: baseBranch })
                .catch(err => console.warn('Failed to save default branch:', err))
            
            await Promise.resolve(onCreate({
                name: finalName,
                prompt: prompt || undefined,
                baseBranch,
                // If user touched the input, treat name as manually edited
                userEditedName: !!userEdited,
            }))
            // On success the parent will close the modal; no need to reset creating here
        } catch (_e) {
            // Parent handles showing the error; re-enable to allow retry
            setCreating(false)
        }
    }, [creating, name, prompt, baseBranch, onCreate, validateSessionName])

    // Keep ref in sync immediately on render to avoid stale closures in tests
    createRef.current = handleCreate

    useLayoutEffect(() => {
        if (open) {
            setCreating(false)
            // Generate a fresh Docker-style name each time the modal opens
            const gen = generateDockerStyleName()
            initialGeneratedNameRef.current = gen
            setName(gen)
            setWasEdited(false)
            wasEditedRef.current = false
            setPrompt('')
            setValidationError('')
            
            // Fetch available branches and the project-specific default branch
            setLoadingBranches(true)
            Promise.all([
                invoke<string[]>('list_project_branches'),
                invoke<string | null>('get_project_default_base_branch'),
                invoke<string>('get_project_default_branch')
            ])
                .then(([branchList, savedDefaultBranch, gitDefaultBranch]) => {
                    setBranches(branchList)
                    // Use saved default if available, otherwise use git default
                    const defaultBranch = savedDefaultBranch || gitDefaultBranch
                    setBaseBranch(defaultBranch)
                })
                .catch(err => {
                    console.warn('Failed to get branches:', err)
                    setBranches([])
                    setBaseBranch('')
                })
                .finally(() => setLoadingBranches(false))
            
            getSkipPermissions().then(setSkipPermissions)
            getAgentType().then(type => setAgentType(type as 'claude' | 'cursor'))
            
            // Focus the prompt textarea when modal opens
            setTimeout(() => {
                promptTextareaRef.current?.focus()
            }, 100)
        }
    }, [open, getSkipPermissions, getAgentType])

    useEffect(() => {
        if (!open) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
            } else if (e.key === 'Enter' && e.metaKey) {
                e.preventDefault()
                // Use ref to ensure latest state is used when creating
                createRef.current()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [open, onClose])

    if (!open) return null

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
            <div className="w-[720px] max-w-[95vw] bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 text-slate-200 font-medium">Start new Schaltwerk session</div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Session name</label>
                        <input 
                            ref={nameInputRef}
                            value={name} 
                            onChange={handleNameChange} 
                            onFocus={() => { setWasEdited(true); wasEditedRef.current = true }}
                            onKeyDown={() => { setWasEdited(true); wasEditedRef.current = true }}
                            onInput={() => { setWasEdited(true); wasEditedRef.current = true }}
                            className={`w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border ${
                                validationError ? 'border-red-500' : 'border-slate-700'
                            }`} 
                            placeholder={name || "e.g. eager_cosmos"} 
                        />
                        {validationError && (
                            <p className="text-xs text-red-400 mt-1">{validationError}</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Initial prompt (optional)</label>
                        <textarea 
                            ref={promptTextareaRef}
                            value={prompt} 
                            onChange={e => setPrompt(e.target.value)} 
                            className="w-full h-28 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700" 
                            placeholder="Describe the task for the Claude session" 
                        />
                        <p className="text-xs text-slate-400 mt-1">Equivalent to: schaltwerk start &lt;name&gt; -p "&lt;prompt&gt;"</p>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-sm text-slate-300 mb-1">Base branch</label>
                            {loadingBranches ? (
                                <input 
                                    value="Loading branches..." 
                                    disabled
                                    className="w-full bg-slate-800 text-slate-500 rounded px-3 py-2 border border-slate-700" 
                                />
                            ) : (
                                <BranchAutocomplete
                                    value={baseBranch}
                                    onChange={setBaseBranch}
                                    branches={branches}
                                    disabled={branches.length === 0}
                                    placeholder={branches.length === 0 ? "No branches available" : "Type to search branches..."}
                                />
                            )}
                            <p className="text-xs text-slate-400 mt-1">Branch from which to create the worktree</p>
                        </div>
                        <div>
                            <label className="block text-sm text-slate-300 mb-1">Agent</label>
                            <div className="flex gap-2">
                                <button 
                                    type="button" 
                                    onClick={() => handleAgentTypeChange('claude')} 
                                    className={`px-3 py-1.5 text-sm rounded border ${agentType === 'claude' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                                >
                                    Claude
                                </button>
                                <button 
                                    type="button" 
                                    onClick={() => handleAgentTypeChange('cursor')} 
                                    className={`px-3 py-1.5 text-sm rounded border ${agentType === 'cursor' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                                >
                                    Cursor
                                </button>
                            </div>
                            <p className="text-xs text-slate-400 mt-1">AI agent to use for this session</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <input id="skipPerms" type="checkbox" checked={skipPermissions} onChange={e => handleSkipPermissionsChange(e.target.checked)} />
                            <label htmlFor="skipPerms" className="text-sm text-slate-300">{agentType === 'cursor' ? 'Force flag' : 'Skip permissions'}</label>
                        </div>
                    </div>
                </div>
                <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
                    <button 
                        onClick={onClose} 
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded group relative"
                        title="Cancel (Esc)"
                    >
                        Cancel
                        <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
                    </button>
                    <button 
                        onClick={handleCreate} 
                        disabled={!name.trim() || !baseBranch || creating}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-white group relative inline-flex items-center gap-2"
                        title="Create session (Cmd+Enter)"
                    >
                        {creating && (
                            <span
                                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                                aria-hidden="true"
                            />
                        )}
                        <span>Create</span>
                        {!creating && <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">⌘↵</span>}
                    </button>
                </div>
            </div>
        </div>
    )
}


