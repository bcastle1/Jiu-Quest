import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Focused real-player regression: delay only the first GLB request, then serve
// its unchanged bytes. No player events, state, factory or rendering are mocked.
const base = (process.env.JIUQUEST_PREVIEW_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const artifacts = resolve(process.env.JIUQUEST_STARTUP_BUDGET_ARTIFACTS || 'tmp/startup-budget-delayed-glb');
await mkdir(artifacts, { recursive: true });
const report = { startedAtUtc: new Date().toISOString(), holdMs: 32000, scope: 'Actual Unity with first GLB request held for 32 seconds, then continued unchanged; no mocked rendering or Unity events', pageErrors: [], assetFailures: [] };
let browser, page, releaseGlb;
try {
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'],
    ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}),
    ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.__startupBudgetEvents = [];
    window.addEventListener('jiuquest:unity', (event) => window.__startupBudgetEvents.push({ ...event.detail, at: performance.now() }));
  });
  page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 400 && /\/(unity|animations)\//.test(response.url())) report.assetFailures.push({ url: response.url(), status: response.status() }); });
  report.manifest = await (await context.request.get(`${base}/unity/build-manifest.json`)).json();
  let requestObserved;
  const firstRequest = new Promise((resolveRequest) => { requestObserved = resolveRequest; });
  const gate = new Promise((resolveGate) => { releaseGlb = resolveGate; });
  await page.route('**/unity/StreamingAssets/Bjj/double_leg.glb*', async (route) => {
    report.glbRequestedAtUtc = new Date().toISOString(); requestObserved();
    await gate; await route.continue();
  });
  await page.goto(`${base}/?preview=unity`);
  let requestTimer;
  try {
    await Promise.race([firstRequest, new Promise((_, reject) => { requestTimer = setTimeout(() => reject(new Error('The actual player did not request its initial GLB within 45 seconds')), 45000); })]);
  } finally { clearTimeout(requestTimer); }
  await new Promise((done) => setTimeout(done, report.holdMs));
  report.whileHeld = await page.evaluate(() => ({ phase: document.querySelector('.unity-stage')?.dataset.unityStatus, events: window.__startupBudgetEvents, at: performance.now() }));
  assert.ok(['loading', 'loading-move'].includes(report.whileHeld.phase), 'The initial scene must survive the former 30-second post-factory cutoff');
  assert.equal(report.whileHeld.events.some((event) => event.type === 'ready'), false, 'A held initial GLB cannot already report runtime readiness');
  report.glbReleasedAtUtc = new Date().toISOString(); releaseGlb();
  await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('.unity-stage')?.dataset.unityStatus), null, { polling: 100, timeout: 60000 });
  report.afterRelease = await page.evaluate(() => ({ phase: document.querySelector('.unity-stage')?.dataset.unityStatus, text: document.querySelector('.unity-stage')?.innerText, events: window.__startupBudgetEvents, at: performance.now() }));
  assert.equal(report.afterRelease.phase, 'ready');
  assert.ok(report.afterRelease.events.some((event) => event.type === 'state' && event.moveId === 'double_leg' && event.playing === false && event.progress === 0));
  await page.getByRole('button', { name: 'Play animation', exact: true }).waitFor();
  const bytes = await page.screenshot({ path: resolve(artifacts, 'after-delayed-initial-glb.png'), fullPage: true });
  report.screenshot = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.assetFailures, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error); process.exitCode = 1;
} finally {
  releaseGlb?.();
  if (browser) await browser.close();
  report.completedAtUtc = new Date().toISOString();
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, heldPhase: report.whileHeld?.phase, finalPhase: report.afterRelease?.phase, artifacts, failure: report.failure }, null, 2));
}
