---
description: Open long content in the accessible viewer — your last answer, the plan, or any markdown file (dynamic by default).
argument-hint: "[plan | long | <path-to-markdown-file>]   (empty = freshest of last answer / plan)"
allowed-tools: Bash(node *)
---

Open content in the plan-reader viewer (read-aloud TTS, sticky TOC, ⌘K palette).
The user's argument is: `$ARGUMENTS`

The viewer is fed by `scripts/open-viewer.js`, which reads this project's Claude
Code session transcript directly — no capture step. Pick ONE mode from the
argument and run the matching command. Match the keyword after trimming
surrounding whitespace and ignoring case (`Plan`, `plan `, `LONG` all count). Do
not read, summarize, or re-render the content yourself; the viewer is the
deliverable. Relay the script's output.

**Mode A — dynamic (argument is empty):**
Opens the freshest of {your last substantial answer, a plan presented in this
project}. Run exactly:
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-viewer.js" --mode auto
```

**Mode B — the plan** (argument is exactly `plan`):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-viewer.js" --mode plan
```

**Mode C — your most recent long answer** (argument is exactly `long` or `last`):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-viewer.js" --mode message
```

**Mode D — a markdown file** (argument is anything else — treat it as a path):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-viewer.js" --file "$ARGUMENTS"
```

In every mode the script either opens the viewer or prints a short, friendly
reason (e.g. "Nothing to read yet…", "No plan has been presented in this
project yet.", "Could not read file …"). Relay that line to the user verbatim.
