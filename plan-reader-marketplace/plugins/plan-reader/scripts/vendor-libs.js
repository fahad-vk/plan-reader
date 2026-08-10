#!/usr/bin/env node
'use strict';

/*
 * vendor-libs.js — build step.
 *
 * Reads the hand-authored skeleton (templates/plan-viewer.skeleton.html) and
 * inlines the pinned vendored libraries + a dev-default plan, producing the
 * self-contained, offline templates/plan-viewer.html. Re-runnable: it always
 * builds from the skeleton, so version bumps are a re-run away.
 *
 * Injected:
 *   /*__MARKED_MIN_JS__*\/   marked.min.js               (markdown parser)
 *   /*__HLJS_MIN_JS__*\/     highlight.min.js            (syntax highlighter)
 *   /*__HLJS_CSS__*\/        a11y light + dark themes     (theme-scoped)
 *   __DEV_DEFAULT_BASE64__   base64(fixtures/big-plan.md) (standalone dev render)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function resolveFirst(candidates, label) {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Could not locate ${label}. Run "npm install" first. Tried:\n  ${candidates.join('\n  ')}`);
}

function main() {
  const skeletonPath = path.join(ROOT, 'templates', 'plan-viewer.skeleton.html');
  const outPath = path.join(ROOT, 'templates', 'plan-viewer.html');

  let html = read(skeletonPath);

  const markedJs = read(resolveFirst([
    path.join(NM, 'marked', 'marked.min.js'),
    path.join(NM, 'marked', 'lib', 'marked.umd.js'),
  ], 'marked'));

  const hljsJs = read(resolveFirst([
    path.join(NM, '@highlightjs', 'cdn-assets', 'highlight.min.js'),
    path.join(NM, 'highlight.js', 'lib', 'highlight.min.js'),
  ], 'highlight.js browser bundle'));

  const lightCss = read(resolveFirst([
    path.join(NM, '@highlightjs', 'cdn-assets', 'styles', 'a11y-light.min.css'),
    path.join(NM, 'highlight.js', 'styles', 'a11y-light.min.css'),
  ], 'a11y-light theme'));

  const darkCss = read(resolveFirst([
    path.join(NM, '@highlightjs', 'cdn-assets', 'styles', 'a11y-dark.min.css'),
    path.join(NM, 'highlight.js', 'styles', 'a11y-dark.min.css'),
  ], 'a11y-dark theme'));

  // Theme-scoped via native CSS nesting: light when not dark, dark when dark.
  const scopedCss =
    `:root:not([data-theme="dark"]){\n${lightCss}\n}\n` +
    `[data-theme="dark"]{\n${darkCss}\n}\n`;

  const devPlan = read(path.join(ROOT, 'fixtures', 'big-plan.md'));
  const devB64 = Buffer.from(devPlan, 'utf8').toString('base64');

  // Simple, unique-marker replacements (no regex specials to worry about).
  const replacements = [
    ['/*__HLJS_CSS__*/', scopedCss],
    ['/*__MARKED_MIN_JS__*/', markedJs],
    ['/*__HLJS_MIN_JS__*/', hljsJs],
    ['__DEV_DEFAULT_BASE64__', devB64],
  ];
  for (const [marker, value] of replacements) {
    if (!html.includes(marker)) {
      throw new Error(`Marker not found in skeleton: ${marker}`);
    }
    html = html.split(marker).join(value);
  }

  fs.writeFileSync(outPath, html);
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
  console.log(`Wrote ${path.relative(ROOT, outPath)} (${kb} KB, self-contained).`);
}

main();
