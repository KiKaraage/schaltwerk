import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

// ---- Mocks (must be declared before importing the component) ----

// Mock react-split to capture props and render children
vi.mock('react-split', () => {
  let lastProps: any = null
  const SplitMock = ({ children, ...props }: any) => {
    lastProps = props
    return (
      <div
        data-testid="split"
        data-direction={props.direction}
        data-sizes={JSON.stringify(props.sizes)}
        data-minsize={props.minSize}
        data-gutter={props.gutterSize}
        className="h-full flex flex-col"
      >
        {children}
      </div>
    )
  }
  function __getLastProps() {
    return lastProps
  }
  return { default: SplitMock, __getLastProps }
})

// Spy-able store for our Terminal mock
const mountCount = new Map<string, number>()
const unmountCount = new Map<string, number>()
const focusSpies = new Map<string, ReturnType<typeof vi.fn>>()

// Mock the Terminal component used by TerminalGrid
vi.mock('./Terminal', () => {
  const TerminalMock = forwardRef<any, any>(function TerminalMock(props, ref) {
    const { terminalId, className = '', sessionName, isOrchestrator } = props
    const focus = vi.fn()
    focusSpies.set(terminalId, focus)
    useEffect(() => {
      mountCount.set(terminalId, (mountCount.get(terminalId) || 0) + 1)
      return () => {
        unmountCount.set(terminalId, (unmountCount.get(terminalId) || 0) + 1)
        focusSpies.delete(terminalId)
      }
    }, [terminalId])

    useImperativeHandle(ref, () => ({ focus }), [focus])

    return (
      <div
        data-testid={`terminal-${terminalId}`}
        data-terminal-id={terminalId}
        data-session-name={sessionName || ''}
        data-orchestrator={isOrchestrator ? '1' : '0'}
        className={className}
      />
    )
  })

  function __getFocusSpy(id: string) {
    return focusSpies.get(id)
  }
  function __getMountCount(id: string) {
    return mountCount.get(id) || 0
  }
  function __getUnmountCount(id: string) {
    return unmountCount.get(id) || 0
  }

  return {
    Terminal: TerminalMock,
    __getFocusSpy,
    __getMountCount,
    __getUnmountCount,
  }
})

// Mock Tauri core invoke used by SelectionContext (providers in tests)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

// Now import component under test and helpers
import { TerminalGrid } from './TerminalGrid'
import { TestProviders } from '../../tests/test-utils'
import { useSelection } from '../../contexts/SelectionContext'
import { useFocus } from '../../contexts/FocusContext'

// Bridge to call context setters from tests sharing the same provider tree
let bridge: {
  setSelection: ReturnType<typeof useSelection>['setSelection']
  setCurrentFocus: ReturnType<typeof useFocus>['setCurrentFocus']
  setFocusForSession: ReturnType<typeof useFocus>['setFocusForSession']
  getFocusForSession: ReturnType<typeof useFocus>['getFocusForSession']
  getSessionKey: () => string
  isReady: boolean
  terminals: ReturnType<typeof useSelection>['terminals']
} | null = null

