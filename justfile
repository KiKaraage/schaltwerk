# Para UI Development Commands

# Find an available port starting from a base port
_find_available_port base_port:
    #!/usr/bin/env bash
    port={{base_port}}
    while lsof -i :$port >/dev/null 2>&1; do
        port=$((port + 1))
    done
    echo $port

# Run the application in development mode with auto port detection
run:
    #!/usr/bin/env bash
    set -euo pipefail
    
    # Find available port starting from 1420
    port=$(just _find_available_port 1420)
    echo "🚀 Starting Para UI on port $port"
    
    # Export the port for Vite
    export VITE_PORT=$port
    
    # Start the full Tauri development environment
    npm run tauri dev

# Run only the frontend (Vite dev server) on auto-detected port
run-frontend:
    #!/usr/bin/env bash
    set -euo pipefail
    
    port=$(just _find_available_port 1420)
    echo "🌐 Starting frontend on port $port"
    
    export VITE_PORT=$port
    npm run dev

# Run only the backend (Tauri/Rust)
run-backend:
    #!/usr/bin/env bash
    cd src-tauri
    cargo run

# Run frontend and backend separately in parallel
run-split:
    #!/usr/bin/env bash
    set -euo pipefail
    
    port=$(just _find_available_port 1420)
    echo "🔧 Starting split mode - Frontend: $port, Backend: separate process"
    
    # Start frontend in background
    VITE_PORT=$port npm run dev &
    frontend_pid=$!
    
    # Wait a moment for frontend to start
    sleep 2
    
    # Start backend
    echo "🦀 Starting Rust backend..."
    cd src-tauri
    FRONTEND_URL="http://localhost:$port" cargo run &
    backend_pid=$!
    
    # Handle cleanup on exit
    trap "echo 'Stopping services...'; kill $frontend_pid $backend_pid 2>/dev/null || true" EXIT
    
    echo "✅ Services running - Frontend: http://localhost:$port"
    echo "📝 Press Ctrl+C to stop both services"
    
    # Wait for either process to exit
    wait

# Run on a specific port
run-port port:
    #!/usr/bin/env bash
    if lsof -i :{{port}} >/dev/null 2>&1; then
        echo "❌ Port {{port}} is already in use"
        exit 1
    fi
    
    echo "🚀 Starting Para UI on port {{port}}"
    export VITE_PORT={{port}}
    npm run tauri dev

# Build the application for production
build:
    npm run build && npm run tauri build

# Run all tests and lints
test:
    npm run test