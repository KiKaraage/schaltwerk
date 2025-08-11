import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import hljs from 'highlight.js'
import { VscSplitHorizontal, VscListFlat } from 'react-icons/vsc'
import clsx from 'clsx'

interface DiffLine {
  lineNumber: number
  type: 'added' | 'removed' | 'unchanged' | 'context'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

interface OptimizedDiffViewerProps {
  oldContent: string
  newContent: string
  language?: string
  viewMode?: 'split' | 'unified'
  onViewModeChange?: (mode: 'split' | 'unified') => void
  onLineSelect?: (side: 'old' | 'new', startLine: number, endLine: number, content: string[]) => void
  leftTitle?: string
  rightTitle?: string
}

interface LineSelection {
  side: 'old' | 'new'
  startLine: number
  endLine: number
}

const CHUNK_SIZE = 100
const OVERSCAN = 20

function computeUnifiedDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = []
  
  const oldLinesSet = new Set(oldLines)
  const newLinesSet = new Set(newLines)
  
  let oldIdx = 0
  let newIdx = 0
  let lineNum = 0
  
  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    lineNum++
    
    if (oldIdx < oldLines.length && !newLinesSet.has(oldLines[oldIdx])) {
      result.push({
        lineNumber: lineNum,
        type: 'removed',
        content: oldLines[oldIdx],
        oldLineNumber: oldIdx + 1
      })
      oldIdx++
    } else if (newIdx < newLines.length && !oldLinesSet.has(newLines[newIdx])) {
      result.push({
        lineNumber: lineNum,
        type: 'added',
        content: newLines[newIdx],
        newLineNumber: newIdx + 1
      })
      newIdx++
    } else if (oldIdx < oldLines.length && newIdx < newLines.length && oldLines[oldIdx] === newLines[newIdx]) {
      result.push({
        lineNumber: lineNum,
        type: 'unchanged',
        content: oldLines[oldIdx],
        oldLineNumber: oldIdx + 1,
        newLineNumber: newIdx + 1
      })
      oldIdx++
      newIdx++
    } else {
      if (oldIdx < oldLines.length) {
        result.push({
          lineNumber: lineNum,
          type: 'removed',
          content: oldLines[oldIdx],
          oldLineNumber: oldIdx + 1
        })
        oldIdx++
      } else if (newIdx < newLines.length) {
        result.push({
          lineNumber: lineNum,
          type: 'added',
          content: newLines[newIdx],
          newLineNumber: newIdx + 1
        })
        newIdx++
      }
    }
  }
  
  return result
}

interface SplitAlignedRow {
  oldLine?: string
  newLine?: string
  oldLineNumber?: number
  newLineNumber?: number
  type: 'unchanged' | 'added' | 'removed'
}

function computeSplitAlignment(oldLines: string[], newLines: string[]): SplitAlignedRow[] {
  const n = oldLines.length
  const m = newLines.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const rows: SplitAlignedRow[] = []
  let i = 0
  let j = 0
  let oldNum = 0
  let newNum = 0

  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      oldNum += 1
      newNum += 1
      rows.push({
        oldLine: oldLines[i],
        newLine: newLines[j],
        oldLineNumber: oldNum,
        newLineNumber: newNum,
        type: 'unchanged'
      })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      oldNum += 1
      rows.push({
        oldLine: oldLines[i],
        oldLineNumber: oldNum,
        type: 'removed'
      })
      i += 1
    } else {
      newNum += 1
      rows.push({
        newLine: newLines[j],
        newLineNumber: newNum,
        type: 'added'
      })
      j += 1
    }
  }

  while (i < n) {
    oldNum += 1
    rows.push({ oldLine: oldLines[i], oldLineNumber: oldNum, type: 'removed' })
    i += 1
  }
  while (j < m) {
    newNum += 1
    rows.push({ newLine: newLines[j], newLineNumber: newNum, type: 'added' })
    j += 1
  }

  return rows
}

const HighlightedLine = memo(({ 
  content, 
  highlightedHtml,
  isVisible 
}: { 
  content: string
  highlightedHtml: string | null
  isVisible: boolean
}) => {
  if (!isVisible) {
    return <span className="font-mono text-[12px]">{content}</span>
  }
  
  if (highlightedHtml) {
    return (
      <code
        className="hljs font-mono text-[12px] leading-[1.3]"
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />
    )
  }
  
  return <span className="font-mono text-[12px]">{content}</span>
})

HighlightedLine.displayName = 'HighlightedLine'

