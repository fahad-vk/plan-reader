#!/usr/bin/env node
'use strict';

/*
 * open-viewer.js — the player.
 *
 * Fills the content placeholders in the self-contained templates/plan-viewer.html
 * and opens the result in the default browser. Two sources:
 *   - default: the captured plan (latest-plan.md + capture-status.json in the data dir)
 *   - --file <path>: any markdown file (powers /readmd and /readlong — long summaries,
 *     clarifications, or any doc, not just plans)
 *
 * Flags:
 *   --data <dir>   data dir (default: $CLAUDE_PLUGIN_DATA, else OS temp/plan-reader)
 *   --file <path>  render this markdown file instead of the captured plan
 *   --label <text> header chip label (defaults to cwd for plans, file name for --file)
 *   --out <path>   explicit output HTML path
 *   --dry-run      build the HTML but do not launch a browser
 *   env PLAN_READER_NO_OPEN=1  same as --dry-run
 *
 * Fail-safe: nothing to show -> friendly message, exit 0, no browser, no HTML.
 * A failed most-recent capture (ok=false) still opens the last good plan with a
 * visible "last capture failed" banner.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = { dryRun: false, data: null, out: null, file: null, label: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--data') args.data = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--label') args.label = argv[++i];
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

const NO_PLAN_MSG = 'No plan captured yet. Approve or reject a plan in plan mode, then run /readplan.';

// Resolve what to render into { md, cwd, ts, ok, outDir } — or null (with a
// friendly message already printed) when there is nothing to show.
function resolveSource(args) {
  if (args.file) {
    let md;
    try {
      md = fs.readFileSync(args.file, 'utf8');
    } catch (_e) {
      console.log('Could not read file: ' + args.file);
      return null;
    }
    if (!md.trim()) {
      console.log('File is empty: ' + args.file);
      return null;
    }
    let ts = 'unknown';
    try { ts = fs.statSync(args.file).mtime.toISOString(); } catch (_e) { /* keep unknown */ }
    return {
      md,
      cwd: args.label || path.basename(args.file),
      ts,
      ok: true,
      outDir: resolveDataDir(args.data),
    };
  }

  // Default: the captured plan.
  const dir = resolveDataDir(args.data);
  let md;
  try {
    md = fs.readFileSync(path.join(dir, 'latest-plan.md'), 'utf8');
  } catch (_e) {
    console.log(NO_PLAN_MSG);
    return null;
  }
  if (!md.trim()) {
    console.log(NO_PLAN_MSG);
    return null;
  }
  const status = readStatus(dir);
  return {
    md,
    cwd: args.label || (status && status.cwd) || 'unknown',
    ts: (status && status.ts) || 'unknown',
    ok: !(status && status.ok === false),
    outDir: dir,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const templatePath = path.join(__dirname, '..', 'templates', 'plan-viewer.html');

  const src = resolveSource(args);
  if (!src) return 0; // message already printed

  let template;
  try {
    template = fs.readFileSync(templatePath, 'utf8');
  } catch (_e) {
    console.log('Viewer template is missing. Run "npm run vendor" in the plugin directory to build it.');
    return 0;
  }

  const html = fillTemplate(template, src.md, src.cwd, src.ts, src.ok);

  const outPath = args.out || path.join(src.outDir, 'plan-' + fileStamp() + '.html');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
  } catch (e) {
    console.log('Could not write the viewer HTML: ' + e.message);
    return 0;
  }

  if (!src.ok) {
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
