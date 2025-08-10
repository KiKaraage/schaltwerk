import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from '../contexts/SelectionContext'
import { VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved } from 'react-icons/vsc'
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
    mainCommit: string, 
    headCommit: string 
  } | null>(null)
  
  const sessionName = selection.kind === 'session' ? selection.payload : null
  
  const loadChangedFiles = useCallback(async () => {
    try {
      const changedFiles = await invoke<ChangedFile[]>('get_changed_files_from_main', { sessionName })
      setFiles(changedFiles)
      
      const currentBranch = await invoke<string>('get_current_branch_name', { sessionName })
      const [mainCommit, headCommit] = await invoke<[string, string]>('get_commit_comparison_info', { sessionName })
      
      setBranchInfo({
        currentBranch,
        mainCommit,
        headCommit
      })
    } catch (error) {
      console.error('Failed to load changed files:', error)
    }
  }, [sessionName])
  
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
      <div className="px-3 py-2 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Changes from main</span>
            {branchInfo && (
              <span className="text-xs text-slate-500">
                ({branchInfo.currentBranch} → main)
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
            <div className="mb-1">No changes from main</div>
            <div className="text-xs">
              {branchInfo?.currentBranch === 'main' 
                ? 'You are on the main branch' 
                : 'Your branch is up to date with main'
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}