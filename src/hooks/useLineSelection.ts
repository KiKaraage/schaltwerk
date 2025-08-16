import { useState, useCallback, useRef } from 'react'

export interface LineSelection {
  startLine: number
  endLine: number
  side: 'old' | 'new'
}

export function useLineSelection() {
  const [selection, setSelection] = useState<LineSelection | null>(null)
  const lastClickedLine = useRef<{ line: number; side: 'old' | 'new' } | null>(null)
  
  const handleLineClick = useCallback((lineNum: number, side: 'old' | 'new', event?: MouseEvent | React.MouseEvent) => {
    const isShiftClick = event?.shiftKey
    
    if (isShiftClick && lastClickedLine.current && lastClickedLine.current.side === side) {
      // Shift+click: extend selection
      const start = Math.min(lastClickedLine.current.line, lineNum)
      const end = Math.max(lastClickedLine.current.line, lineNum)
      setSelection({ startLine: start, endLine: end, side })
    } else if (selection && selection.side === side && 
               lineNum >= selection.startLine && lineNum <= selection.endLine) {
      // Clicking within current selection: clear it
      setSelection(null)
      lastClickedLine.current = null
    } else {
      // Regular click: select single line
      setSelection({ startLine: lineNum, endLine: lineNum, side })
      lastClickedLine.current = { line: lineNum, side }
    }
  }, [selection])
  
  const extendSelection = useCallback((lineNum: number, side: 'old' | 'new') => {
    if (!selection || selection.side !== side) {
      // Start new selection
      setSelection({ startLine: lineNum, endLine: lineNum, side })
      lastClickedLine.current = { line: lineNum, side }
    } else {
      // Extend existing selection
      const start = Math.min(selection.startLine, lineNum)
      const end = Math.max(selection.endLine, lineNum)
      setSelection({ startLine: start, endLine: end, side })
    }
  }, [selection])
  
  const clearSelection = useCallback(() => {
    setSelection(null)
    lastClickedLine.current = null
  }, [])
  
  const isLineSelected = useCallback((lineNum: number | undefined, side: 'old' | 'new') => {
    if (!selection || !lineNum || selection.side !== side) return false
    return lineNum >= selection.startLine && lineNum <= selection.endLine
  }, [selection])
  
  const isLineInRange = useCallback((lineNum: number | undefined) => {
    if (!selection || !lineNum) return false
    return lineNum >= selection.startLine && lineNum <= selection.endLine
  }, [selection])
  
  return {
    selection,
    handleLineClick,
    extendSelection,
    clearSelection,
    isLineSelected,
    isLineInRange
  }
}