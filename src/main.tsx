import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { SelectionProvider } from './contexts/SelectionContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SelectionProvider>
      <div className="h-screen w-screen">
        <App />
      </div>
    </SelectionProvider>
  </React.StrictMode>,
)
