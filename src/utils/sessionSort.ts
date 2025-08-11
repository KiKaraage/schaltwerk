type EnrichedSessionLike = {
  info: {
    ready_to_merge?: boolean
    last_modified?: string
    last_modified_ts?: number
  }
}

function getSessionTime(session: EnrichedSessionLike): number {
  if (typeof session.info.last_modified_ts === 'number') {
    return session.info.last_modified_ts
  }
  if (session.info.last_modified) {
    return new Date(session.info.last_modified).getTime()
  }
  return 0
}

export function compareSessions<A extends EnrichedSessionLike>(a: A, b: A): number {
  const aReady = !!a.info.ready_to_merge
  const bReady = !!b.info.ready_to_merge
  if (aReady !== bReady) return aReady ? 1 : -1

  const aTime = getSessionTime(a)
  const bTime = getSessionTime(b)
  return bTime - aTime
}

export function sortSessions<A extends EnrichedSessionLike>(sessions: A[]): A[] {
  return [...sessions].sort(compareSessions)
}
