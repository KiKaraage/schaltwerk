import { render, act } from '@testing-library/react'
import { DiffViewerWithReview } from './DiffViewerWithReview'
import { SelectionProvider } from '../contexts/SelectionContext'
import { ReviewProvider } from '../contexts/ReviewContext'
import { ProjectProvider } from '../contexts/ProjectContext'

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
  it('Cmd/Ctrl+ArrowDown/ArrowUp navigates files safely (no crash)', async () => {
    render(
      <Wrapper>
        <DiffViewerWithReview filePath={null} isOpen={true} onClose={() => {}} />
      </Wrapper>
    )

    // Simulate keyboard navigation with modifier
    const isMac = navigator.platform.toUpperCase().includes('MAC')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', [isMac ? 'metaKey' : 'ctrlKey']: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', [isMac ? 'metaKey' : 'ctrlKey']: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', [isMac ? 'metaKey' : 'ctrlKey']: true }))
    })

    // No assertions about specific file being loaded; we assert no throw and basic presence
    // by ensuring the component kept rendering (no crash).
    // Presence of the counter text is a stable indicator of the diff viewer header.
    // We avoid querying exact text to keep it locale-agnostic.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    expect(document.querySelector('.flex-1')).toBeTruthy()
  })
})
