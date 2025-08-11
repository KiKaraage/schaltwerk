#!/usr/bin/env bash
set -euo pipefail

PORT=${1:-3212}

echo "🚀 Fast build mode for Para UI on port $PORT"

export VITE_PORT=$PORT
export PORT=$PORT

if command -v sccache &> /dev/null; then
    echo "✨ Using sccache for Rust compilation caching"
    export RUSTC_WRAPPER=sccache
    export SCCACHE_DIR=$HOME/.cache/sccache
fi

export CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_DEBUG=0
export CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_OPT_LEVEL=0

echo "📦 Building frontend (optimized)..."
npx vite build

echo "🦀 Building Tauri app (packs frontend assets into binary)…"
# Build the Tauri app so the frontend dist is embedded and not blank
npm run tauri build

echo "✅ Build complete! Starting application..."
VITE_PORT=$PORT PORT=$PORT PARA_REPO_PATH="$(pwd)" ./src-tauri/target/release/ui