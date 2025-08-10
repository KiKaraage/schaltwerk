import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface MarkReadyConfirmationProps {
  open: boolean
  sessionName: string
  hasUncommittedChanges: boolean
  onClose: () => void
  onSuccess: () => void
}

export function MarkReadyConfirmation({ 
  open, 
  sessionName, 
  hasUncommittedChanges, 
  onClose,
  onSuccess 
}: MarkReadyConfirmationProps) {
  const [autoCommit, setAutoCommit] = useState(true)
  const [loading, setLoading] = useState(false)
  
  const handleConfirm = useCallback(async () => {
    if (loading) return
    if (hasUncommittedChanges && !autoCommit) return
    
    setLoading(true)
    try {
      const success = await invoke<boolean>('para_core_mark_session_ready', {
        name: sessionName,
        autoCommit: hasUncommittedChanges ? autoCommit : false
      })
      
      if (success) {
        onSuccess()
        onClose()
      } else {
        alert('Session has uncommitted changes. Please commit them first or enable auto-commit.')
      }
    } catch (error) {
      console.error('Failed to mark session as ready:', error)
      alert(`Failed to mark session as ready: ${error}`)
    } finally {
      setLoading(false)
    }
  }, [loading, hasUncommittedChanges, autoCommit, sessionName, onSuccess, onClose])
  
  useEffect(() => {
    if (!open) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleConfirm()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, handleConfirm])
  
  if (!open) return null
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold mb-4">Mark Session as Ready</h2>
        
        <p className="text-slate-300 mb-4">
          Marking <span className="font-mono text-blue-400">{sessionName}</span> as ready for merge.
        </p>
        
        {hasUncommittedChanges && (
          <div className="bg-amber-950/50 border border-amber-800 rounded p-3 mb-4">
            <p className="text-amber-200 text-sm mb-3">
              ⚠ This session has uncommitted changes
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoCommit}
                onChange={(e) => setAutoCommit(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-300">
                Automatically commit all changes with message "Mark session {sessionName} as ready for merge"
              </span>
            </label>
          </div>
        )}
        
        <p className="text-slate-400 text-sm mb-6">
          Ready sessions will be moved to the bottom of the list and visually marked as complete. 
          They can be merged to the main branch when convenient.
        </p>
        
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded transition-colors disabled:opacity-50 group"
            title="Cancel (Esc)"
          >
            Cancel
            <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || (hasUncommittedChanges && !autoCommit)}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
            title="Mark as ready (Enter)"
          >
            {loading ? 'Marking...' : 'Mark as Ready'}
            {!loading && <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>}
          </button>
        </div>
      </div>
    </div>
  )
}