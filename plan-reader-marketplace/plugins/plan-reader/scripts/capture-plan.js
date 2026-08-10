#!/usr/bin/env node
'use strict';

/*
 * capture-plan.js — the passive recorder.
 *
 * Registered as a PermissionRequest hook matching ExitPlanMode. It reads the raw
 * hook payload from stdin, extracts the plan markdown, and writes it to disk for
 * the /readplan command to open later.
 *
 * HARD RULE: this script NEVER emits a hook decision and ALWAYS exits 0. It is a
 * side-channel recorder — the normal approve/reject prompt must be completely
 * untouched whether we succeed or fail. Every failure mode (malformed stdin,
 * missing field, unwritable dir) degrades to capture-status.json { ok:false }
 * with the prior good latest-plan.md left in place.
 *
 * Step 1 of the plan flagged `tool_input.plan` as UNDOCUMENTED. Until a real
 * payload confirms the field path, we probe an ordered list of candidates and
 * take the first that yields a non-empty string. A schema difference degrades to
 * ok=false rather than a crash.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Ordered candidates for the plan-text field. First non-empty string wins.
// Confirm/trim this list once a real ExitPlanMode payload is captured (Step 1).
const PLAN_TEXT_CANDIDATES = [
  'tool_input.plan',
  'tool_input.plan_text',
  'tool_input.markdown',
  'plan',
];

function getByPath(obj, dottedPath) {
  return dottedPath.split('.').reduce(
    (acc, key) => (acc != null && typeof acc === 'object' ? acc[key] : undefined),
    obj,
  );
}

function extractPlanText(payload) {
  for (const candidate of PLAN_TEXT_CANDIDATES) {
    const value = getByPath(payload, candidate);
    if (typeof value === 'string' && value.trim().length > 0) {
      return { text: value, fieldPath: candidate };
    }
  }
  return { text: null, fieldPath: null };
}

function resolveDataDir() {
  const fromEnv = process.env.CLAUDE_PLUGIN_DATA;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  return path.join(os.tmpdir(), 'plan-reader');
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_err) {
    return '';
  }
}

function writeStatus(dir, status) {
  // Best-effort. If we cannot even write the status file, there is nothing more
  // to do — we still exit 0 so the approval prompt is unaffected.
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'capture-status.json'),
      JSON.stringify(status, null, 2),
    );
  } catch (_err) {
    /* swallow — never throw from the recorder */
  }
}

function main() {
  const ts = new Date().toISOString();
  const dir = resolveDataDir();

  let payload;
  try {
    const raw = readStdin();
    if (!raw || raw.trim().length === 0) {
      writeStatus(dir, { ok: false, ts, error: 'empty stdin' });
      return;
    }
    payload = JSON.parse(raw);
  } catch (_err) {
    writeStatus(dir, { ok: false, ts, error: 'malformed JSON on stdin' });
    return;
  }

  const { text, fieldPath } = extractPlanText(payload);
  if (text == null) {
    writeStatus(dir, {
      ok: false,
      ts,
      error: 'no plan text found in payload (unexpected schema)',
    });
    return;
  }

  const cwd = (payload && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || 'unknown';
  const sessionId = (payload && payload.session_id) || 'unknown';

  const header = [
    '<!-- plan-reader capture',
    `captured: ${ts}`,
    `cwd: ${cwd}`,
    `session_id: ${sessionId}`,
    `field_path: ${fieldPath}`,
    '-->',
    '',
  ].join('\n');

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'latest-plan.md'), header + text);
    writeStatus(dir, { ok: true, ts, cwd, session_id: sessionId, field_path: fieldPath });
  } catch (err) {
    // Write failed AFTER a good extraction — leave any prior latest-plan.md alone.
    writeStatus(dir, { ok: false, ts, error: `write failed: ${err.message}` });
  }
}

try {
  main();
} catch (err) {
  // Absolute last-resort guard. Try to record the failure, but never throw.
  try {
    writeStatus(resolveDataDir(), {
      ok: false,
      ts: new Date().toISOString(),
      error: `unexpected: ${err && err.message}`,
    });
  } catch (_err) {
    /* give up silently */
  }
}

process.exit(0);
