import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSelector } from './ModelSelector'

function setup(initial: 'claude' | 'cursor' = 'claude', disabled = false) {
  const onChange = vi.fn()
  render(<ModelSelector value={initial} onChange={onChange} disabled={disabled} />)
  return { onChange }
}

describe('ModelSelector', () => {
  test('renders dropdown button with current model label and color indicator', () => {
    setup('claude')
    const toggle = screen.getByRole('button', { name: /Claude/i })
    expect(toggle).toBeInTheDocument()

    // Check the color indicator by class presence
    expect(toggle.querySelector('.bg-blue-500')).toBeTruthy()
  })

  test('opens menu on click and renders options', async () => {
    const user = userEvent.setup()
    setup('claude')

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    // Ensure both options are present
    expect(screen.getAllByRole('button', { name: 'Claude' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Cursor' })).toBeInTheDocument()
  })

  test('changes selection on option click and closes menu', async () => {
    const user = userEvent.setup()
    const { onChange } = setup('claude')

    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'Cursor' }))

    expect(onChange).toHaveBeenCalledWith('cursor')

    // menu should close (options disappear)
    expect(screen.queryByRole('button', { name: 'Cursor' })).not.toBeInTheDocument()
  })

  test('keyboard navigation: Enter opens menu, Tab to option, Enter selects', async () => {
    const user = userEvent.setup()
    const { onChange } = setup('claude')

    const toggle = screen.getByRole('button', { name: /Claude/i })
    toggle.focus()
    await user.keyboard('{Enter}')

    // Move focus to first option (Claude), then to second (Cursor)
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('cursor')
  })

  test('disabled state prevents opening and interaction', async () => {
    const user = userEvent.setup()
    setup('claude', true)

    const toggle = screen.getByRole('button', { name: /Claude/i })
    expect(toggle).toBeDisabled()

    await user.click(toggle)
    expect(screen.queryByRole('button', { name: 'Cursor' })).not.toBeInTheDocument()
  })

  test('default model selection reflects initial value', () => {
    setup('cursor')
    const toggle = screen.getByRole('button', { name: /Cursor/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.querySelector('.bg-purple-500')).toBeTruthy()
  })

  test('falls back to default model when given invalid value', () => {
    const onChange = vi.fn()
    // Force an invalid value through casts to exercise fallback
    render(<ModelSelector value={'invalid' as unknown as 'claude' | 'cursor'} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /Claude/i })).toBeInTheDocument()
  })

  test('mocks external model API calls (no network during interaction)', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(global as any, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) })

    const { onChange } = setup('claude')
    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'Cursor' }))

    expect(onChange).toHaveBeenCalledWith('cursor')
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})
