import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { OptimizedDiffViewer } from './OptimizedDiffViewer'
import { useSelection } from '../contexts/SelectionContext'
import { useReview } from '../contexts/ReviewContext'
import { VscClose, VscChevronLeft, VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscComment, VscSend, VscCheck } from 'react-icons/vsc'
import clsx from 'clsx'
import hljs from 'highlight.js'
import { ReviewComment } from '../types/review'

interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
}

interface DiffViewerWithReviewProps {
  filePath: string | null
  isOpen: boolean
  onClose: () => void
}

interface LineSelection {
  side: 'old' | 'new'
  startLine: number
  endLine: number
  content: string[]
}

// Memoized component for highlighted code to prevent re-renders during typing
const HighlightedCode = memo(({ content, language }: { content: string[], language?: string }) => {
  const highlightedHtml = useMemo(() => {
    const code = content.join('\n')
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value
      }
      return hljs.highlightAuto(code).value
    } catch {
      return code
    }
  }, [content, language])

  return (
    <div className="mb-3 bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
      <div className="max-h-48 overflow-y-auto custom-scrollbar">
        <pre className="p-3 text-xs leading-relaxed">
          <code 
            className="hljs font-mono"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      </div>
    </div>
  )
})

HighlightedCode.displayName = 'HighlightedCode'

// Completely isolated comment input to prevent performance issues
const CommentInput = memo(({ 
  onSubmit, 
  onCancel 
}: { 
  onSubmit: (text: string) => void,
  onCancel: () => void 
}) => {
  const [localValue, setLocalValue] = useState('')
  
  const handleSubmit = useCallback(() => {
    if (localValue.trim()) {
      onSubmit(localValue.trim())
      setLocalValue('')
    }
  }, [localValue, onSubmit])
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }, [handleSubmit, onCancel])
  
  return (
    <>
      <textarea
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write your comment... (⌘+Enter to submit)"
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm focus:outline-none focus:border-blue-500 resize-none"
        rows={3}
        autoFocus
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-slate-800/60 hover:bg-slate-700/60 text-sm rounded transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!localValue.trim()}
          className="px-3 py-1.5 bg-blue-600/90 hover:bg-blue-600 disabled:bg-slate-800/60 disabled:opacity-50 rounded text-sm font-medium transition-colors flex items-center gap-1.5"
        >
          <VscSend className="text-xs" />
          <span>Add Comment</span>
          <span className="text-xs opacity-70">⌘↵</span>
        </button>
      </div>
    </>
  )
})

CommentInput.displayName = 'CommentInput'

