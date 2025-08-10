import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { FocusProvider, useFocus } from './FocusContext'

function wrapper({ children }: { children: React.ReactNode }) {
  return <FocusProvider>{children}</FocusProvider>
}

describe('FocusContext', () => {
  it('defaults to claude for unknown sessions', () => {
    const { result } = renderHook(() => useFocus(), { wrapper })
    expect(result.current.getFocusForSession('unknown')).toBe('claude')
    expect(result.current.currentFocus).toBeNull()
  })

  it('sets focus per session and updates currentFocus', () => {
    const { result } = renderHook(() => useFocus(), { wrapper })
    act(() => result.current.setFocusForSession('sess-1', 'terminal'))
    expect(result.current.getFocusForSession('sess-1')).toBe('terminal')
    expect(result.current.currentFocus).toBe('terminal')

    act(() => result.current.setCurrentFocus('diff'))
    expect(result.current.currentFocus).toBe('diff')
  })
})
