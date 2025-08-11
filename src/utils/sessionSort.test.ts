import { compareSessions, sortSessions } from './sessionSort'

describe('sessionSort', () => {
  type S = { info: { ready_to_merge?: boolean; last_modified?: string; last_modified_ts?: number } }

  const make = (ready: boolean, date: string): S => ({ info: { ready_to_merge: ready, last_modified: date } })

  it('sorts by last_modified descending when readiness equal', () => {
    const a = make(false, '2024-01-01T10:00:00Z')
    const b = make(false, '2024-01-01T12:00:00Z')
    const arr = [a, b]
    const sorted = sortSessions(arr)
    expect(sorted[0]).toBe(b)
    expect(sorted[1]).toBe(a)
  })

  it('places not-reviewed sessions before reviewed sessions regardless of time', () => {
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

  it('prefers last_modified_ts over last_modified when both present', () => {
    const withTimestamp: S = { 
      info: { 
        last_modified: '2024-01-01T00:00:00Z',
        last_modified_ts: new Date('2024-01-02T00:00:00Z').getTime()
      } 
    }
    const withoutTimestamp: S = { 
      info: { 
        last_modified: '2024-01-03T00:00:00Z' 
      } 
    }
    const sorted = sortSessions([withoutTimestamp, withTimestamp])
    // withoutTimestamp has newer date string (Jan 3)
    // withTimestamp has older date string (Jan 1) but newer timestamp (Jan 2)
    // Since timestamp takes precedence, withoutTimestamp (Jan 3) should be first
    expect(sorted[0]).toBe(withoutTimestamp)
    expect(sorted[1]).toBe(withTimestamp)
  })

  it('handles mixed timestamp and date string scenarios correctly', () => {
    const onlyTimestamp: S = { info: { last_modified_ts: 1704067200000 } } // 2024-01-01
    const onlyDateString: S = { info: { last_modified: '2024-01-02T00:00:00Z' } }
    const both: S = { 
      info: { 
        last_modified: '2023-12-31T00:00:00Z',
        last_modified_ts: 1704240000000 // 2024-01-03
      }
    }
    
    const sorted = sortSessions([onlyTimestamp, onlyDateString, both])
    // both has newest timestamp (Jan 3)
    // onlyDateString has Jan 2
    // onlyTimestamp has Jan 1
    expect(sorted[0]).toBe(both)
    expect(sorted[1]).toBe(onlyDateString)
    expect(sorted[2]).toBe(onlyTimestamp)
  })
})
