import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ProjectProvider } from '../../contexts/ProjectContext'

// Use real keyboard hook behavior

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(), UnlistenFn: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ProjectProvider>
      <SelectionProvider>
        <FocusProvider>
          {ui}
        </FocusProvider>
      </SelectionProvider>
    </ProjectProvider>
  )
}

function press(key: string, opts: Partial<KeyboardEvent> = {}) {
  const ev = new KeyboardEvent('keydown', { key, ...opts })
  window.dispatchEvent(ev)
}

describe('Sidebar keyboard navigation basic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh)', configurable: true })

    const sessions = [
      { info: { session_id: 'a', branch: 'para/a', worktree_path: '/a', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
      { info: { session_id: 'b', branch: 'para/b', worktree_path: '/b', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
      { info: { session_id: 'c', branch: 'para/c', worktree_path: '/c', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'get_current_directory') return '/cwd'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      return undefined as any
    })

    vi.mocked(listen).mockImplementation(async () => {
      return () => {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Cmd+ArrowDown selects first session from orchestrator; Cmd+ArrowUp returns to orchestrator', async () => {
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const items = screen.getAllByRole('button')
      expect(items.some(b => /main \(orchestrator\)/.test(b.textContent || ''))).toBe(true)
      expect(items.filter(b => (b.textContent || '').includes('para/'))).toHaveLength(3)
    })

    // Orchestrator selected by default (has blue ring class)
    const orchestratorBtn = screen.getByTitle(/Select orchestrator/i)
    expect(orchestratorBtn.className).toContain('session-ring-blue')

    // Move down
    press('ArrowDown', { metaKey: true })

    await waitFor(() => {
      expect(screen.getByTitle(/Selected session/)).toBeInTheDocument()
    })

    // Move up to orchestrator
    press('ArrowUp', { metaKey: true })

    await waitFor(() => {
      const orch = screen.getByTitle(/Select orchestrator/i)
      expect(orch.className).toContain('session-ring-blue')
    })
  })
})