export function DiffViewerWithReview({ filePath, isOpen, onClose }: DiffViewerWithReviewProps) {
  const { selection } = useSelection()
  const { currentReview, startReview, addComment, removeComment, updateComment, getCommentsForFile, clearReview } = useReview()
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(filePath)
  const [mainContent, setMainContent] = useState<string>('')
  const [worktreeContent, setWorktreeContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [branchInfo, setBranchInfo] = useState<{ 
    currentBranch: string, 
    baseBranch: string,
    baseCommit: string, 
    headCommit: string 
  } | null>(null)
  
  const [lineSelection, setLineSelection] = useState<LineSelection | null>(null)
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('unified')
  const diffViewerRef = useRef<HTMLDivElement>(null)
  const fileListRef = useRef<HTMLDivElement>(null)
  
  const sessionName = selection.kind === 'session' ? selection.payload : null
  
  useEffect(() => {
    setSelectedFile(filePath)
  }, [filePath])

  useEffect(() => {
    if (isOpen && sessionName) {
      // Start review if not already started for this session
      if (!currentReview || currentReview.sessionName !== sessionName) {
        startReview(sessionName)
      }
    }
  }, [isOpen, sessionName, currentReview, startReview])
  
  const loadChangedFiles = useCallback(async () => {
    try {
      const changedFiles = await invoke<ChangedFile[]>('get_changed_files_from_main', { sessionName })
      setFiles(changedFiles)
      // Auto-select first file when opening if none selected
      if (changedFiles.length > 0 && (!selectedFile || !isOpen)) {
        setSelectedFile(changedFiles[0].path)
      }
      
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
  }, [sessionName, selectedFile, isOpen])
  
  const loadFileDiff = useCallback(async (path: string) => {
    if (!path) return
    
    setLoading(true)
    setSelectedFile(path)
    setLineSelection(null)
    setShowCommentForm(false)
    
    // Keep current view mode; do not override user preference here
    
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

  // Initialize view mode from persisted preference (default unified)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('para.diffViewMode')
      if (saved === 'split' || saved === 'unified') {
        setViewMode(saved)
      } else {
        setViewMode('unified')
      }
    } catch {
      setViewMode('unified')
    }
  }, [])
  
  useEffect(() => {
    if (selectedFile && isOpen) {
      loadFileDiff(selectedFile)
    }
  }, [selectedFile, isOpen, loadFileDiff])
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const modifierKey = isMac ? e.metaKey : e.ctrlKey

      if (e.key === 'Escape') {
        // Always close the diff viewer on ESC, and clear any transient UI
        setShowCommentForm(false)
        setLineSelection(null)
        if (isOpen) onClose()
        return
      }

      // Cmd/Ctrl+ArrowUp/Down: navigate files
      if (isOpen && modifierKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        if (!files.length) return
        e.preventDefault()
        e.stopImmediatePropagation?.()
        const currentIndex = files.findIndex(f => f.path === selectedFile)
        if (e.key === 'ArrowDown') {
          const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, files.length - 1)
          const next = files[nextIndex]
          if (next && next.path !== selectedFile) {
            loadFileDiff(next.path)
          }
        } else if (e.key === 'ArrowUp') {
          const prevIndex = currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0)
          const prev = files[prevIndex]
          if (prev && prev.path !== selectedFile) {
            loadFileDiff(prev.path)
          }
        }
        return
      }

      // Cmd/Ctrl+Enter: open comment form (if selection)
      if (isOpen && modifierKey && !e.shiftKey && e.key === 'Enter') {
        if (lineSelection && !showCommentForm) {
          e.preventDefault()
          e.stopImmediatePropagation?.()
          setShowCommentForm(true)
          return
        }
      }

      // Cmd/Ctrl+Shift+Enter: finish review
      if (isOpen && modifierKey && e.shiftKey && e.key === 'Enter') {
        if (!showCommentForm && currentReview && currentReview.comments.length > 0) {
          e.preventDefault()
          e.stopImmediatePropagation?.()
          void handleFinishReview()
          return
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, showCommentForm, onClose, files, selectedFile, loadFileDiff, lineSelection, currentReview])

  const handleViewModeChange = useCallback((mode: 'split' | 'unified') => {
    setViewMode(mode)
    try {
      localStorage.setItem('para.diffViewMode', mode)
    } catch {
      // ignore storage errors
    }
  }, [])

  // Add missing state for mouse selection
  const [isSelecting, setIsSelecting] = useState(false)
  
  // Helper function to get line info from target element
  const getLineInfo = useCallback((target: HTMLElement): { side: 'old' | 'new', line: number } | null => {
    const lineElement = target.closest('[data-line-number]')
    if (!lineElement) return null
    
    const lineNumber = parseInt(lineElement.getAttribute('data-line-number') || '0')
    const side = lineElement.closest('[data-side]')?.getAttribute('data-side') as 'old' | 'new'
    
    if (!side || !lineNumber) return null
    return { side, line: lineNumber }
  }, [])
  
  const handleLineSelect = useCallback((side: 'old' | 'new', startLine: number, endLine: number, content: string[]) => {
    setLineSelection({
      side,
      startLine,
      endLine,
      content
    })
    setShowCommentForm(false)
  }, [])
  
  const handleLineMouseDown = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    const lineInfo = getLineInfo(target)
    
    if (lineInfo) {
      const isTextSelection = window.getSelection()?.toString()
      if (isTextSelection) return
      
      if (target.closest('code') || target.closest('span') || target.classList.contains('select-text')) {
        return
      }
      
      e.preventDefault()
      setIsSelecting(true)
      setLineSelection({
        side: lineInfo.side,
        startLine: lineInfo.line,
        endLine: lineInfo.line,
        content: []
      })
      setShowCommentForm(false)
    }
  }, [getLineInfo])

  const handleLineMouseMove = useCallback((e: MouseEvent) => {
    if (!isSelecting) return
    
    const target = e.target as HTMLElement
    const lineInfo = getLineInfo(target)
    if (!lineInfo || !lineSelection) return
    
    if (lineInfo.side === lineSelection.side) {
      // Only update if the line actually changed to avoid unnecessary re-renders
      if (lineInfo.line !== lineSelection.endLine) {
        setLineSelection({
          ...lineSelection,
          endLine: lineInfo.line
        })
      }
    }
  }, [isSelecting, lineSelection, getLineInfo])

  const handleLineMouseUp = useCallback(() => {
    if (isSelecting && lineSelection) {
      // Extract the actual content for the selected lines
      const lines = lineSelection.side === 'old' ? mainContent.split('\n') : worktreeContent.split('\n')
      const startIdx = Math.min(lineSelection.startLine - 1, lineSelection.endLine - 1)
      const endIdx = Math.max(lineSelection.startLine - 1, lineSelection.endLine - 1)
      const content = lines.slice(startIdx, endIdx + 1)
      
      setLineSelection({
        ...lineSelection,
        startLine: Math.min(lineSelection.startLine, lineSelection.endLine),
        endLine: Math.max(lineSelection.startLine, lineSelection.endLine),
        content
      })
    }
    setIsSelecting(false)
  }, [isSelecting, lineSelection, mainContent, worktreeContent])

  useEffect(() => {
    if (!isOpen) return
    
    document.addEventListener('mousedown', handleLineMouseDown)
    document.addEventListener('mousemove', handleLineMouseMove)
    document.addEventListener('mouseup', handleLineMouseUp)
    
    return () => {
      document.removeEventListener('mousedown', handleLineMouseDown)
      document.removeEventListener('mousemove', handleLineMouseMove)
      document.removeEventListener('mouseup', handleLineMouseUp)
    }
  }, [isOpen, handleLineMouseDown, handleLineMouseMove, handleLineMouseUp])

  // Apply visual highlighting to selected lines with better performance
  useEffect(() => {
    if (!diffViewerRef.current) return
    
    const startLine = lineSelection ? Math.min(lineSelection.startLine, lineSelection.endLine) : -1
    const endLine = lineSelection ? Math.max(lineSelection.startLine, lineSelection.endLine) : -1
    
    // Use data attributes instead of iterating through all rows
    diffViewerRef.current.setAttribute('data-selection-start', startLine.toString())
    diffViewerRef.current.setAttribute('data-selection-end', endLine.toString())
    diffViewerRef.current.setAttribute('data-selection-active', lineSelection ? 'true' : 'false')
    
    return () => {
      if (diffViewerRef.current) {
        diffViewerRef.current.removeAttribute('data-selection-start')
        diffViewerRef.current.removeAttribute('data-selection-end')
        diffViewerRef.current.removeAttribute('data-selection-active')
      }
    }
  }, [lineSelection?.startLine, lineSelection?.endLine])

  // Ensure selected file is kept in view within the file list
  useEffect(() => {
    if (!fileListRef.current || !selectedFile) return
    const el = fileListRef.current.querySelector(`[data-path="${CSS.escape(selectedFile)}"]`)
    if (el && 'scrollIntoView' in el) {
      ;(el as HTMLElement).scrollIntoView({ block: 'nearest' })
    }
  }, [selectedFile])
  
  const handleAddComment = useCallback((commentText: string) => {
    if (!lineSelection || !selectedFile || !commentText) return

    addComment({
      filePath: selectedFile,
      lineRange: {
        start: lineSelection.startLine,
        end: lineSelection.endLine
      },
      side: lineSelection.side,
      selectedText: lineSelection.content.join('\n'),
      comment: commentText
    })

    setShowCommentForm(false)
    setLineSelection(null)
  }, [lineSelection, selectedFile, addComment])

  const handleFinishReview = async () => {
    if (!currentReview || currentReview.comments.length === 0) return
    if (!sessionName) return

    const reviewText = formatReviewForPrompt(currentReview.comments)
    
    try {
      const terminalId = `session-${sessionName}-top`
      await invoke('write_terminal', { 
        id: terminalId, 
        data: reviewText 
      })
      
      clearReview()
      onClose()
    } catch (error) {
      console.error('Failed to send review to terminal:', error)
    }
  }

  const formatReviewForPrompt = (comments: ReviewComment[]) => {
    let output = '\n# Code Review Comments\n\n'
    
    const commentsByFile = comments.reduce((acc, comment) => {
      if (!acc[comment.filePath]) {
        acc[comment.filePath] = []
      }
      acc[comment.filePath].push(comment)
      return acc
    }, {} as Record<string, ReviewComment[]>)

    for (const [file, fileComments] of Object.entries(commentsByFile)) {
      output += `## ${file}\n\n`
      
      for (const comment of fileComments) {
        output += `### Line ${comment.lineRange.start} (${comment.side === 'old' ? 'base' : 'current'}):\n`
        output += `\`\`\`\n${comment.selectedText}\n\`\`\`\n`
        output += `**Comment:** ${comment.comment}\n\n`
      }
    }

    return output
  }
  
  const getFileIcon = (changeType: string) => {
    switch (changeType) {
      case 'added': return <VscDiffAdded className="text-green-500" />
      case 'modified': return <VscDiffModified className="text-yellow-500" />
      case 'deleted': return <VscDiffRemoved className="text-red-500" />
      default: return <VscFile className="text-blue-500" />
    }
  }
  
  const language = useMemo(() => {
    if (!selectedFile) return undefined
    const ext = selectedFile.split('.').pop()?.toLowerCase()
    const languageMap: Record<string, string> = {
      'ts': 'typescript', 'tsx': 'typescript',
      'js': 'javascript', 'jsx': 'javascript',
      'rs': 'rust', 'py': 'python', 'go': 'go',
      'java': 'java', 'kt': 'kotlin', 'swift': 'swift',
      'c': 'c', 'h': 'c',
      'cpp': 'cpp', 'cc': 'cpp', 'cxx': 'cpp',
      'hpp': 'cpp', 'hh': 'cpp', 'hxx': 'cpp',
      'cs': 'csharp', 'rb': 'ruby', 'php': 'php',
      'sh': 'bash', 'bash': 'bash', 'zsh': 'bash',
      'json': 'json', 'yml': 'yaml', 'yaml': 'yaml',
      'toml': 'toml', 'md': 'markdown',
      'css': 'css', 'scss': 'scss', 'less': 'less'
    }
    return languageMap[ext || ''] || undefined
  }, [selectedFile])


  const fileComments = selectedFile ? getCommentsForFile(selectedFile) : []
  
  return (
    <>
      <div 
        className={clsx(
          "fixed inset-0 bg-black/50 z-40 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      
      <div 
        className={clsx(
          "fixed inset-y-0 right-0 w-[94vw] z-50 bg-slate-950 shadow-2xl flex",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
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
            {files.length > 0 && (
              <div className="mt-1 text-[10px] text-slate-500">Navigate: ⌘↑ / ⌘↓</div>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto" ref={fileListRef}>
            <div className="p-2">
              {files.map(file => {
                const commentsCount = getCommentsForFile(file.path).length
                return (
                  <div
                    key={file.path}
                    className={clsx(
                      "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer",
                      "hover:bg-slate-800/50 transition-colors text-sm",
                      selectedFile === file.path && "bg-slate-800"
                    )}
                    onClick={() => loadFileDiff(file.path)}
                    data-path={file.path}
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
                    {commentsCount > 0 && (
                      <div className="flex items-center gap-1 text-xs text-blue-400">
                        <VscComment />
                        <span>{commentsCount}</span>
                      </div>
                    )}
                    <div className="text-xs text-slate-400">
                      {file.change_type === 'modified' ? 'M' : 
                       file.change_type === 'added' ? 'A' :
                       file.change_type === 'deleted' ? 'D' : 
                       file.change_type[0].toUpperCase()}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {currentReview && currentReview.comments.length > 0 && (
            <div className="border-t border-slate-800 p-3">
              <div className="text-xs text-slate-400 mb-2">
                {currentReview.comments.length} comment{currentReview.comments.length !== 1 ? 's' : ''} pending
              </div>
              <button
                onClick={handleFinishReview}
                className="w-full px-3 py-1.5 bg-blue-600/90 hover:bg-blue-600 rounded text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
                title="Finish Review (⇧⌘↵)"
              >
                <VscCheck className="text-sm" />
                <span>Finish Review</span>
                <span className="text-xs opacity-70">⇧⌘↵</span>
              </button>
            </div>
          )}
        </div>
        
        <div className="flex-1 flex flex-col">
          {selectedFile && (
            <>
              <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-b border-slate-800">
                <div>
                  <div className="text-sm font-mono">{selectedFile}</div>
                  {branchInfo && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      Comparing {branchInfo.currentBranch} → {branchInfo.baseBranch} ({branchInfo.baseCommit}..{branchInfo.headCommit})
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {currentReview && currentReview.comments.length > 0 && (
                    <button
                      onClick={handleFinishReview}
                      className="px-3 py-1.5 bg-blue-600/90 hover:bg-blue-600 rounded text-sm font-medium transition-colors flex items-center gap-1.5"
                      title="Finish Review (⇧⌘↵)"
                    >
                      <VscCheck className="text-sm" />
                      <span>Finish Review ({currentReview.comments.length})</span>
                      <span className="text-xs opacity-70">⇧⌘↵</span>
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="p-1.5 hover:bg-slate-800 rounded transition-colors"
                    title="Close (ESC)"
                  >
                    <VscClose className="text-xl" />
                  </button>
                </div>
              </div>
              
              <div 
                className="flex-1 overflow-hidden relative" 
                ref={diffViewerRef}
              >
                {/* Line selection indicator */}
                {lineSelection && (
                  <div className="fixed top-20 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg z-50 text-sm shadow-lg">
                    Lines {lineSelection.startLine === lineSelection.endLine 
                      ? lineSelection.startLine 
                      : `${lineSelection.startLine}-${lineSelection.endLine}`} selected ({lineSelection.side === 'old' ? 'base' : 'current'})
                  </div>
                )}
                
                {loading ? (
                  <div className="h-full flex items-center justify-center text-slate-500">
                    <div className="text-center">
                      <div className="mb-2">Loading diff...</div>
                      <div className="text-xs">{selectedFile}</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <OptimizedDiffViewer
                      oldContent={mainContent}
                      newContent={worktreeContent}
                      language={language}
                      viewMode={viewMode}
                      onViewModeChange={handleViewModeChange}
                      onLineSelect={handleLineSelect}
                      leftTitle={`${branchInfo?.baseBranch || 'base'} (${branchInfo?.baseCommit || 'base'})`}
                      rightTitle={`${branchInfo?.currentBranch || 'current'} (${branchInfo?.headCommit || 'HEAD'})`}
                    />

                    {lineSelection && !showCommentForm && (
                      <div 
                        className="fixed z-50 review-comment-button"
                        style={{
                          bottom: '80px',
                          right: '40px'
                        }}
                      >
                        <button
                          onClick={() => {
                            console.log('Add Comment clicked')
                            setShowCommentForm(true)
                          }}
                          className="px-4 py-2 bg-blue-600/90 hover:bg-blue-600 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-xl text-white"
                          title="Add Comment (⌘↵)"
                        >
                          <VscComment />
                          <span>Add Comment</span>
                          <span className="text-xs opacity-70">⌘↵</span>
                        </button>
                      </div>
                    )}

                    {showCommentForm && lineSelection && (
                      <div 
                        className="fixed z-50 review-comment-form bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4"
                        style={{
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          minWidth: '500px',
                          maxWidth: '700px'
                        }}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs text-slate-400">
                            Lines {lineSelection.startLine === lineSelection.endLine 
                              ? lineSelection.startLine 
                              : `${lineSelection.startLine}-${lineSelection.endLine}`} ({lineSelection.side === 'old' ? 'base' : 'current'})
                          </span>
                          <span className="text-xs text-slate-500">
                            {selectedFile?.split('/').pop()}
                          </span>
                        </div>
                        <HighlightedCode 
                          content={lineSelection.content}
                          language={language}
                        />
                        <style>{`
                          .custom-scrollbar::-webkit-scrollbar {
                            width: 8px;
                          }
                          .custom-scrollbar::-webkit-scrollbar-track {
                            background: rgba(30, 41, 59, 0.5);
                            border-radius: 4px;
                          }
                          .custom-scrollbar::-webkit-scrollbar-thumb {
                            background: rgba(71, 85, 105, 0.8);
                            border-radius: 4px;
                          }
                          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                            background: rgba(100, 116, 139, 0.9);
                          }
                        `}</style>
                        <CommentInput 
                          onSubmit={handleAddComment}
                          onCancel={() => setShowCommentForm(false)}
                        />
                      </div>
                    )}

                    {fileComments.length > 0 && (
                      <div className="absolute top-0 right-0 m-4 max-w-sm">
                        <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl">
                          <div className="px-3 py-2 border-b border-slate-700 text-sm font-medium">
                            Comments ({fileComments.length})
                          </div>
                          <div className="max-h-64 overflow-y-auto">
                            {fileComments.map(comment => (
                              <div key={comment.id} className="p-3 border-b border-slate-800 last:border-b-0">
                                <div className="text-xs text-slate-400 mb-1">
                                  Line {comment.lineRange.start} ({comment.side === 'old' ? 'base' : 'current'})
                                </div>
                                <div className="text-xs font-mono bg-slate-800 p-1 rounded mb-2 overflow-x-auto">
                                  {comment.selectedText.substring(0, 50)}
                                  {comment.selectedText.length > 50 && '...'}
                                </div>
                                {editingCommentId === comment.id ? (
                                  <div>
                                    <textarea
                                      value={editingCommentText}
                                      onChange={(e) => setEditingCommentText(e.target.value)}
                                      className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm focus:outline-none focus:border-blue-500 resize-none"
                                      rows={2}
                                      autoFocus
                                    />
                                    <div className="mt-2 flex justify-end gap-2">
                                      <button
                                        onClick={() => {
                                          setEditingCommentId(null)
                                          setEditingCommentText('')
                                        }}
                                        className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => {
                                          updateComment(comment.id, editingCommentText)
                                          setEditingCommentId(null)
                                          setEditingCommentText('')
                                        }}
                                        className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="text-sm mb-2">{comment.comment}</div>
                                    <div className="flex justify-end gap-2">
                                      <button
                                        onClick={() => {
                                          setEditingCommentId(comment.id)
                                          setEditingCommentText(comment.comment)
                                        }}
                                        className="text-xs text-blue-400 hover:text-blue-300"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => removeComment(comment.id)}
                                        className="text-xs text-red-400 hover:text-red-300"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}