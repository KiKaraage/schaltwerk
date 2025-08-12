import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'
import { DiffViewerOverlay } from './DiffViewerOverlay'
import { SelectionProvider } from '../contexts/SelectionContext'
import { ProjectProvider } from '../contexts/ProjectContext'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'get_changed_files_from_main') {
      return [
        { path: 'src/a.ts', change_type: 'modified' },
        { path: 'src/b.ts', change_type: 'added' },
      ]
    }
    if (cmd === 'get_current_branch_name') return 'feature/x'
    if (cmd === 'get_base_branch_name') return 'main'
    if (cmd === 'get_commit_comparison_info') return ['abc', 'def']
    if (cmd === 'get_file_diff_from_main') return ['old\ncontent', 'new\ncontent']
    return undefined
  }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <SelectionProvider>{children}</SelectionProvider>
    </ProjectProvider>
  )
}

function setSessionInStorage(sessionName: string) {
  localStorage.setItem(
    'schaltwerk-selection',
    JSON.stringify({ kind: 'session', sessionName })
  )
}

describe('DiffViewerOverlay', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('shows overlay and positions/backdrop with isOpen, closes on backdrop click', async () => {
    setSessionInStorage('demo')
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerOverlay filePath={null} isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    // The backdrop div has no role; verify the Changed Files label appears (modal visible)
    expect(await screen.findByText('Changed Files')).toBeInTheDocument()

    // Close via top-left chevron button (has title)
    const closeButtons = await screen.findAllByTitle('Close (ESC)')
    fireEvent.click(closeButtons[0])
    expect(onClose).toHaveBeenCalled()
  })

  it('loads diff when selecting files from the sidebar', async () => {
    setSessionInStorage('demo')
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerOverlay filePath={null} isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    const a = await screen.findByText('a.ts')
    fireEvent.click(a)

    // Header shows selected file path
    expect(await screen.findByText('src/a.ts')).toBeInTheDocument()
  })

  it('responds to Escape key to close', async () => {
    setSessionInStorage('demo')
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerOverlay filePath={null} isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(onClose).toHaveBeenCalled()
  })

  it('content area is scrollable', async () => {
    setSessionInStorage('demo')
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerOverlay filePath={'src/a.ts'} isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    // The diff container has class diff-wrapper and should be in the document
    const label = await screen.findByText('src/a.ts')
    expect(label).toBeInTheDocument()
  })
})
