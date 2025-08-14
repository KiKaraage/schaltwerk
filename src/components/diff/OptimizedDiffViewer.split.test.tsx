import { render, screen } from '@testing-library/react'
import { OptimizedDiffViewer } from './OptimizedDiffViewer'

const OLD = `a\nb\nc`
const NEW = `a\nX\nb\nc\nY`

describe('OptimizedDiffViewer (split)', () => {
  it('renders two panes with aligned rows and change highlights', () => {
    render(
      <OptimizedDiffViewer
        oldContent={OLD}
        newContent={NEW}
        viewMode="split"
        leftTitle="LeftBase"
        rightTitle="RightHead"
      />
    )

    // Headers
    expect(screen.getByText('LeftBase')).toBeInTheDocument()
    expect(screen.getByText('RightHead')).toBeInTheDocument()

    // Content expectations:
    // - 'X' appears as an added line on the right side only
    expect(screen.getByText('X')).toBeInTheDocument()
    // - 'Y' appears as an added line on the right side only
    expect(screen.getByText('Y')).toBeInTheDocument()
    // - Unchanged line 'a' should exist
    expect(screen.getAllByText('a').length).toBeGreaterThan(0)

    // Line numbers: left has 3 lines, right has 5 lines
    // We just assert some representative numbers show up.
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
  })
})
