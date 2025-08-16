import { useRef, forwardRef, useImperativeHandle } from 'react'
import { Terminal, TerminalHandle } from './Terminal'
import { useTerminalTabs } from '../../hooks/useTerminalTabs'

interface TerminalTabsProps {
  baseTerminalId: string
  workingDirectory: string
  className?: string
  sessionName?: string
  isOrchestrator?: boolean
  maxTabs?: number
}

export interface TerminalTabsHandle {
  focus: () => void
}

export const TerminalTabs = forwardRef<TerminalTabsHandle, TerminalTabsProps>(({
  baseTerminalId,
  workingDirectory,
  className = '',
  sessionName,
  isOrchestrator = false,
  maxTabs = 6
}, ref) => {
  const { tabs, activeTab, canAddTab, addTab, closeTab, setActiveTab } = useTerminalTabs({
    baseTerminalId,
    workingDirectory,
    maxTabs
  })

  const terminalRefs = useRef<Map<number, TerminalHandle>>(new Map())

  useImperativeHandle(ref, () => ({
    focus: () => {
      // Since we only render the active terminal, it should be the only one in the refs
      const activeTerminalRef = terminalRefs.current.get(activeTab)
      if (activeTerminalRef) {
        activeTerminalRef.focus()
      }
    }
  }), [activeTab])

  const handleTabClick = (tabIndex: number) => {
    setActiveTab(tabIndex)
  }

  const handleTabClose = (e: React.MouseEvent, tabIndex: number) => {
    e.stopPropagation()
    closeTab(tabIndex)
  }


  return (
    <div className={`h-full flex flex-col ${className}`}>
      <div className="flex-shrink-0 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => (
            <div
              key={tab.index}
              className={`
                flex items-center px-3 py-1.5 text-xs cursor-pointer border-r border-slate-800/50 min-w-0 max-w-32
                ${tab.index === activeTab 
                  ? 'bg-panel text-slate-300' 
                  : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
                }
              `}
              onClick={() => handleTabClick(tab.index)}
            >
              <span className="truncate flex-1">{tab.label}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => handleTabClose(e, tab.index)}
                  className="ml-2 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300"
                  title="Close tab"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          
          {canAddTab && (
            <button
              onClick={addTab}
              className="flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-300 hover:bg-slate-800/50 border-r border-slate-800/50"
              title="Add new terminal"
            >
              +
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {tabs.filter(tab => tab.index === activeTab).map((tab) => (
          <div
            key={tab.index}
            className="absolute inset-0"
          >
            <Terminal
              ref={(ref) => {
                if (ref) {
                  terminalRefs.current.set(tab.index, ref)
                } else {
                  terminalRefs.current.delete(tab.index)
                }
              }}
              terminalId={tab.terminalId}
              className="h-full w-full"
              sessionName={sessionName}
              isOrchestrator={isOrchestrator}
            />
          </div>
        ))}
      </div>
    </div>
  )
})

TerminalTabs.displayName = 'TerminalTabs'