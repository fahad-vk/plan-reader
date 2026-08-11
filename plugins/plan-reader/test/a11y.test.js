'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures');

let chromium, AxeBuilder;
try {
  ({ chromium } = require('playwright'));
  AxeBuilder = require('@axe-core/playwright').default;
} catch (_e) {
  // deps not installed — tests below will skip
}

let browser, page, htmlUrl, dataDir;

before(async () => {
  if (!chromium) return;

  // Build a fixture-filled viewer from big-plan.md via the real open-viewer.js.
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-a11y-'));
  const md = fs.readFileSync(path.join(FIXTURES, 'big-plan.md'), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'latest-plan.md'), md);
  fs.writeFileSync(
    path.join(dataDir, 'capture-status.json'),
    JSON.stringify({ ok: true, ts: '2026-08-10T12:00:00.000Z', cwd: '/home/dev/app' }),
  );
  const outHtml = path.join(dataDir, 'viewer.html');
  const res = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'open-viewer.js'), '--dry-run', '--data', dataDir, '--out', outHtml],
    { env: { ...process.env, PLAN_READER_NO_OPEN: '1' }, encoding: 'utf8' },
  );
  assert.strictEqual(res.status, 0, 'open-viewer built the fixture HTML');

  htmlUrl = pathToFileURL(outHtml).href;
  browser = await chromium.launch();
  const context = await browser.newContext();
  page = await context.newPage();
  await page.goto(htmlUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__planReader);
});

after(async () => {
  if (browser) await browser.close();
});

test('axe-core: no serious or critical accessibility violations', async (t) => {
  if (!chromium) return t.skip('playwright/@axe-core not installed');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map((v) => `- [${v.impact}] ${v.id}: ${v.help}`).join('\n');
  assert.strictEqual(bad.length, 0, `serious/critical a11y violations found:\n${report}`);
});

test('TOC entry count equals heading count (P1)', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  const info = await page.evaluate(() => window.__planReader);
  assert.ok(info.headingCount > 3, 'fixture has multiple headings');
  assert.strictEqual(info.tocCount, info.headingCount, 'TOC has one entry per heading');
});

test('player controls are present and keyboard-focusable (R1)', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  for (const id of ['btn-prev', 'btn-play', 'btn-next', 'btn-stop', 'rate', 'voice', 'btn-readcode']) {
    const exists = await page.$(`#${id}`);
    assert.ok(exists, `control #${id} exists`);
  }
  // The player slides up on demand; reveal it, then confirm Play takes focus.
  await page.evaluate(() => window.__planReader.showPlayer());
  await page.waitForTimeout(50);
  await page.focus('#btn-play');
  const active = await page.evaluate(() => document.activeElement.id);
  assert.strictEqual(active, 'btn-play', 'play button is focusable');
});

test('command palette opens, traps focus, and closes on Escape (P3)', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  await page.evaluate(() => window.__planReader.openPalette());
  assert.strictEqual(await page.evaluate(() => window.__planReader.isPaletteOpen()), true, 'palette opened');

  let focused = await page.evaluate(() => document.activeElement.id);
  assert.strictEqual(focused, 'palette-input', 'focus moved into the palette input');

  // Tab is trapped: focus must stay on the input.
  await page.keyboard.press('Tab');
  focused = await page.evaluate(() => document.activeElement.id);
  assert.strictEqual(focused, 'palette-input', 'Tab is trapped inside the palette');

  await page.keyboard.press('Escape');
  assert.strictEqual(await page.evaluate(() => window.__planReader.isPaletteOpen()), false, 'Escape closes the palette');
});

test('scroll-spy marks a current section in the TOC (P1)', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  const currentCount = await page.evaluate(
    () => document.querySelectorAll('nav.toc a[aria-current="true"]').length,
  );
  assert.strictEqual(currentCount, 1, 'exactly one TOC entry is marked current');
});

test('speakable transcript announces code blocks instead of reading them raw (R2)', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  const info = await page.evaluate(() => window.__planReader);
  assert.ok(info.codeUnits >= 1, 'fixture has at least one code block');
  assert.match(info.firstCodeUtterance, /code block, \d+ line/i, 'code is announced, not narrated raw');
  // Ensure the raw code text is NOT part of the default spoken utterance.
  assert.ok(!/gen_random_uuid|tokenBucket|CREATE TABLE/.test(info.firstCodeUtterance),
    'raw code characters are not in the spoken utterance by default');
});
