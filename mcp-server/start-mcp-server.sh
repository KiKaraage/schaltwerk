#!/bin/bash

# Start the Schaltwerk MCP Server
# This script is called when the Tauri app starts

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
MCP_DIR="$SCRIPT_DIR"

# Check if node_modules exists, if not install dependencies
if [ ! -d "$MCP_DIR/node_modules" ]; then
  echo "Installing MCP server dependencies..."
  cd "$MCP_DIR" && npm install
fi

# Build the TypeScript code if needed
if [ ! -d "$MCP_DIR/build" ]; then
  echo "Building MCP server..."
  cd "$MCP_DIR" && npm run build
fi

# Start the MCP server
echo "Starting Schaltwerk MCP server..."
cd "$MCP_DIR" && node build/schaltwerk-mcp-server.js