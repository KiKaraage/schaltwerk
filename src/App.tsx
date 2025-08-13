import { useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { TerminalGrid } from './components/TerminalGrid'
import { RightPanelTabs } from './components/RightPanelTabs'
import { DiffViewerWithReview } from './components/DiffViewerWithReview'
import Split from 'react-split'
import { NewSessionModal } from './components/NewSessionModal'
import { CancelConfirmation } from './components/CancelConfirmation'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from './contexts/SelectionContext'
import { useProject } from './contexts/ProjectContext'
import { OpenInSplitButton } from './components/OpenInSplitButton'
import { VscGear, VscHome } from 'react-icons/vsc'
import { HomeScreen } from './components/HomeScreen'
import { SettingsModal } from './components/SettingsModal'
// FocusProvider moved to root in main.tsx

export interface SessionActionEvent {
  action: 'cancel' | 'cancel-immediate'
  sessionId: string
  sessionName: string
  sessionDisplayName?: string
  branch?: string
  hasUncommittedChanges?: boolean
}


// Helper function to get the basename of a path (last segment)
function getBasename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

export default function App() {
  const { selection, setSelection } = useSelection()
  const { projectPath, setProjectPath } = useProject()
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [currentSession, setCurrentSession] = useState<{ id: string; name: string; displayName: string; branch: string; hasUncommittedChanges: boolean } | null>(null)
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null)
  const [isDiffViewerOpen, setIsDiffViewerOpen] = useState(false)
  const [showHome, setShowHome] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  
  // Start with home screen, user must explicitly choose a project
  // Remove automatic project detection to ensure home screen is shown first

  useEffect(() => {
    const handleSessionAction = (event: CustomEvent<SessionActionEvent>) => {
      const { action, sessionId, sessionName, sessionDisplayName, branch, hasUncommittedChanges = false } = event.detail
      
      setCurrentSession({ 
        id: sessionId, 
        name: sessionName, 
        displayName: sessionDisplayName || sessionName, 
        branch: branch || '',
        hasUncommittedChanges 
      })
      
      if (action === 'cancel') {
        setCancelModalOpen(true)
      } else if (action === 'cancel-immediate') {
        // perform cancel directly
        setCancelModalOpen(false)
        void handleCancelSession(hasUncommittedChanges)
      }
    }
    
    window.addEventListener('schaltwerk:session-action' as any, handleSessionAction)
    return () => window.removeEventListener('schaltwerk:session-action' as any, handleSessionAction)
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
        
        if (!newSessionOpen && !cancelModalOpen && !settingsOpen && !isInputFocused) {
          e.preventDefault()
          setNewSessionOpen(true)
        }
      }
      
      // Add settings shortcut (Cmd+,)
      if (modifierKey && e.key === ',') {
        const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                               document.activeElement?.tagName === 'TEXTAREA' ||
                               document.activeElement?.getAttribute('contenteditable') === 'true'
        
        if (!settingsOpen && !isInputFocused) {
          e.preventDefault()
          setSettingsOpen(true)
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
    window.addEventListener('schaltwerk:open-diff-view' as any, handleOpenDiffView)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('global-new-session-shortcut', handleGlobalNewSession)
      window.removeEventListener('schaltwerk:open-diff-view' as any, handleOpenDiffView)
    }
  }, [newSessionOpen, cancelModalOpen, settingsOpen])
  
  
  const handleCancelSession = async (_force: boolean) => {
    if (!currentSession) return
    
    try {
      setIsCancelling(true)
      await invoke('para_core_cancel_session', { 
        name: currentSession.name
      })
      setCancelModalOpen(false)
      
    } catch (error) {
      console.error('Failed to cancel session:', error)
      alert(`Failed to cancel session: ${error}`)
    } finally {
      setIsCancelling(false)
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
    isDraft?: boolean
    draftContent?: string
  }) => {
    try {
      if (data.isDraft) {
        // Create draft session
        await invoke('para_core_create_draft_session', {
          name: data.name,
          draftContent: data.draftContent || '',
        })
        setNewSessionOpen(false)
        
        // Get the created session to get the correct worktree path
        const sessionData = await invoke('para_core_get_session', { name: data.name }) as any
        
        // Switch to the new draft session - no agent will start
        await setSelection({
          kind: 'session',
          payload: data.name,
          worktreePath: sessionData.worktree_path
        })
      } else {
        // Create regular session
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
          worktreePath: sessionData.worktree_path
        })
      }
    } catch (error) {
      console.error('Failed to create session:', error)
      alert(`Failed to create session: ${error}`)
    }
  }

  const handleOpenProject = async (path: string) => {
    try {
      await invoke('initialize_project', { path })
      await invoke('add_recent_project', { path })
      setProjectPath(path)
      setShowHome(false)
      // SelectionContext will automatically update orchestrator when projectPath changes
    } catch (error) {
      console.error('Failed to open project:', error)
      alert(`Failed to open project: ${error}`)
    }
  }

  const handleGoHome = () => {
    setShowHome(true)
  }
  
  if (showHome) {
    return <HomeScreen onOpenProject={handleOpenProject} />
  }
  
  return (
    <>
      {/* Global top bar */}
      <div className="absolute top-0 right-0 left-0 h-9 flex items-center justify-between px-3 z-20 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={handleGoHome}
            className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 bg-slate-800/40 hover:bg-slate-700/50 border border-slate-700/60"
            title="Home"
            aria-label="Home"
          >
            <VscHome className="text-[15px]" />
          </button>
          {projectPath && (
            <div className="flex items-center gap-1 text-xs bg-slate-800/40 border border-slate-700/60 rounded-lg px-2 py-1">
              <span className="text-slate-400 font-medium">{getBasename(projectPath)}</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500 max-w-[200px] truncate" title={projectPath}>
                {projectPath}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <OpenInSplitButton resolvePath={async () => {
            if (selection.kind === 'session') {
              let worktreePath = selection.worktreePath
              if (!worktreePath && selection.payload) {
                try {
                  const sessionData = await invoke<any>('para_core_get_session', { name: selection.payload })
                  worktreePath = sessionData?.worktree_path
                } catch {}
              }
              return worktreePath
            }
            return await invoke<string>('get_current_directory')
          }} />
          <button
            onClick={() => setSettingsOpen(true)}
            className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 bg-slate-800/40 hover:bg-slate-700/50 border border-slate-700/60"
            title="Settings (⌘,)"
            aria-label="Settings"
          >
            <VscGear className="text-[15px]" />
          </button>
        </div>
      </div>

      <Split className="h-full w-full flex pt-9" sizes={[18, 82]} minSize={[220, 400]} gutterSize={6}>
      <div className="h-full bg-panel border-r border-slate-800 overflow-y-auto">
        <div className="h-full flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <Sidebar isDiffViewerOpen={isDiffViewerOpen} />
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
            <RightPanelTabs onFileSelect={handleFileSelect} />
          </section>
        </Split>
      </div>
      <NewSessionModal open={newSessionOpen} onClose={() => setNewSessionOpen(false)} onCreate={handleCreateSession} />
      
      {currentSession && (
        <CancelConfirmation
          open={cancelModalOpen}
          displayName={currentSession.displayName}
          branch={currentSession.branch}
          hasUncommittedChanges={currentSession.hasUncommittedChanges}
          onConfirm={handleCancelSession}
          onCancel={() => setCancelModalOpen(false)}
          loading={isCancelling}
        />
      )}
      </Split>
      
      {/* Diff Viewer Overlay with Review - render only when open */}
      {isDiffViewerOpen && (
        <DiffViewerWithReview 
          filePath={selectedDiffFile}
          isOpen={true}
          onClose={handleCloseDiffViewer}
        />
      )}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
