import { useState, useEffect } from 'react'
import { SimpleDiffPanel } from './SimpleDiffPanel'
import { useSelection } from '../contexts/SelectionContext'
import { VscDiff, VscChevronLeft, VscNotebook } from 'react-icons/vsc'
import clsx from 'clsx'
import { DraftContentView } from './drafts/DraftContentView'
import { DraftListView } from './drafts/DraftListView'

interface RightPanelTabsProps {
  onFileSelect: (filePath: string) => void
}

export function RightPanelTabs({ onFileSelect }: RightPanelTabsProps) {
  const { selection, isDraft } = useSelection()
  const [activeTab, setActiveTab] = useState<'changes' | 'task'>('changes')
  const [previewDraftName, setPreviewDraftName] = useState<string | null>(null)

  // Reset preview when leaving orchestrator
  useEffect(() => {
    if (selection.kind !== 'orchestrator') setPreviewDraftName(null)
  }, [selection])

  // Default tab per mode: orchestrator -> task (drafts list), draft session -> task, running session -> changes
  useEffect(() => {
    if (selection.kind === 'orchestrator') {
      setActiveTab('task')
    } else if (selection.kind === 'session') {
      setActiveTab(isDraft ? 'task' : 'changes')
    }
  }, [selection, isDraft])

  // Note: removed Cmd+D toggle to reserve shortcut for New Draft

  // Unified header with tabs
  const isOrchestrator = selection.kind === 'orchestrator'
  const rightTabLabel = isOrchestrator ? 'Drafts' : 'Task'
  const showBackButton = isOrchestrator && !!previewDraftName

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="flex items-center border-b border-slate-800">
        <button
          onClick={() => setActiveTab('changes')}
          className={clsx(
            'flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
            activeTab === 'changes' ? 'text-slate-200 bg-slate-800/50 border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          )}
          title="Changes"
        >
          <VscDiff className="text-sm" />
          <span>Changes</span>
        </button>
        <button
          onClick={() => setActiveTab('task')}
          className={clsx(
            'flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
            activeTab === 'task' ? 'text-slate-200 bg-slate-800/50 border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          )}
          title={`${rightTabLabel}`}
        >
          <VscNotebook className="text-sm" />
          <span>{rightTabLabel}</span>
        </button>
      </div>

      {/* Back/breadcrumb row when previewing a draft in orchestrator */}
      {showBackButton && (
        <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2">
          <button
            className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center gap-1"
            onClick={() => setPreviewDraftName(null)}
            title="Back to drafts"
          >
            <VscChevronLeft />
            Back
          </button>
          <div className="text-xs text-slate-400">Viewing draft: {previewDraftName}</div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {activeTab === 'changes' ? (
          <div data-testid="diff-panel"><SimpleDiffPanel onFileSelect={onFileSelect} /></div>
        ) : (
          // Task/Drafts tab content
          selection.kind === 'session' ? (
            <DraftContentView sessionName={selection.payload!} editable={isDraft} debounceMs={1000} />
          ) : (
            previewDraftName ? (
              <DraftContentView sessionName={previewDraftName} editable debounceMs={1000} />
            ) : (
              <DraftListView onOpenDraft={(name) => setPreviewDraftName(name)} />
            )
          )
        )}
      </div>
    </div>
  )
}
