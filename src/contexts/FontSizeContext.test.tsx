import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { FontSizeProvider, useFontSize } from './FontSizeContext'

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, _args?: any) => {
    if (cmd === 'para_core_get_font_size') {
      return Promise.resolve(13)
    }
    if (cmd === 'para_core_set_font_size') {
      return Promise.resolve()
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`))
  })
}))

const TestComponent = () => {
  const { baseFontSize, terminalFontSize, uiFontSize, increaseFontSize, decreaseFontSize, resetFontSize } = useFontSize()
  return (
    <div>
      <div data-testid="base-font-size">{baseFontSize}</div>
      <div data-testid="terminal-font-size">{terminalFontSize}</div>
      <div data-testid="ui-font-size">{uiFontSize}</div>
      <button onClick={increaseFontSize} data-testid="increase">+</button>
      <button onClick={decreaseFontSize} data-testid="decrease">-</button>
      <button onClick={resetFontSize} data-testid="reset">Reset</button>
    </div>
  )
}

describe('FontSizeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('provides default font sizes', async () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    await waitFor(() => {
      expect(getByTestId('base-font-size')).toHaveTextContent('13')
      expect(getByTestId('terminal-font-size')).toHaveTextContent('13')
      expect(getByTestId('ui-font-size')).toHaveTextContent('12')
    })
  })

  it('increases font size when increase function is called', () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    act(() => {
      getByTestId('increase').click()
    })

    expect(getByTestId('base-font-size')).toHaveTextContent('14')
  })

  it('decreases font size when decrease function is called', () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    act(() => {
      getByTestId('decrease').click()
    })

    expect(getByTestId('base-font-size')).toHaveTextContent('12')
  })

  it('resets font size when reset function is called', () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    act(() => {
      getByTestId('increase').click()
      getByTestId('increase').click()
    })

    expect(getByTestId('base-font-size')).toHaveTextContent('15')

    act(() => {
      getByTestId('reset').click()
    })

    expect(getByTestId('base-font-size')).toHaveTextContent('13')
  })

  it('persists font size to database', async () => {
    const mockInvoke = vi.mocked((await import('@tauri-apps/api/core')).invoke)
    
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    await waitFor(() => {
      expect(getByTestId('base-font-size')).toHaveTextContent('13')
    })

    act(() => {
      getByTestId('increase').click()
    })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('para_core_set_font_size', { fontSize: 14 })
    })
  })

  it('respects min and max font size limits', () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    // Test minimum limit
    for (let i = 0; i < 10; i++) {
      act(() => {
        getByTestId('decrease').click()
      })
    }
    expect(getByTestId('base-font-size')).toHaveTextContent('8')

    // Reset and test maximum limit
    act(() => {
      getByTestId('reset').click()
    })

    for (let i = 0; i < 20; i++) {
      act(() => {
        getByTestId('increase').click()
      })
    }
    expect(getByTestId('base-font-size')).toHaveTextContent('24')
  })
})