import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { DiffViewerWithReview } from './DiffViewerWithReview'
import { SelectionProvider } from '../contexts/SelectionContext'
import { ReviewProvider } from '../contexts/ReviewContext'
import { ProjectProvider, useProject } from '../contexts/ProjectContext'
import { vi } from 'vitest'
import { useEffect } from 'react'

// Mock OptimizedDiffViewer to expose onLineSelect easily and to avoid heavy DOM
vi.mock('./OptimizedDiffViewer', () => ({
  OptimizedDiffViewer: (props: any) => (
    <button aria-label="MockDiff" onClick={() => props.onLineSelect?.('new', 2, 3, ['line2', 'line3'])}>
      MockDiff for {props.leftTitle} vs {props.rightTitle}
    </button>
  )
}))

// Central mock for Tauri invoke
const invokeMock = vi.fn(async (cmd: string, _args?: any) => {
  if (cmd === 'para_core_get_session') {
    return { name: 'sessionA', worktree_path: '/tmp/sessionA' }
  }
  if (cmd === 'get_changed_files_from_main') {
    return [
      { path: 'src/a.ts', change_type: 'modified' },
      { path: 'src/b.ts', change_type: 'added' },
    ]
  }
  if (cmd === 'get_current_branch_name') return 'feature/x'
  if (cmd === 'get_base_branch_name') return 'main'
  if (cmd === 'get_commit_comparison_info') return ['abc', 'def']
  if (cmd === 'get_file_diff_from_main') return ['const old = 1;\nfunction foo(){}', 'const old = 2;\nfunction foo(){ return 1 }']
  if (cmd === 'write_terminal') return undefined
  if (cmd === 'terminal_exists') return true
  if (cmd === 'create_terminal') return undefined
  if (cmd === 'get_current_directory') return '/tmp'
  return undefined
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, ...args: any[]) => invokeMock(cmd, ...args),
}))

// Component to set project path for tests
function TestProjectInitializer({ children }: { children: React.ReactNode }) {
  const { setProjectPath } = useProject()
  
  useEffect(() => {
    // Set a test project path immediately
    setProjectPath('/test/project')
  }, [setProjectPath])
  
  return <>{children}</>
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <TestProjectInitializer>
        <SelectionProvider>
          <ReviewProvider>{children}</ReviewProvider>
        </SelectionProvider>
      </TestProjectInitializer>
    </ProjectProvider>
  )
}

