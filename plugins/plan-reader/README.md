# plan-reader

Capture the plan Claude Code presents at approval time (`ExitPlanMode`) and render
it in a **self-contained, offline, genuinely accessible** browser viewer — with
read-aloud (TTS), a sticky table-of-contents, reading progress, and a ⌘K command
palette. Built accessibility-first: full keyboard operation, ARIA landmarks + a live
region, light/dark themes with checked contrast, and a "speakable transcript" that
announces code blocks instead of narrating raw characters.

## How it works

1. A `PermissionRequest` hook matching `ExitPlanMode` runs `scripts/capture-plan.js`.
   It is a **passive recorder**: it reads the plan from stdin, writes it to
   `$CLAUDE_PLUGIN_DATA/latest-plan.md`, and **always exits 0 without emitting a
   decision** — your normal approve/reject prompt is completely untouched.
2. Run **`/readplan`** any time to open the most recently captured plan in the viewer
   (`scripts/open-viewer.js` fills the offline template and opens your browser).

## Install (local marketplace)

From Claude Code:

```
/plugin marketplace add /absolute/path/to/plan-reader-marketplace
/plugin install plan-reader
```

Node.js is required on your PATH (the hook and command run `node`).

## Development

```
npm install          # dev deps: marked, highlight.js, jsdom, axe-core, playwright
npm run vendor       # rebuild templates/plan-viewer.html from the skeleton + vendored libs
npm test             # capture + open-viewer fail-safe suite (node:test)
npm run test:a11y    # axe-core + interaction checks in headless Chromium
bash dev/run-local.sh        # or: pwsh dev/run-local.ps1  → builds .devout.html
```

Open `.devout.html` in a browser to exercise the viewer against a sample plan.
The committed `templates/plan-viewer.html` is generated — edit
`templates/plan-viewer.skeleton.html` and re-run `npm run vendor`.

## ⚠ Two steps require a human (see the build plan)

- **Step 1 — confirm the capture field path.** The exact JSON field holding the plan
  markdown in an `ExitPlanMode` `PermissionRequest` payload is undocumented. The
  recorder probes an ordered list of candidates (`tool_input.plan`,
  `tool_input.plan_text`, `tool_input.markdown`, `plan`) and degrades to
  `ok=false` — never a crash — if none match. **Capture one real payload and confirm
  / trim `PLAN_TEXT_CANDIDATES` in `scripts/capture-plan.js`.** A throwaway dump hook:

  ```json
  { "hooks": { "PermissionRequest": [ { "matcher": "ExitPlanMode", "hooks": [
    { "type": "command",
      "command": "node -e \"const fs=require('fs');fs.writeFileSync(process.env.CLAUDE_PLUGIN_DATA+'/plan-payload.json', fs.readFileSync(0))\"" }
  ] } ] } }
  ```

- **Step 0 / Step 7 — co-design and acceptance with the accessibility champion.**
  Sit with the accessibility teammate, watch how they read a plan today, and get their
  sign-off on a real long plan with a screen reader (NVDA on Windows at minimum) + TTS.
  Their reaction is the validation — not the passing tests.

## Fail-safe guarantees

1. `/readplan` with no capture → "no plan captured yet", no browser.
2. Malformed / empty / unexpected-schema stdin → recorder exits 0, prior good plan preserved.
3. Render/open failure → user-facing message, no crash.
4. Repeated `/readplan` → idempotent (same input → identical HTML).
5. The `PermissionRequest` hook never returns a decision → approve/reject unaffected.
