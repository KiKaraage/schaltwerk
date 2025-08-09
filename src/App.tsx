import { useState, useEffect } from 'react'
import './App.css'
import { Sidebar } from './components/Sidebar'
import { TerminalGrid } from './components/TerminalGrid'
import { LazyGitPanel } from './components/LazyGitPanel'
import Split from 'react-split'
import { NewSessionModal } from './components/NewSessionModal'
import { FinishSessionModal } from './components/FinishSessionModal'
import { CancelConfirmation } from './components/CancelConfirmation'
import { invoke } from '@tauri-apps/api/core'

export interface SessionActionEvent {
  action: 'finish' | 'cancel'
  sessionId: string
  sessionName: string
  hasUncommittedChanges?: boolean
}

export default function App() {
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [finishModalOpen, setFinishModalOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [currentSession, setCurrentSession] = useState<{ id: string; name: string; hasUncommittedChanges: boolean } | null>(null)
  
  useEffect(() => {
    const handleSessionAction = (event: CustomEvent<SessionActionEvent>) => {
      const { action, sessionId, sessionName, hasUncommittedChanges = false } = event.detail
      
      setCurrentSession({ id: sessionId, name: sessionName, hasUncommittedChanges })
      
      if (action === 'finish') {
        setFinishModalOpen(true)
      } else if (action === 'cancel') {
        setCancelModalOpen(true)
      }
    }
    
    window.addEventListener('para-ui:session-action' as any, handleSessionAction)
    return () => window.removeEventListener('para-ui:session-action' as any, handleSessionAction)
  }, [])
  
  const handleFinishSession = async (message: string, branch?: string) => {
    if (!currentSession) return
    
    try {
      await invoke('para_finish_session', { 
        sessionId: currentSession.id, 
        message,
        branch 
      })
      await invoke('refresh_para_sessions')
      setFinishModalOpen(false)
      
      window.dispatchEvent(new CustomEvent('para-ui:selection', { 
        detail: 'orchestrator' 
      }))
    } catch (error) {
      console.error('Failed to finish session:', error)
      alert(`Failed to finish session: ${error}`)
    }
  }
  
  const handleCancelSession = async (force: boolean) => {
    if (!currentSession) return
    
    try {
      await invoke('para_cancel_session', { 
        sessionId: currentSession.id, 
        force 
      })
      await invoke('refresh_para_sessions')
      setCancelModalOpen(false)
      
      window.dispatchEvent(new CustomEvent('para-ui:selection', { 
        detail: 'orchestrator' 
      }))
    } catch (error) {
      console.error('Failed to cancel session:', error)
      alert(`Failed to cancel session: ${error}`)
    }
  }
  return (
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
        <Split className="h-full w-full flex" sizes={[55, 45]} minSize={[400, 400]} gutterSize={8}>
          <main className="bg-slate-950 h-full">
            <TerminalGrid />
          </main>
          <section className="overflow-hidden">
            <LazyGitPanel />
          </section>
        </Split>
      </div>
      <NewSessionModal open={newSessionOpen} onClose={() => setNewSessionOpen(false)} onCreate={() => setNewSessionOpen(false)} />
      
      {currentSession && (
        <>
          <FinishSessionModal
            open={finishModalOpen}
            sessionName={currentSession.name}
            onConfirm={handleFinishSession}
            onCancel={() => setFinishModalOpen(false)}
          />
          
          <CancelConfirmation
            open={cancelModalOpen}
            sessionName={currentSession.name}
            hasUncommittedChanges={currentSession.hasUncommittedChanges}
            onConfirm={handleCancelSession}
            onCancel={() => setCancelModalOpen(false)}
          />
        </>
      )}
    </Split>
  )
}
