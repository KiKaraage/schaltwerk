import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from '../../contexts/SelectionContext'
import { useReview } from '../../contexts/ReviewContext'
import { useFocus } from '../../contexts/FocusContext'
import { ReviewComment } from '../../types/review'
import { useLineSelection } from '../../hooks/useLineSelection'
import { 
  computeUnifiedDiff, 
  addCollapsibleSections, 
  computeSplitDiff,
  getFileLanguage
} from '../../utils/diff'
import { DiffLineRow } from './DiffLineRow'
import { 
  VscClose, VscComment, VscSend, VscCheck,
  VscSplitHorizontal, VscListFlat, VscFile,
  VscDiffAdded, VscDiffModified, VscDiffRemoved
} from 'react-icons/vsc'
import clsx from 'clsx'
import hljs from 'highlight.js'

interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
}

interface UnifiedDiffModalProps {
  filePath: string | null
  isOpen: boolean
  onClose: () => void
}

export function UnifiedDiffModal({ filePath, isOpen, onClose }: UnifiedDiffModalProps) {
  const { selection, setSelection } = useSelection()
  const { currentReview, startReview, addComment, getCommentsForFile, clearReview } = useReview()
  const { setFocusForSession, setCurrentFocus } = useFocus()
  const lineSelection = useLineSelection()
  const lineSelectionRef = useRef(lineSelection)
  lineSelectionRef.current = lineSelection
  
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(filePath)
  const [mainContent, setMainContent] = useState<string>('')
  const [worktreeContent, setWorktreeContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [branchInfo, setBranchInfo] = useState<{ 
    currentBranch: string
    baseBranch: string
    baseCommit: string
    headCommit: string 
  } | null>(null)
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0)
  
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified')
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set())
  const [commentFormPosition, setCommentFormPosition] = useState<{ x: number, y: number } | null>(null)
  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  
  const sessionName = selection.kind === 'session' ? selection.payload : null
  
  // Helper to check if a line has comments
  const getCommentForLine = useCallback((lineNum: number | undefined, side: 'old' | 'new') => {
    if (!lineNum || !selectedFile) return null
    const comments = getCommentsForFile(selectedFile)
    return comments.find(c => 
      c.side === side && 
      lineNum >= c.lineRange.start && 
      lineNum <= c.lineRange.end
    )
  }, [selectedFile, getCommentsForFile])
  
  // Show comment form whenever there's a selection (but not while dragging)
  useEffect(() => {
    if (lineSelection.selection && !isDraggingSelection) {
      setShowCommentForm(true)
    } else if (!lineSelection.selection) {
      setShowCommentForm(false)
      setCommentFormPosition(null)
    }
  }, [lineSelection.selection, isDraggingSelection])

  useEffect(() => {
    setSelectedFile(filePath)
  }, [filePath])

  useEffect(() => {
    if (isOpen && sessionName && (!currentReview || currentReview.sessionName !== sessionName)) {
      startReview(sessionName)
    }
  }, [isOpen, sessionName, currentReview, startReview])

  const loadChangedFiles = useCallback(async () => {
    try {
      const changedFiles = await invoke<ChangedFile[]>('get_changed_files_from_main', { sessionName })
      setFiles(changedFiles)
      
      // Auto-select first file when opening
      if (changedFiles.length > 0 && !filePath) {
        setSelectedFile(changedFiles[0].path)
        setSelectedFileIndex(0)
      } else if (filePath) {
        // Find index of pre-selected file
        const index = changedFiles.findIndex(f => f.path === filePath)
        if (index >= 0) {
          setSelectedFileIndex(index)
        }
      }
      
      const currentBranch = await invoke<string>('get_current_branch_name', { sessionName })
      const baseBranch = await invoke<string>('get_base_branch_name', { sessionName })
      const [baseCommit, headCommit] = await invoke<[string, string]>('get_commit_comparison_info', { sessionName })
      
      setBranchInfo({ currentBranch, baseBranch, baseCommit, headCommit })
    } catch (error) {
      console.error('Failed to load changed files:', error)
    }
  }, [sessionName, filePath])

  const loadFileDiff = useCallback(async (path: string, index?: number) => {
    if (!path) return
    
    setLoading(true)
    setSelectedFile(path)
    if (index !== undefined) {
      setSelectedFileIndex(index)
    }
    lineSelectionRef.current.clearSelection()
    setShowCommentForm(false)
    setCommentFormPosition(null)
    setExpandedSections(new Set())
    
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
      if (e.key === 'Escape') {
        if (showCommentForm) {
          setShowCommentForm(false)
          setCommentFormPosition(null)
          lineSelection.clearSelection()
        } else if (isOpen) {
          onClose()
        }
      } else if (isOpen && !showCommentForm) {
        // Arrow key navigation for file list when modal is open and comment form is not shown
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          e.stopPropagation()
          if (selectedFileIndex > 0) {
            const newIndex = selectedFileIndex - 1
            setSelectedFileIndex(newIndex)
            loadFileDiff(files[newIndex].path, newIndex)
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          e.stopPropagation()
          if (selectedFileIndex < files.length - 1) {
            const newIndex = selectedFileIndex + 1
            setSelectedFileIndex(newIndex)
            loadFileDiff(files[newIndex].path, newIndex)
          }
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown, true) // Use capture phase to handle before other listeners
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, showCommentForm, onClose, lineSelection, selectedFileIndex, files, loadFileDiff])

  const diffResult = useMemo(() => {
    const lines = computeUnifiedDiff(mainContent, worktreeContent)
    return addCollapsibleSections(lines)
  }, [mainContent, worktreeContent])

  const splitDiffResult = useMemo(() => {
    return computeSplitDiff(mainContent, worktreeContent)
  }, [mainContent, worktreeContent])

  const language = useMemo(() => getFileLanguage(selectedFile || ''), [selectedFile])

  const highlightCode = useCallback((code: string) => {
    if (!code) return ''
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value
      }
      return hljs.highlightAuto(code).value
    } catch {
      return code
    }
  }, [language])

  const handleLineMouseDown = useCallback((lineNum: number, side: 'old' | 'new', event: React.MouseEvent) => {
    event.preventDefault()
    setIsDraggingSelection(true)
    
    // Start new selection
    lineSelection.handleLineClick(lineNum, side, event)
    
    // Don't set position here - we'll calculate it after selection is complete
  }, [lineSelection])

  const handleLineMouseEnter = useCallback((lineNum: number, side: 'old' | 'new') => {
    if (isDraggingSelection && lineSelection.selection && lineSelection.selection.side === side) {
      // Extend selection while dragging
      lineSelection.extendSelection(lineNum, side)
    }
  }, [isDraggingSelection, lineSelection])

  const handleLineMouseUp = useCallback(() => {
    if (isDraggingSelection) {
      setIsDraggingSelection(false)
      
      // Calculate position based on the selected lines
      if (lineSelection.selection) {
        const endLine = Math.max(lineSelection.selection.startLine, lineSelection.selection.endLine)
        
        // Find the DOM element for the last selected line
        const lineElements = document.querySelectorAll(`[data-line-num="${endLine}"][data-side="${lineSelection.selection.side}"]`)
        if (lineElements.length > 0) {
          const rect = lineElements[0].getBoundingClientRect()
          // Position below the selection, aligned to the right side of the viewport
          setCommentFormPosition({ 
            x: window.innerWidth - 420, // Right-aligned with some margin
            y: rect.bottom + 10 
          })
        }
      }
    }
  }, [isDraggingSelection, lineSelection.selection])

  // Global mouse up handler
  useEffect(() => {
    if (isDraggingSelection) {
      const handleGlobalMouseUp = () => {
        setIsDraggingSelection(false)
      }
      document.addEventListener('mouseup', handleGlobalMouseUp)
      return () => document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDraggingSelection])

  const toggleCollapsed = useCallback((idx: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }, [])


  const handleSubmitComment = useCallback((text: string) => {
    if (!lineSelection.selection || !selectedFile) return
    
    const lines = lineSelection.selection.side === 'old' 
      ? mainContent.split('\n')
      : worktreeContent.split('\n')
    
    const selectedText = lines
      .slice(lineSelection.selection.startLine - 1, lineSelection.selection.endLine)
      .join('\n')
    
    addComment({
      filePath: selectedFile,
      lineRange: {
        start: lineSelection.selection.startLine,
        end: lineSelection.selection.endLine
      },
      side: lineSelection.selection.side,
      selectedText,
      comment: text
    })
    
    setShowCommentForm(false)
    setCommentFormPosition(null)
    lineSelection.clearSelection()
  }, [lineSelection, selectedFile, mainContent, worktreeContent, addComment])

  const formatReviewForPrompt = useCallback((comments: ReviewComment[]) => {
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
        output += `### Lines ${comment.lineRange.start}-${comment.lineRange.end} (${comment.side === 'old' ? 'base' : 'current'}):\n`
        output += `\`\`\`\n${comment.selectedText}\n\`\`\`\n`
        output += `**Comment:** ${comment.comment}\n\n`
      }
    }

    return output
  }, [])

  const handleFinishReview = useCallback(async () => {
    if (!currentReview || currentReview.comments.length === 0) return
    if (!sessionName) return

    const reviewText = formatReviewForPrompt(currentReview.comments)
    
    try {
      const terminalId = `session-${sessionName}-top`
      await invoke('write_terminal', { id: terminalId, data: reviewText })
      
      // Focus the session with blue border
      await setSelection({
        kind: 'session',
        payload: sessionName
      })
      setFocusForSession(sessionName, 'claude')
      setCurrentFocus('claude')
      
      // Clear the review after sending
      clearReview()
      
      onClose()
    } catch (error) {
      console.error('Failed to send review to terminal:', error)
    }
  }, [currentReview, sessionName, formatReviewForPrompt, clearReview, onClose, setSelection, setFocusForSession, setCurrentFocus])

  const getFileIcon = (changeType: string) => {
    switch (changeType) {
      case 'added': return <VscDiffAdded className="text-green-500" />
      case 'modified': return <VscDiffModified className="text-yellow-500" />
      case 'deleted': return <VscDiffRemoved className="text-red-500" />
      default: return <VscFile className="text-blue-500" />
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-200"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-slate-950 rounded-xl shadow-2xl w-[95vw] h-[90vh] flex flex-col overflow-hidden border border-slate-800">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold">Git Diff Viewer</h2>
              {selectedFile && (
                <div className="text-sm text-slate-400 font-mono">{selectedFile}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setViewMode('unified')}
                  className={clsx(
                    'px-3 py-1 text-sm rounded transition-colors',
                    viewMode === 'unified' 
                      ? 'bg-slate-700 text-white' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  )}
                >
                  <VscListFlat className="inline mr-1" />
                  Unified
                </button>
                <button
                  onClick={() => setViewMode('split')}
                  className={clsx(
                    'px-3 py-1 text-sm rounded transition-colors',
                    viewMode === 'split' 
                      ? 'bg-slate-700 text-white' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  )}
                >
                  <VscSplitHorizontal className="inline mr-1" />
                  Split
                </button>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <VscClose className="text-xl" />
              </button>
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* File list sidebar */}
            <div className="w-80 border-r border-slate-800 bg-slate-900/30 flex flex-col">
              <div className="p-3 border-b border-slate-800">
                <div className="text-sm font-medium mb-1">Changed Files</div>
                <div className="text-xs text-slate-500">{files.length} files</div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {files.map(file => {
                  const commentCount = getCommentsForFile(file.path).length
                  return (
                    <div
                      key={file.path}
                      className={clsx(
                        "px-3 py-2 cursor-pointer hover:bg-slate-800/50 transition-colors",
                        "flex items-center gap-2",
                        selectedFile === file.path && "bg-slate-800"
                      )}
                      onClick={() => loadFileDiff(file.path, files.indexOf(file))}
                    >
                      {getFileIcon(file.change_type)}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{file.path.split('/').pop()}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {file.path.substring(0, file.path.lastIndexOf('/'))}
                        </div>
                      </div>
                      {commentCount > 0 && (
                        <div className="flex items-center gap-1 text-xs text-blue-400">
                          <VscComment />
                          <span>{commentCount}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {currentReview && currentReview.comments.length > 0 && (
                <div className="p-3 border-t border-slate-800 space-y-2">
                  <div className="text-xs text-slate-500">
                    <div className="font-medium text-slate-400 mb-1">Review Summary:</div>
                    <div className="space-y-1">
                      {files.map(file => {
                        const fileComments = getCommentsForFile(file.path)
                        if (fileComments.length === 0) return null
                        return (
                          <div key={file.path} className="flex items-center justify-between">
                            <span className="truncate">{file.path.split('/').pop()}</span>
                            <span className="text-blue-400">{fileComments.length} comment{fileComments.length > 1 ? 's' : ''}</span>
                          </div>
                        )
                      }).filter(Boolean)}
                    </div>
                  </div>
                  <button
                    onClick={handleFinishReview}
                    className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <VscCheck />
                    Finish Review ({currentReview.comments.length} comment{currentReview.comments.length > 1 ? 's' : ''})
                  </button>
                </div>
              )}
            </div>

            {/* Diff viewer */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-slate-500">Loading diff...</div>
                </div>
              ) : selectedFile && (
                <>
                  {branchInfo && (
                    <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-800 bg-slate-900/30">
                      {branchInfo.baseBranch} ({branchInfo.baseCommit.slice(0, 7)}) → {branchInfo.currentBranch} ({branchInfo.headCommit.slice(0, 7)})
                    </div>
                  )}
                  
                  {viewMode === 'unified' ? (
                    <div className="flex-1 overflow-auto font-mono text-sm">
                      <table className="w-full" style={{ tableLayout: 'fixed' }}>
                        <tbody>
                          {diffResult.flatMap((line, idx) => {
                            const isExpanded = expandedSections.has(idx)
                            const lineNum = line.oldLineNumber || line.newLineNumber
                            const side: 'old' | 'new' = line.type === 'removed' ? 'old' : 'new'
                            
                            if (line.isCollapsible) {
                              const rows = []
                              rows.push(
                                <DiffLineRow
                                  key={idx}
                                  line={line}
                                  index={idx}
                                  isSelected={false}
                                  onLineMouseDown={handleLineMouseDown}
                                  onLineMouseEnter={handleLineMouseEnter}
                                  onLineMouseUp={handleLineMouseUp}
                                  onToggleCollapse={() => toggleCollapsed(idx)}
                                  isCollapsed={!isExpanded}
                                  highlightedContent={undefined}
                                />
                              )
                              
                              if (isExpanded && line.collapsedLines) {
                                line.collapsedLines.forEach((collapsedLine, collapsedIdx) => {
                                  const collapsedLineNum = collapsedLine.oldLineNumber || collapsedLine.newLineNumber
                                  const collapsedSide: 'old' | 'new' = collapsedLine.type === 'removed' ? 'old' : 'new'
                                  const collapsedComment = getCommentForLine(collapsedLineNum, collapsedSide)
                                  rows.push(
                                    <DiffLineRow
                                      key={`${idx}-expanded-${collapsedIdx}`}
                                      line={collapsedLine}
                                      index={idx * 1000 + collapsedIdx}
                                      isSelected={collapsedLineNum ? lineSelection.isLineSelected(collapsedLineNum, collapsedSide) : false}
                                      onLineMouseDown={handleLineMouseDown}
                                      onLineMouseEnter={handleLineMouseEnter}
                                      onLineMouseUp={handleLineMouseUp}
                                      highlightedContent={collapsedLine.content ? highlightCode(collapsedLine.content) : undefined}
                                      hasComment={!!collapsedComment}
                                      commentText={collapsedComment?.comment}
                                    />
                                  )
                                })
                              }
                              
                              return rows
                            }
                            
                            const comment = getCommentForLine(lineNum, side)
                            return (
                              <DiffLineRow
                                key={idx}
                                line={line}
                                index={idx}
                                isSelected={lineNum ? lineSelection.isLineSelected(lineNum, side) : false}
                                onLineMouseDown={handleLineMouseDown}
                                onLineMouseEnter={handleLineMouseEnter}
                                onLineMouseUp={handleLineMouseUp}
                                highlightedContent={line.content ? highlightCode(line.content) : undefined}
                                hasComment={!!comment}
                                commentText={comment?.comment}
                              />
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex-1 flex overflow-hidden">
                      <div className="flex-1 overflow-auto font-mono text-sm border-r border-slate-800">
                        <div className="sticky top-0 bg-slate-900 px-3 py-1 text-xs font-medium border-b border-slate-800">
                          {branchInfo?.baseBranch || 'Base'}
                        </div>
                        <table className="w-full" style={{ tableLayout: 'fixed' }}>
                          <tbody>
                            {splitDiffResult.leftLines.map((line, idx) => (
                              <DiffLineRow
                                key={idx}
                                line={line}
                                index={idx}
                                isSelected={line.oldLineNumber ? lineSelection.isLineSelected(line.oldLineNumber, 'old') : false}
                                onLineMouseDown={handleLineMouseDown}
                                onLineMouseEnter={handleLineMouseEnter}
                                onLineMouseUp={handleLineMouseUp}
                                highlightedContent={line.content ? highlightCode(line.content) : undefined}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex-1 overflow-auto font-mono text-sm">
                        <div className="sticky top-0 bg-slate-900 px-3 py-1 text-xs font-medium border-b border-slate-800">
                          {branchInfo?.currentBranch || 'Current'}
                        </div>
                        <table className="w-full" style={{ tableLayout: 'fixed' }}>
                          <tbody>
                            {splitDiffResult.rightLines.map((line, idx) => (
                              <DiffLineRow
                                key={idx}
                                line={line}
                                index={idx}
                                isSelected={line.newLineNumber ? lineSelection.isLineSelected(line.newLineNumber, 'new') : false}
                                onLineMouseDown={handleLineMouseDown}
                                onLineMouseEnter={handleLineMouseEnter}
                                onLineMouseUp={handleLineMouseUp}
                                highlightedContent={line.content ? highlightCode(line.content) : undefined}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  
                  {/* Comment form appears near the selected line */}
                  
                  {/* Comment form fixed on the right side */}
                  {showCommentForm && lineSelection.selection && (
                    <>
                      {/* Invisible backdrop to detect clicks outside */}
                      <div 
                        className="fixed inset-0 z-[59]" 
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowCommentForm(false)
                          setCommentFormPosition(null)
                          lineSelection.clearSelection()
                        }}
                      />
                      <div 
                        className="fixed right-4 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4 w-96 z-[60]"
                        style={{
                          top: commentFormPosition ? Math.min(commentFormPosition.y, window.innerHeight - 300) : '50%',
                          transform: commentFormPosition ? 'none' : 'translateY(-50%)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="text-sm mb-3 text-slate-300">
                          <div className="font-medium mb-1">Add Review Comment</div>
                          <div className="text-xs text-slate-500">
                            {lineSelection.selection.startLine === lineSelection.selection.endLine
                              ? `Line ${lineSelection.selection.startLine}`
                              : `Lines ${lineSelection.selection.startLine}-${lineSelection.selection.endLine}`
                            } • {lineSelection.selection.side === 'old' ? 'Base version' : 'Current version'}
                          </div>
                        </div>
                        <CommentForm
                          onSubmit={handleSubmitComment}
                          onCancel={() => {
                            setShowCommentForm(false)
                            setCommentFormPosition(null)
                            lineSelection.clearSelection()
                          }}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function CommentForm({ onSubmit, onCancel }: { onSubmit: (text: string) => void, onCancel: () => void }) {
  const [text, setText] = useState('')
  
  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim())
      setText('')
    }
  }
  
  return (
    <>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write your comment..."
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm focus:outline-none focus:border-blue-500 resize-none"
        rows={4}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.metaKey) {
            handleSubmit()
          } else if (e.key === 'Escape') {
            onCancel()
          }
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium transition-colors flex items-center gap-2"
        >
          <VscSend />
          Submit
        </button>
      </div>
    </>
  )
}