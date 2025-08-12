import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TestProviders } from './tests/test-utils'
import App from './App'
import { vi } from 'vitest'

// ---- Mock: react-split (layout only) ----
vi.mock('react-split', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="split">{children}</div>,
}))

// ---- Mock: heavy child components to reduce surface area ----
vi.mock('./components/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}))
vi.mock('./components/TerminalGrid', () => ({
  TerminalGrid: () => <div data-testid="terminal-grid" />,
}))
vi.mock('./components/SimpleDiffPanel', () => ({
  SimpleDiffPanel: ({ onFileSelect }: { onFileSelect: (p: string) => void }) => (
    <div data-testid="diff-panel" onClick={() => onFileSelect('file.txt')} />
  ),
}))
vi.mock('./components/NewSessionModal', () => ({
  NewSessionModal: () => null,
}))
vi.mock('./components/CancelConfirmation', () => ({
  CancelConfirmation: () => null,
}))
vi.mock('./components/DiffViewerWithReview', () => ({
  DiffViewerWithReview: () => null,
}))
vi.mock('./components/OpenInSplitButton', () => ({
  OpenInSplitButton: () => <button data-testid="open-in-split" />,
}))

// ---- Mock: HomeScreen to drive transitions via onOpenProject ----
vi.mock('./components/HomeScreen', () => ({
  HomeScreen: ({ onOpenProject }: { onOpenProject: (p: string) => void }) => (
    <div data-testid="home-screen">
      <button data-testid="open-project" onClick={() => onOpenProject('/Users/me/sample-project')}>Open</button>
    </div>
  ),
}))

// ---- Mock: @tauri-apps/api/core (invoke) with adjustable behavior per test ----
const mockState = {
  isGitRepo: false,
  currentDir: '/Users/me/sample-project',
  defaultBranch: 'main',
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, _args?: any) => {
    switch (cmd) {
      case 'get_current_directory':
        return mockState.currentDir
      case 'is_git_repository':
        return mockState.isGitRepo
      case 'get_project_default_branch':
        return mockState.defaultBranch
      // Selection/terminal lifecycle stubs
      case 'terminal_exists':
        return false
      case 'create_terminal':
        return null
      case 'para_core_get_session':
        return { worktree_path: '/tmp/worktrees/abc' }
      case 'initialize_project':
      case 'add_recent_project':
      case 'para_core_create_session':
      case 'para_core_cancel_session':
      case 'directory_exists':
      case 'update_recent_project_timestamp':
      case 'remove_recent_project':
        return null
      default:
        return null
    }
  }),
}))

function renderApp() {
  return render(
    <TestProviders>
      <App />
    </TestProviders>
  )
}

describe('App.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.isGitRepo = false
    mockState.currentDir = '/Users/me/sample-project'
    mockState.defaultBranch = 'main'
  })

  it('renders without crashing (shows Home by default)', async () => {
    renderApp()
    expect(await screen.findByTestId('home-screen')).toBeInTheDocument()
  })

  it('routes between Home and Main app states', async () => {
    renderApp()

    // Initially Home
    const home = await screen.findByTestId('home-screen')
    expect(home).toBeInTheDocument()

    // Open a project via HomeScreen prop
    fireEvent.click(screen.getByTestId('open-project'))

    // Main layout should appear
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('terminal-grid')).toBeInTheDocument()
      expect(screen.getByTestId('diff-panel')).toBeInTheDocument()
    })

    // Click the global Home button to return
    const homeButton = screen.getByLabelText('Home')
    fireEvent.click(homeButton)

    expect(await screen.findByTestId('home-screen')).toBeInTheDocument()
  })

  it('handles startup errors without crashing (logs error and stays on Home)', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    // Make get_current_directory throw inside App startup effect
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderApp()

    expect(await screen.findByTestId('home-screen')).toBeInTheDocument()
    expect(errSpy).toHaveBeenCalled()

    errSpy.mockRestore()
  })

  it('displays project path in top bar when a project is opened', async () => {
    renderApp()

    // Initially on home screen
    expect(await screen.findByTestId('home-screen')).toBeInTheDocument()

    // Open a project - the mocked HomeScreen passes '/Users/me/sample-project'
    mockState.isGitRepo = true
    
    fireEvent.click(screen.getByTestId('open-project'))

    // Wait for app to switch to main view with increased timeout
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    }, { timeout: 3000 })

    // The basename of the project path should appear, along with the full path
    // Note: The mocked HomeScreen is hardcoded to open '/Users/me/sample-project'
    await waitFor(() => {
      expect(screen.getByText('sample-project')).toBeInTheDocument()
      expect(screen.getByText('/Users/me/sample-project')).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})
