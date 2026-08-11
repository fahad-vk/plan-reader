#!/usr/bin/env node
'use strict';

/*
 * resolve-content.js — the transcript resolver.
 *
 * Reads Claude Code session transcripts and returns the content to render in
 * the viewer. The transcript is the single source of truth; it is already
 * scoped per-project, so a plan from another project can never leak in (the
 * old temp-file capture had no such scoping — that was the stale-demo-plan bug).
 *
 *   ~/.claude/projects/<project-slug>/<session-id>.jsonl
 *
 * Two candidates are extracted from THIS project's transcripts only:
 *   - lastMessage: the assistant's answer to the most recent genuine user
 *     prompt (the final text segment of that turn), read from the invoking
 *     session (CLAUDE_CODE_SESSION_ID) so a second window can't be picked up.
 *   - lastPlan: the most recent ExitPlanMode plan across the project's sessions.
 *
 * Selection: 'message' -> lastMessage, 'plan' -> lastPlan, 'auto' -> the
 * freshest deliverable (a plan proposed since the last genuine prompt wins;
 * otherwise the last message). Nothing found -> { ok:false, reason }.
 * Never throws — every failure degrades to a reason.
 *
 * The JSONL shapes this relies on are undocumented Claude Code internals, so
 * every access is defensive and a format surprise degrades to { ok:false }.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN_MESSAGE_CHARS = 200;

// A comparable timestamp: the ISO string if present, else '' (which sorts
// before any real ISO date, so a missing timestamp counts as oldest — never
// newest, which a naive 'unknown' sentinel would wrongly do).
function cmpTs(t) {
  return typeof t === 'string' && t ? t : '';
}

// cwd -> project folder slug. Claude Code replaces every non-alphanumeric
// character with '-'. Verified: 'D:\plan-plugin' -> 'D--plan-plugin',
// 'C:\Users\fahad' -> 'C--Users-fahad', 'C:\Users\fahad\nsr-custom-form' ->
// 'C--Users-fahad-nsr-custom-form'.
function projectSlug(projectDir) {
  return String(projectDir || '').replace(/[^A-Za-z0-9]/g, '-');
}

function defaultProjectsRoot() {
  let home;
  try { home = os.homedir(); } catch (_e) { home = os.tmpdir(); }
  return path.join(home, '.claude', 'projects');
}

function parseJsonl(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return [];
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip BOM
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t);
      // Only keep object records; a line that is literally `null`, a scalar,
      // or an array is not a transcript entry and must not reach the loops.
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v);
    } catch (_e) {
      /* skip malformed / partial (crash-mid-write) line */
    }
  }
  return out;
}

// --- line classification ----------------------------------------------------

function userText(obj) {
  if (!obj || obj.type !== 'user' || !obj.message) return null;
  const c = obj.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    const t = c.find((b) => b && b.type === 'text' && typeof b.text === 'string');
    if (t) return t.text;
    return null; // tool_result-only carrier
  }
  return null;
}

function isCommandLine(obj) {
  const t = userText(obj);
  return typeof t === 'string' && /^\s*<command-(name|message|args)>/.test(t);
}

// A genuine user prompt: real typed input, not a skill injection (isMeta) and
// not a slash-command wrapper.
function isGenuineUser(obj) {
  if (obj && obj.isMeta === true) return false;
  const t = userText(obj);
  if (typeof t !== 'string' || !t.trim()) return false;
  return !isCommandLine(obj);
}

// Where the assistant's answer window ends: the next genuine prompt or the
// /read command line. Skill injections (isMeta) and tool_result carriers are
// transparent — they occur mid-turn and must not truncate the answer.
function isStopBoundary(obj) {
  return isGenuineUser(obj) || isCommandLine(obj);
}

