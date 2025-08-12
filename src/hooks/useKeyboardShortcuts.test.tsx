import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

function pressKey(key: string, { metaKey = false, ctrlKey = false, shiftKey = false } = {}) {
  const event = new KeyboardEvent('keydown', { key, metaKey, ctrlKey, shiftKey, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
}

describe('useKeyboardShortcuts', () => {
  it('invokes orchestrator selection on mod+1', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()

    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 0 }))

    // Simulate mac with meta by setting userAgent
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', configurable: true })

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

  it('opens diff on mod+g and cancels on mod+d', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    const onCancelSelectedSession = vi.fn()
    const onOpenDiffViewer = vi.fn()

    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onCancelSelectedSession, onOpenDiffViewer, sessionCount: 5 }))
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })

    pressKey('g', { metaKey: true })
    pressKey('d', { metaKey: true })

    expect(onOpenDiffViewer).toHaveBeenCalled()
    expect(onCancelSelectedSession).toHaveBeenCalledWith(false)
  })

  it('does not navigate sessions with arrow keys when diff viewer is open', () => {
    const onSelectPrevSession = vi.fn()
    const onSelectNextSession = vi.fn()
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()

    renderHook(() => useKeyboardShortcuts({ 
      onSelectOrchestrator, 
      onSelectSession, 
      onSelectPrevSession, 
      onSelectNextSession,
      sessionCount: 3,
      isDiffViewerOpen: true
    }))
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })

    pressKey('ArrowUp', { metaKey: true })
    pressKey('ArrowDown', { metaKey: true })

    expect(onSelectPrevSession).not.toHaveBeenCalled()
    expect(onSelectNextSession).not.toHaveBeenCalled()
  })

  it('navigates sessions with arrow keys when diff viewer is closed', () => {
    const onSelectPrevSession = vi.fn()
    const onSelectNextSession = vi.fn()
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()

    renderHook(() => useKeyboardShortcuts({ 
      onSelectOrchestrator, 
      onSelectSession, 
      onSelectPrevSession, 
      onSelectNextSession,
      sessionCount: 3,
      isDiffViewerOpen: false
    }))
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })

    pressKey('ArrowUp', { metaKey: true })
    pressKey('ArrowDown', { metaKey: true })

    expect(onSelectPrevSession).toHaveBeenCalled()
    expect(onSelectNextSession).toHaveBeenCalled()
  })

  it('uses ctrl on non-mac platforms and meta on mac', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()

    // Non-mac: meta should NOT trigger, ctrl SHOULD
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true })
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 0 }))
    pressKey('1', { metaKey: true })
    expect(onSelectOrchestrator).not.toHaveBeenCalled()
    pressKey('1', { ctrlKey: true })
    expect(onSelectOrchestrator).toHaveBeenCalled()

    // Mac: meta SHOULD trigger
    Object.defineProperty(navigator, 'userAgent', { value: 'Macintosh Mac OS', configurable: true })
    const onSelectOrchestrator2 = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator: onSelectOrchestrator2, onSelectSession, sessionCount: 0 }))
    pressKey('1', { metaKey: true })
    expect(onSelectOrchestrator2).toHaveBeenCalled()
  })

  it('preventDefault is called for handled shortcuts and not for ignored ones', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    const onSelectPrevSession = vi.fn()
    const onOpenDiffViewer = vi.fn()
    const onFocusTerminal = vi.fn()

    Object.defineProperty(navigator, 'userAgent', { value: 'Macintosh', configurable: true })
    renderHook(() => useKeyboardShortcuts({ 
      onSelectOrchestrator, 
      onSelectSession, 
      onSelectPrevSession,
      onOpenDiffViewer,
      onFocusTerminal,
      sessionCount: 3,
      isDiffViewerOpen: false,
    }))

    const captureDefault = (key: string, opts: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}) => {
      let prevented = false
      const listener = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
      window.addEventListener('keydown', listener)
      pressKey(key, opts)
      window.removeEventListener('keydown', listener)
      return prevented
    }

    expect(captureDefault('1', { metaKey: true })).toBe(true)
    expect(captureDefault('2', { metaKey: true })).toBe(true)
    expect(captureDefault('g', { metaKey: true })).toBe(true)
    expect(captureDefault('/', { metaKey: true })).toBe(true)

    // Not handled: missing modifier
    expect(captureDefault('1', { metaKey: false })).toBe(false)
  })

  it('shift modifies cancel behavior (immediate=true)', () => {
    const onCancelSelectedSession = vi.fn()
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    Object.defineProperty(navigator, 'userAgent', { value: 'Mac', configurable: true })
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onCancelSelectedSession, sessionCount: 2 }))

    pressKey('d', { metaKey: true, shiftKey: true })
    expect(onCancelSelectedSession).toHaveBeenCalledWith(true)
  })

  it('context-specific: arrows do not preventDefault when diff viewer open', () => {
    const onSelectPrevSession = vi.fn()
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    Object.defineProperty(navigator, 'userAgent', { value: 'Mac', configurable: true })
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onSelectPrevSession, sessionCount: 2, isDiffViewerOpen: true }))
    let prevented = false
    const listener = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
    window.addEventListener('keydown', listener)
    pressKey('ArrowUp', { metaKey: true })
    window.removeEventListener('keydown', listener)
    expect(prevented).toBe(false)
    expect(onSelectPrevSession).not.toHaveBeenCalled()
  })

  it('context-specific: \'/\' only prevents when callback provided', () => {
    const onSelectOrchestrator = vi.fn()
    const onSelectSession = vi.fn()
    Object.defineProperty(navigator, 'userAgent', { value: 'Mac', configurable: true })
    // Without callback
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, sessionCount: 1 }))
    let prevented = false
    const l1 = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
    window.addEventListener('keydown', l1)
    pressKey('/', { metaKey: true })
    window.removeEventListener('keydown', l1)
    expect(prevented).toBe(false)

    // With callback
    const onFocusTerminal = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onFocusTerminal, sessionCount: 1 }))
    prevented = false
    const l2 = (e: Event) => { prevented = (e as KeyboardEvent).defaultPrevented }
    window.addEventListener('keydown', l2)
    pressKey('/', { metaKey: true })
    window.removeEventListener('keydown', l2)
    expect(prevented).toBe(true)
    expect(onFocusTerminal).toHaveBeenCalled()
  })
})
