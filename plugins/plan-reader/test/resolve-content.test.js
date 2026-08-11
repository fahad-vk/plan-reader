'use strict';

/*
 * Tests for scripts/resolve-content.js — the transcript resolver.
 *
 * The resolver reads Claude Code session transcripts
 * (<projectsRoot>/<slug>/<session>.jsonl) and returns the content to render:
 * the last substantial assistant answer, the most recent captured plan, or
 * (in auto mode) whichever is the freshest deliverable. It is pure and never
 * throws; every failure degrades to { ok: false, reason }.
 *
 * Transcripts are built inline with small helpers so each test is self-
 * contained and mirrors the real JSONL shape observed on disk:
 *   - genuine user prompts: {type:'user', message:{content:'...'|[{type:'text'}]}}
 *   - skill-body injections: same, but isMeta:true (appear MID-TURN)
 *   - slash commands: string content '<command-name>/read</command-name>'
 *   - tool results: {type:'user', message:{content:[{type:'tool_result'}]}}
 *   - the plan: assistant tool_use {name:'ExitPlanMode', input:{plan}}
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveContent, projectSlug } = require('../scripts/resolve-content.js');

// --- transcript builders ----------------------------------------------------

let CLOCK = Date.parse('2026-08-11T00:00:00.000Z');
function ts() {
  CLOCK += 1000;
  return new Date(CLOCK).toISOString();
}

const CWD = 'D:\\plan-plugin';
const long = (label) => label + ' ' + 'x'.repeat(300);

function userMsg(text, when) {
  return { type: 'user', message: { role: 'user', content: text }, cwd: CWD, timestamp: when || ts() };
}
function metaInject(text, when) {
  // A skill-body injection: isMeta:true, injected mid-turn when the assistant
  // invokes a skill. Must be transparent to turn detection.
  return { type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text }] }, cwd: CWD, timestamp: when || ts() };
}
function commandLine(name, when) {
  const n = name.replace(/^\//, '');
  return { type: 'user', message: { role: 'user', content: `<command-message>${n}</command-message>\n<command-name>/${n}</command-name>` }, cwd: CWD, timestamp: when || ts() };
}
function asstText(text, when) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, cwd: CWD, timestamp: when || ts() };
}
function asstToolUse(name, input, when) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] }, cwd: CWD, timestamp: when || ts() };
}
function toolResult(id, when) {
  return { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id || 't1', content: 'ok' }] }, cwd: CWD, timestamp: when || ts() };
}
function exitPlan(plan, when) {
  return asstToolUse('ExitPlanMode', { plan }, when);
}

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-tx-'));
}
// Write a session transcript into <root>/<slug>/<session>.jsonl.
function writeSession(root, slug, session, lines) {
  const dir = path.join(root, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, session + '.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return path.join(dir, session + '.jsonl');
}
function writeTranscript(slug, session, lines) {
  const root = freshRoot();
  writeSession(root, slug, session, lines);
  return root;
}

const SLUG = projectSlug(CWD); // 'D--plan-plugin'

// --- 1: last answer before the /read line ----------------------------------

test('message mode returns the answer after the last genuine prompt', () => {
  const root = writeTranscript(SLUG, 's1', [
    userMsg('first question'),
    asstText(long('AN EARLIER ANSWER')),
    userMsg('second question'),
    asstText(long('THE ANSWER I WANT')),
    commandLine('read'),
  ]);
  const r = resolveContent({ mode: 'message', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.kind, 'message');
  assert.match(r.md, /THE ANSWER I WANT/);
  assert.doesNotMatch(r.md, /AN EARLIER ANSWER/, 'only the most recent answer');
});

// --- 2: THE REAL BUG — meta injections + command lines don't corrupt turns --

test('skill-injection (isMeta) lines are transparent and do not break extraction', () => {
  // Mirrors the real session: a genuine prompt, then a mid-turn skill dump
  // (isMeta), then the answer, then the /read command line.
  const root = writeTranscript(SLUG, 's1', [
    userMsg('old question'),
    asstText(long('OLD ANSWER')),
    userMsg('the real question'),
    metaInject('Base directory for this skill: C:/…/brainstorming\n' + 'blah '.repeat(200)),
    asstText(long('THE FRESH ANSWER')),
    commandLine('read'),
  ]);
  const r = resolveContent({ mode: 'message', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, true, 'must not be fooled into no-message by the meta line');
  assert.match(r.md, /THE FRESH ANSWER/);
  assert.doesNotMatch(r.md, /Base directory for this skill/, 'skill dump excluded from the answer');
  assert.doesNotMatch(r.md, /OLD ANSWER/);
});

test('the /read command line is the stop boundary; in-flight turn text is excluded', () => {
  const root = writeTranscript(SLUG, 's1', [
    userMsg('the question'),
    asstText(long('THE ANSWER')),
    commandLine('read'),
    asstText('In-flight preamble of the /read turn that must never be shown.'),
  ]);
  const r = resolveContent({ mode: 'message', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, true);
  assert.match(r.md, /THE ANSWER/);
  assert.doesNotMatch(r.md, /In-flight preamble/, 'current /read turn output excluded');
});

// --- 3: agentic turn — prefer the final answer after the last tool ----------

test('message mode returns the final answer segment after the last tool call', () => {
  const root = writeTranscript(SLUG, 's1', [
    userMsg('do the thing'),
    asstText('Let me check something first.'), // short narration before tools
    asstToolUse('Bash', { command: 'ls' }),
    toolResult('t1'),
    asstText(long('THE FINAL ANSWER after all the work')),
    commandLine('read'),
  ]);
  const r = resolveContent({ mode: 'message', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, true);
  assert.match(r.md, /THE FINAL ANSWER/);
  assert.doesNotMatch(r.md, /Let me check something first/, 'pre-tool narration is not the answer');
});

// --- 4: plan mode -----------------------------------------------------------

test('plan mode returns the most recent ExitPlanMode plan', () => {
  const root = writeTranscript(SLUG, 's1', [
    userMsg('plan it'),
    exitPlan('# Old plan\n\nfirst attempt'),
    userMsg('revise'),
    exitPlan('# New plan\n\nsecond attempt'),
    commandLine('read'),
  ]);
  const r = resolveContent({ mode: 'plan', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.kind, 'plan');
  assert.match(r.md, /# New plan/);
  assert.doesNotMatch(r.md, /# Old plan/);
});

// --- 5: auto selection ------------------------------------------------------

test('auto returns a just-approved plan even though a remark follows it', () => {
  // The exact edge the advisory flagged: approve a plan, a one-line remark
  // follows (newer timestamp), then /read. The plan is the fresh deliverable.
  const root = writeTranscript(SLUG, 's1', [
    userMsg('please plan this'),
    exitPlan('# The Plan\n\nthe thing just approved'),
    toolResult('t1'), // approval
    asstText(long('Great, starting the work now')), // newer than the plan
    commandLine('read'),
  ]);
  const r = resolveContent({ mode: 'auto', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.kind, 'plan', 'plan came after the last genuine prompt, so it wins');
  assert.match(r.md, /# The Plan/);
});

test('auto returns the message when the last plan predates the last prompt', () => {
  const root = writeTranscript(SLUG, 's1', [
    userMsg('plan it'),
    exitPlan('# A plan\n\nhappened first'),
    userMsg('now forget the plan, just answer'),
    asstText(long('The freshest answer')),
    commandLine('read'),
  ]);
  const r = resolveContent({ mode: 'auto', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.kind, 'message', 'a new genuine prompt came after the plan');
  assert.match(r.md, /The freshest answer/);
});

test('a timestamp-less plan does not outrank a real, dated message in auto', () => {
  // A plan line missing its timestamp must be treated as oldest, not newest
  // (naive string sort would rank 'unknown' above any ISO date).
  const planNoTs = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'ExitPlanMode', input: { plan: '# Undated plan' } }] } };
  const root = writeTranscript(SLUG, 's1', [
    userMsg('question', '2026-08-11T00:00:01.000Z'),
    Object.assign(planNoTs, {}), // no timestamp field
    asstText(long('A real dated answer'), '2026-08-11T00:00:05.000Z'),
    commandLine('read'),
  ]);
  const r = resolveContent({ mode: 'auto', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.kind, 'message', 'the dated message wins over an undated plan');
});

// --- 6: THE REGRESSION — cross-project plans never leak in -------------------

test('a plan captured in a DIFFERENT project is never returned', () => {
  const root = writeTranscript(SLUG, 's1', [
    userMsg('hello'),
    asstText(long('A real answer in THIS project')),
    commandLine('read'),
  ]);
  const otherDir = path.join(root, projectSlug('/home/dev/projects/example-app'));
  fs.mkdirSync(otherDir, { recursive: true });
  fs.writeFileSync(path.join(otherDir, 'demo.jsonl'),
    JSON.stringify(exitPlan('# Add rate limiting to the API\n\nSTALE DEMO PLAN')) + '\n');

  const plan = resolveContent({ mode: 'plan', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.reason, 'no-plan');

  const auto = resolveContent({ mode: 'auto', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(auto.kind, 'message');
  assert.doesNotMatch(auto.md, /rate limiting/, 'the stale demo plan must never appear');
});

// --- 2b: harness-injected command I/O is not a genuine prompt ---------------

test('bash and local-command wrapper lines are not genuine user prompts', () => {
  // The harness records `!` bash runs and slash-command output as user-role
  // lines. They must not mask the real last answer (found via live dogfooding).
  const synthetic = (content) => ({ type: 'user', message: { role: 'user', content }, timestamp: ts() });
  const root = writeTranscript(SLUG, 's1', [
    userMsg('the real question I typed'),
    asstText(long('THE REAL ANSWER I want to read back')),
    synthetic('<bash-input>ls -la</bash-input>'),
    synthetic('<bash-stdout>total 0</bash-stdout>'),
    synthetic('<local-command-stdout>✔ Updated plan-reader.</local-command-stdout>'),
    commandLine('read'),
  ]);
  const r = resolveContent({ mode: 'message', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, true, 'command I/O must not mask the real answer');
  assert.match(r.md, /THE REAL ANSWER/);
});

// --- 6b: never-throws on a JSON-null line -----------------------------------

test('a JSON-null transcript line is skipped and never throws', () => {
  const root = writeTranscript(SLUG, 's1', [
    userMsg('q'),
    null, // serialises to the line "null"
    asstText(long('THE ANSWER survives a null line')),
    commandLine('read'),
  ]);
  const r = resolveContent({ mode: 'auto', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, true);
  assert.match(r.md, /THE ANSWER survives/);
});

// --- 6c: cross-session plans must NOT leak (the reintroduced-bug class) ------

test('auto ignores a plan from another session in the same project', () => {
  const root = freshRoot();
  writeSession(root, SLUG, 'mine', [
    userMsg('my question'),
    asstText(long('MY REAL ANSWER')),
    commandLine('read'),
  ]);
  writeSession(root, SLUG, 'other', [userMsg('x'), exitPlan('# OTHER SESSION PLAN')]);
  const r = resolveContent({ mode: 'auto', projectDir: CWD, projectsRoot: root, sessionId: 'mine' });
  assert.strictEqual(r.kind, 'message');
  assert.doesNotMatch(r.md, /OTHER SESSION PLAN/, 'a different session\'s plan must not win auto');
});

test('auto shows nothing for a short answer + no in-session plan, ignoring old plans', () => {
  // The advisory\'s failure mode 1: a quick question early in a session must
  // not dredge up a shipped plan from a previous session.
  const root = freshRoot();
  writeSession(root, SLUG, 'mine', [userMsg('what time is it'), asstText('~3pm'), commandLine('read')]);
  writeSession(root, SLUG, 'old', [userMsg('x'), exitPlan('# OLD SHIPPED PLAN')]);
  const r = resolveContent({ mode: 'auto', projectDir: CWD, projectsRoot: root, sessionId: 'mine' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'nothing');
});

test('plan mode prefers the anchored session\'s own plan over a newer-mtime file', () => {
  const root = freshRoot();
  writeSession(root, SLUG, 'mine', [userMsg('plan'), exitPlan('# MY SESSION PLAN'), commandLine('read')]);
  const other = writeSession(root, SLUG, 'other', [userMsg('x'), exitPlan('# OTHER PLAN')]);
  fs.utimesSync(other, new Date(Date.now() + 60000), new Date(Date.now() + 60000));
  const r = resolveContent({ mode: 'plan', projectDir: CWD, projectsRoot: root, sessionId: 'mine' });
  assert.match(r.md, /# MY SESSION PLAN/);
  assert.strictEqual(r.label, 'Plan');
});

test('plan mode falls back to another session\'s plan, labeled as earlier', () => {
  const root = freshRoot();
  writeSession(root, SLUG, 'mine', [userMsg('q'), asstText(long('answer, no plan here')), commandLine('read')]);
  writeSession(root, SLUG, 'old', [userMsg('x'), exitPlan('# EARLIER PLAN')]);
  const r = resolveContent({ mode: 'plan', projectDir: CWD, projectsRoot: root, sessionId: 'mine' });
  assert.strictEqual(r.ok, true);
  assert.match(r.md, /# EARLIER PLAN/);
  assert.match(r.label, /earlier session/i, 'a cross-session plan is labeled honestly');
});

// --- 7: session anchor ------------------------------------------------------

test('sessionId anchors to the exact session, not the newest-mtime file', () => {
  const root = freshRoot();
  // The session we invoked /read from:
  writeSession(root, SLUG, 'mine', [
    userMsg('my question'),
    asstText(long('ANSWER FROM MY SESSION')),
    commandLine('read'),
  ]);
  // A different window on the same project, written LATER (newer mtime):
  const other = writeSession(root, SLUG, 'other', [
    userMsg('their question'),
    asstText(long('ANSWER FROM THE OTHER WINDOW')),
  ]);
  fs.utimesSync(other, new Date(Date.now() + 60000), new Date(Date.now() + 60000));

  const r = resolveContent({ mode: 'message', projectDir: CWD, projectsRoot: root, sessionId: 'mine' });
  assert.strictEqual(r.ok, true);
  assert.match(r.md, /ANSWER FROM MY SESSION/);
  assert.doesNotMatch(r.md, /OTHER WINDOW/, 'must not read the concurrent window');
});

// --- 8: slug + robustness ---------------------------------------------------

test('projectSlug matches the observed Claude Code folder convention', () => {
  assert.strictEqual(projectSlug('D:\\plan-plugin'), 'D--plan-plugin');
  assert.strictEqual(projectSlug('C:\\Users\\fahad'), 'C--Users-fahad');
});

test('the project folder is matched case-insensitively (Windows drive-letter)', () => {
  // Session stored under a lowercase-drive slug; query uses uppercase drive.
  const root = freshRoot();
  writeSession(root, projectSlug('d:\\plan-plugin'), 's1', [
    userMsg('q'),
    asstText(long('CASE INSENSITIVE ANSWER')),
    commandLine('read'),
  ]);
  const r = resolveContent({ mode: 'message', projectDir: 'D:\\plan-plugin', projectsRoot: root });
  assert.strictEqual(r.ok, true);
  assert.match(r.md, /CASE INSENSITIVE ANSWER/);
});

test('malformed and partial JSONL lines are skipped, not fatal', () => {
  const root = writeTranscript(SLUG, 's1', [
    userMsg('question'),
    asstText(long('A good answer survives the garbage')),
    commandLine('read'),
  ]);
  fs.appendFileSync(path.join(root, SLUG, 's1.jsonl'), 'not json\n{ "type": "assistant", "message":');
  const r = resolveContent({ mode: 'auto', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, true);
  assert.match(r.md, /A good answer survives/);
});

test('a leading UTF-8 BOM does not corrupt the first line', () => {
  const root = writeTranscript(SLUG, 's1', [
    userMsg('question'),
    asstText(long('BOM-safe answer')),
    commandLine('read'),
  ]);
  const p = path.join(root, SLUG, 's1.jsonl');
  fs.writeFileSync(p, '\uFEFF' + fs.readFileSync(p, 'utf8'));
  const r = resolveContent({ mode: 'message', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, true);
  assert.match(r.md, /BOM-safe answer/);
});

test('missing project transcript folder degrades to a reason, never throws', () => {
  const root = freshRoot();
  const r = resolveContent({ mode: 'auto', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'nothing');
});

test('a session whose only turn is /read has no prior message', () => {
  const root = writeTranscript(SLUG, 's1', [commandLine('read')]);
  const r = resolveContent({ mode: 'message', projectDir: CWD, projectsRoot: root });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-message');
});
