import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { SelectionProvider } from '../contexts/SelectionContext'
import { FocusProvider } from '../contexts/FocusContext'
import { ProjectProvider } from '../contexts/ProjectContext'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core')
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

interface SessionInfo {
  session_id: string
  display_name?: string
  branch: string
  worktree_path: string
  base_branch: string
  merge_mode: string
  status: 'active' | 'dirty' | 'missing' | 'archived'
  created_at?: string
  last_modified?: string
  has_uncommitted_changes?: boolean
  is_current: boolean
  session_type: 'worktree' | 'container'
  ready_to_merge?: boolean
}

interface EnrichedSession {
  info: SessionInfo
  status?: any
  terminals: string[]
}

const createSession = (id: string, readyToMerge = false): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `para/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    merge_mode: 'rebase',
    status: 'active',
    is_current: false,
    session_type: 'worktree',
    ready_to_merge: readyToMerge,
  },
  terminals: []
})

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

describe('Sidebar filter functionality and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    const sessions = [
      createSession('alpha', false),
      createSession('bravo', true),  // reviewed
      createSession('charlie', false),
      createSession('delta', true),  // reviewed
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      throw new Error(`Unexpected command: ${cmd}`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('filters sessions: All -> Drafts -> Reviewed', async () => {
    renderWithProviders(<Sidebar />)

    // Wait for sessions to render
    await waitFor(() => {
      const buttons = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(buttons).toHaveLength(4)
    })

    // Click Drafts
    fireEvent.click(screen.getByRole('button', { name: /📝 Drafts/ }))

    await waitFor(() => {
      const drafts = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      // Only alpha and charlie remain (they are not ready_to_merge and not active)
      expect(drafts).toHaveLength(2)
      expect(drafts[0]).toHaveTextContent('alpha')
      expect(drafts[1]).toHaveTextContent('charlie')
    })

    // Click Reviewed
    fireEvent.click(screen.getByRole('button', { name: /✅ Reviewed/ }))

    await waitFor(() => {
      const reviewed = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      // Only bravo and delta
      expect(reviewed).toHaveLength(2)
      // Alphabetical within reviewed
      expect(reviewed[0]).toHaveTextContent('bravo')
      expect(reviewed[1]).toHaveTextContent('delta')
    })

    // Back to All
    const allButton = screen.getAllByRole('button').find(b => b.textContent?.startsWith('All'))
    fireEvent.click(allButton!)

    await waitFor(() => {
      const all = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(all).toHaveLength(4)
    })
  })

  it('persists filterMode to localStorage and restores it', async () => {
    // First render: set to Reviewed
    const { unmount } = renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const all = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(all).toHaveLength(4)
    })

    fireEvent.click(screen.getByRole('button', { name: /✅ Reviewed/ }))

    await waitFor(() => {
      expect(localStorage.getItem('schaltwerk:sessions:filterMode')).toBe('reviewed')
    })

    unmount()

    // Second render should restore 'reviewed'
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      // Only reviewed sessions should be visible on load
      const reviewed = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(reviewed).toHaveLength(2)
      const sortBtn = screen.getByTitle(/^Sort:/i)
      expect(sortBtn).toBeInTheDocument() // sanity
    })
  })
})
