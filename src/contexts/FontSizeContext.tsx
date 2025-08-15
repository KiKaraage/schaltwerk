import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface FontSizeContextType {
  baseFontSize: number
  terminalFontSize: number
  uiFontSize: number
  increaseFontSize: () => void
  decreaseFontSize: () => void
  resetFontSize: () => void
}

const FontSizeContext = createContext<FontSizeContextType | undefined>(undefined)

const DEFAULT_BASE_FONT_SIZE = 13
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 24
const FONT_SIZE_STEP = 1

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [baseFontSize, setBaseFontSize] = useState(DEFAULT_BASE_FONT_SIZE)
  const [initialized, setInitialized] = useState(false)

  // Load font size from database on mount
  useEffect(() => {
    invoke<number>('para_core_get_font_size')
      .then(size => {
        if (size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) {
          setBaseFontSize(size)
        }
        setInitialized(true)
      })
      .catch(err => {
        console.error('Failed to load font size:', err)
        setInitialized(true)
      })
  }, [])

  const terminalFontSize = baseFontSize
  // Keep original sizing: UI was 12px when terminal was 13px
  const uiFontSize = baseFontSize === DEFAULT_BASE_FONT_SIZE ? 12 : Math.max(Math.round(baseFontSize * 0.92), 10)

  // Save font size to database when it changes
  useEffect(() => {
    if (!initialized) return
    
    invoke('para_core_set_font_size', { fontSize: baseFontSize })
      .catch(err => console.error('Failed to save font size:', err))
    
    document.documentElement.style.setProperty('--terminal-font-size', `${terminalFontSize}px`)
    document.documentElement.style.setProperty('--ui-font-size', `${uiFontSize}px`)
    document.documentElement.style.setProperty('--base-font-size', `${baseFontSize}px`)
    
    window.dispatchEvent(new CustomEvent('font-size-changed', { 
      detail: { baseFontSize, terminalFontSize, uiFontSize } 
    }))
  }, [baseFontSize, terminalFontSize, uiFontSize, initialized])

  const increaseFontSize = () => {
    setBaseFontSize(prev => Math.min(prev + FONT_SIZE_STEP, MAX_FONT_SIZE))
  }

  const decreaseFontSize = () => {
    setBaseFontSize(prev => Math.max(prev - FONT_SIZE_STEP, MIN_FONT_SIZE))
  }

  const resetFontSize = () => {
    setBaseFontSize(DEFAULT_BASE_FONT_SIZE)
  }

  return (
    <FontSizeContext.Provider value={{
      baseFontSize,
      terminalFontSize,
      uiFontSize,
      increaseFontSize,
      decreaseFontSize,
      resetFontSize
    }}>
      {children}
    </FontSizeContext.Provider>
  )
}

export function useFontSize() {
  const context = useContext(FontSizeContext)
  if (context === undefined) {
    throw new Error('useFontSize must be used within a FontSizeProvider')
  }
  return context
}