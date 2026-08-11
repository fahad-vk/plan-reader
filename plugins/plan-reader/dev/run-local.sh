#!/usr/bin/env bash
# run-local.sh — POSIX dev loop.
# Rebuilds the self-contained viewer template, then renders a sample markdown
# file through open-viewer.js (no browser). Open .devout.html manually.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

export PLAN_READER_NO_OPEN=1

echo "1/2 Rebuilding self-contained viewer template..."
node "$ROOT/scripts/vendor-libs.js"

echo "2/2 Building viewer HTML from a sample plan..."
node "$ROOT/scripts/open-viewer.js" --file "$ROOT/fixtures/sample-plan.md" \
  --label "(dev) sample-plan.md" --out "$ROOT/.devout.html"

echo
echo "Done. Open this in a browser:"
echo "  $ROOT/.devout.html"
