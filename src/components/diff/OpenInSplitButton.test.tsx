import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OpenInSplitButton } from './OpenInSplitButton'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => invokeMock(...args)
}))

describe('OpenInSplitButton', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('loads available apps and default, opens menu and persists selection', async () => {
    // list_available_open_apps, get_default_open_app
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_available_open_apps') {
        return [
          { id: 'finder', name: 'Finder', kind: 'system' },
          { id: 'vscode', name: 'VS Code', kind: 'editor' },
        ]
      }
      if (cmd === 'get_default_open_app') return 'finder'
      if (cmd === 'set_default_open_app') return undefined
      if (cmd === 'open_in_app') return undefined
      return undefined
    })

    const resolvePath = vi.fn(async () => '/some/path')
    render(<OpenInSplitButton resolvePath={resolvePath} />)

    // Main button should exist
    const mainBtn = await screen.findByRole('button', { name: /Open/i })
    expect(mainBtn).toBeInTheDocument()

    // Open the dropdown
    const toggle = screen.getByRole('button', { name: '' })
    fireEvent.click(toggle)

    // Select VS Code from the menu
    const vsCodeItem = await screen.findByText('VS Code')
    fireEvent.click(vsCodeItem)

    await waitFor(() => {
      // set_default_open_app and open_in_app should be called
      expect(invokeMock).toHaveBeenCalledWith('set_default_open_app', { appId: 'vscode' })
      expect(invokeMock).toHaveBeenCalledWith('open_in_app', { appId: 'vscode', worktreePath: '/some/path' })
    })

    // Clicking main button now should open with new default
    fireEvent.click(mainBtn)
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('open_in_app', { appId: 'vscode', worktreePath: '/some/path' })
    })
  })
})