// Ordered content items of an assistant line: text pieces and tool markers.
function assistantItems(obj) {
  if (!obj || obj.type !== 'assistant' || !obj.message) return [];
  const c = obj.message.content;
  const items = [];
  if (typeof c === 'string') {
    if (c) items.push({ kind: 'text', text: c });
  } else if (Array.isArray(c)) {
    for (const b of c) {
      if (b && b.type === 'text' && typeof b.text === 'string') items.push({ kind: 'text', text: b.text });
      else if (b && b.type === 'tool_use') items.push({ kind: 'tool' });
    }
  }
  return items;
}

// --- transcript listing (case-insensitive on the slug folder) ---------------

function resolveProjectDir(projectsRoot, projectDir) {
  const slug = projectSlug(projectDir);
  const exact = path.join(projectsRoot, slug);
  if (fs.existsSync(exact)) return exact;
  // Fallback: match the slug case-insensitively (Windows drive-letter casing,
  // e.g. 'D--...' vs 'd--...' for the same logical project).
  let entries;
  try {
    entries = fs.readdirSync(projectsRoot);
  } catch (_e) {
    return exact;
  }
  const lower = slug.toLowerCase();
  const hit = entries.find((n) => n.toLowerCase() === lower);
  return hit ? path.join(projectsRoot, hit) : exact;
}

function listTranscripts(projectsRoot, projectDir) {
  const dir = resolveProjectDir(projectsRoot, projectDir);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_e) {
    return { dir, files: [] };
  }
  const files = names
    .filter((n) => n.endsWith('.jsonl'))
    .map((n) => {
      const p = path.join(dir, n);
      let mtime = 0;
      try { mtime = fs.statSync(p).mtimeMs; } catch (_e) { /* keep 0 */ }
      return { path: p, name: n, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return { dir, files };
}

// --- extraction -------------------------------------------------------------

// From one session's lines: the answer to the last genuine prompt (final text
// segment after that turn's last tool call), plus that prompt's timestamp.
function extractLastMessage(lines) {
  let lastGenuineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isGenuineUser(lines[i])) lastGenuineIdx = i;
  }
  if (lastGenuineIdx < 0) return { message: null, lastGenuineTs: null };
  const lastGenuineTs = lines[lastGenuineIdx].timestamp || null;

  // Walk the answer window: [lastGenuineIdx+1 .. next stop boundary).
  const items = []; // { kind:'text'|'tool', text?, ts }
  for (let i = lastGenuineIdx + 1; i < lines.length; i++) {
    if (isStopBoundary(lines[i])) break;
    const ts = lines[i].timestamp;
    for (const it of assistantItems(lines[i])) {
      items.push(Object.assign({ ts }, it));
    }
  }
  if (!items.length) return { message: null, lastGenuineTs };

  const collect = (arr) => {
    const texts = arr.filter((x) => x.kind === 'text' && x.text.trim());
    const md = texts.map((x) => x.text).join('\n\n').trim();
    const ts = texts.length ? texts[texts.length - 1].ts : null;
    return { md, ts };
  };

  // Prefer the trailing run of text after the last tool call (the final
  // answer), falling back to the whole turn if that run is too short.
  let lastTool = -1;
  for (let i = 0; i < items.length; i++) if (items[i].kind === 'tool') lastTool = i;
  const trailing = collect(items.slice(lastTool + 1));
  if (trailing.md.length >= MIN_MESSAGE_CHARS) {
    return { message: { md: trailing.md, ts: trailing.ts || lastGenuineTs }, lastGenuineTs };
  }
  const full = collect(items);
  if (full.md.length >= MIN_MESSAGE_CHARS) {
    return { message: { md: full.md, ts: full.ts || lastGenuineTs }, lastGenuineTs };
  }
  return { message: null, lastGenuineTs };
}

// The most recent ExitPlanMode plan within a single session's lines.
function extractPlanFromLines(lines) {
  let best = null;
  for (const obj of lines) {
    if (!obj || obj.type !== 'assistant' || !obj.message) continue;
    const c = obj.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b && b.type === 'tool_use' && b.name === 'ExitPlanMode' && b.input &&
          typeof b.input.plan === 'string' && b.input.plan.trim()) {
        if (!best || cmpTs(obj.timestamp) >= cmpTs(best.ts)) {
          best = { md: b.input.plan, ts: obj.timestamp };
        }
      }
    }
  }
  return best;
}

