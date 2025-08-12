import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import 'highlight.js/styles/github-dark.css'
import App from './App'
import { SelectionProvider } from './contexts/SelectionContext'
import { FocusProvider } from './contexts/FocusContext'
import { ReviewProvider } from './contexts/ReviewContext'
import { ProjectProvider } from './contexts/ProjectContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProjectProvider>
      <SelectionProvider>
        <FocusProvider>
          <ReviewProvider>
            <div className="h-screen w-screen">
              <App />
            </div>
          </ReviewProvider>
        </FocusProvider>
      </SelectionProvider>
    </ProjectProvider>
  </React.StrictMode>,
)
