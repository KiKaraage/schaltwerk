import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import 'highlight.js/styles/github-dark.css'
import App from './App'
import { SelectionProvider } from './contexts/SelectionContext'
import { FocusProvider } from './contexts/FocusContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SelectionProvider>
      <FocusProvider>
        <div className="h-screen w-screen">
          <App />
        </div>
      </FocusProvider>
    </SelectionProvider>
  </React.StrictMode>,
)
