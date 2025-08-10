import { useEffect } from 'react'

interface KeyboardShortcutsProps {
    onSelectOrchestrator: () => void
    onSelectSession: (index: number) => void
    onCancelSelectedSession?: (immediate: boolean) => void
    onMarkSelectedSessionReady?: () => void
    sessionCount: number
    onSelectPrevSession?: () => void
    onSelectNextSession?: () => void
    onFocusSidebar?: () => void
    onFocusClaude?: () => void
}

export function useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onCancelSelectedSession, onMarkSelectedSessionReady, sessionCount, onSelectPrevSession, onSelectNextSession, onFocusSidebar, onFocusClaude }: KeyboardShortcutsProps) {
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
            } else if (key === 'ArrowUp') {
                if (onSelectPrevSession) {
                    event.preventDefault()
                    onSelectPrevSession()
                }
            } else if (key === 'ArrowDown') {
                if (onSelectNextSession) {
                    event.preventDefault()
                    onSelectNextSession()
                }
            } else if (key === 'ArrowLeft') {
                if (onFocusSidebar) {
                    event.preventDefault()
                    onFocusSidebar()
                }
            } else if (key === 'ArrowRight') {
                if (onFocusClaude) {
                    event.preventDefault()
                    onFocusClaude()
                }
            } else if (key === 'd' || key === 'D') {
                if (onCancelSelectedSession) {
                    event.preventDefault()
                    const immediate = event.shiftKey === true
                    onCancelSelectedSession(immediate)
                }
            } else if (key === 'r' || key === 'R') {
                if (onMarkSelectedSessionReady) {
                    event.preventDefault()
                    onMarkSelectedSessionReady()
                }
            }
        }
        
        window.addEventListener('keydown', handleKeyDown)
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [sessionCount, onSelectOrchestrator, onSelectSession, onCancelSelectedSession, onMarkSelectedSessionReady, onSelectPrevSession, onSelectNextSession, onFocusSidebar, onFocusClaude])
}