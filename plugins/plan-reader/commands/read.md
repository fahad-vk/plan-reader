---
description: Open long content in the accessible viewer — the captured plan, your last long answer, or any markdown file.
argument-hint: "[long | <path-to-markdown-file>]   (empty = captured plan)"
allowed-tools: Write, Bash(node *)
---

Open content in the plan-reader viewer (read-aloud TTS, sticky TOC, ⌘K palette).
The user's argument is: `$ARGUMENTS`

Pick ONE mode based on that argument, then run the matching command:

**Mode A — captured plan** (argument is empty or the word `plan`):
Run exactly:
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-viewer.js"
```
If it prints "No plan captured yet…", tell the user no plan has been captured — they
need to reach a plan-approval prompt (plan mode) once, then run `/read` again.

**Mode B — your most recent long answer** (argument is exactly `long` or `last`):
1. Find the writable data dir:
   ```
   node -e "const os=require('os');process.stdout.write(process.env.CLAUDE_PLUGIN_DATA||os.tmpdir())"
   ```
   Call it `<DIR>`.
2. With the Write tool, save your PREVIOUS substantial assistant response (the last
   real answer before this `/read` command) to `<DIR>/latest-response.md`, **verbatim
   and unmodified** as Markdown (keep headings, lists, code blocks, tables exactly).
3. Run exactly:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/open-viewer.js" --file "<DIR>/latest-response.md" --label "Assistant response"
   ```
If there is no prior substantial response, say so and do nothing.

**Mode C — a markdown file** (argument is anything else — treat it as a file path):
Run exactly:
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-viewer.js" --file "$ARGUMENTS"
```
If it prints "Could not read file …" or "File is empty …", relay that to the user.

In all modes: relay the script's output and confirm the viewer opened. Do not read,
summarize, or re-render the content yourself — the viewer is the deliverable.
