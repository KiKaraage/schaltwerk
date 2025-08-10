import { useCallback } from 'react'
import { ConfirmModal } from './ConfirmModal'

interface CancelConfirmationProps {
  open: boolean
  sessionName: string
  hasUncommittedChanges: boolean
  onConfirm: (force: boolean) => void
  onCancel: () => void
}

export function CancelConfirmation({ 
  open, 
  sessionName, 
  hasUncommittedChanges, 
  onConfirm, 
  onCancel 
}: CancelConfirmationProps) {
  const handleConfirm = useCallback(() => {
    onConfirm(hasUncommittedChanges)
  }, [onConfirm, hasUncommittedChanges])

  if (!open) return null

  const body = (
    <p className="text-zinc-300">
      This will move the session to the archive.
      {hasUncommittedChanges ? (
        <span className="block mt-2 text-amber-500 font-medium">
          ⚠️ Warning: This session has uncommitted changes that will be lost!
        </span>
      ) : (
        <span className="block mt-2 text-zinc-400">
          All changes in this session have been committed.
        </span>
      )}
    </p>
  )

  return (
    <ConfirmModal
      open={open}
      title={<span>Cancel Session: {sessionName}?</span>}
      body={body}
      confirmText={hasUncommittedChanges ? 'Force Cancel' : 'Cancel Session'}
      confirmTitle="Cancel session (Enter)"
      cancelText="Keep Session"
      cancelTitle="Keep session (Esc)"
      onConfirm={handleConfirm}
      onCancel={onCancel}
      variant={hasUncommittedChanges ? 'danger' : 'warning'}
    />
  )
}