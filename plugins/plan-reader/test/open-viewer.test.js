'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'open-viewer.js');
const FIXTURES = path.join(__dirname, '..', 'fixtures');

function freshDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-open-'));
}

// Always run with --dry-run so no browser is launched.
function runOpen(dir, extraArgs) {
  const res = spawnSync(
    process.execPath,
    [SCRIPT, '--dry-run', '--data', dir].concat(extraArgs || []),
    { env: { ...process.env, PLAN_READER_NO_OPEN: '1' }, encoding: 'utf8' },
  );
  return res;
}

function seedPlan(dir, ok) {
  fs.mkdirSync(dir, { recursive: true });
  const md = fs.readFileSync(path.join(FIXTURES, 'sample-plan.md'), 'utf8');
  fs.writeFileSync(path.join(dir, 'latest-plan.md'), md);
  fs.writeFileSync(
    path.join(dir, 'capture-status.json'),
    JSON.stringify({ ok, ts: '2026-08-10T00:00:00.000Z', cwd: 'C:\\work\\app' }),
  );
}

test('builds a non-empty HTML containing the base64 plan; no browser on dry-run', () => {
  const dir = freshDataDir();
  seedPlan(dir, true);
  const out = path.join(dir, 'out.html');
  const res = runOpen(dir, ['--out', out]);

  assert.strictEqual(res.status, 0);
  assert.ok(fs.existsSync(out), 'output HTML exists');

  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.length > 1000, 'HTML is non-empty');

  const expectedB64 = Buffer.from(
    fs.readFileSync(path.join(FIXTURES, 'sample-plan.md'), 'utf8'),
    'utf8',
  ).toString('base64');
  assert.ok(html.includes(expectedB64), 'HTML embeds the base64-encoded plan');
  assert.ok(!html.includes('"__PLAN_BASE64__"'), 'placeholder was replaced');
  assert.match(res.stdout, /dry run/i, 'reports dry run, does not open a browser');
});

test('Windows cwd path is embedded without breaking JS string escaping', () => {
  const dir = freshDataDir();
  seedPlan(dir, true);
  const out = path.join(dir, 'out.html');
  runOpen(dir, ['--out', out]);
  const html = fs.readFileSync(out, 'utf8');
  // JSON.stringify escapes the backslashes, so the doubled form appears.
  assert.ok(html.includes('C:\\\\work\\\\app'), 'backslashes are JSON-escaped');
});

test('empty data dir -> "no plan captured", exit 0, no HTML written', () => {
  const dir = freshDataDir();
  const out = path.join(dir, 'out.html');
  const res = runOpen(dir, ['--out', out]);
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /no plan captured/i);
  assert.ok(!fs.existsSync(out), 'no HTML is produced when nothing was captured');
});

test('ok=false still opens last good plan and injects the failed flag', () => {
  const dir = freshDataDir();
  seedPlan(dir, false);
  const out = path.join(dir, 'out.html');
  const res = runOpen(dir, ['--out', out]);
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /capture failed/i);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes('var INJECTED_OK       = false;'), 'capture-failed flag injected');
});

test('idempotent: repeated runs produce identical content', () => {
  const dir = freshDataDir();
  seedPlan(dir, true);
  const outA = path.join(dir, 'a.html');
  const outB = path.join(dir, 'b.html');
  runOpen(dir, ['--out', outA]);
  runOpen(dir, ['--out', outB]);
  assert.strictEqual(
    fs.readFileSync(outA, 'utf8'),
    fs.readFileSync(outB, 'utf8'),
    'same input yields byte-identical output',
  );
});
