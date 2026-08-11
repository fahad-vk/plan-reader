'use strict';

/*
 * Tests for scripts/open-viewer.js — the player.
 *
 * The viewer's default source is now the session transcript (via
 * resolve-content.js), selected by --mode auto|plan|message. A fixture
 * projects root is passed with --projects-root so tests never touch the real
 * ~/.claude. The --file path (any markdown) is unchanged.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'open-viewer.js');
const { projectSlug } = require('../scripts/resolve-content.js');

const CWD = 'D:\\plan-plugin';
const SLUG = projectSlug(CWD);
const long = (s) => s + ' ' + 'x'.repeat(300);

function runOpen(extraArgs) {
  return spawnSync(
    process.execPath,
    [SCRIPT, '--dry-run'].concat(extraArgs || []),
    { env: { ...process.env, PLAN_READER_NO_OPEN: '1' }, encoding: 'utf8' },
  );
}

// Build a fixture projects root containing one session transcript.
function buildProjectsRoot(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-open-'));
  const dir = path.join(root, SLUG);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return root;
}
const userMsg = (t) => ({ type: 'user', message: { role: 'user', content: t }, timestamp: '2026-08-11T00:00:01.000Z' });
const asstText = (t) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] }, timestamp: '2026-08-11T00:00:02.000Z' });
const readCmd = () => ({ type: 'user', message: { role: 'user', content: '<command-name>/read</command-name>' }, timestamp: '2026-08-11T00:00:03.000Z' });
const exitPlan = (p) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'ExitPlanMode', input: { plan: p } }] }, timestamp: '2026-08-11T00:00:02.500Z' });

function commonArgs(root, out) {
  return ['--projects-root', root, '--project', CWD, '--out', out];
}

// --- default (auto) mode ----------------------------------------------------

test('auto mode renders the last assistant answer from the transcript', () => {
  const root = buildProjectsRoot([userMsg('q'), asstText(long('THE ANSWER TO RENDER')), readCmd()]);
  const out = path.join(root, 'out.html');
  const res = runOpen(commonArgs(root, out));

  assert.strictEqual(res.status, 0);
  assert.ok(fs.existsSync(out), 'HTML produced');
  const html = fs.readFileSync(out, 'utf8');
  const b64 = Buffer.from(long('THE ANSWER TO RENDER'), 'utf8').toString('base64');
  assert.ok(html.includes(b64), 'embeds the resolved message as base64');
  assert.ok(!html.includes('"__PLAN_BASE64__"'), 'placeholder replaced');
  assert.match(res.stdout, /dry run/i, 'no browser on dry-run');
});

test('--mode plan renders the captured plan', () => {
  const root = buildProjectsRoot([userMsg('plan it'), exitPlan('# The Plan\n\nbody'), readCmd()]);
  const out = path.join(root, 'out.html');
  const res = runOpen(commonArgs(root, out).concat(['--mode', 'plan']));

  assert.strictEqual(res.status, 0);
  const html = fs.readFileSync(out, 'utf8');
  const b64 = Buffer.from('# The Plan\n\nbody', 'utf8').toString('base64');
  assert.ok(html.includes(b64), 'embeds the plan');
});

test('nothing to show -> friendly message, exit 0, no HTML', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-open-'));
  const out = path.join(root, 'out.html');
  const res = runOpen(['--projects-root', root, '--project', CWD, '--out', out]);
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /nothing to read/i);
  assert.ok(!fs.existsSync(out), 'no HTML when there is nothing to show');
});

test('--mode message with no answer -> its own friendly message', () => {
  const root = buildProjectsRoot([readCmd()]); // only a /read line, no prior answer
  const out = path.join(root, 'out.html');
  const res = runOpen(commonArgs(root, out).concat(['--mode', 'message']));
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /no substantial answer/i);
  assert.ok(!fs.existsSync(out));
});

test('idempotent: repeated runs produce byte-identical HTML', () => {
  const root = buildProjectsRoot([userMsg('q'), asstText(long('STABLE ANSWER')), readCmd()]);
  const a = path.join(root, 'a.html');
  const b = path.join(root, 'b.html');
  runOpen(commonArgs(root, a));
  runOpen(commonArgs(root, b));
  assert.strictEqual(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'));
});

// --- --file / --label (arbitrary markdown) ----------------------------------

test('--file renders an arbitrary markdown file with no transcript needed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-open-'));
  const md = '# A long summary\n\nParagraph one.\n\n- point A\n- point B\n';
  const mdPath = path.join(root, 'summary.md');
  fs.writeFileSync(mdPath, md);
  const out = path.join(root, 'out.html');
  const res = runOpen(['--file', mdPath, '--out', out]);

  assert.strictEqual(res.status, 0);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes(Buffer.from(md, 'utf8').toString('base64')), 'embeds file content');
  assert.match(html, /INJECTED_CWD\s*=\s*"summary\.md";/, 'labels header with file name');
});

test('--label overrides the header chip', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-open-'));
  const mdPath = path.join(root, 'resp.md');
  fs.writeFileSync(mdPath, '# Response\n\nBody.\n');
  const out = path.join(root, 'out.html');
  runOpen(['--file', mdPath, '--label', 'Assistant response', '--out', out]);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /INJECTED_CWD\s*=\s*"Assistant response";/);
});

test('--file with a missing path prints a message and writes no HTML', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-open-'));
  const out = path.join(root, 'out.html');
  const res = runOpen(['--file', path.join(root, 'nope.md'), '--out', out]);
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /could not read file/i);
  assert.ok(!fs.existsSync(out));
});

test('Windows label path is embedded without breaking JS string escaping', () => {
  const root = buildProjectsRoot([userMsg('q'), asstText(long('ANS')), readCmd()]);
  const out = path.join(root, 'out.html');
  runOpen(commonArgs(root, out).concat(['--label', 'C:\\work\\app']));
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes('C:\\\\work\\\\app'), 'backslashes JSON-escaped');
});
