import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from '../contexts/SelectionContext'
import { VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscCode } from 'react-icons/vsc'
import clsx from 'clsx'

interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
}

interface DiffFileListProps {
  onFileSelect: (filePath: string) => void
}

export function DiffFileList({ onFileSelect }: DiffFileListProps) {
  const { selection } = useSelection()
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [branchInfo, setBranchInfo] = useState<{ 
    currentBranch: string, 
    baseBranch: string,
    baseCommit: string, 
    headCommit: string 
  } | null>(null)
  
  const sessionName = selection.kind === 'session' ? selection.payload : null
  
  const loadChangedFiles = useCallback(async () => {
    try {
      const changedFiles = await invoke<ChangedFile[]>('get_changed_files_from_main', { sessionName })
      setFiles(changedFiles)
      
      const currentBranch = await invoke<string>('get_current_branch_name', { sessionName })
      const baseBranch = await invoke<string>('get_base_branch_name', { sessionName })
      const [baseCommit, headCommit] = await invoke<[string, string]>('get_commit_comparison_info', { sessionName })
      
      setBranchInfo({
        currentBranch,
        baseBranch,
        baseCommit,
        headCommit
      })
    } catch (error) {
      console.error('Failed to load changed files:', error)
    }
  }, [sessionName])

  const handleOpenInVSCode = useCallback(async () => {
    try {
      let worktreePath: string | undefined = undefined
      if (selection.kind === 'session') {
        worktreePath = selection.worktreePath
        if (!worktreePath && sessionName) {
          const sessionData = await invoke<any>('para_core_get_session', { name: sessionName })
          worktreePath = sessionData?.worktree_path
        }
      } else {
        worktreePath = await invoke<string>('get_current_directory')
      }
      if (worktreePath) {
        await invoke('open_in_vscode', { worktreePath })
      }
    } catch (error) {
      console.error('Failed to open VSCode:', error)
    }
  }, [selection, sessionName])
  
  useEffect(() => {
    loadChangedFiles()
    const interval = setInterval(loadChangedFiles, 3000)
    return () => clearInterval(interval)
  }, [loadChangedFiles])
  
  const handleFileClick = (file: ChangedFile) => {
    setSelectedFile(file.path)
    onFileSelect(file.path)
  }
  
  const getFileIcon = (changeType: string) => {
    switch (changeType) {
      case 'added': return <VscDiffAdded className="text-green-500" />
      case 'modified': return <VscDiffModified className="text-yellow-500" />
      case 'deleted': return <VscDiffRemoved className="text-red-500" />
      default: return <VscFile className="text-blue-500" />
    }
  }
  
  return (
    <div className="h-full flex flex-col bg-slate-950">
      <div className="px-3 py-2 border-b border-slate-800 relative">
        <button
          onClick={handleOpenInVSCode}
          className="absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-300 bg-transparent hover:bg-slate-700/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors"
          title="Open in VSCode"
          aria-label="Open in VSCode"
        >
          <VscCode className="text-[16px]" />
        </button>
        <div className="flex items-center justify-between pr-12">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Changes from {branchInfo?.baseBranch || 'base'}</span>
            {branchInfo && (
              <span className="text-xs text-slate-500">
                ({branchInfo.currentBranch} → {branchInfo.baseBranch})
              </span>
            )}
          </div>
          {branchInfo && files.length > 0 && (
            <div className="text-xs text-slate-500">
              {files.length} files changed
            </div>
          )}
        </div>
      </div>
      
      {files.length > 0 ? (
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            {files.map(file => (
              <div
                key={file.path}
                className={clsx(
                  "flex items-center gap-2 px-2 py-2 rounded cursor-pointer",
                  "hover:bg-slate-800/50 transition-colors",
                  selectedFile === file.path && "bg-slate-800/30"
                )}
                onClick={() => handleFileClick(file)}
              >
                {getFileIcon(file.change_type)}
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate font-medium">
                    {file.path.split('/').pop()}
                  </div>
                  {file.path.includes('/') && (
                    <div className="text-xs text-slate-500 truncate">
                      {file.path.substring(0, file.path.lastIndexOf('/'))}
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-400 uppercase">
                  {file.change_type === 'modified' ? 'M' : 
                   file.change_type === 'added' ? 'A' :
                   file.change_type === 'deleted' ? 'D' : 
                   file.change_type[0].toUpperCase()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-500">
          <div className="text-center">
            <VscFile className="mx-auto mb-2 text-4xl opacity-50" />
            <div className="mb-1">No changes from {branchInfo?.baseBranch || 'base'}</div>
            <div className="text-xs">
              {branchInfo?.currentBranch === branchInfo?.baseBranch 
                ? `You are on the ${branchInfo?.baseBranch} branch` 
                : `Your branch is up to date with ${branchInfo?.baseBranch || 'base'}`
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}