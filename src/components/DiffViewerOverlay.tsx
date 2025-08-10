import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import { useSelection } from '../contexts/SelectionContext'
import { VscClose, VscChevronLeft, VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved } from 'react-icons/vsc'
import clsx from 'clsx'

interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
}

interface DiffViewerOverlayProps {
  filePath: string | null
  isOpen: boolean
  onClose: () => void
}

export function DiffViewerOverlay({ filePath, isOpen, onClose }: DiffViewerOverlayProps) {
  const { selection } = useSelection()
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(filePath)
  const [mainContent, setMainContent] = useState<string>('')
  const [worktreeContent, setWorktreeContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [branchInfo, setBranchInfo] = useState<{ 
    currentBranch: string, 
    mainCommit: string, 
    headCommit: string 
  } | null>(null)
  
  const sessionName = selection.kind === 'session' ? selection.payload : null
  
  useEffect(() => {
    setSelectedFile(filePath)
  }, [filePath])
  
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
  
  const loadFileDiff = useCallback(async (path: string) => {
    if (!path) return
    
    setLoading(true)
    setSelectedFile(path)
    
    try {
      const [mainText, worktreeText] = await invoke<[string, string]>('get_file_diff_from_main', {
        sessionName,
        filePath: path
      })
      
      setMainContent(mainText)
      setWorktreeContent(worktreeText)
    } catch (error) {
      console.error('Failed to load file diff:', error)
    } finally {
      setLoading(false)
    }
  }, [sessionName])
  
  useEffect(() => {
    if (isOpen) {
      loadChangedFiles()
    }
  }, [isOpen, loadChangedFiles])
  
  useEffect(() => {
    if (selectedFile && isOpen) {
      loadFileDiff(selectedFile)
    }
  }, [selectedFile, isOpen, loadFileDiff])
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])
  
  const getFileIcon = (changeType: string) => {
    switch (changeType) {
      case 'added': return <VscDiffAdded className="text-green-500" />
      case 'modified': return <VscDiffModified className="text-yellow-500" />
      case 'deleted': return <VscDiffRemoved className="text-red-500" />
      default: return <VscFile className="text-blue-500" />
    }
  }
  
  const renderSyntaxHighlight = (code: string) => {
    return (
      <pre className="font-mono text-sm">
        <code>{code}</code>
      </pre>
    )
  }
  
  return (
    <>
      {/* Backdrop */}
      <div 
        className={clsx(
          "fixed inset-0 bg-black/50 z-40 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      
      {/* Slide-out panel from right */}
      <div 
        className={clsx(
          "fixed inset-y-0 right-0 w-[94vw] z-50 bg-slate-950 shadow-2xl flex",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* File List Sidebar */}
        <div className="w-72 border-r border-slate-800 flex flex-col bg-slate-900/30">
          <div className="px-3 py-3 border-b border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="p-1 hover:bg-slate-800 rounded transition-colors"
                  title="Close (ESC)"
                >
                  <VscChevronLeft className="text-lg" />
                </button>
                <span className="text-sm font-medium">Changed Files</span>
              </div>
              <span className="text-xs text-slate-500">
                {files.length} files
              </span>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            <div className="p-2">
              {files.map(file => (
                <div
                  key={file.path}
                  className={clsx(
                    "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer",
                    "hover:bg-slate-800/50 transition-colors text-sm",
                    selectedFile === file.path && "bg-slate-800"
                  )}
                  onClick={() => loadFileDiff(file.path)}
                >
                  {getFileIcon(file.change_type)}
                  <div className="flex-1 min-w-0">
                    <div className="truncate">
                      {file.path.split('/').pop()}
                    </div>
                    {file.path.includes('/') && (
                      <div className="text-xs text-slate-500 truncate">
                        {file.path.substring(0, file.path.lastIndexOf('/'))}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">
                    {file.change_type === 'modified' ? 'M' : 
                     file.change_type === 'added' ? 'A' :
                     file.change_type === 'deleted' ? 'D' : 
                     file.change_type[0].toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Diff Viewer Main Area */}
        <div className="flex-1 flex flex-col">
          {selectedFile && (
            <>
              <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-b border-slate-800">
                <div>
                  <div className="text-sm font-mono">{selectedFile}</div>
                  {branchInfo && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      Comparing {branchInfo.currentBranch} → main ({branchInfo.mainCommit}..{branchInfo.headCommit})
                    </div>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 hover:bg-slate-800 rounded transition-colors"
                  title="Close (ESC)"
                >
                  <VscClose className="text-xl" />
                </button>
              </div>
              
              <div className="flex-1 overflow-auto">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-slate-500">
                    <div className="text-center">
                      <div className="mb-2">Loading diff...</div>
                      <div className="text-xs">{selectedFile}</div>
                    </div>
                  </div>
                ) : (
                  <ReactDiffViewer
                    oldValue={mainContent}
                    newValue={worktreeContent}
                    splitView={window.innerWidth > 1400}
                    compareMethod={DiffMethod.LINES}
                    leftTitle={`main (${branchInfo?.mainCommit || 'base'})`}
                    rightTitle={`${branchInfo?.currentBranch || 'current'} (${branchInfo?.headCommit || 'HEAD'})`}
                    renderContent={renderSyntaxHighlight}
                    useDarkTheme={true}
                    styles={{
                      variables: {
                        dark: {
                          diffViewerBackground: '#0f172a',
                          diffViewerColor: '#cbd5e1',
                          addedBackground: 'rgba(34, 197, 94, 0.15)',
                          addedColor: '#cbd5e1',
                          removedBackground: 'rgba(239, 68, 68, 0.15)',
                          removedColor: '#cbd5e1',
                          wordAddedBackground: 'rgba(34, 197, 94, 0.3)',
                          wordRemovedBackground: 'rgba(239, 68, 68, 0.3)',
                          addedGutterBackground: 'rgba(34, 197, 94, 0.2)',
                          removedGutterBackground: 'rgba(239, 68, 68, 0.2)',
                          gutterBackground: '#1e293b',
                          gutterBackgroundDark: '#0f172a',
                          highlightBackground: '#334155',
                          highlightGutterBackground: '#475569',
                          codeFoldGutterBackground: '#1e293b',
                          codeFoldBackground: '#1e293b',
                          emptyLineBackground: '#0f172a',
                          gutterColor: '#64748b',
                          addedGutterColor: '#cbd5e1',
                          removedGutterColor: '#cbd5e1',
                          codeFoldContentColor: '#64748b',
                          diffViewerTitleBackground: '#1e293b',
                          diffViewerTitleColor: '#cbd5e1',
                          diffViewerTitleBorderColor: '#334155',
                        }
                      },
                      line: {
                        fontFamily: 'SF Mono, Monaco, Consolas, monospace',
                        fontSize: '13px',
                        lineHeight: '1.4'
                      }
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}