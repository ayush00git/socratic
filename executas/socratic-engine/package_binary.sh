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
#   - pkg (installed globally or locally; script installs if missing)
#
# Note: ncc is NOT used here because socratic-engine has zero external npm
# dependencies (only Node built-ins + local sdk/sampling.js). pkg handles
# local requires natively, so bundling with ncc first is unnecessary.

set -euo pipefail

cd "$(dirname "$0")"

# ── Config ────────────────────────────────────────────────────────────────────
TOOL_ID="tool-ayush00git-socratic-enginev2-mnjzfxs7"
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

# ── Ensure pkg is available ───────────────────────────────────────────────────
if ! command -v pkg &>/dev/null; then
  echo "Installing pkg globally..."
  npm install -g pkg
fi

# ── Step 1: Compile directly with pkg ────────────────────────────────────────
# pkg handles local requires (sdk/sampling.js) natively — no bundler needed.
echo "[1/3] Compiling binary with pkg (target: $PKG_TARGET)..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

BINARY_NAME="$TOOL_ID"
pkg "$ENTRY" \
  --target "$PKG_TARGET" \
  --output "$BUILD_DIR/$BINARY_NAME" \
  --compress GZip
echo "      → $BUILD_DIR/$BINARY_NAME"

# ── Step 2: Assemble the archive directory ────────────────────────────────────
# NOTE: The Anna Agent installs binaries into its own bin/ directory, so the
# archive must NOT contain a bin/ subfolder. Place the binary at the root.
echo "[2/3] Assembling archive structure..."
STAGE_DIR="$BUILD_DIR/stage"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

cp "$BUILD_DIR/$BINARY_NAME" "$STAGE_DIR/$BINARY_NAME"
chmod +x "$STAGE_DIR/$BINARY_NAME"

# Write the manifest.json Anna Agent reads to locate the entrypoint.
# entrypoint uses just the filename — no bin/ prefix.
cat > "$STAGE_DIR/manifest.json" <<EOF
{
  "slug": "socratic-engine",
  "name": "$TOOL_ID",
  "version": "$VERSION",
  "platform": "$PLATFORM",
  "runtime": {
    "binary": {
      "entrypoint": {
        "default": "$BINARY_NAME"
      },
      "permissions": {
        "$BINARY_NAME": "0o755"
      }
    }
  }
}
EOF

# ── Step 3: Create the .tar.gz ────────────────────────────────────────────────
echo "[3/3] Creating archive..."
mkdir -p "$OUT_DIR"
tar -czf "$OUT_DIR/$ARCHIVE_NAME" -C "$STAGE_DIR" .

# Cleanup build temp
rm -rf "$BUILD_DIR"

echo
echo "✓ Done: $OUT_DIR/$ARCHIVE_NAME"
echo
echo "Archive contents:"
tar -tzf "$OUT_DIR/$ARCHIVE_NAME"
echo
echo "Next steps:"
echo "  1. Upload $OUT_DIR/$ARCHIVE_NAME to a GitHub Release asset"
echo "  2. On anna.partners → Tool → Distribution → Binary"
echo "     Executable Name (entrypoint): $TOOL_ID   (no bin/ prefix)"
