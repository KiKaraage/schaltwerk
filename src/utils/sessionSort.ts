type EnrichedSessionLike = {
  info: {
    ready_to_merge?: boolean
    last_modified?: string
    last_modified_ts?: number
  }
}

export function compareSessions<A extends EnrichedSessionLike>(a: A, b: A): number {
  const aReady = !!a.info.ready_to_merge
  const bReady = !!b.info.ready_to_merge
  if (aReady !== bReady) return aReady ? 1 : -1

  const aTime = typeof a.info.last_modified_ts === 'number'
    ? a.info.last_modified_ts
    : (a.info.last_modified ? new Date(a.info.last_modified).getTime() : 0)
  const bTime = typeof b.info.last_modified_ts === 'number'
    ? b.info.last_modified_ts
    : (b.info.last_modified ? new Date(b.info.last_modified).getTime() : 0)
  return bTime - aTime
}

export function sortSessions<A extends EnrichedSessionLike>(sessions: A[]): A[] {
  return [...sessions].sort(compareSessions)
}
