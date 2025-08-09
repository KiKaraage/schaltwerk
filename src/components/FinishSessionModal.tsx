import React, { useState, useEffect } from 'react'

interface FinishSessionModalProps {
  open: boolean
  sessionName: string
  onConfirm: (message: string, branch?: string) => void
  onCancel: () => void
}

export function FinishSessionModal({ open, sessionName, onConfirm, onCancel }: FinishSessionModalProps) {
  const [message, setMessage] = useState('')
  const [customBranch, setCustomBranch] = useState('')

  useEffect(() => {
    if (!open) {
      setMessage('')
      setCustomBranch('')
    }
  }, [open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (message.trim()) {
      onConfirm(message.trim(), customBranch.trim() || undefined)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold mb-4 text-zinc-100">
          Finish Session: {sessionName}
        </h2>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Commit Message
            </label>
            <textarea 
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Describe what was implemented (required)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              autoFocus
              required
            />
          </div>
          
          <div className="mb-6">
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Custom Branch Name
            </label>
            <input 
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Leave empty for auto-generated name"
              value={customBranch}
              onChange={(e) => setCustomBranch(e.target.value)}
            />
          </div>
          
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-md hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!message.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-green-700 rounded-md hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              Finish Session
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}