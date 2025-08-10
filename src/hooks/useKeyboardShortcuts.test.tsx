import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

function pressKey(key: string, { metaKey = false, ctrlKey = false, shiftKey = false } = {}) {
  const event = new KeyboardEvent('keydown', { key, metaKey, ctrlKey, shiftKey })
  window.dispatchEvent(event)
}

describe('useKeyboardShortcuts', () => {
  it('invokes orchestrator selection on mod+1', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()

    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 0 }))

    // Simulate mac with meta by setting platform
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })

    pressKey('1', { metaKey: true })
    expect(onSelectOrchestrator).toHaveBeenCalled()
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('invokes session selection for keys 2..9 within bounds', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 3 }))
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })

    pressKey('2', { metaKey: true })
    pressKey('4', { metaKey: true })
    // 2 -> index 0, 4 -> index 2
    expect(onSelectSession).toHaveBeenCalledWith(0)
    expect(onSelectSession).toHaveBeenCalledWith(2)
  })

  it('does not invoke session selection when index out of bounds', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 1 }))
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })

    pressKey('3', { metaKey: true })
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('invokes cancel callback with and without shift on mod+d / mod+D', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    const onCancelSelectedSession = vi.fn()

    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onCancelSelectedSession, sessionCount: 5 }))
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })

    pressKey('d', { metaKey: true })
    pressKey('D', { metaKey: true, shiftKey: true })

    expect(onCancelSelectedSession).toHaveBeenCalledWith(false)
    expect(onCancelSelectedSession).toHaveBeenCalledWith(true)
  })
})
