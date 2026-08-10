# QA Report — plan-reader viewer

- **Date:** 2026-08-10
- **Target:** `templates/plan-viewer.html` (self-contained offline viewer), built from `fixtures/big-plan.md`
- **Mode:** Diff-aware (greenfield plugin; no dev server — the "app" is a `file://` HTML viewer)
- **Tier:** Standard (fix critical + high + medium)
- **Driver:** Playwright + Chromium (equivalent to gstack `$B`; the gstack browse binary is Linux/macOS-oriented and this host is Windows)
- **Framework:** Vanilla JS + `marked` + `highlight.js`, Web Speech API

## Summary

| Metric | Value |
|--------|-------|
| Issues found | 1 (Medium) |
| Fixed (verified) | 1 |
| Deferred | 0 |
| Console errors | 0 |
| Page errors | 0 |
| Functional checks | 22/22 pass |
| axe-core (WCAG 2.1 A/AA) | 0 serious/critical |
| Health score | **98 → 100** |

**PR summary:** QA found 1 issue, fixed 1, health score 98 → 100.

## What was tested (as a user)

Across the full viewer, at desktop (1280px), split-screen (700px), and mobile (375px):

- **Render:** markdown → semantic HTML, 17 headings, 2 tables, multiple code blocks, syntax highlighting. `main` content present.
- **TOC (P1):** entry count == heading count (17/17); click jumps and scrolls; scroll-spy marks exactly one current section.
- **Themes:** light ↔ dark toggle flips `data-theme`; contrast checked by axe in both.
- **Command palette (P3):** opens (button + Ctrl/⌘K), fuzzy-filters, traps Tab focus, closes on Esc, executes a "jump to section" action.
- **Player (R2):** skip-code toggle (`aria-pressed`), speed select, scrubber label update, play/pause/stop wiring. Speakable transcript announces "Code block, N lines" / "Table, N rows, N cols" rather than narrating raw code.
- **Read-time / chips (P2):** "~N min read", captured timestamp, cwd, capture-failed banner hidden when `ok=true`.
- **Responsive:** TOC hidden < 820px; no horizontal document overflow.

## Issues

### ISSUE-001 — Player controls clipped off-screen at narrow widths — **Medium** — Functional/Accessibility

**Status:** ✅ Fixed (verified) · **Commit:** `52a020b` · **Regression test:** `69f488c`

**Repro (before fix):**
1. Open the viewer and resize the window to ~700px wide (split-screen) or 375px (mobile).
2. The player bar was a single non-wrapping fixed-height row.
3. The **Skip code / Read code** toggle rendered at `right=732` in a 700px viewport — pushed past the right edge with `overflow-x: visible`, so it was clipped with no scroll and only partially reachable by keyboard (focus scroll-into-view was satisfied by the sliver of the left edge that remained on-screen).

This matters because "skip code / read code on demand" is called out in the plan as the **R2 accessibility spine**, not polish — an unreachable state at any width breaks the accessibility-first promise.

**Evidence:**
- Before: `screenshots/qa-mobile.png` (Speed control clipped at right edge; voice + skip-code off-screen)
- Probe: `btn-readcode` `right=784` at vw=700 (off-screen); keyboard Tab reached it but it stayed 90% clipped.
- After: `screenshots/issue-001-after-mobile.png`, `screenshots/issue-001-after-splitscreen.png` (bar wraps; all controls fully visible)

**Fix:** The player bar now wraps onto extra rows (`flex-wrap: wrap`, `min-height` instead of fixed `height`), and a `ResizeObserver` keeps the `--player-h` CSS variable synced with the bar's real height so the reading column's bottom padding always clears it (also handles the late voice-picker population that widens the bar). Verified no control clipped at 1280 / 700 / 375px, and content clears the player at every width.

## Notes / non-issues

- The `cwd` header chip showed `D:plan-pluginexample` in one screenshot — this is a Git Bash heredoc mangling backslashes in the **QA seed file**, not a product bug. The product writes/reads `capture-status.json` through `JSON.stringify`/`JSON.parse`, and `test/open-viewer.test.js` verifies a real `C:\work\app` path is JSON-escaped correctly in the output.
- Text-to-speech audio is not asserted headlessly (no voices in headless Chromium); the transcript construction and control wiring are asserted. Real acceptance (screen reader + audio) remains the champion sign-off in the build plan's Step 7.

## Health score

| Category | Weight | Baseline | Final |
|----------|-------:|---------:|------:|
| Console | 15% | 100 | 100 |
| Links | 10% | 100 | 100 |
| Visual | 10% | 100 | 100 |
| Functional | 20% | 92 (−1 medium) | 100 |
| UX | 15% | 100 | 100 |
| Performance | 10% | 100 | 100 |
| Content | 5% | 100 | 100 |
| Accessibility | 15% | 100 | 100 |
| **Weighted** | | **98.4** | **100** |
