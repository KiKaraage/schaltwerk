import React, { useEffect } from 'react'
import { render } from '@testing-library/react'
import { SelectionProvider } from '../contexts/SelectionContext'
import { FocusProvider } from '../contexts/FocusContext'
import { ReviewProvider } from '../contexts/ReviewContext'
import { ProjectProvider, useProject } from '../contexts/ProjectContext'
import { FontSizeProvider } from '../contexts/FontSizeContext'

export function renderWithProviders(ui: React.ReactElement) {
  return render(
    <FontSizeProvider>
      <ProjectProvider>
        <SelectionProvider>
          <FocusProvider>
            <ReviewProvider>
              {ui}
            </ReviewProvider>
          </FocusProvider>
        </SelectionProvider>
      </ProjectProvider>
    </FontSizeProvider>
  )
}

// Component to set project path for tests
function TestProjectInitializer({ children }: { children: React.ReactNode }) {
  const { setProjectPath } = useProject()
  
  useEffect(() => {
    // Set a test project path immediately
    setProjectPath('/test/project')
  }, [setProjectPath])
  
  return <>{children}</>
}

export function TestProviders({ children }: { children: React.ReactNode }) {
  return (
    <FontSizeProvider>
      <ProjectProvider>
        <TestProjectInitializer>
          <SelectionProvider>
            <FocusProvider>
              <ReviewProvider>
                {children}
              </ReviewProvider>
            </FocusProvider>
          </SelectionProvider>
        </TestProjectInitializer>
      </ProjectProvider>
    </FontSizeProvider>
  )
}