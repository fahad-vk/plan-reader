'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'capture-plan.js');
const FIXTURES = path.join(__dirname, '..', 'fixtures');

function freshDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-test-'));
}

function runCapture(input, dataDir) {
  const res = spawnSync(process.execPath, [SCRIPT], {
    input,
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
    encoding: 'utf8',
  });
  return res;
}

function readStatus(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'capture-status.json'), 'utf8'));
}

test('always exits 0 and never writes to stdout (no decision)', () => {
  const dir = freshDataDir();
  const input = fs.readFileSync(path.join(FIXTURES, 'exit-plan.json'), 'utf8');
  const res = runCapture(input, dir);
  assert.strictEqual(res.status, 0, 'exit code must be 0');
  assert.strictEqual(res.stdout.trim(), '', 'must not emit a hook decision on stdout');
});

test('good payload writes latest-plan.md with header and ok=true', () => {
  const dir = freshDataDir();
  const input = fs.readFileSync(path.join(FIXTURES, 'exit-plan.json'), 'utf8');
  runCapture(input, dir);

  const status = readStatus(dir);
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.field_path, 'tool_input.plan');

  const md = fs.readFileSync(path.join(dir, 'latest-plan.md'), 'utf8');
  assert.match(md, /plan-reader capture/, 'header comment present');
  assert.match(md, /# Add rate limiting to the API/, 'plan body present');
});

test('malformed JSON sets ok=false and leaves a prior good file untouched', () => {
  const dir = freshDataDir();

  // Seed a prior good capture.
  const good = fs.readFileSync(path.join(FIXTURES, 'exit-plan.json'), 'utf8');
  runCapture(good, dir);
  const before = fs.readFileSync(path.join(dir, 'latest-plan.md'), 'utf8');

  // Now send garbage.
  const bad = fs.readFileSync(path.join(FIXTURES, 'malformed.json'), 'utf8');
  const res = runCapture(bad, dir);
  assert.strictEqual(res.status, 0);

  const status = readStatus(dir);
  assert.strictEqual(status.ok, false);
  assert.match(status.error, /malformed/i);

  const after = fs.readFileSync(path.join(dir, 'latest-plan.md'), 'utf8');
  assert.strictEqual(after, before, 'prior good latest-plan.md must be preserved');
});

test('empty stdin sets ok=false without crashing', () => {
  const dir = freshDataDir();
  const res = runCapture('', dir);
  assert.strictEqual(res.status, 0);
  const status = readStatus(dir);
  assert.strictEqual(status.ok, false);
  assert.match(status.error, /empty/i);
  assert.ok(!fs.existsSync(path.join(dir, 'latest-plan.md')), 'no plan file on empty input');
});

test('unexpected schema (no plan field) sets ok=false without crashing', () => {
  const dir = freshDataDir();
  const input = fs.readFileSync(path.join(FIXTURES, 'empty.json'), 'utf8');
  const res = runCapture(input, dir);
  assert.strictEqual(res.status, 0);
  const status = readStatus(dir);
  assert.strictEqual(status.ok, false);
  assert.match(status.error, /schema|no plan/i);
});

test('falls back to OS temp when CLAUDE_PLUGIN_DATA is unset', () => {
  const input = fs.readFileSync(path.join(FIXTURES, 'exit-plan.json'), 'utf8');
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_DATA;
  const res = spawnSync(process.execPath, [SCRIPT], { input, env, encoding: 'utf8' });
  assert.strictEqual(res.status, 0);
  const fallback = path.join(os.tmpdir(), 'plan-reader', 'capture-status.json');
  assert.ok(fs.existsSync(fallback), 'status written to OS temp fallback');
});
