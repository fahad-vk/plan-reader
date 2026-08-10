# run-local.ps1 — Windows dev loop.
# Wipes .devdata, pipes the sample payload through capture-plan.js, then builds
# the viewer HTML with open-viewer.js (no browser). Open .devout.html manually.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root ".devdata"

if (Test-Path $data) { Remove-Item -Recurse -Force $data }
New-Item -ItemType Directory -Force $data | Out-Null

$env:CLAUDE_PLUGIN_DATA = $data
$env:PLAN_READER_NO_OPEN = "1"

Write-Host "1/3 Rebuilding self-contained viewer template..."
node (Join-Path $root "scripts/vendor-libs.js")

Write-Host "2/3 Capturing sample plan..."
Get-Content (Join-Path $root "fixtures/exit-plan.json") -Raw | node (Join-Path $root "scripts/capture-plan.js")
Get-Content (Join-Path $data "capture-status.json")

Write-Host "3/3 Building viewer HTML..."
$out = Join-Path $root ".devout.html"
node (Join-Path $root "scripts/open-viewer.js") --out $out

Write-Host ""
Write-Host "Done. Open this in a browser:"
Write-Host "  $out"
