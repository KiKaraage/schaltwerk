export interface SessionInfoLike {
  session_id: string
}

export interface EnrichedSessionLike {
  info: SessionInfoLike
}

// Given an ordered list of sessions, the id being removed, and the current selected id,
// return the next session id to select. If the removed one is not the current selection
// or if no sessions remain, return null.
export function computeNextSelectedSessionId(
  sortedSessions: EnrichedSessionLike[],
  removedSessionId: string,
  currentSelectedSessionId: string | null
): string | null {
  const wasSelected = currentSelectedSessionId === removedSessionId
  if (!wasSelected) return null

  const currentIndex = sortedSessions.findIndex(
    s => s.info.session_id === removedSessionId
  )
  if (currentIndex === -1) return null

  const remaining = sortedSessions.filter(
    s => s.info.session_id !== removedSessionId
  )
  if (remaining.length === 0) return null

  const nextIndex = Math.min(currentIndex, remaining.length - 1)
  return remaining[nextIndex].info.session_id
}
