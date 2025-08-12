# Para UI Development Commands

# Default command - show available commands
default:
    @just --list

# Install development dependencies
install:
    #!/usr/bin/env bash
    set -euo pipefail
    
    echo "📦 Installing development dependencies..."
    npm install
    
    echo "✅ Development dependencies installed successfully!"
    echo "💡 Run 'just run' to start the development server"
    echo "💡 Run 'just deploy-mac' to install the app to /Applications"

# Find an available port starting from a base port
_find_available_port base_port:
    #!/usr/bin/env bash
    port={{base_port}}
    while lsof -i :$port >/dev/null 2>&1; do
        port=$((port + 1))
    done
    echo $port

# Run the application in development mode with auto port detection (optimized for speed)
run:
    #!/usr/bin/env bash
    set -euo pipefail
    
    # Find available port starting from 1420
    port=$(just _find_available_port 1420)
    echo "🚀 Starting Para UI on port $port (optimized for speed)"
    
    # Enable all available speed optimizations
    if command -v sccache &> /dev/null; then
        echo "✨ Using sccache for Rust compilation caching"
        export RUSTC_WRAPPER=sccache
        export SCCACHE_DIR=$HOME/.cache/sccache
    fi
    
    # Use optimized dev profile settings
    export CARGO_PROFILE_DEV_BUILD_OVERRIDE_OPT_LEVEL=1
    export CARGO_PROFILE_DEV_BUILD_OVERRIDE_DEBUG=0
    
    # Export the port for Vite
    export VITE_PORT=$port
    
    # Start with fast build mode
    TAURI_SKIP_DEVSERVER_CHECK=true npm run tauri dev

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
    PARA_REPO_PATH="$(pwd)" ./src-tauri/target/release/schaltwerk

# Build and run the application in release mode with a specific port
# This builds fresh like 'just run' does, but creates a release build
run-port-release port:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🚀 Building Para UI release on port {{port}}..."
    
    # Export port for any runtime components that need it
    export VITE_PORT={{port}}
    export PORT={{port}}
    
    # Clean old binaries to force rebuild
    echo "🧹 Cleaning old release binaries..."
    rm -f ./src-tauri/target/release/schaltwerk
    rm -f ./src-tauri/target/release/ui
    
    # Build frontend
    echo "📦 Building frontend..."
    npm run build
    
    # Build Tauri app properly (this embeds the frontend assets)
    echo "🦀 Building Tauri app (with frontend embedded)..."
    npm run tauri build
    
    echo "✅ Build complete. Launching release binary..."
    # The tauri build creates the binary with the productName from tauri.conf.json
    # Pass repository path explicitly so backend can discover it
    VITE_PORT={{port}} PORT={{port}} PARA_REPO_PATH="$(pwd)" ./src-tauri/target/release/schaltwerk

# Deploy the application to /Applications on macOS (system-wide)
deploy-mac:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔨 Building Schaltwerk for macOS..."
    
    # Build the release version
    npm run build
    npm run tauri build
    
    # Check if the app bundle was created
    if [ ! -d "src-tauri/target/release/bundle/macos/Schaltwerk.app" ]; then
        echo "❌ Build failed - Schaltwerk.app not found"
        exit 1
    fi
    
    # Remove old installation if it exists
    if [ -d "/Applications/Schaltwerk.app" ]; then
        echo "🗑️  Removing existing Schaltwerk installation..."
        rm -rf "/Applications/Schaltwerk.app"
    fi
    
    # Copy the app to Applications
    echo "📦 Installing Schaltwerk to /Applications..."
    cp -R "src-tauri/target/release/bundle/macos/Schaltwerk.app" "/Applications/"
    
    # Set proper permissions
    chmod -R 755 "/Applications/Schaltwerk.app"
    
    # Clear extended attributes and quarantine flags
    echo "🔐 Clearing quarantine attributes..."
    xattr -cr "/Applications/Schaltwerk.app" 2>/dev/null || true
    
    # Attempt ad-hoc code signing with entitlements if developer tools are available
    if command -v codesign &> /dev/null; then
        echo "✍️  Code signing the application..."
        # First remove any existing signature
        codesign --remove-signature "/Applications/Schaltwerk.app" 2>/dev/null || true
        # Then sign with entitlements
        if [ -f "src-tauri/entitlements.plist" ]; then
            codesign --force --deep --sign - --entitlements "src-tauri/entitlements.plist" "/Applications/Schaltwerk.app" 2>/dev/null || true
        else
            codesign --force --deep --sign - "/Applications/Schaltwerk.app" 2>/dev/null || true
        fi
    fi
    
    echo "✅ Schaltwerk installed successfully!"
    echo "🚀 You can now launch Schaltwerk from Applications or Spotlight"
    echo ""
    echo "To launch from terminal: open /Applications/Schaltwerk.app"

# Deploy the application to ~/Applications on macOS (user-specific)
deploy-mac-user:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔨 Building Schaltwerk for macOS..."
    
    # Build the release version
    npm run build
    npm run tauri build
    
    # Check if the app bundle was created
    if [ ! -d "src-tauri/target/release/bundle/macos/Schaltwerk.app" ]; then
        echo "❌ Build failed - Schaltwerk.app not found"
        exit 1
    fi
    
    # Create user Applications directory if it doesn't exist
    mkdir -p ~/Applications
    
    # Remove old installation if it exists
    if [ -d ~/Applications/Schaltwerk.app ]; then
        echo "🗑️  Removing existing Schaltwerk installation..."
        rm -rf ~/Applications/Schaltwerk.app
    fi
    
    # Copy the app to user Applications
    echo "📦 Installing Schaltwerk to ~/Applications..."
    cp -R "src-tauri/target/release/bundle/macos/Schaltwerk.app" ~/Applications/
    
    # Set proper permissions
    chmod -R 755 ~/Applications/Schaltwerk.app
    
    # Clear quarantine attributes to avoid Gatekeeper issues
    echo "🔐 Clearing quarantine attributes..."
    xattr -cr ~/Applications/Schaltwerk.app 2>/dev/null || true
    
    # Attempt ad-hoc code signing with entitlements if developer tools are available
    if command -v codesign &> /dev/null; then
        echo "✍️  Code signing the application..."
        # First remove any existing signature
        codesign --remove-signature ~/Applications/Schaltwerk.app 2>/dev/null || true
        # Then sign with entitlements
        if [ -f "src-tauri/entitlements.plist" ]; then
            codesign --force --deep --sign - --entitlements "src-tauri/entitlements.plist" ~/Applications/Schaltwerk.app 2>/dev/null || true
        else
            codesign --force --deep --sign - ~/Applications/Schaltwerk.app 2>/dev/null || true
        fi
    fi
    
    echo "✅ Schaltwerk installed successfully!"
    echo "🚀 You can now launch Schaltwerk from ~/Applications"
    echo ""
    echo "To launch from terminal: open ~/Applications/Schaltwerk.app"