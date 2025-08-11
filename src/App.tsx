import { useState, useEffect } from 'react'
import './App.css'
import { Sidebar } from './components/Sidebar'
import { TerminalGrid } from './components/TerminalGrid'
import { SimpleDiffPanel } from './components/SimpleDiffPanel'
import { DiffViewerWithReview } from './components/DiffViewerWithReview'
import Split from 'react-split'
import { NewSessionModal } from './components/NewSessionModal'
import { CancelConfirmation } from './components/CancelConfirmation'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from './contexts/SelectionContext'
// FocusProvider moved to root in main.tsx

export interface SessionActionEvent {
  action: 'cancel' | 'cancel-immediate'
  sessionId: string
  sessionName: string
  hasUncommittedChanges?: boolean
}


export default function App() {
  const { setSelection } = useSelection()
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [currentSession, setCurrentSession] = useState<{ id: string; name: string; hasUncommittedChanges: boolean } | null>(null)
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null)
  const [isDiffViewerOpen, setIsDiffViewerOpen] = useState(false)
  
  useEffect(() => {
    const handleSessionAction = (event: CustomEvent<SessionActionEvent>) => {
      const { action, sessionId, sessionName, hasUncommittedChanges = false } = event.detail
      
      setCurrentSession({ id: sessionId, name: sessionName, hasUncommittedChanges })
      
      if (action === 'cancel') {
        setCancelModalOpen(true)
      } else if (action === 'cancel-immediate') {
        // perform cancel directly
        setCancelModalOpen(false)
        void handleCancelSession(hasUncommittedChanges)
      }
    }
    
    window.addEventListener('para-ui:session-action' as any, handleSessionAction)
    return () => window.removeEventListener('para-ui:session-action' as any, handleSessionAction)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modifierKey = isMac ? e.metaKey : e.ctrlKey
      
      if (modifierKey && e.key === 'n') {
        // Don't interfere if a modal is already open or if we're typing in an input
        const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                               document.activeElement?.tagName === 'TEXTAREA' ||
                               document.activeElement?.getAttribute('contenteditable') === 'true'
        
        if (!newSessionOpen && !cancelModalOpen && !isInputFocused) {
          e.preventDefault()
          setNewSessionOpen(true)
        }
      }
    }

    const handleGlobalNewSession = () => {
      // Handle ⌘N from terminal (custom event)
      if (!newSessionOpen && !cancelModalOpen) {
        setNewSessionOpen(true)
      }
    }

    const handleOpenDiffView = () => {
      // open diff view for current session; file selection stays null to show list
      setSelectedDiffFile(null)
      setIsDiffViewerOpen(true)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('global-new-session-shortcut', handleGlobalNewSession)
    window.addEventListener('para-ui:open-diff-view' as any, handleOpenDiffView)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('global-new-session-shortcut', handleGlobalNewSession)
      window.removeEventListener('para-ui:open-diff-view' as any, handleOpenDiffView)
    }
  }, [newSessionOpen, cancelModalOpen])
  
  
  const handleCancelSession = async (_force: boolean) => {
    if (!currentSession) return
    
    try {
      await invoke('para_core_cancel_session', { 
        name: currentSession.name
      })
      setCancelModalOpen(false)
      
      // Switch back to orchestrator after canceling session
      await setSelection({ kind: 'orchestrator' })
    } catch (error) {
      console.error('Failed to cancel session:', error)
      alert(`Failed to cancel session: ${error}`)
    }
  }
  
  const handleFileSelect = (filePath: string) => {
    setSelectedDiffFile(filePath)
    setIsDiffViewerOpen(true)
  }
  
  const handleCloseDiffViewer = () => {
    setIsDiffViewerOpen(false)
  }
  
  const handleCreateSession = async (data: {
    name: string
    prompt?: string
    baseBranch: string
    userEditedName?: boolean
  }) => {
    try {
      await invoke('para_core_create_session', { 
        name: data.name,
        prompt: data.prompt || null,
        baseBranch: data.baseBranch || null,
        userEditedName: data.userEditedName ?? false,
      })
      setNewSessionOpen(false)
      
      // Get the created session to get the correct worktree path
      const sessionData = await invoke('para_core_get_session', { name: data.name }) as any
      
      // Switch to the new session immediately - context handles terminal creation and Claude start
      await setSelection({
        kind: 'session',
        payload: data.name,
        worktreePath: sessionData.worktree_path,
        isNewSession: true  // This triggers Claude to start
      })
    } catch (error) {
      console.error('Failed to create session:', error)
      alert(`Failed to create session: ${error}`)
    }
  }
  
  return (
    <>
      <Split className="h-full w-full flex" sizes={[18, 82]} minSize={[220, 400]} gutterSize={6}>
      <div className="h-full bg-panel border-r border-slate-800 overflow-y-auto">
        <div className="h-full flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <Sidebar />
          </div>
          <div className="p-2 border-t border-slate-800">
            <button 
              onClick={() => setNewSessionOpen(true)} 
              className="w-full bg-slate-800/60 hover:bg-slate-700/60 text-sm px-3 py-1.5 rounded group flex items-center justify-between"
              title="Start new session (⌘N)"
            >
              <span>Start new session</span>
              <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⌘N</span>
            </button>
          </div>
        </div>
      </div>

      <div className="relative h-full">
        {/* Unified session ring around center + right (Claude, Terminal, Diff) */}
        <div id="work-ring" className="absolute inset-2 rounded-xl pointer-events-none" />
        <Split className="h-full w-full flex" sizes={[70, 30]} minSize={[400, 280]} gutterSize={8}>
          <main className="bg-slate-950 h-full">
            <TerminalGrid />
          </main>
          <section className="overflow-hidden">
            <SimpleDiffPanel onFileSelect={handleFileSelect} />
          </section>
        </Split>
      </div>
      <NewSessionModal open={newSessionOpen} onClose={() => setNewSessionOpen(false)} onCreate={handleCreateSession} />
      
      {currentSession && (
        <CancelConfirmation
          open={cancelModalOpen}
          sessionName={currentSession.name}
          hasUncommittedChanges={currentSession.hasUncommittedChanges}
          onConfirm={handleCancelSession}
          onCancel={() => setCancelModalOpen(false)}
        />
      )}
      </Split>
      
      {/* Diff Viewer Overlay with Review - renders outside of main layout */}
      <DiffViewerWithReview 
        filePath={selectedDiffFile}
        isOpen={isDiffViewerOpen}
        onClose={handleCloseDiffViewer}
      />
    </>
  )
}
