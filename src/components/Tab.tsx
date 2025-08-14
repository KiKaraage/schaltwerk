import React from 'react'
import { VscClose } from 'react-icons/vsc'

interface TabProps {
  projectPath: string
  projectName: string
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

export function Tab({ projectPath, projectName, isActive, onSelect, onClose }: TabProps) {
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClose()
  }
  
  return (
    <button
      className={`
        h-7 px-2 inline-flex items-center gap-1.5 rounded-lg border transition-all duration-150 group relative
        ${isActive 
          ? 'bg-cyan-900/30 text-cyan-300 border-cyan-700/50' 
          : 'bg-slate-800/40 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border-slate-700/60'
        }
      `}
      onClick={onSelect}
      title={projectPath}
    >
      <span className="text-xs font-medium truncate max-w-[120px]">
        {projectName}
      </span>
      <button
        onClick={handleClose}
        className={`
          rounded hover:bg-slate-700/60 transition-colors p-0.5
          ${isActive 
            ? 'text-cyan-400 hover:text-cyan-200' 
            : 'text-slate-500 hover:text-red-400'
          }
        `}
        aria-label={`Close ${projectName}`}
      >
        <VscClose className="text-[10px]" />
      </button>
    </button>
  )
}