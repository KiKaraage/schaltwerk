import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLineSelection } from './useLineSelection'

describe('useLineSelection', () => {
  it('initializes with no selection', () => {
    const { result } = renderHook(() => useLineSelection())
    
    expect(result.current.selection).toBeNull()
  })
  
  it('selects single line on click', () => {
    const { result } = renderHook(() => useLineSelection())
    
    act(() => {
      result.current.handleLineClick(5, 'old')
    })
    
    expect(result.current.selection).toEqual({
      startLine: 5,
      endLine: 5,
      side: 'old'
    })
  })
  
  it('extends selection with shift+click', () => {
    const { result } = renderHook(() => useLineSelection())
    
    // First click
    act(() => {
      result.current.handleLineClick(5, 'new')
    })
    
    // Shift+click
    act(() => {
      const event = { shiftKey: true } as React.MouseEvent
      result.current.handleLineClick(10, 'new', event)
    })
    
    expect(result.current.selection).toEqual({
      startLine: 5,
      endLine: 10,
      side: 'new'
    })
  })
  
  it('clears selection when clicking within selected range', () => {
    const { result } = renderHook(() => useLineSelection())
    
    // Select range
    act(() => {
      result.current.handleLineClick(5, 'old')
    })
    
    act(() => {
      const event = { shiftKey: true } as React.MouseEvent
      result.current.handleLineClick(10, 'old', event)
    })
    
    // Click within range
    act(() => {
      result.current.handleLineClick(7, 'old')
    })
    
    expect(result.current.selection).toBeNull()
  })
  
  it('starts new selection when clicking different side', () => {
    const { result } = renderHook(() => useLineSelection())
    
    act(() => {
      result.current.handleLineClick(5, 'old')
    })
    
    act(() => {
      result.current.handleLineClick(10, 'new')
    })
    
    expect(result.current.selection).toEqual({
      startLine: 10,
      endLine: 10,
      side: 'new'
    })
  })
  
  it('extends selection using extendSelection', () => {
    const { result } = renderHook(() => useLineSelection())
    
    act(() => {
      result.current.extendSelection(5, 'old')
    })
    
    expect(result.current.selection).toEqual({
      startLine: 5,
      endLine: 5,
      side: 'old'
    })
    
    act(() => {
      result.current.extendSelection(10, 'old')
    })
    
    expect(result.current.selection).toEqual({
      startLine: 5,
      endLine: 10,
      side: 'old'
    })
  })
  
  it('clears selection', () => {
    const { result } = renderHook(() => useLineSelection())
    
    act(() => {
      result.current.handleLineClick(5, 'old')
    })
    
    act(() => {
      result.current.clearSelection()
    })
    
    expect(result.current.selection).toBeNull()
  })
  
  it('correctly identifies selected lines', () => {
    const { result } = renderHook(() => useLineSelection())
    
    act(() => {
      result.current.handleLineClick(5, 'old')
    })
    
    act(() => {
      const event = { shiftKey: true } as React.MouseEvent
      result.current.handleLineClick(10, 'old', event)
    })
    
    // Lines within range on correct side
    expect(result.current.isLineSelected(5, 'old')).toBe(true)
    expect(result.current.isLineSelected(7, 'old')).toBe(true)
    expect(result.current.isLineSelected(10, 'old')).toBe(true)
    
    // Lines outside range
    expect(result.current.isLineSelected(4, 'old')).toBe(false)
    expect(result.current.isLineSelected(11, 'old')).toBe(false)
    
    // Lines on wrong side
    expect(result.current.isLineSelected(7, 'new')).toBe(false)
    
    // Undefined line number
    expect(result.current.isLineSelected(undefined, 'old')).toBe(false)
  })
  
  it('handles no selection in isLineSelected', () => {
    const { result } = renderHook(() => useLineSelection())
    
    expect(result.current.isLineSelected(5, 'old')).toBe(false)
  })
  
  it('checks if line is in range regardless of side', () => {
    const { result } = renderHook(() => useLineSelection())
    
    act(() => {
      result.current.handleLineClick(5, 'old')
    })
    
    act(() => {
      const event = { shiftKey: true } as React.MouseEvent
      result.current.handleLineClick(10, 'old', event)
    })
    
    expect(result.current.isLineInRange(7)).toBe(true)
    expect(result.current.isLineInRange(3)).toBe(false)
    expect(result.current.isLineInRange(undefined)).toBe(false)
  })
})