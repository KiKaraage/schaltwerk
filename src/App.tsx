import { useState, useEffect } from 'react'
import './App.css'
import { Sidebar } from './components/Sidebar'
import { TerminalGrid } from './components/TerminalGrid'
import { SimpleDiffPanel } from './components/SimpleDiffPanel'
import { DiffViewerOverlay } from './components/DiffViewerOverlay'
import Split from 'react-split'
import { NewSessionModal } from './components/NewSessionModal'
import { CancelConfirmation } from './components/CancelConfirmation'
import { invoke } from '@tauri-apps/api/core'

export interface SessionActionEvent {
  action: 'cancel'
  sessionId: string
  sessionName: string
  hasUncommittedChanges?: boolean
}

export default function App() {
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
      }
    }
    
    window.addEventListener('para-ui:session-action' as any, handleSessionAction)
    return () => window.removeEventListener('para-ui:session-action' as any, handleSessionAction)
  }, [])
  
  
  const handleCancelSession = async (_force: boolean) => {
    if (!currentSession) return
    
    try {
      await invoke('para_core_cancel_session', { 
        name: currentSession.name
      })
      setCancelModalOpen(false)
      
      window.dispatchEvent(new CustomEvent('para-ui:selection', { 
        detail: { kind: 'orchestrator', color: 'blue' } 
      }))
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
    dangerousSkipPermissions: boolean
    sandboxEnabled: boolean
    sandboxProfile?: string
    color: 'green' | 'violet' | 'amber'
  }) => {
    try {
      await invoke('para_core_create_session', { 
        name: data.name, 
        prompt: data.prompt || null 
      })
      setNewSessionOpen(false)
      
      // Get the created session to get the correct worktree path
      const sessionData = await invoke('para_core_get_session', { name: data.name }) as any
      
      window.dispatchEvent(new CustomEvent('para-ui:selection', { 
        detail: { 
          kind: 'session', 
          payload: sessionData.id,
          color: data.color,
          worktreePath: sessionData.worktree_path
        } 
      }))
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
            <button onClick={() => setNewSessionOpen(true)} className="w-full bg-slate-800/60 hover:bg-slate-700/60 text-sm px-3 py-1.5 rounded">Start new session</button>
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
      
      {/* Diff Viewer Overlay - renders outside of main layout */}
      <DiffViewerOverlay 
        filePath={selectedDiffFile}
        isOpen={isDiffViewerOpen}
        onClose={handleCloseDiffViewer}
      />
    </>
  )
}
