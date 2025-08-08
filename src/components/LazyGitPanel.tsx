import React, { useEffect, useState } from 'react'
import { Terminal } from './Terminal'
import { invoke } from '@tauri-apps/api/core'

export function LazyGitPanel() {
    const [terminalId] = useState('lazygit-panel')
    const [isInitialized, setIsInitialized] = useState(false)

    useEffect(() => {
        const initLazyGit = async () => {
            if (isInitialized) return
            
            try {
                // Get the current working directory (UI folder)
                const cwd = '/Users/marius.wichtner/Documents/git/para/ui'
                
                // Create terminal for lazygit
                await invoke('create_terminal', { 
                    id: terminalId, 
                    cwd: cwd
                })
                
                // Small delay to ensure terminal is ready
                setTimeout(async () => {
                    // Send lazygit command to the terminal
                    await invoke('write_terminal', { 
                        id: terminalId, 
                        data: 'lazygit\r\n'
                    })
                }, 500)
                
                setIsInitialized(true)
            } catch (error) {
                console.error('Failed to initialize lazygit:', error)
            }
        }

        initLazyGit()
    }, [terminalId, isInitialized])

    return (
        <div className="h-full flex flex-col bg-panel">
            <div className="px-3 py-2 text-sm text-slate-400 border-b border-slate-800">
                Git Diff — lazygit
            </div>
            <div className="flex-1 overflow-hidden">
                <Terminal terminalId={terminalId} className="h-full" />
            </div>
        </div>
    )
}