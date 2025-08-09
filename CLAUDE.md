# CLAUDE.md - Para UI Development Guidelines

This file provides guidance to Claude Code when working with the Para UI codebase.

## Project Overview

Para UI is a Tauri-based desktop application that provides a visual interface for managing Para sessions. It features multiple terminal panels, session management, and real-time status monitoring.

## Essential Development Commands

### Before Completing ANY Task

**IMPORTANT**: Always run these commands before considering a task complete:

```bash
# Run all tests and lints
npm run test

# Or individually:
npm run lint          # TypeScript type checking
npm run lint:rust     # Rust clippy linting
npm run build:rust    # Rust compilation check
```

### Development Commands

```bash
npm run dev           # Start Vite dev server
npm run build         # Build TypeScript/React frontend
npm run tauri dev     # Run full Tauri app in development mode
npm run check         # Full check (alias for npm run test)
```

## Architecture Overview

### Frontend (React/TypeScript)
```
src/
├── components/       # React components
│   ├── Terminal.tsx  # Core terminal renderer using xterm.js
│   ├── TerminalGrid.tsx  # Main dual-terminal layout
│   ├── LazyGitPanel.tsx  # Right panel terminal
│   └── Sidebar.tsx   # Session list and navigation
├── hooks/           # Custom React hooks
│   ├── useSessionTerminals.ts     # Single terminal management
│   └── useSessionTerminalPair.ts  # Dual terminal management
└── App.tsx          # Main application component
```

### Backend (Rust/Tauri)
```
src-tauri/
├── src/
│   ├── main.rs      # Tauri app entry point and commands
│   ├── pty.rs       # Terminal PTY management
│   └── cleanup.rs   # Process cleanup on exit
└── Cargo.toml       # Rust dependencies
```

## Key Features

### Terminal Management
- **Session-aware terminals**: Each session has 3 terminals (top, bottom, right)
- **Lazy creation**: Terminals created only when first needed
- **Persistent state**: Terminals keep running when switching sessions
- **Proper cleanup**: All processes killed when app exits

### Terminal ID Convention
```
Orchestrator:
- orchestrator-top
- orchestrator-bottom  
- orchestrator-right

Sessions:
- session-{name}-top
- session-{name}-bottom
- session-{name}-right
```

## Testing Requirements

### Before ANY Commit

**MANDATORY**: Run `npm run test` and ensure it passes completely. This command runs:
1. **TypeScript linting**: `npm run lint` - TypeScript must compile with no errors
2. **Rust linting**: `npm run lint:rust` - Clippy must pass with no warnings  
3. **Rust tests**: `npm run test:rust` - All unit tests must pass
4. **Rust build**: `npm run build:rust` - Must compile successfully

Never consider a task complete unless `npm run test` passes without errors.

### Common Issues to Check
- Unused imports (both TypeScript and Rust)
- Missing JSX configuration in tsconfig.json
- Unhandled async/await in Tauri commands
- Terminal cleanup on app exit
- Memory leaks from event listeners

## Code Style Requirements

### TypeScript/React
- Use functional components with hooks
- Extract reusable logic into custom hooks
- Proper TypeScript types (avoid `any`)
- Clean up event listeners in useEffect
- Handle errors gracefully

### Rust
- Use `Result<T, String>` for Tauri commands
- Proper async/await handling
- Clean up resources (PTY processes, file handles)
- No clippy warnings allowed
- Use `#[warn(unused_imports)]` directive

## Critical Implementation Details

### Terminal Lifecycle
1. **Creation**: PTY process spawned on first session access
2. **Switching**: Frontend switches terminal IDs, backend processes persist
3. **Cleanup**: All processes killed via cleanup module on app exit

### Event System
- `para-ui:selection`: Emitted when user selects different session
- `terminal-output-{id}`: Terminal output events from backend
- Components listen and react to maintain synchronization

### Known Issues
- Terminal resize events need debouncing to prevent flicker
- Initial terminal size must match container dimensions
- Visibility detection prevents inactive terminals from processing input

## Development Workflow

1. Make changes
2. Run `npm run lint` to check TypeScript
3. Run `npm run lint:rust` to check Rust code
4. Run `npm run test` for full validation
5. Test in dev mode: `npm run tauri dev`
6. Only commit when all checks pass

## Important Notes

- **Never skip the test step**: Running `npm run test` before commits prevents broken builds
- **Terminal cleanup is critical**: Always ensure PTY processes are properly terminated
- **Session persistence**: Terminals should survive session switches but not app restarts
- **Resource management**: Each session creates 3 OS processes - handle with care

## Common Tasks

### Adding a new terminal panel
1. Create new component using `Terminal` component
2. Use `useSessionTerminals` hook for session awareness
3. Follow naming convention: `{context}-{position}`
4. Ensure cleanup in backend

### Debugging terminal issues
1. Check browser console for JavaScript errors
2. Check Tauri console for Rust errors
3. Verify terminal IDs match expected format
4. Use `ps aux | grep -E "zsh|bash|fish"` to check for orphaned processes
5. Check application logs (see Logging section below)

### Performance optimization
1. Minimize resize events with debouncing
2. Use visibility detection to pause inactive terminals
3. Lazy-create terminals only when needed
4. Properly dispose xterm.js instances

## Logging

### Log File Location
The application writes detailed logs to help debug issues. Log files are located at:
- **macOS**: `~/Library/Application Support/para-ui/logs/para-ui-{timestamp}.log`
- **Linux**: `~/.local/share/para-ui/logs/para-ui-{timestamp}.log`
- **Windows**: `%LOCALAPPDATA%\para-ui\logs\para-ui-{timestamp}.log`

The exact log file path is printed to stderr when the app starts with a 📝 emoji prefix.

### Log Content
Logs include:
- Terminal creation/destruction events
- Terminal resize operations
- Session switching events
- Errors and warnings
- Terminal process lifecycle

### Viewing Logs
```bash
# macOS - View latest log
tail -f ~/Library/Application\ Support/para-ui/logs/para-ui-*.log

# Linux - View latest log
tail -f ~/.local/share/para-ui/logs/para-ui-*.log

# Filter for terminal-related events
cat ~/Library/Application\ Support/para-ui/logs/para-ui-*.log | grep -E "Creating terminal|Terminal.*exists|Switching from"
```

### Common Log Patterns to Watch For
- **Duplicate terminal creation**: Multiple "Creating terminal" entries with the same ID indicates a bug
- **Orphaned terminals**: Terminals created but never closed in cleanup
- **Failed operations**: WARN or ERROR level messages indicate problems


### Code Quality

- Do not write comments, ensure we have self-documenting code.
- Avoid writing fallbacks or alternative solutions to solve them. Rather fix them directly.
- Never write altnerative file names, functions or components. Rather fix them directly.
- Ask the user if problems seem impossible or difficult to solve for advice.
- Always develop deterministic solutions and never heuristics.
