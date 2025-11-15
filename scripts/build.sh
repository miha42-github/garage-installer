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

echo "✓ Linux build complete"
echo

echo "Building for macOS x86_64..."
deno compile \
    --allow-all \
    --target x86_64-apple-darwin \
    --output=dist/garage-installer-macos-x64 \
    mod.ts

echo "✓ macOS build complete"
echo

echo "=== Build Summary ==="
ls -lh dist/
echo

echo "✓ All builds complete!"
echo
echo "Test with: ./dist/garage-installer-linux-x64"
