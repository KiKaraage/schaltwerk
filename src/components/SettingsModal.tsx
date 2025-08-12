import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { clearTerminalStartedTracking } from './Terminal'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [mcpServerRunning, setMcpServerRunning] = useState(false)
  const mcpServerPort = 9547
  const [isRestarting, setIsRestarting] = useState(false)
  const [configPath, setConfigPath] = useState('')

  useEffect(() => {
    if (!isOpen) return

    // Check MCP server status
    checkMcpServerStatus()

    // Claude Code uses .claude.json in the project directory
    setConfigPath('.claude.json (in project root)')
  }, [isOpen])

  const checkMcpServerStatus = async () => {
    try {
      const response = await fetch(`http://localhost:${mcpServerPort}/health`)
      setMcpServerRunning(response.ok)
    } catch {
      setMcpServerRunning(false)
    }
  }

  const startMcpServer = async () => {
    try {
      await invoke('start_mcp_server', { port: mcpServerPort })
      setTimeout(checkMcpServerStatus, 1000)
    } catch (error) {
      console.error('Failed to start MCP server:', error)
    }
  }

  const restartOrchestrator = async () => {
    setIsRestarting(true)
    try {
      // Clear the started tracking for orchestrator terminals
      clearTerminalStartedTracking([
        'orchestrator-top',
        'orchestrator-bottom',
        'orchestrator-right'
      ])

      // Close orchestrator terminals
      await invoke('close_terminal', { id: 'orchestrator-top' })
      await invoke('close_terminal', { id: 'orchestrator-bottom' })
      await invoke('close_terminal', { id: 'orchestrator-right' })

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 500))

      // Recreate orchestrator terminals
      await invoke('create_terminal', { id: 'orchestrator-top', cwd: process.cwd() })
      await invoke('create_terminal', { id: 'orchestrator-bottom', cwd: process.cwd() })
      await invoke('create_terminal', { id: 'orchestrator-right', cwd: process.cwd() })

      // Claude will auto-start in orchestrator-top via Terminal component
      
      onClose()
    } catch (error) {
      console.error('Failed to restart orchestrator:', error)
    } finally {
      setIsRestarting(false)
    }
  }

  const copyConfigSnippet = () => {
    const config = {
      mcpServers: {
        schaltwerk: {
          type: "stdio",
          command: "node",
          args: [`${process.cwd()}/mcp-server/build/schaltwerk-mcp-server.js`]
        }
      }
    }
    navigator.clipboard.writeText(JSON.stringify(config, null, 2))
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div 
        className="bg-panel border border-slate-700 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-slate-200">Settings</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-2xl leading-none"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        <div className="space-y-6">
          {/* MCP Server Section */}
          <div className="border-b border-slate-700 pb-6">
            <h3 className="text-lg font-medium text-slate-300 mb-4">MCP Server Configuration</h3>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Server Status</p>
                  <p className="text-sm">
                    {mcpServerRunning ? (
                      <span className="text-green-400">✓ Running on port {mcpServerPort}</span>
                    ) : (
                      <span className="text-yellow-400">⚠ Not running</span>
                    )}
                  </p>
                </div>
                {!mcpServerRunning && (
                  <button
                    onClick={startMcpServer}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                  >
                    Start Server
                  </button>
                )}
              </div>

              <div className="bg-slate-800 rounded p-4">
                <p className="text-sm text-slate-400 mb-2">Configuration Method:</p>
                <div className="space-y-3">
                  <div className="bg-slate-900 p-3 rounded">
                    <p className="text-sm text-slate-300 font-medium mb-1">Option 1: CLI Command (Recommended)</p>
                    <p className="text-xs text-slate-400 mb-2">Run this in a terminal:</p>
                    <code className="text-xs text-green-400 block">
                      claude mcp add --transport stdio --scope project schaltwerk node {process.cwd()}/mcp-server/build/schaltwerk-mcp-server.js
                    </code>
                  </div>
                  
                  <div className="bg-slate-900 p-3 rounded">
                    <p className="text-sm text-slate-300 font-medium mb-1">Option 2: Manual Config</p>
                    <p className="text-xs text-slate-400 mb-2">Add to <code className="text-slate-300">{configPath}</code>:</p>
                    <div className="relative">
                      <pre className="text-xs bg-slate-950 p-2 rounded overflow-x-auto">
{`{
  "mcpServers": {
    "schaltwerk": {
      "type": "stdio",
      "command": "node",
      "args": ["${process.cwd()}/mcp-server/build/schaltwerk-mcp-server.js"]
    }
  }
}`}
                      </pre>
                      <button
                        onClick={copyConfigSnippet}
                        className="absolute top-1 right-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4">
                <div>
                  <p className="text-sm text-slate-300">Restart Orchestrator</p>
                  <p className="text-xs text-slate-500">Reload Claude Code with updated MCP configuration</p>
                </div>
                <button
                  onClick={restartOrchestrator}
                  disabled={isRestarting}
                  className={`px-4 py-2 rounded text-sm ${
                    isRestarting 
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                      : 'bg-orange-600 hover:bg-orange-700'
                  }`}
                >
                  {isRestarting ? 'Restarting...' : 'Restart'}
                </button>
              </div>
            </div>
          </div>

          {/* Keyboard Shortcuts Section */}
          <div>
            <h3 className="text-lg font-medium text-slate-300 mb-4">Keyboard Shortcuts</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-slate-400">New Session</div>
              <div className="text-slate-300">⌘N</div>
              
              <div className="text-slate-400">Cancel Session</div>
              <div className="text-slate-300">⌘⌫</div>
              
              <div className="text-slate-400">Mark as Reviewed</div>
              <div className="text-slate-300">⌘R</div>
              
              <div className="text-slate-400">Focus Terminal</div>
              <div className="text-slate-300">⌘/</div>
              
              <div className="text-slate-400">Navigate Sessions</div>
              <div className="text-slate-300">↑↓</div>
              
              <div className="text-slate-400">Settings</div>
              <div className="text-slate-300">⌘,</div>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}