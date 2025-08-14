import { render, act } from '@testing-library/react'
import { DiffViewerWithReview } from './DiffViewerWithReview'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { ReviewProvider } from '../../contexts/ReviewContext'
import { ProjectProvider } from '../../contexts/ProjectContext'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'get_changed_files_from_main') {
      return [
        { path: 'src/a.ts', change_type: 'modified' },
        { path: 'src/b.ts', change_type: 'added' },
        { path: 'src/c.ts', change_type: 'modified' },
      ]
    }
    if (cmd === 'get_current_branch_name') return 'feature/x'
    if (cmd === 'get_base_branch_name') return 'main'
    if (cmd === 'get_commit_comparison_info') return ['abc', 'def']
    if (cmd === 'get_file_diff_from_main') return ['old', 'new']
    return undefined
  })
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <SelectionProvider>
        <ReviewProvider>{children}</ReviewProvider>
      </SelectionProvider>
    </ProjectProvider>
  )
}

describe('DiffViewerWithReview keyboard navigation', () => {
  it('Escape key closes the modal', async () => {
    const onClose = vi.fn()
    render(
      <Wrapper>
        <DiffViewerWithReview filePath="src/test.ts" isOpen={true} onClose={onClose} />
      </Wrapper>
    )

    // Simulate pressing Escape
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    // Verify onClose was called
    expect(onClose).toHaveBeenCalled()
  })
})
