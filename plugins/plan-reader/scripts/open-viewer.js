#!/usr/bin/env node
'use strict';

/*
 * open-viewer.js — the player.
 *
 * Reads the captured latest-plan.md + capture-status.json, fills the content
 * placeholders in the self-contained templates/plan-viewer.html, writes a
 * timestamped plan-<ts>.html, and opens it in the default browser.
 *
 * Flags:
 *   --data <dir>   data dir (default: $CLAUDE_PLUGIN_DATA, else OS temp/plan-reader)
 *   --out <path>   explicit output path (default: <data>/plan-<ts>.html)
 *   --dry-run      build the HTML but do not launch a browser
 *   env PLAN_READER_NO_OPEN=1  same as --dry-run
 *
 * Fail-safe: no captured plan -> friendly message, exit 0, no browser, no HTML.
 * A failed most-recent capture (ok=false) still opens the last good plan with a
 * visible "last capture failed" banner.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = { dryRun: false, data: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--data') args.data = argv[++i];
    else if (a === '--out') args.out = argv[++i];
  }
  if (process.env.PLAN_READER_NO_OPEN === '1') args.dryRun = true;
  return args;
}

function resolveDataDir(explicit) {
  if (explicit && explicit.trim()) return explicit;
  const fromEnv = process.env.CLAUDE_PLUGIN_DATA;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  return path.join(os.tmpdir(), 'plan-reader');
}

function readStatus(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'capture-status.json'), 'utf8'));
  } catch (_e) {
    return null;
  }
}

// Timestamp for filenames without ':' (illegal on Windows).
function fileStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function openInBrowser(filePath) {
  const platform = process.platform;
  const isWSL = platform === 'linux' && /microsoft/i.test(os.release());
  let cmd, cmdArgs;
  if (platform === 'win32') {
    // 'start' is a cmd builtin; empty title arg guards paths with spaces.
    cmd = 'cmd';
    cmdArgs = ['/c', 'start', '', filePath];
  } else if (platform === 'darwin') {
    cmd = 'open';
    cmdArgs = [filePath];
  } else if (isWSL) {
    cmd = 'wslview';
    cmdArgs = [filePath];
  } else {
    cmd = 'xdg-open';
    cmdArgs = [filePath];
  }
  try {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
    child.on('error', function () {
      if (isWSL) {
        // Fall back to explorer.exe if wslview is missing.
        try { spawn('explorer.exe', [filePath], { detached: true, stdio: 'ignore' }).unref(); } catch (_e) {}
      }
    });
    child.unref();
    return true;
  } catch (_e) {
    return false;
  }
}

function fillTemplate(template, planMd, cwd, ts, ok) {
  const b64 = Buffer.from(planMd, 'utf8').toString('base64');
  // Replace QUOTED tokens with JSON.stringify (properly escapes Windows paths,
  // quotes, etc). __CAPTURE_OK__ becomes a bare boolean literal.
  return template
    .split('"__PLAN_BASE64__"').join(JSON.stringify(b64))
    .split('"__CWD_LABEL__"').join(JSON.stringify(cwd))
    .split('"__CAPTURED_TS__"').join(JSON.stringify(ts))
    .split('"__CAPTURE_OK__"').join(ok ? 'true' : 'false');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolveDataDir(args.data);
  const planPath = path.join(dir, 'latest-plan.md');
  const templatePath = path.join(__dirname, '..', 'templates', 'plan-viewer.html');

  // Fail-safe: nothing captured yet.
  let planMd = '';
  try {
    planMd = fs.readFileSync(planPath, 'utf8');
  } catch (_e) {
    console.log('No plan captured yet. Approve or reject a plan in plan mode, then run /readplan.');
    return 0;
  }
  if (!planMd.trim()) {
    console.log('No plan captured yet. Approve or reject a plan in plan mode, then run /readplan.');
    return 0;
  }

  let template;
  try {
    template = fs.readFileSync(templatePath, 'utf8');
  } catch (_e) {
    console.log('Viewer template is missing. Run "npm run vendor" in the plugin directory to build it.');
    return 0;
  }

  const status = readStatus(dir);
  const ok = !(status && status.ok === false);
  const cwd = (status && status.cwd) || 'unknown';
  const ts = (status && status.ts) || 'unknown';

  const html = fillTemplate(template, planMd, cwd, ts, ok);

  const outPath = args.out || path.join(dir, 'plan-' + fileStamp() + '.html');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
  } catch (e) {
    console.log('Could not write the viewer HTML: ' + e.message);
    return 0;
  }

  if (!ok) {
    console.log('⚠ The most recent capture failed — opening the last good plan with a warning banner.');
  }

  if (args.dryRun) {
    console.log('Built viewer (dry run, browser not opened): ' + outPath);
  } else {
    openInBrowser(outPath);
    console.log('Opened plan viewer: ' + outPath);
  }
  return 0;
}

process.exit(main());
