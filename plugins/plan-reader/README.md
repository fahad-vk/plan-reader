# plan-reader

Render any long content — your last assistant answer, the plan Claude Code
presented at approval time, or any markdown file — in a **self-contained,
offline, genuinely accessible** browser viewer. Read-aloud (TTS), a sticky
table-of-contents, reading progress, and a ⌘K command palette. Built
accessibility-first: full keyboard operation, ARIA landmarks + a live region,
light/dark themes with checked contrast, and a "speakable transcript" that
announces code blocks instead of narrating raw characters.

## How it works

There is **no capture step and no background hook**. When you run `/read`,
`scripts/open-viewer.js` reads this project's Claude Code **session transcript**
directly (`~/.claude/projects/<project>/<session>.jsonl`), extracts the content
you asked for, fills the offline template, and opens your browser.

Because the transcript is already scoped per-project and per-session, `/read`
only ever shows **this** project's content — a plan or answer from another
project can never leak in.

## The `/read` command

One command; an optional argument picks the source. Bare `/read` is **dynamic**.

| Invocation | Opens |
|------------|-------|
| `/read` | the **freshest** of {your last substantial answer, a plan presented in this project} |
| `/read plan` | the most recent plan presented in this project (`ExitPlanMode`) |
| `/read long` (or `last`) | your most recent long assistant answer — read or listen instead of scrolling the terminal |
| `/read <file.md>` | any Markdown file you point at |

All open the same accessible viewer (TTS, sticky TOC, ⌘K palette). If there's
nothing to show, `/read` prints a short friendly reason instead of opening.

## Install (local marketplace)

From Claude Code:

```
/plugin marketplace add /absolute/path/to/plan-reader-marketplace
/plugin install plan-reader
```

Node.js is required on your PATH (the command runs `node`).

## Development

```
npm install          # dev deps: marked, highlight.js, jsdom, axe-core, playwright
npm run vendor       # rebuild templates/plan-viewer.html from the skeleton + vendored libs
npm test             # resolver + open-viewer suites (node:test)
npm run test:a11y    # axe-core + interaction checks in headless Chromium
bash dev/run-local.sh        # or: pwsh dev/run-local.ps1  → builds .devout.html
```

Open `.devout.html` in a browser to exercise the viewer against a sample plan.
The committed `templates/plan-viewer.html` is generated — edit
`templates/plan-viewer.skeleton.html` and re-run `npm run vendor`.

## Fail-safe guarantees

1. Nothing to read → a short friendly reason, no browser, exit 0.
2. Malformed / partial transcript lines, a missing project folder, or a BOM →
   degraded to a reason, never a crash (the resolver never throws).
3. Content is read from the **invoking session** (`CLAUDE_CODE_SESSION_ID`), so a
   second window open on the same project is never picked up by mistake.
4. Render/open failure → user-facing message, no crash.
5. Repeated `/read` → idempotent (same input → identical HTML).

## Reading from Claude Code internals

`/read` depends on the layout of Claude Code's session transcripts
(`~/.claude/projects/*/*.jsonl`), which is an **undocumented internal** (stable
in practice — it's how sessions resume). Every access is defensive; if the
format ever changes, `/read` degrades to a friendly message rather than showing
wrong or stale content.
