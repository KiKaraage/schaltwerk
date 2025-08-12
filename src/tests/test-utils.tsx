import React from 'react'
import { render } from '@testing-library/react'
import { SelectionProvider } from '../contexts/SelectionContext'
import { FocusProvider } from '../contexts/FocusContext'
import { ReviewProvider } from '../contexts/ReviewContext'
import { ProjectProvider } from '../contexts/ProjectContext'

export function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ProjectProvider>
      <SelectionProvider>
        <FocusProvider>
          <ReviewProvider>
            {ui}
          </ReviewProvider>
        </FocusProvider>
      </SelectionProvider>
    </ProjectProvider>
  )
}

export function TestProviders({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <SelectionProvider>
        <FocusProvider>
          <ReviewProvider>
            {children}
          </ReviewProvider>
        </FocusProvider>
      </SelectionProvider>
    </ProjectProvider>
  )
}