import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from '../contexts/SelectionContext'
import { useReview } from '../contexts/ReviewContext'
import { VscClose, VscChevronLeft, VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscComment, VscSend, VscCheck } from 'react-icons/vsc'
import clsx from 'clsx'
import hljs from 'highlight.js'
import { ReviewComment } from '../types/review'
import { OptimizedDiffViewer } from './OptimizedDiffViewer'

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
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
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
  const [isSelecting, setIsSelecting] = useState(false)
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')
  const diffViewerRef = useRef<HTMLDivElement>(null)
  const fileListRef = useRef<HTMLDivElement>(null)
  const [splitView, setSplitView] = useState<boolean>(() => typeof window !== 'undefined' ? window.innerWidth > 1400 : true)
  const [highlightEnabled, setHighlightEnabled] = useState<boolean>(true)
  const totalLinesRef = useRef<number>(0)
  const lineHeightRef = useRef<number>(16)
  const contentStartOffsetRef = useRef<number>(0)
  const [contentStartOffset, setContentStartOffset] = useState(0)
  const moveRafRef = useRef<number | null>(null)
  const selectionSideRef = useRef<'old' | 'new'>('new')
  const overlayRef = useRef<HTMLDivElement>(null)
  const hitLayerRef = useRef<HTMLDivElement>(null)
  const measureLineRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const scrollTopRef = useRef(0)
  const scrollRafRef = useRef<number | null>(null)
  
  const sessionName = selection.kind === 'session' ? selection.payload : null
  
  // Unmount entire overlay when closed to avoid any lingering layers catching events
  if (!isOpen) {
    return null
  }

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
  
  const loadFileDiff = useCallback(async (path: string) => {
    if (!path) return
    
    setLoading(true)
    setSelectedFile(path)
    setLineSelection(null)
    setShowCommentForm(false)
    
    try {
      const [mainText, worktreeText] = await invoke<[string, string]>('get_file_diff_from_main', {
        sessionName,
        filePath: path
      })
      
      setMainContent(mainText)
      setWorktreeContent(worktreeText)
      // Decide defaults for large files
      const total = Math.max(mainText.split('\n').length, worktreeText.split('\n').length)
      totalLinesRef.current = total
      if (total > 200) {
        // Default to unified view and reduced highlighting on large files
        setSplitView(false)
        setHighlightEnabled(false)
      }
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
      if (e.key === 'Escape') {
        if (showCommentForm) {
          setShowCommentForm(false)
          setLineSelection(null)
        } else if (isOpen) {
          onClose()
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, showCommentForm, onClose])

  // Line-based selection handlers with proper offset for react-diff-viewer structure
  const measureDiffRows = useCallback(() => {
    // Measure a single line height using a hidden element with the same typography
    if (measureLineRef.current) {
      const style = window.getComputedStyle(measureLineRef.current)
      const lh = parseFloat(style.lineHeight)
      if (!Number.isNaN(lh) && lh > 0) {
        lineHeightRef.current = lh
      }
    }
    // Find first code block to align overlay start
    if (!diffViewerRef.current) return
    const container = diffViewerRef.current
    const codeEl = container.querySelector('pre, code') as HTMLElement | null
    if (codeEl) {
      const containerRect = container.getBoundingClientRect()
      const codeRect = codeEl.getBoundingClientRect()
      const offset = Math.max(0, (codeRect.top - containerRect.top) + container.scrollTop)
      contentStartOffsetRef.current = offset
      setContentStartOffset(offset)
    } else {
      contentStartOffsetRef.current = 0
      setContentStartOffset(0)
    }
  }, [])

  useEffect(() => {
    if (loading) return
    // Measure after render
    const id = window.requestAnimationFrame(measureDiffRows)
    return () => window.cancelAnimationFrame(id)
  }, [loading, mainContent, worktreeContent, splitView, measureDiffRows])

  // Track container scroll to position selection overlay correctly
  useEffect(() => {
    const el = diffViewerRef.current
    if (!el) return
    const onScroll = () => {
      scrollTopRef.current = el.scrollTop
      if (scrollRafRef.current != null) return
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null
        setScrollTop(scrollTopRef.current)
      })
    }
    el.addEventListener('scroll', onScroll)
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = null
    }
  }, [diffViewerRef])

  const getLineFromMouse = useCallback((ev: MouseEvent): number | null => {
    if (!hitLayerRef.current || !diffViewerRef.current) return null
    const layer = hitLayerRef.current
    const container = diffViewerRef.current
    const layerRect = layer.getBoundingClientRect()
    const y = ev.clientY
    const relativeY = (y - layerRect.top) + container.scrollTop
    const lh = lineHeightRef.current || 16
    let lineNum = Math.floor(relativeY / lh) + 1
    if (!isFinite(lineNum)) return null
    lineNum = Math.max(1, Math.min(totalLinesRef.current || 1, lineNum))
    return lineNum
  }, [])

  const getSideFromMouse = useCallback((ev: MouseEvent): 'old' | 'new' => {
    if (!splitView || !diffViewerRef.current) return 'new'
    const contRect = diffViewerRef.current.getBoundingClientRect()
    return ev.clientX < (contRect.left + contRect.width / 2) ? 'old' : 'new'
  }, [splitView])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!diffViewerRef.current) return
    const target = e.target as HTMLElement
    if (target.closest('.review-comment-button') || target.closest('.review-comment-form')) return
    const nativeEvent = e.nativeEvent as MouseEvent
    const line = getLineFromMouse(nativeEvent)
    if (!line) return
    e.preventDefault()
    // Fix the side on mousedown to avoid side flips while dragging
    const side = getSideFromMouse(nativeEvent)
    selectionSideRef.current = side
    setIsSelecting(true)
    setShowCommentForm(false)
    setLineSelection({ side, startLine: line, endLine: line, content: [] })
    // Attach window-level listeners only for the active drag
    const handleMove = (ev: MouseEvent) => {
      if (moveRafRef.current != null) return
      moveRafRef.current = window.requestAnimationFrame(() => {
        moveRafRef.current = null
        const ln = getLineFromMouse(ev)
        if (!ln) return
        setLineSelection(prev => prev ? { ...prev, endLine: ln } : prev)
      })
    }
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      setIsSelecting(false)
      // compute content now that range is final
      setLineSelection(prev => {
        if (!prev) return prev
        const lines = prev.side === 'old' ? mainContent.split('\n') : worktreeContent.split('\n')
        const startIdx = Math.min(prev.startLine - 1, prev.endLine - 1)
        const endIdx = Math.max(prev.startLine - 1, prev.endLine - 1)
        const content = lines.slice(startIdx, endIdx + 1)
        return {
          ...prev,
          startLine: Math.min(prev.startLine, prev.endLine),
          endLine: Math.max(prev.startLine, prev.endLine),
          content
        }
      })
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp, { once: true })
  }, [getLineFromMouse, getSideFromMouse, isSelecting, mainContent, worktreeContent])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isSelecting || !lineSelection) return
    if (moveRafRef.current != null) return
    const nativeEvent = e.nativeEvent as MouseEvent
    moveRafRef.current = window.requestAnimationFrame(() => {
      moveRafRef.current = null
      const ln = getLineFromMouse(nativeEvent)
      if (!ln) return
      setLineSelection(prev => prev ? { ...prev, endLine: ln } : prev)
    })
  }, [isSelecting, lineSelection, getLineFromMouse])

  const handleMouseUp = useCallback(() => {
    if (!isSelecting) return
    setIsSelecting(false)
    setLineSelection(prev => {
      if (!prev) return prev
      const lines = prev.side === 'old' ? mainContent.split('\n') : worktreeContent.split('\n')
      const startIdx = Math.min(prev.startLine - 1, prev.endLine - 1)
      const endIdx = Math.max(prev.startLine - 1, prev.endLine - 1)
      const content = lines.slice(startIdx, endIdx + 1)
      return {
        ...prev,
        startLine: Math.min(prev.startLine, prev.endLine),
        endLine: Math.max(prev.startLine, prev.endLine),
        content
      }
    })
  }, [isSelecting, mainContent, worktreeContent])

  // No DOM row mutation; selection is visualized by overlay rectangle

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

  const handleFinishReview = useCallback(async () => {
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
  }, [currentReview, sessionName, clearReview, onClose])
  
  useEffect(() => {
    // Only register keyboard handler when the diff viewer is open
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.userAgent.includes('Mac')
      const modifierKey = isMac ? e.metaKey : e.ctrlKey

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        // Clear any transient UI first
        if (showCommentForm) {
          setShowCommentForm(false)
          return
        }
        if (lineSelection) {
          setLineSelection(null)
          return
        }
        // Then close the diff viewer
        onClose()
        return
      }

      // Cmd/Ctrl+ArrowUp/Down: navigate files
      if (modifierKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
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
      if (modifierKey && !e.shiftKey && e.key === 'Enter') {
        if (lineSelection && !showCommentForm) {
          e.preventDefault()
          e.stopImmediatePropagation?.()
          setShowCommentForm(true)
          return
        }
      }

      // Cmd/Ctrl+Shift+Enter: finish review
      if (modifierKey && e.shiftKey && e.key === 'Enter') {
        if (!showCommentForm && currentReview && currentReview.comments.length > 0) {
          e.preventDefault()
          e.stopImmediatePropagation?.()
          void handleFinishReview()
          return
        }
      }
    }
    
    // Use capture phase to handle Escape before other handlers
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, showCommentForm, onClose, files, selectedFile, loadFileDiff, lineSelection, currentReview, handleFinishReview])


  const handleLineSelect = useCallback((side: 'old' | 'new', startLine: number, endLine: number, content: string[]) => {
    setLineSelection({
      side,
      startLine,
      endLine,
      content
    })
    setShowCommentForm(false)
  }, [])

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
    return languageMap[ext || '']
  }, [selectedFile])

  // No longer used; highlighting handled by OptimizedDiffViewer + HighlightedCode
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
          "fixed inset-0 z-50 flex items-center justify-center p-2",
          "transition-all duration-300 ease-in-out",
          isOpen ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
        )}
      >
        <div className="w-[96vw] max-w-[1800px] h-[92vh] bg-slate-950 shadow-2xl rounded-lg flex overflow-hidden">
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
          
          <div className="flex-1 overflow-y-auto" ref={fileListRef}>
            <div className="p-2">
              {files.map(file => {
                const commentsCount = getCommentsForFile(file.path).length
                return (
                  <div
                    key={file.path}
                    data-path={file.path}
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
              >
                <VscCheck className="text-sm" />
                <span>Finish Review</span>
              </button>
            </div>
          )}
        </div>
        
        <div className="flex-1 flex flex-col">
          {selectedFile && (
            <>
              <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-b border-slate-800">
                <div className="min-w-0 flex-1 mr-4">
                  <div className="text-sm font-mono truncate">{selectedFile}</div>
                  {branchInfo && (
                    <div className="text-xs text-slate-500 mt-0.5 truncate">
                      Comparing {branchInfo.currentBranch} → {branchInfo.baseBranch} ({branchInfo.baseCommit}..{branchInfo.headCommit})
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex items-center gap-1 mr-2">
                    <span className="text-xs text-slate-400">View:</span>
                    <button
                      onClick={() => setSplitView(false)}
                      className={clsx('px-2 py-1 text-xs rounded', !splitView ? 'bg-slate-800 text-white' : 'bg-slate-800/40 text-slate-300 hover:bg-slate-800/60')}
                    >Unified</button>
                    <button
                      onClick={() => setSplitView(true)}
                      className={clsx('px-2 py-1 text-xs rounded', splitView ? 'bg-slate-800 text-white' : 'bg-slate-800/40 text-slate-300 hover:bg-slate-800/60')}
                    >Split</button>
                  </div>
                  <div className="flex items-center gap-1 mr-2">
                    <span className="text-xs text-slate-400">Syntax:</span>
                    <button
                      onClick={() => setHighlightEnabled((v) => !v)}
                      className={clsx('px-2 py-1 text-xs rounded', highlightEnabled ? 'bg-slate-800 text-white' : 'bg-slate-800/40 text-slate-300 hover:bg-slate-800/60')}
                    >{highlightEnabled ? 'On' : 'Off'}</button>
                  </div>
                  {currentReview && currentReview.comments.length > 0 && (
                    <button
                      onClick={handleFinishReview}
                      className="px-3 py-1.5 bg-blue-600/90 hover:bg-blue-600 rounded text-sm font-medium transition-colors flex items-center gap-1.5"
                    >
                      <VscCheck className="text-sm" />
                      <span>Finish Review ({currentReview.comments.length})</span>
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
                className="flex-1 overflow-auto diff-wrapper relative" 
                ref={diffViewerRef}
                style={{ userSelect: 'none' }}
              >
                {/* Line selection indicator */}
                {lineSelection && (
                  <div className="fixed top-20 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg z-50 text-sm shadow-lg">
                    Lines {lineSelection.startLine === lineSelection.endLine 
                      ? lineSelection.startLine 
                      : `${lineSelection.startLine}-${lineSelection.endLine}`} selected ({lineSelection.side === 'old' ? 'base' : 'current'})
                  </div>
                )}
                
                {/* Overlay styles */}
                <style>{`
                  .diff-wrapper { user-select: none; position: relative; }
                  .selection-overlay { position: absolute; inset: 0; pointer-events: none; }
                  .selection-hitlayer { position: absolute; left: 0; right: 0; pointer-events: auto; }
                  .selection-rect { position: absolute; background: rgba(59,130,246,0.18); border-left: 3px solid rgb(59,130,246); }
                `}</style>
                
                {loading ? (
                  <div className="h-full flex items-center justify-center text-slate-500">
                    <div className="text-center">
                      <div className="mb-2">Loading diff...</div>
                      <div className="text-xs">{selectedFile}</div>
                    </div>
                  </div>
                ) : (
                  <>
                {/* Hidden line measure element */}
                <div ref={measureLineRef} style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', lineHeight: '1.3', fontSize: 12, whiteSpace: 'pre' }}>X</div>
                <OptimizedDiffViewer
                  oldContent={mainContent}
                  newContent={worktreeContent}
                  language={language}
                  viewMode={splitView ? 'split' : 'unified'}
                  onLineSelect={handleLineSelect}
                  leftTitle={`${branchInfo?.baseBranch || 'base'} (${branchInfo?.baseCommit || 'base'})`}
                  rightTitle={`${branchInfo?.currentBranch || 'current'} (${branchInfo?.headCommit || 'HEAD'})`}
                />

                {/* Selection overlay (visual only, above diff) */}
                <div
                  className="selection-overlay"
                  ref={overlayRef}
                  style={{ zIndex: 5 }}
                >
                  {lineSelection && (
                    <div
                      className="selection-rect"
                      style={{
                        top: (contentStartOffset - scrollTop) + ((Math.min(lineSelection.startLine, lineSelection.endLine) - 1) * (lineHeightRef.current || 16)),
                        height: ((Math.abs(lineSelection.endLine - lineSelection.startLine) + 1) * (lineHeightRef.current || 16)),
                        left: splitView ? (lineSelection.side === 'old' ? 0 : '50%') : 0,
                        width: splitView ? '50%' : '100%'
                      }}
                    />
                  )}
                </div>

                {/* Hit layer (captures mouse and maps to lines) */}
                <div
                  ref={hitLayerRef}
                  className="selection-hitlayer"
                  style={{
                    top: contentStartOffset - scrollTop,
                    height: Math.max(0, (totalLinesRef.current || 0) * (lineHeightRef.current || 16)),
                    zIndex: 6
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
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
                        setShowCommentForm(true)
                      }}
                      className="px-4 py-2 bg-blue-600/90 hover:bg-blue-600 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-xl text-white"
                    >
                      <VscComment />
                      <span>Add Comment</span>
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
      </div>
    </>
  )
}