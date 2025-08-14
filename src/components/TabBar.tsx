import { Tab } from './Tab'

export interface ProjectTab {
  projectPath: string
  projectName: string
}

interface TabBarProps {
  tabs: ProjectTab[]
  activeTabPath: string | null
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
}

export function TabBar({ tabs, activeTabPath, onSelectTab, onCloseTab }: TabBarProps) {
  if (tabs.length === 0) return null
  
  return (
    <div className="flex items-center gap-2">
      {tabs.map((tab) => (
        <Tab
          key={tab.projectPath}
          projectPath={tab.projectPath}
          projectName={tab.projectName}
          isActive={tab.projectPath === activeTabPath}
          onSelect={() => onSelectTab(tab.projectPath)}
          onClose={() => onCloseTab(tab.projectPath)}
        />
      ))}
    </div>
  )
}