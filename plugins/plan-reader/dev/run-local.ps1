# run-local.ps1 — Windows dev loop.
# Rebuilds the self-contained viewer template, then renders a sample markdown
# file through open-viewer.js (no browser). Open .devout.html manually.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$env:PLAN_READER_NO_OPEN = "1"

Write-Host "1/2 Rebuilding self-contained viewer template..."
node (Join-Path $root "scripts/vendor-libs.js")

Write-Host "2/2 Building viewer HTML from a sample plan..."
$out = Join-Path $root ".devout.html"
node (Join-Path $root "scripts/open-viewer.js") --file (Join-Path $root "fixtures/sample-plan.md") --label "(dev) sample-plan.md" --out $out

Write-Host ""
Write-Host "Done. Open this in a browser:"
Write-Host "  $out"
