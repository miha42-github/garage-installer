#!/bin/bash
set -e

echo "=== Garage Installer Build Script ==="
echo

# Check if Deno is installed
if ! command -v deno &> /dev/null; then
    echo "Error: Deno is not installed"
    echo "Install from: https://deno.land/"
    exit 1
fi

echo "Deno version: $(deno --version | head -1)"
echo

# Create dist directory
mkdir -p dist

echo "Building for Linux x86_64..."
deno compile \
    --allow-all \
    --target x86_64-unknown-linux-gnu \
    --output=dist/garage-installer-linux-x64 \
    mod.ts

echo "✓ Linux x86_64 build complete"
echo

echo "Building for Linux ARM64..."
deno compile \
    --allow-all \
    --target aarch64-unknown-linux-gnu \
    --output=dist/garage-installer-linux-arm64 \
    mod.ts

echo "✓ Linux ARM64 build complete"
echo

echo "Building for macOS x86_64 (Intel)..."
deno compile \
    --allow-all \
    --target x86_64-apple-darwin \
    --output=dist/garage-installer-macos-x64 \
    mod.ts

echo "✓ macOS x86_64 build complete"
echo

echo "Building for macOS ARM64 (Apple Silicon)..."
deno compile \
    --allow-all \
    --target aarch64-apple-darwin \
    --output=dist/garage-installer-macos-arm64 \
    mod.ts

echo "✓ macOS ARM64 build complete"
echo

echo "Building for Windows x86_64..."
deno compile \
    --allow-all \
    --target x86_64-pc-windows-msvc \
    --output=dist/garage-installer-windows-x64 \
    mod.ts

echo "✓ Windows x86_64 build complete"
echo

echo "=== Build Summary ==="
ls -lh dist/
echo

echo "✓ All builds complete!"
echo
echo "Binaries created:"
echo "  - Linux x86_64:        ./dist/garage-installer-linux-x64"
echo "  - Linux ARM64:         ./dist/garage-installer-linux-arm64"
echo "  - macOS x86_64:        ./dist/garage-installer-macos-x64"
echo "  - macOS ARM64:         ./dist/garage-installer-macos-arm64"
echo "  - Windows x86_64:      ./dist/garage-installer-windows-x64.exe"
