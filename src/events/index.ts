// Centralized event names and builders for Schaltwerk

// Tauri app events (backend <-> frontend)
export const AppEvents = Object.freeze({
  sessionsRefreshed: 'schaltwerk:sessions-refreshed',
  sessionActivity: 'schaltwerk:session-activity',
  sessionGitStats: 'schaltwerk:session-git-stats',
  sessionAdded: 'schaltwerk:session-added',
  sessionRemoved: 'schaltwerk:session-removed',
  terminalStuck: 'schaltwerk:terminal-stuck',
  terminalUnstuck: 'schaltwerk:terminal-unstuck',
  terminalClosed: 'schaltwerk:terminal-closed',
} as const)

// Dynamic terminal output event (legacy shape retained)
export function terminalOutputEvent(terminalId: string): string {
  return `terminal-output-${terminalId}`
}

// UI-only DOM events
export const UiEvents = Object.freeze({
  resetTerminals: 'schaltwerk:reset-terminals',
  sessionAction: 'schaltwerk:session-action',
  openDiffView: 'schaltwerk:open-diff-view',
  globalNewSessionShortcut: 'global-new-session-shortcut',
  globalMarkReadyShortcut: 'global-mark-ready-shortcut',
} as const)
