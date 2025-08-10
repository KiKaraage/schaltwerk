import { compareSessions, sortSessions } from './sessionSort'

describe('sessionSort', () => {
  type S = { info: { ready_to_merge?: boolean; last_modified?: string } }

  const make = (ready: boolean, date: string): S => ({ info: { ready_to_merge: ready, last_modified: date } })

  it('sorts by last_modified descending when readiness equal', () => {
    const a = make(false, '2024-01-01T10:00:00Z')
    const b = make(false, '2024-01-01T12:00:00Z')
    const arr = [a, b]
    const sorted = sortSessions(arr)
    expect(sorted[0]).toBe(b)
    expect(sorted[1]).toBe(a)
  })

  it('places not-ready sessions before ready sessions regardless of time', () => {
    const readyRecent = make(true, '2024-01-02T00:00:00Z')
    const notReadyOld = make(false, '2023-12-31T00:00:00Z')
    const sorted = sortSessions([readyRecent, notReadyOld])
    expect(sorted[0]).toBe(notReadyOld)
    expect(sorted[1]).toBe(readyRecent)
  })

  it('handles missing dates as oldest', () => {
    const withDate: S = { info: { last_modified: '2024-01-01T00:00:00Z' } }
    const withoutDate: S = { info: {} }
    const sorted = sortSessions([withoutDate, withDate])
    expect(sorted[0]).toBe(withDate)
    expect(sorted[1]).toBe(withoutDate)
  })

  it('compareSessions returns 0 for identical inputs', () => {
    const x = make(false, '2024-01-01T00:00:00Z')
    expect(compareSessions(x, x)).toBe(0)
  })
})
