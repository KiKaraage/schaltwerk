# Schaltwerk

Schaltwerk is a Tauri-based desktop application that provides a visual interface for managing Schaltwerk sessions. It features multiple terminal panels, session management, and real-time status monitoring.

## Features

- **Multi-terminal Interface**: Dual-pane terminal layout with Claude integration
- **Session Management**: Create, switch between, and manage Schaltwerk sessions
- **Real-time Monitoring**: Live session status and progress tracking  
- **Diff Viewer**: Integrated diff viewing with review capabilities
- **Keyboard Navigation**: Comprehensive keyboard shortcuts for efficient workflow

## Quick Start

### Development
```bash
npm install
npm run tauri dev
```

### Building
```bash
npm run build
npm run tauri build
```

### Testing
```bash
npm run test
```

## Documentation

### [📋 Keyboard Shortcuts](./docs/keyboard-shortcuts.md)
Complete reference for all keyboard shortcuts and navigation:
- **⌘T** / **Ctrl+T** - Focus sessions
- **⌘/** / **Ctrl+/** - Focus terminal
- **⌘1-9** - Switch sessions
- **⌘N** - New session
- And many more...

See the [full documentation](./docs/) for detailed guides and references.

## Architecture

### Frontend (React/TypeScript)
- `src/components/` - React components
- `src/hooks/` - Custom React hooks  
- `src/contexts/` - React Context providers

### Backend (Rust/Tauri)
- `src-tauri/src/` - Rust application logic
- Terminal PTY management
- Process lifecycle handling

## Development Setup

### Recommended IDE Setup
- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
