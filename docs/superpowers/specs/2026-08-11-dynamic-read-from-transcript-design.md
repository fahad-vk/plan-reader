# Dynamic `/read` from the session transcript — design

**Date:** 2026-08-11
**Plugin:** plan-reader
**Status:** approved for planning

## Problem

`/read` (bare) always opens whatever sits in a shared temp file
`latest-plan.md`. That file:

- is **not scoped** to a project or session, and
- has **no freshness check**.

A demo plan seeded during development (`# Add rate limiting to the API`,
`cwd: /home/dev/projects/example-app`) is still in the temp dir and wins on
every bare `/read`, so the user sees a stale "dummy plan" instead of anything
relevant. There is also no way for bare `/read` to open the user's **last
message / last session output** — that requires remembering `/read long`, and
even then it depends on the assistant stashing its own reply at command time.

## Root cause

The content source is a temp file written by a passive `ExitPlanMode` hook.
The temp file is global and permanent. A smarter fallback does not fix this;
the source itself is wrong.

## Approach (approved)

Read directly from Claude Code's **session transcripts** as the single source
of truth. Transcripts live at:

```
~/.claude/projects/<project-slug>/<session-id>.jsonl
```

They are **already project-scoped** (folder per project) and contain, per line,
both the assistant messages and the `ExitPlanMode` tool call with the full plan
markdown — each with real timestamps. Verified against this repo's transcripts:
last assistant message and two real `ExitPlanMode` plans (9.5k / 11k chars)
extracted cleanly.

Consequences:

- The stale/demo-plan class of bug becomes **structurally impossible** — we only
  ever read this project's live history.
- Bare `/read` can finally mean "open the freshest relevant thing," choosing
  between the last message and the plan by real timestamp.
- The passive hook + temp file are **retired**.

### Trade-off accepted

The `.jsonl` transcript layout is an **undocumented** Claude Code internal
(stable in practice — it powers session resume). We accept this dependency and
guard it: any parse/format failure **degrades to a friendly message**, never a
crash and never a wrong/stale plan.

## Components

### 1. `scripts/resolve-content.js` (new) — the resolver

Single responsibility: given the current project directory, return the content
to render, or `null` with a reason.

**Locating this project's transcripts**

1. Compute the slug from the project dir by replacing every non-alphanumeric
   character with `-` (observed rule: `D:\plan-plugin` → `D--plan-plugin`,
   `C:\Users\fahad` → `C--Users-fahad`).
2. Look in `~/.claude/projects/<slug>/`. Project dir source, in order:
   `$CLAUDE_PROJECT_DIR`, else `process.cwd()`.
3. **Robust fallback** if that folder is missing or empty: scan all
   `~/.claude/projects/*/*.jsonl`, keep only sessions whose entries carry
   `cwd` equal to (or under) the project dir. This survives a slug-rule change.

**Extracting candidates** (this project's transcripts only)

- `lastMessage`:
  - Parse the newest transcript (by mtime) line-by-line.
  - Identify **real user messages** (a user-role line whose content is a string,
    or an array containing a `text` block) vs. **tool-result** user lines (content
    is only `tool_result` blocks) — the latter are not turn boundaries.
  - The final real user message is the `/read` invocation. Collect all assistant
    `text` blocks between the *previous* real user message and that one — this is
    the user's last answer, including narration across tool calls.
  - Ignore `thinking` and `tool_use` blocks. Discard if the concatenated text is
    below a substance threshold (`MIN_MESSAGE_CHARS = 200`).
  - Record its timestamp (newest contributing assistant line).
- `lastPlan`:
  - Across this project's transcripts, find the most recent `tool_use` named
    `ExitPlanMode`; take `input.plan` and the line timestamp.

**Selection**

- `mode === 'plan'` → return `lastPlan` (or a "no plan in this project" reason).
- `mode === 'message'` (`long`/`last`) → return `lastMessage` (or a reason).
- `mode === 'auto'` (bare) → return whichever of `lastMessage` / `lastPlan` has
  the **newer timestamp**; if only one exists, return it; if neither, a reason.

**Return shape**

```
{ md, label, ts, kind: 'message' | 'plan' }      // success
null  + a machine-readable reason on the object   // nothing to show
```

The resolver does **no** rendering and **no** browser I/O — it only resolves
content. It never throws; all failures become a `null` + reason.

### 2. `scripts/open-viewer.js` (modified) — the player

- Keep `--file <path>` mode exactly as-is (powers `/read <file>`).
- Replace the temp-file default source with a call into the resolver. New flag
  `--mode auto|plan|message` (default `auto`); optional `--project <dir>`.
- Header chip label comes from the resolver (`Assistant answer` / project name
  for a plan). The stale-capture warning banner is removed (no captures anymore).

### 3. `commands/read.md` (rewritten)

- **Bare (no argument)** → `open-viewer.js --mode auto` — dynamic; opens the
  freshest of {last answer, this project's plan}.
- **`plan`** → `--mode plan` (force the plan).
- **`long` / `last`** → `--mode message`. The assistant no longer hand-writes a
  file; the resolver reads the transcript.
- **any other arg** → treat as a file path → `--file`.
- Relay the script's message; do not re-render content in chat.

### 4. Removed

- `scripts/capture-plan.js`
- The `PermissionRequest` / `ExitPlanMode` block in `hooks/hooks.json`
  (leave the file valid — empty `hooks` object if nothing else remains).
- All reliance on `latest-plan.md` / `capture-status.json`. A one-line note in
  the README that no capture step is needed anymore.

## Error handling

Every failure path degrades to a friendly one-liner and exit 0:

| Situation | Message |
|---|---|
| No transcript dir / no sessions for this project | "No session history found for this project yet." |
| `--mode plan`, none found | "No plan has been presented in this project yet." |
| `--mode message`, none substantial | "No substantial answer to open yet." |
| Bare, neither exists | "Nothing to read yet — no plan or answer in this project." |
| Malformed `.jsonl` line | skip the line; never crash |
| `--file` unreadable / empty | existing messages, unchanged |

## Testing

- **Unit (resolver), against fixture `.jsonl` files** under `test/fixtures/transcripts/`:
  - extracts the last multi-block assistant answer across tool calls;
  - ignores `thinking` / `tool_use` / tool-result user lines;
  - filters sub-threshold answers;
  - extracts the newest `ExitPlanMode` plan;
  - `auto` picks the newer timestamp (message-newer and plan-newer cases);
  - project scoping: a plan in *another* project's folder is never returned
    (the demo-plan regression);
  - malformed lines are skipped;
  - empty/missing dir → `null` + reason.
- **open-viewer**: `--mode` wiring, `--dry-run` builds HTML from resolved content;
  `--file` regression stays green.
- Keep existing `a11y` and `responsive.regression` template tests untouched
  (the current working-tree changes to templates/tests are unrelated and ship
  as-is or separately).

## Delivery (full, per shipping flow)

1. Implement resolver + rewire viewer + rewrite command + remove hook/capture.
2. Update/author tests; `npm test` green.
3. Update README (remove capture-step language; document dynamic `/read`).
4. `npm run vendor` (rebuild the self-contained viewer if templates changed).
5. Bump version (`.claude-plugin/plugin.json`, package.json) — minor bump.
6. Commit + push to `github.com/fahad-vk/plan-reader`.

## Out of scope

- Redesigning the viewer UI.
- Multi-plan history / picking an older plan.
- The in-flight template/test edits already in the working tree.
