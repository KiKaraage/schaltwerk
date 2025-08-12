#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js"
import { SchaltwerkBridge, Session } from "./schaltwerk-bridge.js"

interface SchaltwerkStartArgs {
  name?: string
  prompt?: string
  agent_type?: 'claude' | 'cursor'
  base_branch?: string
  skip_permissions?: boolean
}

interface SchaltwerkCancelArgs {
  session_name: string
}

interface SchaltwerkListArgs {
  json?: boolean
}

const bridge = new SchaltwerkBridge()

const server = new Server({
  name: "schaltwerk-mcp-server",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
    resources: {},
  }
})

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "schaltwerk_create",
        description: `Create a new Schaltwerk session for development work.

🎯 PURPOSE: Start new isolated Git worktrees for development tasks with AI assistance.

📋 USAGE:
- Basic: schaltwerk_create(name: "feature-auth", prompt: "implement user authentication")
- With agent type: schaltwerk_create(name: "api-feature", prompt: "add REST API", agent_type: "cursor")
- With base branch: schaltwerk_create(name: "fix-bug", prompt: "fix login issue", base_branch: "develop")
- Skip permissions: schaltwerk_create(name: "quick-fix", prompt: "fix typo", skip_permissions: true)

🤖 AGENT TYPES:
- 'claude': Use Claude AI assistant (default)
- 'cursor': Use Cursor IDE integration

📝 PROMPTING:
When creating sessions for AI agents, provide clear, specific prompts:
- GOOD: "implement user authentication with JWT tokens and password reset"
- GOOD: "fix the login bug where users can't sign in with email addresses"
- BAD: "add auth"
- BAD: "fix bug"

The prompt becomes the initial context for the AI agent working in that session.

⚙️ OPTIONS:
- skip_permissions: Skip permission warnings (use --dangerously-skip-permissions)
- base_branch: Branch to create from (defaults to main/master)

⚠️ IMPORTANT: Each session creates a separate Git worktree, allowing parallel development.`,
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Session name (alphanumeric, hyphens, underscores). Will be used in branch name: schaltwerk/{name}"
            },
            prompt: {
              type: "string",
              description: "Initial task description or context for AI agent. Be specific and detailed."
            },
            agent_type: {
              type: "string",
              enum: ["claude", "cursor"],
              description: "AI agent type to use (default: claude)"
            },
            base_branch: {
              type: "string",
              description: "Base branch to create session from (default: main/master)"
            },
            skip_permissions: {
              type: "boolean",
              description: "Skip permission warnings for autonomous operation (use with caution)"
            }
          },
          required: ["name", "prompt"]
        }
      },
      {
        name: "schaltwerk_list",
        description: `List all Schaltwerk sessions with essential metadata for session management.

📊 JSON OUTPUT (json: true):
- name: Session identifier
- display_name: Human-readable name
- status: "new" | "reviewed" 
- created_at: ISO timestamp
- last_activity: ISO timestamp or null
- agent_type: "claude" | "cursor"
- branch: Git branch name
- worktree_path: Local path
- initial_prompt: Original task description

📋 TEXT OUTPUT (default):
- Formatted list showing review status, name, agent, and last modified

💡 COMMON TASKS:
- List unreviewed sessions: filter by status="new"
- Find active work: check last_activity timestamps
- Identify sessions by agent type
- Get session paths for file operations

Use json: true for programmatic access with clean, essential data only.`,
        inputSchema: {
          type: "object",
          properties: {
            json: {
              type: "boolean",
              description: "Return structured JSON data instead of formatted text",
              default: false
            }
          },
          additionalProperties: false
        }
      },
      {
        name: "schaltwerk_cancel",
        description: `Cancel and permanently delete a Schaltwerk session.

⚠️ WARNING: DESTRUCTIVE OPERATION
- Removes the Git worktree
- Deletes the Git branch
- Loses ALL uncommitted changes
- Cannot be undone

📋 USAGE:
schaltwerk_cancel(session_name: "feature-auth")

✅ WHEN TO USE:
- Cleaning up abandoned or failed sessions
- Removing experimental branches
- After work has been merged elsewhere

❌ WHEN NOT TO USE:
- If session has uncommitted work you want to keep
- For the current active session
- If you're unsure about losing the work

💡 ALTERNATIVE: Use 'schaltwerk_finish' to properly complete and merge work instead.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the session to cancel and delete permanently"
            }
          },
          required: ["session_name"]
        }
      }
    ]
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    let result: string

    switch (name) {
      case "schaltwerk_create": {
        const createArgs = args as SchaltwerkStartArgs
        
        const session = await bridge.createSession(
          createArgs.name || `mcp_session_${Date.now()}`,
          createArgs.prompt,
          createArgs.base_branch,
          createArgs.agent_type,
          createArgs.skip_permissions
        )
        
        result = `Session created successfully:
- Name: ${session.name}
- Branch: ${session.branch}
- Worktree: ${session.worktree_path}
- Agent: ${session.original_agent_type}
- Base Branch: ${session.parent_branch}
${session.initial_prompt ? `- Initial Prompt: ${session.initial_prompt}` : ''}`
        break
      }

      case "schaltwerk_list": {
        const listArgs = args as SchaltwerkListArgs
        
        const sessions = await bridge.listSessions()
        
        if (listArgs.json) {
          // Return only essential fields for LLM session management
          const essentialSessions = sessions.map(s => ({
            name: s.name,
            display_name: s.display_name || s.name,
            status: s.ready_to_merge ? 'reviewed' : 'new',
            created_at: new Date(s.created_at).toISOString(),
            last_activity: s.last_activity ? new Date(s.last_activity).toISOString() : null,
            agent_type: s.original_agent_type || 'claude',
            branch: s.branch,
            worktree_path: s.worktree_path,
            initial_prompt: s.initial_prompt || null
          }))
          result = JSON.stringify(essentialSessions, null, 2)
        } else {
          if (sessions.length === 0) {
            result = 'No active sessions found'
          } else {
            // Format as human-readable text
            const lines = sessions.map((s: Session) => {
              const reviewed = s.ready_to_merge ? '[REVIEWED]' : '[NEW]'
              const agent = s.original_agent_type || 'unknown'
              const modified = s.last_activity ? new Date(s.last_activity).toLocaleString() : 'never'
              const name = s.display_name || s.name
              
              return `${reviewed} ${name} - Agent: ${agent}, Modified: ${modified}`
            })
            
            result = `Active Sessions (${sessions.length}):\n${lines.join('\n')}`
          }
        }
        break
      }

      case "schaltwerk_cancel": {
        const cancelArgs = args as unknown as SchaltwerkCancelArgs
        
        await bridge.cancelSession(cancelArgs.session_name)
        
        result = `Session '${cancelArgs.session_name}' has been cancelled and removed`
        break
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
    }

    return {
      content: [
        {
          type: "text",
          text: result
        }
      ]
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`)
  }
})

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "schaltwerk://sessions",
        name: "Schaltwerk Sessions",
        description: "List of all active Schaltwerk sessions with full metadata",
        mimeType: "application/json"
      },
      {
        uri: "schaltwerk://sessions/reviewed",
        name: "Reviewed Sessions",
        description: "Sessions marked as ready to merge",
        mimeType: "application/json"
      },
      {
        uri: "schaltwerk://sessions/new",
        name: "New Sessions",
        description: "Sessions not yet reviewed",
        mimeType: "application/json"
      }
    ]
  }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params

  try {
    let content: string

    switch (uri) {
      case "schaltwerk://sessions": {
        const sessions = await bridge.listSessions()
        content = JSON.stringify(sessions, null, 2)
        break
      }

      case "schaltwerk://sessions/reviewed": {
        const sessions = await bridge.listSessions()
        const reviewed = sessions.filter(s => s.ready_to_merge)
        content = JSON.stringify(reviewed, null, 2)
        break
      }

      case "schaltwerk://sessions/new": {
        const sessions = await bridge.listSessions()
        const newSessions = sessions.filter(s => !s.ready_to_merge)
        content = JSON.stringify(newSessions, null, 2)
        break
      }

      default:
        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`)
    }

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: content
        }
      ]
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new McpError(ErrorCode.InternalError, `Resource read failed: ${errorMessage}`)
  }
})

async function main(): Promise<void> {
  // Connect to database on startup
  await bridge.connect()
  
  const transport = new StdioServerTransport()
  await server.connect(transport)
  
  console.error("Schaltwerk MCP server running")
  console.error("Connected to database, ready to manage sessions")
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    await bridge.disconnect()
    process.exit(0)
  })
  
  process.on('SIGTERM', async () => {
    await bridge.disconnect()
    process.exit(0)
  })
}

main().catch(console.error)