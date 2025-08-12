import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeScreen } from './HomeScreen'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const invoke = (await import('@tauri-apps/api/core')).invoke as unknown as vi.Mock
const dialog = await import('@tauri-apps/plugin-dialog')

describe('HomeScreen', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    invoke.mockReset()
    ;(dialog.open as vi.Mock).mockReset()
  })

  function setup(overrides: Partial<Record<string, any>> = {}) {
    const onOpenProject = vi.fn()
    // Defaults - set BEFORE render so initial effect uses mocks
    invoke.mockImplementation(async (cmd: string, args?: any) => {
      switch (cmd) {
        case 'get_recent_projects':
          return overrides.get_recent_projects ?? []
        case 'is_git_repository':
          return overrides.is_git_repository ?? true
        case 'add_recent_project':
        case 'remove_recent_project':
        case 'update_recent_project_timestamp':
        case 'initialize_project':
          return null
        case 'directory_exists':
          return overrides.directory_exists ?? true
        default:
          throw new Error(`Unexpected invoke: ${cmd}`)
      }
    })

    render(<HomeScreen onOpenProject={onOpenProject} />)

    return { onOpenProject }
  }

  it('renders initial state with CTA and without recent projects', async () => {
    setup({ get_recent_projects: [] })

    // CTA button present
    expect(screen.getByRole('button', { name: /open git repository/i })).toBeInTheDocument()

    // Recent Projects header should not be visible when empty
    await waitFor(() => {
      expect(screen.queryByText(/recent projects/i)).not.toBeInTheDocument()
    })
  })

  it('shows recent projects when available and allows removing without opening', async () => {
    const recent = [
      { path: '/repo/a', name: 'Project A', lastOpened: 2 },
      { path: '/repo/b', name: 'Project B', lastOpened: 1 },
    ]
    const { onOpenProject } = setup({ get_recent_projects: recent })

    // Cards rendered (sorted newest first by implementation)
    expect(await screen.findByText('Project A')).toBeInTheDocument()
    expect(screen.getByText('/repo/a')).toBeInTheDocument()

    // Click the remove button should not trigger open
    const removeButtons = screen.getAllByTitle(/remove .* from recent projects/i)
    await user.click(removeButtons[0])

    expect(onOpenProject).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('remove_recent_project', { path: '/repo/a' })
  })

  it('open button triggers directory picker and navigates on valid git repo', async () => {
    const { onOpenProject } = setup()
    ;(dialog.open as vi.Mock).mockResolvedValue('/some/repo')

    const openBtn = screen.getByRole('button', { name: /open git repository/i })
    await user.click(openBtn)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('is_git_repository', { path: '/some/repo' })
    })
    expect(invoke).toHaveBeenCalledWith('add_recent_project', { path: '/some/repo' })
    expect(onOpenProject).toHaveBeenCalledWith('/some/repo')
  })

  it('shows error when selected directory is not a git repo', async () => {
    setup({ is_git_repository: false })
    ;(dialog.open as vi.Mock).mockResolvedValue('/not/repo')

    await user.click(screen.getByRole('button', { name: /open git repository/i }))

    expect(await screen.findByText(/not a git repository/i)).toBeInTheDocument()
    // should not navigate
    expect(screen.queryByText(/visual interface for managing/i)).toBeInTheDocument()
  })

  it('keyboard: pressing Enter on focused open button opens dialog', async () => {
    setup()
    ;(dialog.open as vi.Mock).mockResolvedValue('/enter/repo')

    const btn = screen.getByRole('button', { name: /open git repository/i })
    btn.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(dialog.open).toHaveBeenCalled()
    })
  })

  it('allows navigating to create a session (Cmd/Ctrl+N in App will open modal; here we ensure button exists)', async () => {
    setup()
    // Verify the CTA to start new session exists in App, but HomeScreen does not handle it.
    // We assert HomeScreen remains focusable and interactive via keyboard.
    const openBtn = screen.getByRole('button', { name: /open git repository/i })
    await user.tab()
    expect(openBtn).toHaveFocus()
  })

  it('opening a missing recent project shows an error and refreshes list', async () => {
    const recent = [{ path: '/gone/repo', name: 'Project Gone', lastOpened: 1 }]
    setup({ get_recent_projects: recent, directory_exists: false })

    // open card (button within card: click by project name)
    await user.click(await screen.findByText('Project Gone'))

    expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('remove_recent_project', { path: '/gone/repo' })
  })
})
