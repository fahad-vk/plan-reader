---
description: Open your most recent long response in the accessible viewer to read or listen to it.
allowed-tools: Write, Bash(node *)
---

The user wants to read or listen to your most recent substantial response in the
plan-reader viewer (TTS, sticky TOC, ⌘K palette) instead of scrolling the terminal.

Do this:

1. Find the writable data directory. Run:
   ```
   node -e "const os=require('os');process.stdout.write(process.env.CLAUDE_PLUGIN_DATA||os.tmpdir())"
   ```
   Call the printed path `<DIR>`.

2. Using the Write tool, save your PREVIOUS substantial assistant response
   (the last real answer before this `/readlong` command) to
   `<DIR>/latest-response.md`, **verbatim and unmodified**, as Markdown. Do not
   summarize, shorten, or rewrite it — copy it exactly, including headings, lists,
   code blocks, and tables.

3. Run exactly:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/open-viewer.js" --file "<DIR>/latest-response.md" --label "Assistant response"
   ```

4. Relay the script's output; confirm the viewer opened in the browser.

If there is no prior substantial response to show (e.g. this is the first turn),
say so and do nothing else.
