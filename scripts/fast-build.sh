#!/usr/bin/env bash
set -euo pipefail

PORT=${1:-3212}

echo "🚀 Building Para UI on port $PORT (optimized for speed)"

export VITE_PORT=$PORT
export PORT=$PORT

# Enable sccache if available for faster Rust builds
if command -v sccache &> /dev/null; then
    echo "✨ Using sccache for Rust compilation caching"
    export RUSTC_WRAPPER=sccache
    export SCCACHE_DIR=$HOME/.cache/sccache
fi

# Build frontend and backend in parallel for faster builds
echo "🔧 Starting parallel builds..."

# Start frontend build in background
echo "📦 Building frontend (optimized)..."
npm run build &
frontend_pid=$!

# Start rust build in background with dev profile for speed
echo "🦀 Building Tauri app with dev profile..."
(cd src-tauri && cargo build --profile=dev) &
rust_pid=$!

# Wait for both builds to complete
echo "⏳ Waiting for parallel builds..."
wait $frontend_pid && echo "✅ Frontend build complete"
wait $rust_pid && echo "✅ Rust build complete"

# Now build the final Tauri bundle (embeds frontend)
echo "🔧 Creating final Tauri bundle..."
npm run tauri build

echo "✅ Build complete! Starting application..."
VITE_PORT=$PORT PORT=$PORT PARA_REPO_PATH="$(pwd)" ./src-tauri/target/release/ui