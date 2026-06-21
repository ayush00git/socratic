#!/usr/bin/env bash
# package_binary.sh — Build a standalone Anna-installable binary for socratic-engine
#
# Usage:
#   ./package_binary.sh              # auto-detects current platform
#   PLATFORM=linux-x86_64 ./package_binary.sh  # override platform key
#
# Output: dist-anna/<TOOL_ID>-<PLATFORM>.tar.gz
#
# Requirements:
#   - Node.js >= 18
#   - npm
#   - @vercel/ncc  (installed globally or locally; script installs if missing)
#   - pkg          (installed globally or locally; script installs if missing)

set -euo pipefail

cd "$(dirname "$0")"

# ── Config ────────────────────────────────────────────────────────────────────
TOOL_ID="tool-ayush2007iit_7177-socratic-engine-yg859pn2"
VERSION="1.0.0"
ENTRY="index.js"
OUT_DIR="dist-anna"
BUILD_DIR=".build-tmp"

# ── Platform detection ────────────────────────────────────────────────────────
if [ -n "${PLATFORM:-}" ]; then
  echo "Using overridden platform: $PLATFORM"
else
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"

  case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    arm64|aarch64) ARCH="arm64" ;;
  esac

  case "$OS-$ARCH" in
    darwin-arm64)   PLATFORM="darwin-arm64" ;;
    darwin-x86_64)  PLATFORM="darwin-x86_64" ;;
    linux-x86_64)   PLATFORM="linux-x86_64" ;;
    *)
      echo "ERROR: Unsupported platform: $OS-$ARCH" >&2
      echo "Supported: darwin-arm64, darwin-x86_64, linux-x86_64" >&2
      exit 1
      ;;
  esac
fi

# Map Anna platform key → pkg target
case "$PLATFORM" in
  darwin-arm64)   PKG_TARGET="node18-macos-arm64" ;;
  darwin-x86_64)  PKG_TARGET="node18-macos-x64" ;;
  linux-x86_64)   PKG_TARGET="node18-linux-x64" ;;
esac

ARCHIVE_NAME="${TOOL_ID}-${PLATFORM}.tar.gz"

echo "========================================"
echo "  socratic-engine binary packager"
echo "========================================"
echo "  Tool ID : $TOOL_ID"
echo "  Version : $VERSION"
echo "  Platform: $PLATFORM"
echo "  Output  : $OUT_DIR/$ARCHIVE_NAME"
echo "========================================"
echo

# ── Ensure ncc and pkg are available ─────────────────────────────────────────
ensure_tool() {
  local cmd="$1"
  local pkg_name="$2"
  if ! command -v "$cmd" &>/dev/null; then
    echo "Installing $pkg_name globally..."
    npm install -g "$pkg_name"
  fi
}

ensure_tool ncc  "@vercel/ncc"
ensure_tool pkg  "pkg"

# ── Step 1: Bundle all JS into a single file with ncc ────────────────────────
echo "[1/4] Bundling with ncc..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
ncc build "$ENTRY" -o "$BUILD_DIR/ncc-out" --quiet
echo "      → $BUILD_DIR/ncc-out/index.js"

# ── Step 2: Compile bundled file into a native binary with pkg ────────────────
echo "[2/4] Compiling binary with pkg (target: $PKG_TARGET)..."
BINARY_NAME="$TOOL_ID"
pkg "$BUILD_DIR/ncc-out/index.js" \
  --target "$PKG_TARGET" \
  --output "$BUILD_DIR/$BINARY_NAME" \
  --compress GZip
echo "      → $BUILD_DIR/$BINARY_NAME"

# ── Step 3: Assemble the archive directory ────────────────────────────────────
echo "[3/4] Assembling archive structure..."
STAGE_DIR="$BUILD_DIR/stage"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/bin"

cp "$BUILD_DIR/$BINARY_NAME" "$STAGE_DIR/bin/$BINARY_NAME"
chmod +x "$STAGE_DIR/bin/$BINARY_NAME"

# Write the manifest.json Anna Agent reads to locate the entrypoint
cat > "$STAGE_DIR/manifest.json" <<EOF
{
  "tool_id": "$TOOL_ID",
  "version": "$VERSION",
  "platform": "$PLATFORM",
  "entrypoint": "bin/$BINARY_NAME",
  "executables": ["bin/$BINARY_NAME"]
}
EOF

# ── Step 4: Create the .tar.gz ────────────────────────────────────────────────
echo "[4/4] Creating archive..."
mkdir -p "$OUT_DIR"
tar -czf "$OUT_DIR/$ARCHIVE_NAME" -C "$STAGE_DIR" .

# Cleanup build temp
rm -rf "$BUILD_DIR"

echo
echo "✓ Done: $OUT_DIR/$ARCHIVE_NAME"
echo
echo "Next steps:"
echo "  1. Upload $OUT_DIR/$ARCHIVE_NAME to a GitHub Release asset"
echo "  2. On anna.partners → App → More → Advanced → Executa → set binary_url"
echo "     entrypoint: bin/$TOOL_ID"
