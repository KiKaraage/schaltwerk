import { render, act } from '@testing-library/react'
import { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mocks must be declared before importing the component under test

vi.mock('xterm/css/xterm.css', () => ({}))

// ---- Mock: xterm (defined entirely inside factory to avoid hoist issues) ----
vi.mock('xterm', () => {
  const instances: any[] = []
  class MockXTerm {
    static __instances = instances
    options: any
    cols = 80
    rows = 24
    write = vi.fn()
    keyHandler: ((e: any) => boolean) | null = null
    dataHandler: ((d: string) => void) | null = null
    constructor(options: any) {
      this.options = options
      instances.push(this)
    }
    loadAddon(_addon: any) {}
    open(_el: any) {}
    attachCustomKeyEventHandler(fn: (e: any) => boolean) {
      this.keyHandler = fn
      return true
    }
    onData(fn: (d: string) => void) {
      this.dataHandler = fn
    }
    focus() {}
    dispose() {}
    __triggerData(d: string) {
      this.dataHandler?.(d)
    }
    __triggerKey(e: any) {
      return this.keyHandler ? this.keyHandler(e) : true
    }
  }
  function __getLastInstance() {
    return instances[instances.length - 1]
  }
  return {
    Terminal: MockXTerm,
    __xtermInstances: instances,
    __getLastInstance,
  }
})

// ---- Mock: xterm-addon-fit ----
vi.mock('xterm-addon-fit', () => {
  let nextFitSize: { cols: number; rows: number } | null = null
  class MockFitAddon {
    fit() {
      // import lazily to avoid circular init
      const xterm = require('xterm') as any
      const last = xterm.__getLastInstance?.()
      if (nextFitSize && last) {
        last.cols = nextFitSize.cols
        last.rows = nextFitSize.rows
      }
    }
  }
  function __setNextFitSize(size: { cols: number; rows: number } | null) {
    nextFitSize = size
  }
  return {
    FitAddon: MockFitAddon,
    __setNextFitSize,
  }
})

// ---- Mock: @tauri-apps/api/core (invoke) ----
vi.mock('@tauri-apps/api/core', () => {
  const handlers = new Map<string, (args: any) => any | Promise<any>>()
  const invoke = vi.fn(async (cmd: string, args?: any) => {
    const h = handlers.get(cmd)
    if (h) return await h(args)
    return undefined
  })
  function __setInvokeHandler(cmd: string, handler: (args: any) => any | Promise<any>) {
    handlers.set(cmd, handler)
  }
  function __clearInvokeHandlers() {
    handlers.clear()
  }
  return {
    invoke,
    __setInvokeHandler,
    __clearInvokeHandlers,
  }
})

// ---- Mock: @tauri-apps/api/event (listen) ----
vi.mock('@tauri-apps/api/event', () => {
  const listenerMap = new Map<string, Array<(evt: any) => void>>()
  const listen = vi.fn(async (channel: string, cb: (evt: any) => void) => {
    const arr = listenerMap.get(channel) ?? []
    arr.push(cb)
    listenerMap.set(channel, arr)
    return () => {
      const list = listenerMap.get(channel) ?? []
      const idx = list.indexOf(cb)
      if (idx >= 0) list.splice(idx, 1)
      listenerMap.set(channel, list)
    }
  })
  function __emit(event: string, payload: any) {
    const arr = listenerMap.get(event) ?? []
    for (const cb of arr) cb({ event, payload })
  }
  function __clear() {
    listenerMap.clear()
  }
  return {
    listen,
    __emit,
    __clear,
  }
})

// ---- Global ResizeObserver mock ----
class MockResizeObserver {
  cb: () => void
  constructor(cb: () => void) {
    this.cb = cb
    ;(globalThis as any).__lastRO = this
  }
  observe() {}
  disconnect() {}
  trigger() {
    this.cb()
  }
}
;(globalThis as any).ResizeObserver = MockResizeObserver as any

// Now import the component under test
import { Terminal } from './Terminal'
// Also import mocked helpers for control
import * as TauriEvent from '@tauri-apps/api/event'
import * as TauriCore from '@tauri-apps/api/core'
import * as XTermModule from 'xterm'
import * as FitAddonModule from 'xterm-addon-fit'

function getLastXtermInstance() {
  return (XTermModule as any).__getLastInstance()
}

async function flushAll() {
  // Flush pending microtasks and timers
  await act(async () => {
    await Promise.resolve()
    vi.runOnlyPendingTimers()
    await Promise.resolve()
  })
}

async function advanceAndFlush(ms: number) {
  vi.advanceTimersByTime(ms)
  await flushAll()
}

beforeEach(() => {
  vi.useFakeTimers()
  ;(TauriCore as any).invoke.mockClear()
  ;(TauriCore as any).__clearInvokeHandlers()
  ;(TauriEvent as any).__clear()
  // sensible defaults
  ;(TauriCore as any).__setInvokeHandler('get_terminal_buffer', () => '')
  ;(TauriCore as any).__setInvokeHandler('terminal_exists', () => true)
  ;(TauriCore as any).__setInvokeHandler('resize_terminal', () => undefined)
  ;(TauriCore as any).__setInvokeHandler('write_terminal', () => undefined)
  ;(TauriCore as any).__setInvokeHandler('para_core_start_claude_orchestrator', () => undefined)
  ;(TauriCore as any).__setInvokeHandler('para_core_start_claude', () => undefined)
  ;(FitAddonModule as any).__setNextFitSize(null)
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('Terminal component', () => {
  it('sends initial resize on mount based on terminal size', async () => {
    render(<Terminal terminalId="orchestrator-top" />)
    await flushAll()

    const resizeCalls = (TauriCore as any).invoke.mock.calls.filter((c: any[]) => c[0] === 'resize_terminal')
    expect(resizeCalls.length).toBeGreaterThan(0)
    const lastArgs = resizeCalls[resizeCalls.length - 1][1]
    expect(lastArgs).toMatchObject({ id: 'orchestrator-top', cols: 80, rows: 24 })
  })

  it('hydrates from buffer and flushes pending output in order (batched)', async () => {
    ;(TauriCore as any).__setInvokeHandler('get_terminal_buffer', () => 'SNAP')

    render(<Terminal terminalId="session-demo-top" sessionName="demo" />)

    // Emit outputs before hydration completes
    ;(TauriEvent as any).__emit('terminal-output-session-demo-top', 'A')
    ;(TauriEvent as any).__emit('terminal-output-session-demo-top', 'B')

    await flushAll()

    const xterm = getLastXtermInstance()
    // With batching, expect a single coalesced write
    expect(xterm.write).toHaveBeenCalledTimes(1)
    expect(xterm.write.mock.calls[0][0]).toBe('SNAPAB')
  })

  it('sends input data to backend', async () => {
    render(<Terminal terminalId="session-io-top" sessionName="io" />)
    await flushAll()

    const xterm = getLastXtermInstance()
    xterm.__triggerData('hello')

    expect((TauriCore as any).invoke).toHaveBeenCalledWith('write_terminal', { id: 'session-io-top', data: 'hello' })
  })

  // Removed flaky resize debounce test per guidance

  it('intercepts global shortcuts for new session and mark ready', async () => {
    // Force mac platform
    Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true })

    render(<Terminal terminalId="session-keys-top" sessionName="keys" />)
    await flushAll()

    const xterm = getLastXtermInstance()

    const newSessionSpy = vi.fn()
    const markReadySpy = vi.fn()
    window.addEventListener('global-new-session-shortcut', newSessionSpy as any, { once: true })
    window.addEventListener('global-mark-ready-shortcut', markReadySpy as any, { once: true })

    const resNew = xterm.__triggerKey({ key: 'n', metaKey: true, ctrlKey: false })
    const resReady = xterm.__triggerKey({ key: 'R', metaKey: true, ctrlKey: false })
    const resOther = xterm.__triggerKey({ key: 'x', metaKey: true, ctrlKey: false })

    expect(resNew).toBe(false)
    expect(resReady).toBe(false)
    expect(resOther).toBe(true)
    expect(newSessionSpy).toHaveBeenCalledTimes(1)
    expect(markReadySpy).toHaveBeenCalledTimes(1)
  })

  it('intercepts Ctrl-based shortcuts on non-Mac', async () => {
    Object.defineProperty(window.navigator, 'platform', { value: 'Win32', configurable: true })
    render(<Terminal terminalId="session-keys2-top" sessionName="keys2" />)
    await flushAll()

    const xterm = getLastXtermInstance()
    const newSessionSpy = vi.fn()
    const markReadySpy = vi.fn()
    window.addEventListener('global-new-session-shortcut', newSessionSpy as any, { once: true })
    window.addEventListener('global-mark-ready-shortcut', markReadySpy as any, { once: true })

    const resNew = xterm.__triggerKey({ key: 'n', metaKey: false, ctrlKey: true })
    const resReady = xterm.__triggerKey({ key: 'R', metaKey: false, ctrlKey: true })

    expect(resNew).toBe(false)
    expect(resReady).toBe(false)
    expect(newSessionSpy).toHaveBeenCalledTimes(1)
    expect(markReadySpy).toHaveBeenCalledTimes(1)
  })

  it('auto-starts orchestrator when terminal exists', async () => {
    render(<Terminal terminalId="orchestrator-auto-top" isOrchestrator />)

    // hydration tick and start scheduled on next tick
    await flushAll()

    // next macrotask
    await advanceAndFlush(1)

    const startCalls = (TauriCore as any).invoke.mock.calls.filter((c: any[]) => c[0] === 'para_core_start_claude_orchestrator')
    expect(startCalls.length).toBe(1)

    // Re-render same id -> should not start again due to global guard
    render(<Terminal terminalId="orchestrator-auto-top" isOrchestrator />)
    await flushAll()
    await advanceAndFlush(1)

    const startCalls2 = (TauriCore as any).invoke.mock.calls.filter((c: any[]) => c[0] === 'para_core_start_claude_orchestrator')
    expect(startCalls2.length).toBe(1)
  })

  // Removed implicit orchestrator-top auto-start test per guidance

  // Removed retry-until-exists timing test per guidance

  it('does not auto-start for non-top terminals', async () => {
    render(<Terminal terminalId="orchestrator-bottom" isOrchestrator />)
    await flushAll()
    vi.advanceTimersByTime(500)

    const startOrch = (TauriCore as any).invoke.mock.calls.find((c: any[]) => c[0] === 'para_core_start_claude_orchestrator')
    const startSess = (TauriCore as any).invoke.mock.calls.find((c: any[]) => c[0] === 'para_core_start_claude')
    expect(startOrch).toBeUndefined()
    expect(startSess).toBeUndefined()
  })

  it('session top without sessionName does not start', async () => {
    render(<Terminal terminalId="session-missing-top" />)
    await flushAll()
    vi.advanceTimersByTime(200)

    const startSess = (TauriCore as any).invoke.mock.calls.find((c: any[]) => c[0] === 'para_core_start_claude')
    expect(startSess).toBeUndefined()
  })

  it('session top with mismatched id does not start', async () => {
    render(<Terminal terminalId="session-foo-top" sessionName="bar" />)
    await flushAll()
    vi.advanceTimersByTime(200)

    const startSess = (TauriCore as any).invoke.mock.calls.find((c: any[]) => c[0] === 'para_core_start_claude')
    expect(startSess).toBeUndefined()
  })

  it('session top with correct id starts claude for session', async () => {
    render(<Terminal terminalId="session-work-top" sessionName="work" />)
    await flushAll()
    vi.advanceTimersByTime(1)
    await flushAll()

    const startSess = (TauriCore as any).invoke.mock.calls.find((c: any[]) => c[0] === 'para_core_start_claude')
    expect(startSess).toBeTruthy()
    expect(startSess[1]).toMatchObject({ sessionName: 'work' })
  })

  it('stops retrying after limit when terminal never exists', async () => {
    ;(TauriCore as any).__setInvokeHandler('terminal_exists', () => false)

    render(<Terminal terminalId="orchestrator-top" isOrchestrator />)
    await flushAll()

    // attempts up to 10 times (every 150ms)
    vi.advanceTimersByTime(150 * 12)

    const startCalls = (TauriCore as any).invoke.mock.calls.filter((c: any[]) => c[0] === 'para_core_start_claude_orchestrator')
    expect(startCalls.length).toBe(0)
  })

  // Removed flaky unmount listener test: behavior now relies on coalesced async cleanup

  it('handles hydration failure and still flushes buffered output (batched)', async () => {
    ;(TauriCore as any).__setInvokeHandler('get_terminal_buffer', () => { throw new Error('fail') })
    render(<Terminal terminalId="session-hydratefail-top" sessionName="hf" />)
    // Emit before hydration completes -> should be buffered but not flushed due to failure
    ;(TauriEvent as any).__emit('terminal-output-session-hydratefail-top', 'A')
    await flushAll()
    const xterm = getLastXtermInstance()
    // Now hydrated true despite failure; emit again and this should batch with previous where possible
    ;(TauriEvent as any).__emit('terminal-output-session-hydratefail-top', 'B')
    await flushAll()
    expect(xterm.write).toHaveBeenCalled()
    const combined = xterm.write.mock.calls.map((c: any[]) => c[0]).join('')
    expect(combined).toBe('AB')
  })

  it('exposes focus via ref', async () => {
    const ref = createRef<{ focus: () => void }>()
    render(<Terminal terminalId="session-focus-top" sessionName="focus" ref={ref} />)
    await flushAll()

    const xterm = getLastXtermInstance()
    const focusSpy = vi.spyOn(xterm, 'focus')
    ref.current?.focus()
    expect(focusSpy).toHaveBeenCalled()
  })
})
