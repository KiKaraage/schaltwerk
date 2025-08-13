import { useState, useEffect } from 'react'
import { SimpleDiffPanel } from './SimpleDiffPanel'
import { DraftTaskPanel } from './DraftTaskPanel'
import { VscDiff, VscEdit } from 'react-icons/vsc'
import clsx from 'clsx'
import { useSelection } from '../contexts/SelectionContext'

interface RightPanelTabsProps {
  onFileSelect: (filePath: string) => void
  onSessionStart?: (sessionName: string) => void
}

export function RightPanelTabs({ onFileSelect, onSessionStart }: RightPanelTabsProps) {
  const [activeTab, setActiveTab] = useState<'diff' | 'drafts'>('diff')
  const { setSelection } = useSelection()
  
  useEffect(() => {
    const handleShowDrafts = () => {
      setActiveTab('drafts')
    }
    
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modifierKey = isMac ? e.metaKey : e.ctrlKey
      
      if (modifierKey && e.key === 'd') {
        const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                               document.activeElement?.tagName === 'TEXTAREA' ||
                               document.activeElement?.getAttribute('contenteditable') === 'true'
        
        if (!isInputFocused) {
          e.preventDefault()
          setActiveTab(prev => prev === 'diff' ? 'drafts' : 'diff')
        }
      }
    }
    
    window.addEventListener('schaltwerk:show-drafts', handleShowDrafts)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('schaltwerk:show-drafts', handleShowDrafts)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const handleDraftStart = async (sessionName: string) => {
    try {
      await setSelection({
        kind: 'session',
        payload: sessionName
      })
      setActiveTab('diff')
      onSessionStart?.(sessionName)
    } catch (error) {
      console.error('[RightPanelTabs] Failed to switch to started session:', error)
    }
  }

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => setActiveTab('diff')}
          className={clsx(
            'flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
            activeTab === 'diff'
              ? 'text-slate-200 bg-slate-800/50 border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          )}
          title="Diff View (⌘D to toggle)"
        >
          <VscDiff className="text-sm" />
          <span>Diff</span>
        </button>
        <button
          onClick={() => setActiveTab('drafts')}
          className={clsx(
            'flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
            activeTab === 'drafts'
              ? 'text-slate-200 bg-slate-800/50 border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          )}
          title="Draft Tasks (⌘D to toggle)"
        >
          <VscEdit className="text-sm" />
          <span>Drafts</span>
        </button>
      </div>
      
      <div className="flex-1 overflow-hidden">
        {activeTab === 'diff' ? (
          <SimpleDiffPanel onFileSelect={onFileSelect} />
        ) : (
          <DraftTaskPanel onSessionStart={handleDraftStart} />
        )}
      </div>
    </div>
  )
}