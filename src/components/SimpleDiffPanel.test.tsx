import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const invoke = (await import('@tauri-apps/api/core')).invoke as unknown as vi.Mock

// Mutable selection used by mocked hook
let currentSelection: any = { kind: 'orchestrator' }
vi.mock('../contexts/SelectionContext', async () => {
  const actual = await vi.importActual<any>('../contexts/SelectionContext')
  return {
    ...actual,
    useSelection: () => ({ selection: currentSelection })
  }
})

describe('SimpleDiffPanel', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockReset()
    // default clipboard: prefer spying if exists; else define property
    try {
      if (navigator.clipboard && 'writeText' in navigator.clipboard) {
        vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined as any)
      } else {
        Object.defineProperty(globalThis.navigator, 'clipboard', {
          configurable: true,
          value: { writeText: vi.fn().mockResolvedValue(undefined) }
        })
      }
    } catch {
      // Fallback for environments with strict Navigator implementation
      Object.defineProperty(Object.getPrototypeOf(globalThis.navigator), 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) }
      })
    }
  })

  it('renders DiffFileList and no dock by default (orchestrator)', async () => {
    currentSelection = { kind: 'orchestrator' }
    invoke.mockResolvedValueOnce([]) // get_changed_files_from_main will be called by DiffFileList polling, but we just ensure render
    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    render(<SimpleDiffPanel onFileSelect={vi.fn()} />)

    expect(await screen.findByText(/no session selected/i)).toBeInTheDocument()
    expect(screen.queryByText(/show prompt/i)).not.toBeInTheDocument()
  })

  it('fetches and renders prompt markdown when dock opened', async () => {
    currentSelection = { kind: 'session', payload: 's1' }

    // DiffFileList background calls - stub minimal set used in component
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'para_core_get_session') return { initial_prompt: '# Title\n\nSome **bold** text' }
      if (cmd === 'get_changed_files_from_main') return []
      if (cmd === 'get_current_branch_name') return 'feat'
      if (cmd === 'get_base_branch_name') return 'main'
      if (cmd === 'get_commit_comparison_info') return ['a', 'b']
      return null
    })
    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    render(<SimpleDiffPanel onFileSelect={vi.fn()} />)

    // Toggle dock button appears for session
    await waitFor(() => expect(screen.getByRole('button', { name: /show prompt/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /show prompt/i }))

    // Markdown content
    expect(await screen.findByRole('heading', { name: /title/i })).toBeInTheDocument()
    expect(screen.getByText(/bold/i)).toBeInTheDocument()
  })

  it('copy button copies prompt text and shows copied state', async () => {
    currentSelection = { kind: 'session', payload: 's1' }

    const prompt = 'Copy me'
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'para_core_get_session') return { initial_prompt: prompt }
      if (cmd === 'get_changed_files_from_main') return []
      if (cmd === 'get_current_branch_name') return 'feat'
      if (cmd === 'get_base_branch_name') return 'main'
      if (cmd === 'get_commit_comparison_info') return ['a', 'b']
      return null
    })
    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    render(<SimpleDiffPanel onFileSelect={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: /show prompt/i }))

    const copyBtn = await screen.findByTitle(/copy prompt to clipboard/i)
    await user.click(copyBtn)

    await waitFor(() => expect(screen.getByText(/copied/i)).toBeInTheDocument())
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(prompt)
  })

  it('renders changed files, highlights selected row, and calls onFileSelect', async () => {
    currentSelection = { kind: 'session', payload: 's1' }

    const files = [
      { path: 'src/a/file1.txt', change_type: 'modified' },
      { path: 'src/b/file2.ts', change_type: 'added' },
    ]
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_changed_files_from_main') return files
      if (cmd === 'get_current_branch_name') return 'feat'
      if (cmd === 'get_base_branch_name') return 'main'
      if (cmd === 'get_commit_comparison_info') return ['a', 'b']
      if (cmd === 'para_core_get_session') return { initial_prompt: '' }
      return null
    })

    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    const onFileSelect = vi.fn()
    render(<SimpleDiffPanel onFileSelect={onFileSelect} />)

    expect(await screen.findByText('file1.txt')).toBeInTheDocument()
    expect(screen.getByText('file2.ts')).toBeInTheDocument()

    await user.click(screen.getByText('file1.txt'))
    expect(onFileSelect).toHaveBeenCalledWith('src/a/file1.txt')

    // Selected row should have selection class
    const selected = document.querySelector('.bg-slate-800\\/30')
    expect(selected).toBeTruthy()
  })
})
