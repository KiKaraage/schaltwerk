import { describe, it, expect } from 'vitest'
import { computeNextSelectedSessionId, EnrichedSessionLike } from './selectionNext'

const sessions = (ids: string[]): EnrichedSessionLike[] => ids.map(id => ({ info: { session_id: id } }))

describe('computeNextSelectedSessionId', () => {
  it('returns null when removed is not the current selection', () => {
    const sorted = sessions(['a', 'b', 'c'])
    expect(computeNextSelectedSessionId(sorted, 'b', 'a')).toBeNull()
  })

  it('selects same index (next item) when possible', () => {
    const sorted = sessions(['a', 'b', 'c'])
    // removing b while b selected -> should select c (same index 1)
    expect(computeNextSelectedSessionId(sorted, 'b', 'b')).toBe('c')
  })

  it('selects previous when removing the last item', () => {
    const sorted = sessions(['x', 'y', 'z'])
    // removing z while z selected -> should select y
    expect(computeNextSelectedSessionId(sorted, 'z', 'z')).toBe('y')
  })

  it('returns null when list becomes empty', () => {
    const sorted = sessions(['only'])
    expect(computeNextSelectedSessionId(sorted, 'only', 'only')).toBeNull()
  })

  it('returns null if removed id not found in list', () => {
    const sorted = sessions(['a', 'b'])
    expect(computeNextSelectedSessionId(sorted, 'missing', 'missing')).toBeNull()
  })
})