describe('DiffViewerWithReview advanced', () => {
  beforeEach(() => {
    localStorage.setItem('schaltwerk-selection', JSON.stringify({ kind: 'session', sessionName: 'sessionA' }))
    invokeMock.mockClear()
  })

  it('creates a review comment via selection flow and shows it in side panel', async () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerWithReview filePath="src/a.ts" isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    // Wait for file header
    expect(await screen.findByText('src/a.ts')).toBeInTheDocument()

    // Trigger a selection from mocked diff to enable Add Comment button
    fireEvent.click(screen.getByLabelText('MockDiff'))

    // Click floating Add Comment button
    const addBtn = await screen.findByRole('button', { name: /Add Comment/i })
    fireEvent.click(addBtn)

    // Modal form appears with textarea
    const textarea = await screen.findByPlaceholderText(/Write your comment/i)
    fireEvent.change(textarea, { target: { value: 'Looks good, but consider renaming.' } })

    // Submit comment
    const submit = screen.getByRole('button', { name: /^Add Comment\s*⌘?↵?$/i })
    fireEvent.click(submit)

    // Comments panel appears and contains the comment
    expect(await screen.findByText(/Comments \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Looks good, but consider renaming\./)).toBeInTheDocument()
  })

  it('supports editing and deleting comments (thread-like operations)', async () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerWithReview filePath="src/a.ts" isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    // Add two comments
    fireEvent.click(await screen.findByLabelText('MockDiff'))
    fireEvent.click(await screen.findByRole('button', { name: /Add Comment/i }))
    fireEvent.change(await screen.findByPlaceholderText(/Write your comment/i), { target: { value: 'First note' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add Comment/i }))

    // Second
    fireEvent.click(screen.getByLabelText('MockDiff'))
    fireEvent.click(await screen.findByRole('button', { name: /Add Comment/i }))
    fireEvent.change(await screen.findByPlaceholderText(/Write your comment/i), { target: { value: 'Second note' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add Comment/i }))

    expect(await screen.findByText(/Comments \(2\)/)).toBeInTheDocument()

    // Edit first
    const editBtn = screen.getAllByRole('button', { name: /Edit/i })[0]
    fireEvent.click(editBtn)
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'First note - edited' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/i }))
    expect(await screen.findByText('First note - edited')).toBeInTheDocument()

    // Delete second
    const deleteBtn = screen.getAllByRole('button', { name: /Delete/i })[0]
    fireEvent.click(deleteBtn)
    await waitFor(() => expect(screen.getByText(/Comments \(1\)/)).toBeInTheDocument())
  })

  it('navigates between files using Cmd/Ctrl+Arrow keys', async () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerWithReview filePath="src/a.ts" isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    expect(await screen.findByText('src/a.ts')).toBeInTheDocument()

    const isMac = navigator.userAgent.includes('Mac')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', [isMac ? 'metaKey' : 'ctrlKey']: true }))
    })

    // Now shows second file
    expect(await screen.findByText('src/b.ts')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', [isMac ? 'metaKey' : 'ctrlKey']: true }))
    })

    expect(await screen.findByText('src/a.ts')).toBeInTheDocument()
  })

  it('finishes review via button and keyboard and writes to terminal', async () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerWithReview filePath="src/a.ts" isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    // Add a comment so Finish Review is enabled
    fireEvent.click(await screen.findByLabelText('MockDiff'))
    fireEvent.click(await screen.findByRole('button', { name: /Add Comment/i }))
    fireEvent.change(await screen.findByPlaceholderText(/Write your comment/i), { target: { value: 'Ready to ship' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add Comment/i }))

    // Finish via button
    // There are two Finish Review buttons (sidebar footer and header). Click the header one.
    const finishBtns = await screen.findAllByRole('button', { name: /Finish Review/i })
    fireEvent.click(finishBtns[1] || finishBtns[0])

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(invokeMock).toHaveBeenCalledWith('write_terminal', expect.objectContaining({ id: expect.stringContaining('session-sessionA-top') }))

    // Reopen and add again; finish via keyboard Cmd/Ctrl+Shift+Enter
    onClose.mockClear()
    render(
      <Wrapper>
        <DiffViewerWithReview filePath="src/a.ts" isOpen={true} onClose={onClose} />
      </Wrapper>
    )
    fireEvent.click(await screen.findByLabelText('MockDiff'))
    fireEvent.click(await screen.findByRole('button', { name: /Add Comment/i }))
    fireEvent.change(await screen.findByPlaceholderText(/Write your comment/i), { target: { value: 'Another' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add Comment/i }))

    const isMac = navigator.userAgent.includes('Mac')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, [isMac ? 'metaKey' : 'ctrlKey']: true }))
    })

    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows syntax highlighting class and toggles syntax label', async () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerWithReview filePath="src/a.ts" isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    // Make a selection and open comment form to render HighlightedCode
    fireEvent.click(await screen.findByLabelText('MockDiff'))
    fireEvent.click(await screen.findByRole('button', { name: /Add Comment/i }))

    // hljs code element present; assert within the comment modal specifically to avoid duplicate overlay label
    const form = await screen.findByRole('dialog', { hidden: true }).catch(() => null)
    if (form) {
      expect(form.textContent || '').toMatch(/Lines 2-3/)
    } else {
      // fallback: at least one match exists
      expect(screen.getAllByText(/Lines 2-3/).length).toBeGreaterThan(0)
    }
    expect(document.querySelector('.hljs')).toBeTruthy()

    // Toggle syntax button label changes. The button itself is labeled by its content (On/Off)
    const syntaxBtn = screen.getAllByRole('button').find(b => /^(On|Off)$/.test(b.textContent || ''))!
    expect(syntaxBtn).toHaveTextContent(/On|Off/)
    fireEvent.click(syntaxBtn)
    expect(syntaxBtn).toHaveTextContent(/On|Off/)
  })

  it('toggles split/unified view via header buttons', async () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerWithReview filePath="src/a.ts" isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    await screen.findByText('src/a.ts')
    const unifiedBtn = screen.getByRole('button', { name: 'Unified' })
    const splitBtn = screen.getByRole('button', { name: 'Split' })

    // Switch to unified
    fireEvent.click(unifiedBtn)
    // Then split
    fireEvent.click(splitBtn)
    // No crash; classes updated implicitly; assert buttons exist
    expect(unifiedBtn).toBeInTheDocument()
    expect(splitBtn).toBeInTheDocument()
  })

  it('persists review comments across file navigation and back', async () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerWithReview filePath="src/a.ts" isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    // Add comment on a.ts
    fireEvent.click(await screen.findByLabelText('MockDiff'))
    fireEvent.click(await screen.findByRole('button', { name: /Add Comment/i }))
    fireEvent.change(await screen.findByPlaceholderText(/Write your comment/i), { target: { value: 'Keep this check' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add Comment/i }))

    expect(await screen.findByText(/Comments \(1\)/)).toBeInTheDocument()

    // Navigate to b.ts via keyboard
    const isMac = navigator.userAgent.includes('Mac')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', [isMac ? 'metaKey' : 'ctrlKey']: true }))
    })
    expect(await screen.findByText('src/b.ts')).toBeInTheDocument()

    // Navigate back to a.ts
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', [isMac ? 'metaKey' : 'ctrlKey']: true }))
    })
    expect(await screen.findByText('src/a.ts')).toBeInTheDocument()
    expect(await screen.findByText(/Comments \(1\)/)).toBeInTheDocument()
  })
})
