---
description: Open the most recently captured plan in the accessible browser viewer.
allowed-tools: Bash(node *open-viewer.js*)
---

Run the plan viewer for the most recently captured plan.

Execute exactly this command (do not modify the path):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-viewer.js"
```

Then relay the script's output to the user verbatim:

- If it prints **"No plan captured yet…"**, tell the user no plan has been
  captured — they need to reach a plan-approval prompt (plan mode) at least once,
  then run `/readplan` again. Do not treat this as an error.
- If it prints a **"capture failed"** warning, pass that warning along — the
  viewer is showing the last good plan with a banner.
- Otherwise it prints the path it opened; confirm the viewer was opened in the
  browser.

Do not attempt to read, summarize, or re-render the plan yourself — the viewer is
the deliverable. Do not run any command other than the one above.
