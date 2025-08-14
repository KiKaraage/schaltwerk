import { useState, useEffect } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { TerminalGrid } from './components/terminal/TerminalGrid'
import { RightPanelTabs } from './components/right-panel/RightPanelTabs'
import { DiffViewerWithReview } from './components/diff/DiffViewerWithReview'
import Split from 'react-split'
import { NewSessionModal } from './components/modals/NewSessionModal'
import { CancelConfirmation } from './components/modals/CancelConfirmation'
import { SettingsModal } from './components/modals/SettingsModal'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from './contexts/SelectionContext'
import { useProject } from './contexts/ProjectContext'
import { OpenInSplitButton } from './components/diff/OpenInSplitButton'
import { VscHome } from 'react-icons/vsc'
import { HomeScreen } from './components/home/HomeScreen'
import { ProjectTab, TabBar } from './components/TabBar'

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
  const { setProjectPath } = useProject()
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [currentSession, setCurrentSession] = useState<{ id: string; name: string; displayName: string; branch: string; hasUncommittedChanges: boolean } | null>(null)
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null)
  const [isDiffViewerOpen, setIsDiffViewerOpen] = useState(false)
  const [showHome, setShowHome] = useState(true)
  const [openTabs, setOpenTabs] = useState<ProjectTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  
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
        
        if (!newSessionOpen && !cancelModalOpen && !isInputFocused) {
          e.preventDefault()
          setNewSessionOpen(true)
        }
      }
      // New Draft shortcut: Cmd+Shift+N (avoids conflicts with system Cmd+D)
      if (modifierKey && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                               document.activeElement?.tagName === 'TEXTAREA' ||
                               document.activeElement?.getAttribute('contenteditable') === 'true'
        if (!newSessionOpen && !cancelModalOpen && !isInputFocused) {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('schaltwerk:new-draft'))
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
  }, [newSessionOpen, cancelModalOpen])

  // Open NewSessionModal directly in draft mode when requested
  useEffect(() => {
    const handler = () => {
      setNewSessionOpen(true)
      // Wait a tick then toggle the draft checkbox in the modal by dispatching a custom event
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('schaltwerk:new-session:set-draft'))
      }, 0)
    }
    window.addEventListener('schaltwerk:new-draft', handler as any)
    return () => window.removeEventListener('schaltwerk:new-draft', handler as any)
  }, [])
  
  
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
      // Check if tab already exists
      const existingTab = openTabs.find(tab => tab.projectPath === path)
      if (existingTab) {
        // Switch to existing tab
        setActiveTabPath(path)
        setProjectPath(path)
        setShowHome(false)
        return
      }

      // Initialize and add new tab
      await invoke('initialize_project', { path })
      await invoke('add_recent_project', { path })
      
      const projectName = getBasename(path)
      const newTab: ProjectTab = {
        projectPath: path,
        projectName
      }
      
      setOpenTabs(prev => [...prev, newTab])
      setActiveTabPath(path)
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
    setActiveTabPath(null)
    setProjectPath(null)
  }

  const handleSelectTab = (path: string) => {
    setActiveTabPath(path)
    setProjectPath(path)
    setShowHome(false)
  }

  const handleCloseTab = async (path: string) => {
    const tabIndex = openTabs.findIndex(tab => tab.projectPath === path)
    if (tabIndex === -1) return

    // Remove the tab
    const newTabs = openTabs.filter(tab => tab.projectPath !== path)
    setOpenTabs(newTabs)

    // If this was the active tab, handle navigation
    if (path === activeTabPath) {
      if (newTabs.length > 0) {
        // Switch to adjacent tab
        const newIndex = Math.min(tabIndex, newTabs.length - 1)
        const newActiveTab = newTabs[newIndex]
        setActiveTabPath(newActiveTab.projectPath)
        setProjectPath(newActiveTab.projectPath)
      } else {
        // No more tabs, go home
        handleGoHome()
      }
    }
  }
  
  if (showHome && openTabs.length === 0) {
    return <HomeScreen onOpenProject={handleOpenProject} />
  }
  
  return (
    <>
      {/* Show home screen if requested, or no active tab */}
      {showHome && (
        <HomeScreen onOpenProject={handleOpenProject} />
      )}
      
      {/* Show project content when a tab is active */}
      {!showHome && activeTabPath && (
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
              <TabBar
                tabs={openTabs}
                activeTabPath={activeTabPath}
                onSelectTab={handleSelectTab}
                onCloseTab={handleCloseTab}
              />
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
                className="px-3 py-1.5 bg-slate-800/40 hover:bg-slate-700/60 border border-slate-700/60 rounded-lg transition-colors flex items-center gap-2 text-sm text-slate-300"
                title="Settings"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>

          <Split className="h-full w-full flex pt-9" sizes={[20, 80]} minSize={[240, 400]} gutterSize={6}>
            <div className="h-full bg-panel border-r border-slate-800 overflow-y-auto" data-testid="sidebar">
              <div className="h-full flex flex-col">
                <div className="flex-1 overflow-y-auto">
                  <Sidebar isDiffViewerOpen={isDiffViewerOpen} />
                </div>
                <div className="p-2 border-t border-slate-800 grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setNewSessionOpen(true)} 
                    className="w-full bg-slate-800/60 hover:bg-slate-700/60 text-sm px-3 py-1.5 rounded group flex items-center justify-between"
                    title="Start new task (⌘N)"
                  >
                    <span>Start new task</span>
                    <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⌘N</span>
                  </button>
                  <button 
                    onClick={() => window.dispatchEvent(new CustomEvent('schaltwerk:new-draft'))} 
                    className="w-full bg-amber-800/40 hover:bg-amber-700/40 text-sm px-3 py-1.5 rounded group flex items-center justify-between border border-amber-700/40"
                    title="Create draft (⇧⌘N)"
                  >
                    <span>New draft</span>
                    <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⇧⌘N</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="relative h-full">
              {/* Unified session ring around center + right (Claude, Terminal, Diff) */}
              <div id="work-ring" className="absolute inset-2 rounded-xl pointer-events-none" />
              <Split className="h-full w-full flex" sizes={[70, 30]} minSize={[400, 280]} gutterSize={8}>
                <main className="bg-slate-950 h-full" data-testid="terminal-grid">
                  <TerminalGrid />
                </main>
                <section className="overflow-hidden">
                  <RightPanelTabs onFileSelect={handleFileSelect} />
                </section>
              </Split>
            </div>
          </Split>
          
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
          
          {/* Diff Viewer Overlay with Review - render only when open */}
          {isDiffViewerOpen && (
            <DiffViewerWithReview 
              filePath={selectedDiffFile}
              isOpen={true}
              onClose={handleCloseDiffViewer}
            />
          )}

          {/* Settings Modal */}
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </>
      )}
    </>
  )
}