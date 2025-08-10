import { useEffect } from 'react'

interface KeyboardShortcutsProps {
    onSelectOrchestrator: () => void
    onSelectSession: (index: number) => void
    onCancelSelectedSession?: (immediate: boolean) => void
    sessionCount: number
}

export function useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onCancelSelectedSession, sessionCount }: KeyboardShortcutsProps) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
            const modifierKey = isMac ? event.metaKey : event.ctrlKey
            
            if (!modifierKey) return
            
            const key = event.key
            
            if (key === '1') {
                event.preventDefault()
                onSelectOrchestrator()
            } else if (key >= '2' && key <= '9') {
                event.preventDefault()
                const sessionIndex = parseInt(key) - 2
                if (sessionIndex < sessionCount) {
                    onSelectSession(sessionIndex)
                }
            } else if (key === 'd' || key === 'D') {
                if (onCancelSelectedSession) {
                    event.preventDefault()
                    const immediate = event.shiftKey === true
                    onCancelSelectedSession(immediate)
                }
            }
        }
        
        window.addEventListener('keydown', handleKeyDown)
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [sessionCount, onSelectOrchestrator, onSelectSession, onCancelSelectedSession])
}