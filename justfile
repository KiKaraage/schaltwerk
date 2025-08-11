# Para UI Development Commands

# Install all dependencies for development
install:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "📦 Installing npm dependencies..."
    npm install
    echo "🦀 Installing Rust dependencies..."
    cd src-tauri && cargo build --release
    echo "✅ All dependencies installed successfully!"

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
    set -euo pipefail
    
    if lsof -i :{{port}} >/dev/null 2>&1; then
        echo "❌ Port {{port}} is already in use"
        exit 1
    fi
    
    echo "🚀 Starting Para UI on port {{port}}"
    
    # Create temporary config override
    temp_config=$(mktemp)
    echo '{' > "$temp_config"
    echo '  "build": {' >> "$temp_config"
    echo '    "devUrl": "http://localhost:{{port}}",' >> "$temp_config"
    echo '    "beforeDevCommand": "npm run dev",' >> "$temp_config"
    echo '    "beforeBuildCommand": "npm run build",' >> "$temp_config"
    echo '    "frontendDist": "../dist"' >> "$temp_config"
    echo '  }' >> "$temp_config"
    echo '}' >> "$temp_config"
    
    # Export the port for Vite
    export VITE_PORT={{port}}
    export PORT={{port}}
    
    # Cleanup function to remove temp config
    cleanup() {
        echo "🧹 Cleaning up temporary config..."
        rm -f "$temp_config"
    }
    
    # Set trap to cleanup on exit
    trap cleanup EXIT
    
    # Start Tauri with config override
    npm run tauri dev -- --config "$temp_config"

# Build the application for production
build:
    npm run build && npm run tauri build

# Build and run the application in production mode
run-build:
    npm run build && npm run tauri build && ./src-tauri/target/release/para-ui

# Run all tests and lints
test:
    npm run test

# Run the application using the compiled release binary (no autoreload)
run-release:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🚀 Building Para UI (release bundle, no auto-reload)…"
    npm run build
    npm run tauri build
    echo "✅ Build complete. Launching binary from CWD: $(pwd)…"
    # Pass repository path explicitly so backend can discover it even from packaged runs
    PARA_REPO_PATH="$(pwd)" ./src-tauri/target/release/ui

# Same as run-release but allows specifying a port environment
# Useful if parts of the app read PORT/VITE_PORT at runtime
run-port-release port:
    ./scripts/fast-build.sh {{port}}