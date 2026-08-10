# plan-reader marketplace

A Claude Code plugin marketplace containing **plan-reader** — it captures the plan
Claude Code presents at approval time (`ExitPlanMode`) and renders it in a
self-contained, offline, **accessible** browser viewer: read-aloud (TTS), a sticky
table-of-contents with scroll-spy, reading progress + read-time, and a ⌘K command
palette. Built accessibility-first (semantic HTML, ARIA landmarks + live region,
full keyboard operation, contrast-checked light/dark themes, axe-clean).

## Install

```
/plugin marketplace add fahad-vk/plan-reader
/plugin install plan-reader@plan-reader-marketplace
```

Requires **Node.js** on your PATH. No `npm install` needed — the scripts use only
Node built-ins and the viewer's libraries are vendored inline.

## Use

1. In **plan mode**, when Claude presents a plan at the approval prompt, a passive
   hook captures it (your approve/reject flow is untouched).
2. Run **`/readplan`** to open that plan in the browser viewer.

## Team auto-install

Commit to a project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "plan-reader-marketplace": { "source": { "source": "github", "repo": "fahad-vk/plan-reader" } }
  },
  "enabledPlugins": { "plan-reader@plan-reader-marketplace": true }
}
```

## Develop / update

The plugin lives in [`plugins/plan-reader`](plugins/plan-reader) — see its
[README](plugins/plan-reader/README.md) for the dev loop, tests, and the two
human-in-the-loop steps (confirm the capture field path; accessibility sign-off).

To ship an update: edit `templates/plan-viewer.skeleton.html` → `npm run vendor`
→ `npm test && npm run test:a11y` → **bump `version` in
`plugins/plan-reader/.claude-plugin/plugin.json`** → commit & push. Users then run
`/plugin marketplace update plan-reader-marketplace` and
`/plugin update plan-reader@plan-reader-marketplace`, then `/reload-plugins`.
