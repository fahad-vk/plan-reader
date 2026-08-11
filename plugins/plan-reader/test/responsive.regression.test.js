'use strict';

// Regression: ISSUE-001 — player controls clipped off-screen at narrow widths.
// The skip-code toggle (an R2 accessibility-spine control) was pushed past the
// right edge at ~700px (split-screen) and ~375px (mobile) with no way to reach
// it. Fix: the player bar wraps onto extra rows and JS keeps the reading
// column's bottom padding in sync with the bar's real height.
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-plan-reader-2026-08-10.md
//
// The player now slides up on demand rather than being always-visible, so each
// test reveals it first and then asserts the same intent: once shown, no
// control clips at narrow widths and the reading column clears the bar.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures');

let chromium;
try { ({ chromium } = require('playwright')); } catch (_e) { /* skips below */ }

let browser, htmlUrl;

before(async () => {
  if (!chromium) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-resp-'));
  const outHtml = path.join(dir, 'viewer.html');
  const res = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'open-viewer.js'), '--dry-run',
      '--file', path.join(FIXTURES, 'big-plan.md'), '--out', outHtml],
    { env: { ...process.env, PLAN_READER_NO_OPEN: '1' }, encoding: 'utf8' },
  );
  assert.strictEqual(res.status, 0);
  assert.ok(fs.existsSync(outHtml), 'viewer HTML was written');
  htmlUrl = pathToFileURL(outHtml).href;
  browser = await chromium.launch();
});

after(async () => { if (browser) await browser.close(); });

const CONTROLS = ['btn-prev', 'btn-play', 'btn-next', 'btn-stop', 'rate', 'voice', 'btn-readcode'];

for (const width of [700, 375]) {
  test(`no player control is clipped off-screen at ${width}px wide`, async (t) => {
    if (!chromium) return t.skip('playwright not installed');
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    await page.goto(htmlUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__planReader);
    // Reveal the slide-up player, then allow the transition + late
    // voice-population + ResizeObserver to settle the wrapped height.
    await page.evaluate(() => window.__planReader.showPlayer());
    await page.waitForTimeout(400);

    const clipped = await page.evaluate((ids) => {
      const vw = window.innerWidth, vh = window.innerHeight;
      return ids.filter((id) => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        return r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1;
      });
    }, CONTROLS);
    assert.deepStrictEqual(clipped, [], `controls clipped at ${width}px: ${clipped.join(', ')}`);

    // Reading column must clear the (possibly wrapped) player bar.
    const clears = await page.evaluate(() => {
      const pl = document.querySelector('.player');
      const pad = parseInt(getComputedStyle(document.querySelector('.reading-wrap')).paddingBottom, 10);
      return pad >= pl.offsetHeight;
    });
    assert.ok(clears, `reading column padding must clear the player bar at ${width}px`);

    await context.close();
  });
}
