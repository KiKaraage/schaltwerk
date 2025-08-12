import { createContext, useContext, useState, ReactNode } from 'react'

interface ProjectContextType {
  projectPath: string | null
  setProjectPath: (path: string | null) => void
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined)

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectPath, setProjectPath] = useState<string | null>(null)

  return (
    <ProjectContext.Provider value={{ projectPath, setProjectPath }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider')
  }
  return context
}