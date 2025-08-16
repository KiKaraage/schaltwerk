import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ProjectProvider } from '../../contexts/ProjectContext'
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
  container_status?: string
  current_task?: string
  todo_percentage?: number
  is_blocked?: boolean
  diff_stats?: {
    files_changed: number
    additions: number
    deletions: number
    insertions: number
  }
  ready_to_merge?: boolean
}

interface EnrichedSession {
  info: SessionInfo
  status?: any
  terminals: string[]
}

const createSession = (id: string, lastModified?: string, createdAt?: string, readyToMerge = false): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `para/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    merge_mode: 'rebase',
    status: 'active',
    created_at: createdAt,
    last_modified: lastModified,
    has_uncommitted_changes: false,
    is_current: false,
    session_type: 'worktree',
    ready_to_merge: readyToMerge
  },
  terminals: []
})

describe('Sidebar sort mode persistence', () => {
  let mockLocalStorage: { [key: string]: string }
  let localStorageMock: Storage

  // Helper function to wrap component with all required providers
  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <ProjectProvider>
        <SelectionProvider>
          <FocusProvider>
            {component}
          </FocusProvider>
        </SelectionProvider>
      </ProjectProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Create a fresh mock localStorage for each test
    mockLocalStorage = {}
    localStorageMock = {
      getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key]
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {}
      }),
      length: 0,
      key: vi.fn()
    }
    
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true
    })

    const sessions = [
      createSession('test_session_a', '2024-01-15T10:00:00Z', '2024-01-01T10:00:00Z'),
      createSession('test_session_b', '2024-01-10T10:00:00Z', '2024-01-02T10:00:00Z'),
      createSession('test_session_c', '2024-01-20T10:00:00Z', '2023-12-31T10:00:00Z')
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      if (cmd === 'para_core_list_sessions_by_state') return []
      throw new Error(`Unexpected command: ${cmd}`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should default to name sorting when no localStorage value exists', async () => {
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should be in name (alphabetical) order by default
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_a')
    expect(sessionButtons[1]).toHaveTextContent('test_session_b')
    expect(sessionButtons[2]).toHaveTextContent('test_session_c')

    // Check that initial state is saved
    expect(localStorageMock.setItem).toHaveBeenCalledWith('schaltwerk:sessions:sortMode', 'name')
  })

  it('should restore sort mode from localStorage on component mount', async () => {
    // Pre-populate localStorage with 'created' mode
    mockLocalStorage['schaltwerk:sessions:sortMode'] = 'created'

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should be in creation time order (newest first)
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_b') // Jan 2 (newest)
    expect(sessionButtons[1]).toHaveTextContent('test_session_a') // Jan 1  
    expect(sessionButtons[2]).toHaveTextContent('test_session_c') // Dec 31 (oldest)

    // Verify the sort button shows the correct mode
    const sortButton = screen.getByTitle(/^Sort:/i)
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
  })

  it('should persist sort mode changes to localStorage', async () => {
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)

    // Change to created mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
    })
    expect(localStorageMock.setItem).toHaveBeenCalledWith('schaltwerk:sessions:sortMode', 'created')

    // Change to last-edited mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
    })
    expect(localStorageMock.setItem).toHaveBeenCalledWith('schaltwerk:sessions:sortMode', 'last-edited')

    // Change back to name mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
    })
    expect(localStorageMock.setItem).toHaveBeenCalledWith('schaltwerk:sessions:sortMode', 'name')
  })

  it('should handle localStorage initialization errors gracefully', async () => {
    // Test that invalid localStorage values are handled gracefully
    mockLocalStorage['schaltwerk:sessions:sortMode'] = 'invalid-sort-mode'

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should fallback to default 'name' mode when value is invalid
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_a')
    expect(sessionButtons[1]).toHaveTextContent('test_session_b') 
    expect(sessionButtons[2]).toHaveTextContent('test_session_c')

    // Sort button should show default name mode
    const sortButton = screen.getByTitle(/^Sort:/i)
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
  })

  it('should handle localStorage errors gracefully during saving', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Make localStorage.setItem throw an error
    localStorageMock.setItem = vi.fn(() => {
      throw new Error('localStorage quota exceeded')
    })

    const sortButton = screen.getByTitle(/^Sort:/i)

    // Try to change sort mode
    fireEvent.click(sortButton)

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to save sort mode to localStorage:',
        expect.any(Error)
      )
    })

    // Component should still work despite localStorage error
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
    
    consoleSpy.mockRestore()
  })

  it('should ignore invalid localStorage values and use default', async () => {
    // Pre-populate localStorage with invalid value
    mockLocalStorage['schaltwerk:sessions:sortMode'] = 'invalid-mode'

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should fallback to default name sorting
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_a')
    expect(sessionButtons[1]).toHaveTextContent('test_session_b')
    expect(sessionButtons[2]).toHaveTextContent('test_session_c')

    const sortButton = screen.getByTitle(/^Sort:/i)
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
  })

  it('should persist sort mode across component remounts', async () => {
    // First render - change to 'last-edited' mode
    const { unmount } = renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    let sortButton = screen.getByTitle(/^Sort:/i)
    
    // Change to 'created' then 'last-edited' mode
    fireEvent.click(sortButton) // name -> created
    fireEvent.click(sortButton) // created -> last-edited
    
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
    })

    // Verify localStorage was updated
    expect(mockLocalStorage['schaltwerk:sessions:sortMode']).toBe('last-edited')

    // Unmount component
    unmount()

    // Remount component - should restore last-edited mode
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should be in last-edited order (most recent first)
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_c') // Jan 20 (most recent)
    expect(sessionButtons[1]).toHaveTextContent('test_session_a') // Jan 15
    expect(sessionButtons[2]).toHaveTextContent('test_session_b') // Jan 10 (oldest edit)

    // Verify sort button shows correct mode
    sortButton = screen.getByTitle(/^Sort:/i)
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
  })

  it('should handle default fallback correctly', async () => {
    // Start with empty localStorage to test default fallback
    mockLocalStorage = {}

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should default to name sorting when no value exists
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_a')
    expect(sessionButtons[1]).toHaveTextContent('test_session_b')
    expect(sessionButtons[2]).toHaveTextContent('test_session_c')

    // Sort button should show name mode
    const sortButton = screen.getByTitle(/^Sort:/i)
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
  })

  it('should validate sort mode persistence for each mode', async () => {
    const modes = ['name', 'created', 'last-edited'] as const
    
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i]
      // Set up localStorage with the mode
      mockLocalStorage['schaltwerk:sessions:sortMode'] = mode

      const { unmount } = renderWithProviders(<Sidebar />)

      await waitFor(() => {
        const sessionButtons = screen.getAllByRole('button').filter(btn => {
          const text = btn.textContent || ''
          return text.includes('para/') && !text.includes('main (orchestrator)')
        })
        expect(sessionButtons).toHaveLength(3)
      })

      const sortButton = screen.getByTitle(/^Sort:/i)
      
      // Verify the correct sort mode is restored
      if (mode === 'name') {
        expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
      } else if (mode === 'created') {
        expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
      } else if (mode === 'last-edited') {
        expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
      }

      unmount()
      
      // Clear between iterations
      if (i < modes.length - 1) {
        mockLocalStorage = {}
      }
    }
  })
})