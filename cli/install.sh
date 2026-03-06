#!/bin/sh
# Tiddly CLI installer
# Usage: curl -fsSL https://raw.githubusercontent.com/shane-kercheval/tiddly/main/cli/install.sh | sh
set -e

REPO="shane-kercheval/tiddly"

# Detect OS
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$OS" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    *)
        echo "Error: Unsupported OS: $OS" >&2
        echo "Download manually from https://github.com/$REPO/releases" >&2
        exit 1
        ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|amd64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)
        echo "Error: Unsupported architecture: $ARCH" >&2
        echo "Download manually from https://github.com/$REPO/releases" >&2
        exit 1
        ;;
esac

# Get latest version
echo "Fetching latest release..."
VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')"
if [ -z "$VERSION" ]; then
    echo "Error: Could not determine latest version" >&2
    exit 1
fi
echo "Latest version: $VERSION"

# Store full tag for download URLs (GitHub uses the full tag in release paths)
TAG="$VERSION"

# Strip monorepo prefix and v prefix for asset name
# e.g. "cli/v1.2.3" → "1.2.3"
VERSION_NUM="$(echo "$VERSION" | sed 's|.*/||; s/^v//')"

# Build asset name
ASSET="tiddly_${VERSION_NUM}_${OS}_${ARCH}.tar.gz"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
CHECKSUM_URL="https://github.com/$REPO/releases/download/$TAG/checksums.txt"

# Create temp directory with cleanup
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Download binary and checksums
echo "Downloading $ASSET..."
curl -fsSL -o "$WORK_DIR/$ASSET" "$DOWNLOAD_URL"
curl -fsSL -o "$WORK_DIR/checksums.txt" "$CHECKSUM_URL"

# Verify checksum
echo "Verifying checksum..."
EXPECTED="$(grep " ${ASSET}$" "$WORK_DIR/checksums.txt" | awk '{print $1}')"
if [ -z "$EXPECTED" ]; then
    echo "Error: No checksum found for $ASSET in checksums.txt" >&2
    exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$WORK_DIR/$ASSET" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
    ACTUAL="$(shasum -a 256 "$WORK_DIR/$ASSET" | awk '{print $1}')"
else
    echo "Error: No SHA256 tool found (need sha256sum or shasum)" >&2
    exit 1
fi

if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "Error: Checksum mismatch" >&2
    echo "  Expected: $EXPECTED" >&2
    echo "  Got:      $ACTUAL" >&2
    exit 1
fi
echo "Checksum verified."

# Extract
tar -xzf "$WORK_DIR/$ASSET" -C "$WORK_DIR"

# Determine install directory
INSTALL_DIR="${INSTALL_DIR:-}"
if [ -z "$INSTALL_DIR" ]; then
    if [ -w /usr/local/bin ]; then
        INSTALL_DIR="/usr/local/bin"
    else
        INSTALL_DIR="$HOME/.local/bin"
        mkdir -p "$INSTALL_DIR"
    fi
fi

# Install
cp "$WORK_DIR/tiddly" "$INSTALL_DIR/tiddly"
chmod +x "$INSTALL_DIR/tiddly"

echo "Installed tiddly $VERSION to $INSTALL_DIR/tiddly"

# Check if install dir is in PATH
case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
        echo ""
        echo "Warning: $INSTALL_DIR is not in your PATH." >&2
        echo "Add it to your shell profile:" >&2
        echo "  export PATH=\"$INSTALL_DIR:\$PATH\"" >&2
        ;;
esac
