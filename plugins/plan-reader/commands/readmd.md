---
description: Render any Markdown file in the accessible plan-reader viewer.
argument-hint: <path-to-markdown-file>
allowed-tools: Bash(node *open-viewer.js*)
---

Open the Markdown file the user specified in the accessible browser viewer (TTS,
sticky TOC, ⌘K palette) — the same viewer `/readplan` uses, but for any file.

The user's file path is: `$ARGUMENTS`

Run exactly this command (do not modify the flags):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-viewer.js" --file "$ARGUMENTS"
```

Then relay the script's output verbatim:
- "Could not read file …" → tell the user the path wasn't found; ask them to check it.
- "File is empty: …" → tell the user the file has no content.
- Otherwise it prints the path it opened; confirm the viewer opened in the browser.

Do not read, summarize, or re-render the file yourself — the viewer is the deliverable.
