import React, { useState } from 'react'
import './App.css'
import { Sidebar } from './components/Sidebar'
import { TerminalGrid } from './components/TerminalGrid'
import { DiffPanel } from './components/DiffPanel'
import Split from 'react-split'
import { NewSessionModal } from './components/NewSessionModal'

export default function App() {
  const [newSessionOpen, setNewSessionOpen] = useState(false)
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
        <Split className="h-full w-full flex" sizes={[62, 38]} minSize={[360, 320]} gutterSize={6}>
          <main className="bg-slate-950 h-full">
            <TerminalGrid />
          </main>
          <section className="overflow-hidden">
            <DiffPanel />
          </section>
        </Split>
      </div>
      <NewSessionModal open={newSessionOpen} onClose={() => setNewSessionOpen(false)} onCreate={() => setNewSessionOpen(false)} />
    </Split>
  )
}
