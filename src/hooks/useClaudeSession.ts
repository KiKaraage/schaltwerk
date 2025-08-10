import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface ClaudeSessionOptions {
    sessionName?: string
    isOrchestrator?: boolean
}

export function useClaudeSession() {
    const startClaude = useCallback(async (options: ClaudeSessionOptions = {}) => {
        console.log('[useClaudeSession] startClaude called with options:', options)
        try {
            if (options.isOrchestrator) {
                console.log('[useClaudeSession] Invoking para_core_start_claude_orchestrator')
                await invoke('para_core_start_claude_orchestrator')
                console.log('[useClaudeSession] Successfully started Claude for orchestrator')
                return { success: true }
            } else if (options.sessionName) {
                console.log('[useClaudeSession] Invoking para_core_start_claude for session:', options.sessionName)
                await invoke('para_core_start_claude', { sessionName: options.sessionName })
                console.log('[useClaudeSession] Successfully started Claude for session:', options.sessionName)
                return { success: true }
            } else {
                console.error('[useClaudeSession] Invalid Claude session options: must specify either isOrchestrator or sessionName')
                return { success: false, error: 'Invalid options' }
            }
        } catch (error) {
            console.error('[useClaudeSession] Failed to start Claude:', error)
            return { success: false, error: String(error) }
        }
    }, [])

    const getSkipPermissions = useCallback(async (): Promise<boolean> => {
        try {
            return await invoke<boolean>('para_core_get_skip_permissions')
        } catch (error) {
            console.error('Failed to get skip permissions:', error)
            return false
        }
    }, [])

    const setSkipPermissions = useCallback(async (enabled: boolean): Promise<boolean> => {
        try {
            await invoke('para_core_set_skip_permissions', { enabled })
            return true
        } catch (error) {
            console.error('Failed to set skip permissions:', error)
            return false
        }
    }, [])

    return {
        startClaude,
        getSkipPermissions,
        setSkipPermissions,
    }
}