// The most recent plan across the project's OTHER sessions — a fallback used
// only when the anchored session has none. Files are scanned newest-first and
// we stop at the first that contains a plan (bounds work on large projects).
function extractProjectPlan(files, excludePath) {
  for (const f of files) {
    if (f.path === excludePath) continue;
    const best = extractPlanFromLines(parseJsonl(f.path));
    if (best) return best;
  }
  return null;
}

// --- public API -------------------------------------------------------------

function messageResult(m) {
  return { ok: true, kind: 'message', md: m.md, label: 'Assistant answer', ts: m.ts || 'unknown' };
}
function planResult(p, fromEarlier) {
  return {
    ok: true,
    kind: 'plan',
    md: p.md,
    label: fromEarlier ? 'Plan (from an earlier session)' : 'Plan',
    ts: p.ts || 'unknown',
  };
}

// The transcript file for the invoking session, else the most recently
// modified one (best-effort when the session id is unavailable).
function anchoredSessionFile(dir, files, sessionId) {
  if (sessionId) {
    const p = path.join(dir, sessionId + '.jsonl');
    if (fs.existsSync(p)) return p;
  }
  return files.length ? files[0].path : null;
}

function resolveContentInner(opts) {
  const options = opts || {};
  const mode = options.mode || 'auto';
  const projectDir = options.projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projectsRoot = options.projectsRoot || defaultProjectsRoot();
  const sessionId = options.sessionId || process.env.CLAUDE_CODE_SESSION_ID || null;

  const { dir, files } = listTranscripts(projectsRoot, projectDir);

  // Everything the user is "in" comes from the invoking session, so a second
  // window or an old completed task in the same project can't leak in.
  const anchoredFile = anchoredSessionFile(dir, files, sessionId);
  const anchoredLines = anchoredFile ? parseJsonl(anchoredFile) : [];
  const { message, lastGenuineTs } = extractLastMessage(anchoredLines);
  const sessionPlan = extractPlanFromLines(anchoredLines);

  if (mode === 'message') {
    return message ? messageResult(message) : { ok: false, reason: 'no-message' };
  }

  if (mode === 'plan') {
    if (sessionPlan) return planResult(sessionPlan, false);
    // Explicit "show me the plan" may reach back to an earlier session, but
    // it is labeled honestly so an unrelated task is never mistaken for now.
    const earlier = extractProjectPlan(files, anchoredFile);
    return earlier ? planResult(earlier, true) : { ok: false, reason: 'no-plan' };
  }

  // auto — the freshest deliverable of THIS session only. A cross-session plan
  // is never surfaced here (that reintroduces the stale-plan class of bug);
  // the user can ask for it explicitly with /read plan.
  if (!message && !sessionPlan) return { ok: false, reason: 'nothing' };
  if (message && !sessionPlan) return messageResult(message);
  if (sessionPlan && !message) return planResult(sessionPlan, false);
  // A plan proposed at or after the last genuine prompt is the fresh
  // deliverable (e.g. "approve plan, then /read") — prefer it over any remark
  // that happened to follow. Otherwise the newer of the two wins.
  if (cmpTs(lastGenuineTs) && cmpTs(sessionPlan.ts) >= cmpTs(lastGenuineTs)) return planResult(sessionPlan, false);
  return cmpTs(sessionPlan.ts) >= cmpTs(message.ts) ? planResult(sessionPlan, false) : messageResult(message);
}

// Public entry point: honors the "never throws" contract even if an
// unforeseen transcript shape slips past the per-field guards.
function resolveContent(opts) {
  try {
    return resolveContentInner(opts);
  } catch (_e) {
    return { ok: false, reason: 'nothing' };
  }
}

module.exports = { resolveContent, projectSlug, MIN_MESSAGE_CHARS };
