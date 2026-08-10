#!/usr/bin/env bash
# run-local.sh — POSIX dev loop.
# Wipes .devdata, pipes the sample payload through capture-plan.js, then builds
# the viewer HTML with open-viewer.js (no browser). Open .devout.html manually.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.devdata"

rm -rf "$DATA"
mkdir -p "$DATA"

export CLAUDE_PLUGIN_DATA="$DATA"
export PLAN_READER_NO_OPEN=1

echo "1/3 Rebuilding self-contained viewer template..."
node "$ROOT/scripts/vendor-libs.js"

echo "2/3 Capturing sample plan..."
node "$ROOT/scripts/capture-plan.js" < "$ROOT/fixtures/exit-plan.json"
cat "$DATA/capture-status.json"; echo

echo "3/3 Building viewer HTML..."
node "$ROOT/scripts/open-viewer.js" --out "$ROOT/.devout.html"

echo
echo "Done. Open this in a browser:"
echo "  $ROOT/.devout.html"
