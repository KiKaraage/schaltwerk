type EnrichedSessionLike = {
  info: {
    ready_to_merge?: boolean
    last_modified?: string
  }
}

export function compareSessions<A extends EnrichedSessionLike>(a: A, b: A): number {
  const aReady = !!a.info.ready_to_merge
  const bReady = !!b.info.ready_to_merge
  if (aReady !== bReady) return aReady ? 1 : -1

  const aTime = a.info.last_modified ? new Date(a.info.last_modified).getTime() : 0
  const bTime = b.info.last_modified ? new Date(b.info.last_modified).getTime() : 0
  return bTime - aTime
}

export function sortSessions<A extends EnrichedSessionLike>(sessions: A[]): A[] {
  return [...sessions].sort(compareSessions)
}
