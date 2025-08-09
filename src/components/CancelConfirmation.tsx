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
  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold mb-4 text-zinc-100">
          Cancel Session: {sessionName}?
        </h2>
        
        <p className="text-zinc-300 mb-4">
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
        
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-md hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500"
          >
            Keep Session
          </button>
          <button
            onClick={() => onConfirm(hasUncommittedChanges)}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 ${
              hasUncommittedChanges 
                ? 'bg-red-700 hover:bg-red-600 focus:ring-red-500' 
                : 'bg-amber-700 hover:bg-amber-600 focus:ring-amber-500'
            }`}
          >
            {hasUncommittedChanges ? 'Force Cancel' : 'Cancel Session'}
          </button>
        </div>
      </div>
    </div>
  )
}