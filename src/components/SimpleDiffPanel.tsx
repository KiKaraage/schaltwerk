import { DiffFileList } from './DiffFileList'
import { useSelection } from '../contexts/SelectionContext'
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import clsx from 'clsx'

interface SimpleDiffPanelProps {
  onFileSelect: (filePath: string) => void
}

export function SimpleDiffPanel({ onFileSelect }: SimpleDiffPanelProps) {
  const { selection } = useSelection()
  const [dockOpen, setDockOpen] = useState(false)
  const [originalPrompt, setOriginalPrompt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const fetchPrompt = async () => {
      if (selection.kind !== 'session' || !selection.payload) {
        setOriginalPrompt(null)
        return
      }
      setLoading(true)
      try {
        const session = await invoke<any>('para_core_get_session', { name: selection.payload })
        setOriginalPrompt(session?.initial_prompt ?? null)
      } catch (e) {
        console.error('[SimpleDiffPanel] Failed to fetch session prompt:', e)
        setOriginalPrompt(null)
      } finally {
        setLoading(false)
      }
    }
    fetchPrompt()
  }, [selection])

  const canShowDock = selection.kind === 'session' && !!originalPrompt && (originalPrompt?.trim().length ?? 0) > 0
  const sessionLabel = selection.kind === 'session' ? selection.payload : undefined

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      <div className={clsx('flex-1 min-h-0 overflow-hidden transition-[max-height] duration-200')}>
        <DiffFileList onFileSelect={onFileSelect} />
      </div>

      {dockOpen && canShowDock && (
        <div
          className="bg-panel rounded border border-slate-800 overflow-hidden min-h-0 flex flex-col"
          style={{ height: '35%' }}
        >
          <div className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800 text-center">
            {sessionLabel ? `Prompt — ${sessionLabel}` : 'Prompt'}
          </div>
          <div className="session-header-ruler flex-shrink-0" />
          <div className="flex-1 min-h-0 overflow-auto p-3 font-mono text-[12px] leading-[1.35] text-slate-300 whitespace-pre-wrap">
            {loading ? (
              <div className="text-slate-500">Loading prompt…</div>
            ) : (
              originalPrompt
            )}
          </div>
        </div>
      )}

      {selection.kind === 'session' && (
        <button
          className="absolute bottom-3 right-3 px-3 py-1.5 text-xs rounded bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700"
          onClick={() => setDockOpen(v => !v)}
          title={dockOpen ? 'Hide prompt' : 'Show prompt'}
        >
          {dockOpen ? 'Hide prompt' : 'Show prompt'}
        </button>
      )}
    </div>
  )
}