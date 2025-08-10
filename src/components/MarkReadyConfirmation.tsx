import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ConfirmModal } from './ConfirmModal'

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
  
  if (!open) return null

  const body = (
    <div>
      <p className="text-slate-300 mb-4">
        Marking <span className="font-mono text-blue-400">{sessionName}</span> as ready for merge.
      </p>
      {hasUncommittedChanges && (
        <div className="bg-amber-950/50 border border-amber-800 rounded p-3 mb-4">
          <p className="text-amber-200 text-sm mb-3">⚠ This session has uncommitted changes</p>
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
      <p className="text-slate-400 text-sm">
        Ready sessions will be moved to the bottom of the list and visually marked as complete. They can be merged later.
      </p>
    </div>
  )

  return (
    <ConfirmModal
      open={open}
      title={"Mark Session as Ready"}
      body={body}
      confirmText={loading ? 'Marking…' : 'Mark as Ready'}
      confirmTitle="Mark as ready (Enter)"
      cancelText="Cancel"
      cancelTitle="Cancel (Esc)"
      onConfirm={handleConfirm}
      onCancel={onClose}
      confirmDisabled={loading || (hasUncommittedChanges && !autoCommit)}
      loading={loading}
      variant="success"
    />
  )
}