export function OptimizedDiffViewer({
  oldContent,
  newContent,
  language,
  viewMode = 'unified',
  onViewModeChange,
  onLineSelect,
  leftTitle = 'Base',
  rightTitle = 'Current'
}: OptimizedDiffViewerProps) {
  const [internalViewMode, setInternalViewMode] = useState(viewMode)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: CHUNK_SIZE })
  const [selection, setSelection] = useState<LineSelection | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  
  const actualViewMode = viewMode || internalViewMode
  
  const oldLines = useMemo(() => oldContent.split('\n'), [oldContent])
  const newLines = useMemo(() => newContent.split('\n'), [newContent])
  
  const highlightedOldLines = useMemo(() => {
    if (!language || !hljs.getLanguage(language)) return null
    
    try {
      const highlighted = hljs.highlight(oldContent, { language, ignoreIllegals: true })
      return highlighted.value.split('\n')
    } catch {
      return null
    }
  }, [oldContent, language])
  
  const highlightedNewLines = useMemo(() => {
    if (!language || !hljs.getLanguage(language)) return null
    
    try {
      const highlighted = hljs.highlight(newContent, { language, ignoreIllegals: true })
      return highlighted.value.split('\n')
    } catch {
      return null
    }
  }, [newContent, language])
  
  const diffLines = useMemo(() => {
    if (actualViewMode === 'unified') {
      return computeUnifiedDiff(oldLines, newLines)
    }
    return []
  }, [oldLines, newLines, actualViewMode])

  const splitRows = useMemo(() => {
    if (actualViewMode === 'split') {
      return computeSplitAlignment(oldLines, newLines)
    }
    return []
  }, [oldLines, newLines, actualViewMode])
  
  const maxLines = actualViewMode === 'unified' 
    ? diffLines.length 
    : splitRows.length
  
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    
    const scrollTop = scrollRef.current.scrollTop
    const lineHeight = 20
    const containerHeight = scrollRef.current.clientHeight
    
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN)
    const end = Math.min(
      maxLines,
      Math.ceil((scrollTop + containerHeight) / lineHeight) + OVERSCAN
    )
    
    setVisibleRange({ start, end })
  }, [maxLines])
  
  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return
    
    scrollElement.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    
    return () => scrollElement.removeEventListener('scroll', handleScroll)
  }, [handleScroll])
  
  const handleViewModeToggle = useCallback(() => {
    const newMode = actualViewMode === 'split' ? 'unified' : 'split'
    setInternalViewMode(newMode)
    onViewModeChange?.(newMode)
    setSelection(null)
  }, [actualViewMode, onViewModeChange])
  
  const handleMouseDown = useCallback((e: React.MouseEvent, side: 'old' | 'new', lineNum: number) => {
    e.preventDefault()
    setIsSelecting(true)
    setSelection({ side, startLine: lineNum, endLine: lineNum })
  }, [])
  
  const handleMouseMove = useCallback((_e: React.MouseEvent, side: 'old' | 'new', lineNum: number) => {
    if (!isSelecting || !selection || selection.side !== side) return
    
    setSelection(prev => prev ? { ...prev, endLine: lineNum } : null)
  }, [isSelecting, selection])
  
  const handleMouseUp = useCallback(() => {
    if (isSelecting && selection && onLineSelect) {
      const startIdx = Math.min(selection.startLine - 1, selection.endLine - 1)
      const endIdx = Math.max(selection.startLine - 1, selection.endLine - 1)
      const lines = selection.side === 'old' ? oldLines : newLines
      const selectedContent = lines.slice(startIdx, endIdx + 1)
      
      onLineSelect(
        selection.side,
        Math.min(selection.startLine, selection.endLine),
        Math.max(selection.startLine, selection.endLine),
        selectedContent
      )
    }
    setIsSelecting(false)
  }, [isSelecting, selection, onLineSelect, oldLines, newLines])
  
  useEffect(() => {
    if (isSelecting) {
      document.addEventListener('mouseup', handleMouseUp)
      return () => document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isSelecting, handleMouseUp])
  
  const isLineSelected = useCallback((side: 'old' | 'new', lineNum: number) => {
    if (!selection || selection.side !== side) return false
    const min = Math.min(selection.startLine, selection.endLine)
    const max = Math.max(selection.startLine, selection.endLine)
    return lineNum >= min && lineNum <= max
  }, [selection])
  
  const renderUnifiedView = () => {
    const visibleLines = diffLines.slice(visibleRange.start, visibleRange.end)
    
    return (
      <div 
        ref={scrollRef}
        className="flex-1 overflow-auto bg-slate-950 custom-scrollbar"
        style={{ position: 'relative' }}
      >
        <div style={{ height: `${maxLines * 20}px`, position: 'relative' }}>
          <div style={{ 
            transform: `translateY(${visibleRange.start * 20}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0
          }}>
            {visibleLines.map((line, idx) => {
              const actualIdx = visibleRange.start + idx
              const isVisible = true
              
              return (
                <div
                  key={actualIdx}
                  className={clsx(
                    "flex h-[20px]",
                    line.type === 'added' && "bg-green-950/30",
                    line.type === 'removed' && "bg-red-950/30",
                    isLineSelected(line.oldLineNumber ? 'old' : 'new', line.oldLineNumber || line.newLineNumber || 0) && "bg-blue-900/30"
                  )}
                  onMouseDown={(e) => handleMouseDown(e, line.oldLineNumber ? 'old' : 'new', line.oldLineNumber || line.newLineNumber || 0)}
                  onMouseMove={(e) => handleMouseMove(e, line.oldLineNumber ? 'old' : 'new', line.oldLineNumber || line.newLineNumber || 0)}
                >
                  <div className="w-16 px-2 text-xs text-slate-500 font-mono">
                    {line.oldLineNumber || ''}
                  </div>
                  <div className="w-16 px-2 text-xs text-slate-500 font-mono">
                    {line.newLineNumber || ''}
                  </div>
                  <div className="w-8 text-center text-xs text-slate-500">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ''}
                  </div>
                  <div className="flex-1 px-2 overflow-hidden">
                    <HighlightedLine
                      content={line.content}
                      highlightedHtml={
                        line.oldLineNumber && highlightedOldLines
                          ? highlightedOldLines[line.oldLineNumber - 1]
                          : line.newLineNumber && highlightedNewLines
                          ? highlightedNewLines[line.newLineNumber - 1]
                          : null
                      }
                      isVisible={isVisible}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }
  
  const renderSplitView = () => {
    const visibleRows = splitRows.slice(visibleRange.start, visibleRange.end)
    
    return (
      <div 
        ref={scrollRef}
        className="flex-1 overflow-auto bg-slate-950 custom-scrollbar"
        style={{ position: 'relative' }}
      >
        <div className="flex" style={{ minHeight: `${maxLines * 20}px` }}>
          <div className="flex-1 border-r border-slate-800">
            <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-3 py-1 text-xs font-medium">
              {leftTitle}
            </div>
            <div style={{ 
              transform: `translateY(${visibleRange.start * 20}px)`,
              position: 'relative'
            }}>
              {visibleRows.map((row, idx) => {
                const lineNum = row.oldLineNumber ?? 0
                const isVisible = true
                
                return (
                  <div
                    key={`${visibleRange.start + idx}-old`}
                    className={clsx(
                      "flex h-[20px]",
                      row.type === 'removed' && "bg-red-950/30",
                      isLineSelected('old', lineNum) && "bg-blue-900/30"
                    )}
                    onMouseDown={(e) => lineNum && handleMouseDown(e, 'old', lineNum)}
                    onMouseMove={(e) => lineNum && handleMouseMove(e, 'old', lineNum)}
                  >
                    <div className="w-12 px-2 text-xs text-slate-500 font-mono">
                      {lineNum || ''}
                    </div>
                    <div className="flex-1 px-2 overflow-hidden">
                      <HighlightedLine
                        content={row.oldLine ?? ''}
                        highlightedHtml={row.oldLineNumber && highlightedOldLines ? highlightedOldLines[row.oldLineNumber - 1] : null}
                        isVisible={isVisible}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          
          <div className="flex-1">
            <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-3 py-1 text-xs font-medium">
              {rightTitle}
            </div>
            <div style={{ 
              transform: `translateY(${visibleRange.start * 20}px)`,
              position: 'relative'
            }}>
              {visibleRows.map((row, idx) => {
                const lineNum = row.newLineNumber ?? 0
                const isVisible = true
                
                return (
                  <div
                    key={`${visibleRange.start + idx}-new`}
                    className={clsx(
                      "flex h-[20px]",
                      row.type === 'added' && "bg-green-950/30",
                      isLineSelected('new', lineNum) && "bg-blue-900/30"
                    )}
                    onMouseDown={(e) => lineNum && handleMouseDown(e, 'new', lineNum)}
                    onMouseMove={(e) => lineNum && handleMouseMove(e, 'new', lineNum)}
                  >
                    <div className="w-12 px-2 text-xs text-slate-500 font-mono">
                      {lineNum || ''}
                    </div>
                    <div className="flex-1 px-2 overflow-hidden">
                      <HighlightedLine
                        content={row.newLine ?? ''}
                        highlightedHtml={row.newLineNumber && highlightedNewLines ? highlightedNewLines[row.newLineNumber - 1] : null}
                        isVisible={isVisible}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div ref={containerRef} className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800">
        <div className="text-xs text-slate-400">
          {maxLines} lines • {actualViewMode === 'split' ? 'Split View' : 'Unified View'}
        </div>
        <button
          onClick={handleViewModeToggle}
          className="flex items-center gap-2 px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded transition-colors"
        >
          {actualViewMode === 'split' ? (
            <>
              <VscListFlat />
              <span>Unified</span>
            </>
          ) : (
            <>
              <VscSplitHorizontal />
              <span>Split</span>
            </>
          )}
        </button>
      </div>
      
      {actualViewMode === 'unified' ? renderUnifiedView() : renderSplitView()}
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(30, 41, 59, 0.5);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.8);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(100, 116, 139, 0.9);
        }
      `}</style>
    </div>
  )
}