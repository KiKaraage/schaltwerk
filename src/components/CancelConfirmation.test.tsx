import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CancelConfirmation } from './CancelConfirmation'

describe('CancelConfirmation', () => {
  const baseProps = {
    open: true,
    sessionName: 'sess',
    hasUncommittedChanges: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders and confirms cancel', () => {
    const onConfirm = vi.fn()
    render(<CancelConfirmation {...baseProps} onConfirm={onConfirm} />)
    expect(screen.getByText('Cancel Session: sess?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Cancel Session/ }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('renders warning when uncommitted and uses Force Cancel', () => {
    const onConfirm = vi.fn()
    render(<CancelConfirmation {...baseProps} hasUncommittedChanges={true} onConfirm={onConfirm} />)
    expect(screen.getByText(/uncommitted changes/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Force Cancel/ }))
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('handles keyboard: Esc cancels, Enter confirms', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<CancelConfirmation {...baseProps} onConfirm={onConfirm} onCancel={onCancel} hasUncommittedChanges={false} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })
})