function ControlBridge() {
  const { selection, setSelection, isReady, terminals } = useSelection()
  const { setCurrentFocus, setFocusForSession, getFocusForSession } = useFocus()
  useEffect(() => {
    bridge = {
      setSelection,
      setCurrentFocus,
      setFocusForSession,
      getFocusForSession,
      getSessionKey: () => (selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'),
      isReady,
      terminals,
    }
  }, [selection, setSelection, setCurrentFocus, setFocusForSession, getFocusForSession, isReady, terminals])
  return null
}


beforeEach(() => {
  vi.useFakeTimers()
  mountCount.clear()
  unmountCount.clear()
  focusSpies.clear()
  vi.clearAllMocks()

  mockInvoke.mockImplementation((command: string, args?: any) => {
    switch (command) {
      case 'get_current_directory':
        return Promise.resolve('/test/cwd')
      case 'terminal_exists':
        // Terminal doesn't exist initially, forcing creation
        return Promise.resolve(false)
      case 'create_terminal':
        // Mark as created
        const terminalId = args?.id
        if (terminalId) {
          mountCount.set(terminalId, 0) // Mark as created but not yet mounted
        }
        return Promise.resolve()
      case 'para_core_get_session':
        return Promise.resolve({
          worktree_path: '/session/worktree',
          session_id: args?.name || 'test-session',
        })
      default:
        return Promise.resolve(undefined)
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderGrid() {
  return render(
    <TestProviders>
      <ControlBridge />
      <TerminalGrid />
    </TestProviders>
  )
}

describe('TerminalGrid', () => {
  it('renders dual-terminal layout with correct headers and ids (orchestrator)', async () => {
    renderGrid()
    // Use real timers to allow async initialization to complete
    vi.useRealTimers()

    // Wait for bridge to be ready with increased timeout
    await waitFor(() => {
      expect(bridge).toBeDefined()
      expect(bridge?.isReady).toBe(true)
    }, { timeout: 3000 })

    // Headers should be visible
    expect(screen.getByText('Orchestrator — main repo')).toBeInTheDocument()
    expect(screen.getByText('Terminal — main')).toBeInTheDocument()

    // Terminal components should use the actual IDs from the context
    if (!bridge) throw new Error('Bridge not initialized')
    expect(screen.getByTestId(`terminal-${bridge.terminals.top}`)).toBeInTheDocument()
    expect(screen.getByTestId(`terminal-${bridge.terminals.bottom}`)).toBeInTheDocument()
  })

  it('respects split view proportions and layout props', async () => {
    renderGrid()
    // Use real timers to allow async initialization to complete
    vi.useRealTimers()
    
    // Wait for bridge to be ready with increased timeout
    await waitFor(() => {
      expect(bridge).toBeDefined()
      expect(bridge?.isReady).toBe(true)
    }, { timeout: 3000 })
    
    const split = screen.getByTestId('split')
    expect(split.getAttribute('data-direction')).toBe('vertical')
    expect(split.getAttribute('data-sizes')).toBe(JSON.stringify([65, 35]))
    expect(split.getAttribute('data-minsize')).toBe('120')
    expect(split.getAttribute('data-gutter')).toBe('8')
  })

  it('focuses top/bottom terminals on header and body clicks', async () => {
    renderGrid()
    // Use real timers to allow async initialization to complete
    vi.useRealTimers()

    // Wait for bridge to be ready with increased timeout
    await waitFor(() => {
      expect(bridge).toBeDefined()
      expect(bridge?.isReady).toBe(true)
    }, { timeout: 3000 })

    // Click top header -> focus claude (top) after 100ms
    fireEvent.click(screen.getByText('Orchestrator — main repo'))
    await new Promise(r => setTimeout(r, 120))
    const topFocus = (await import('./Terminal')) as any
    expect(topFocus.__getFocusSpy(bridge!.terminals.top)).toHaveBeenCalled()

    // Click bottom header -> focus terminal (bottom)
    fireEvent.click(screen.getByText('Terminal — main'))
    await new Promise(r => setTimeout(r, 120))
    const bottomFocusSpy = (await import('./Terminal')) as any
    expect(bottomFocusSpy.__getFocusSpy(bridge!.terminals.bottom)).toHaveBeenCalled()

    // Also clicking bodies should focus
    const topBody = screen.getByTestId(`terminal-${bridge!.terminals.top}`).parentElement as HTMLElement
    const bottomBody = screen.getByTestId(`terminal-${bridge!.terminals.bottom}`).parentElement as HTMLElement
    fireEvent.click(topBody)
    await new Promise(r => setTimeout(r, 120))
    expect(topFocus.__getFocusSpy(bridge!.terminals.top)).toHaveBeenCalled()
    fireEvent.click(bottomBody)
    await new Promise(r => setTimeout(r, 120))
    expect(bottomFocusSpy.__getFocusSpy(bridge!.terminals.bottom)).toHaveBeenCalled()
  })

  it('switches terminals when session changes and focuses according to session focus state', async () => {
    renderGrid()
    // Use real timers for findBy* polling to avoid hang with fake timers
    vi.useRealTimers()

    // Wait for provider initialization
    await waitFor(() => {
      if (!bridge) throw new Error('bridge not ready')
      expect(bridge.isReady).toBe(true)
    }, { timeout: 2000 })

    // Change selection to a session
    await act(async () => {
      await bridge!.setSelection({ kind: 'session', payload: 'dev', worktreePath: '/dev/path' })
    })
    // allow state to settle
    await Promise.resolve()

    // Headers reflect new session
    expect(await screen.findByText('Session — dev', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('Terminal — dev')).toBeInTheDocument()

    // New terminal ids mounted (remounted due to key change)
    expect(screen.getByTestId('terminal-session-dev-top')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-session-dev-bottom')).toBeInTheDocument()

    // Click headers to drive focus
    const m = (await import('./Terminal')) as any
    fireEvent.click(screen.getByText('Terminal — dev'))
    await new Promise(r => setTimeout(r, 120))
    expect(m.__getFocusSpy('session-dev-bottom')).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Session — dev'))
    await new Promise(r => setTimeout(r, 120))
    expect(m.__getFocusSpy('session-dev-top')).toHaveBeenCalled()
  })

  it('handles terminal reset events by remounting terminals and cleans up on unmount', async () => {
    const utils = renderGrid()
    // Use real timers to allow async initialization to complete
    vi.useRealTimers()

    // Wait for bridge to be ready with increased timeout
    await waitFor(() => {
      expect(bridge).toBeDefined()
      expect(bridge?.isReady).toBe(true)
    }, { timeout: 3000 })

    const m = (await import('./Terminal')) as any
    const topId = bridge!.terminals.top
    const bottomId = bridge!.terminals.bottom
    
    expect(m.__getMountCount(topId)).toBe(1)
    expect(m.__getMountCount(bottomId)).toBe(1)

    // Dispatch reset event -> key increments -> both terminals remount
    act(() => {
      window.dispatchEvent(new Event('schaltwerk:reset-terminals'))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(m.__getMountCount(topId)).toBe(2)
    expect(m.__getMountCount(bottomId)).toBe(2)

    // Unmount component -> listener should be removed; subsequent events won't change counts
    utils.unmount()
    // Each terminal should have unmounted at least once
    expect(m.__getUnmountCount(topId)).toBeGreaterThan(0)
    expect(m.__getUnmountCount(bottomId)).toBeGreaterThan(0)
    act(() => {
      window.dispatchEvent(new Event('schaltwerk:reset-terminals'))
    })

    // After the reset, terminals should have been remounted (count of 2)
    expect(m.__getMountCount(topId)).toBe(2)
    expect(m.__getMountCount(bottomId)).toBe(2)
  })
})
