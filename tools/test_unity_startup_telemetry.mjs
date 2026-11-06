import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installUnityStartupTelemetry } from './unity_startup_telemetry.mjs';

// This isolates telemetry logic using explicit fixture events and a real DOM /
// browser frame clock. It does not load Unity or establish player readiness.
const artifacts = resolve(process.env.JIUQUEST_TELEMETRY_ARTIFACTS || 'tmp/startup-telemetry-probe');
await mkdir(artifacts, { recursive: true });
const report = { startedAtUtc: new Date().toISOString(), scope: 'Isolated browser telemetry fixture, not Unity rendering proof', cases: [] };
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}),
    ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}),
  });
  for (const scenario of ['bootstrap', 'wrong-move', 'wrong-instance', 'playing', 'noninitial', 'error', 'hidden', 'hidden-parent', 'disabled', 'loading', 'zero-canvas', 'interrupted-error', 'interrupted-instance', 'valid']) {
    const page = await browser.newPage();
    await page.setContent('<section class="unity-stage" data-unity-status="ready"><canvas class="unity-canvas" width="390" height="520"></canvas><button aria-label="Play animation">Play</button></section>');
    await page.evaluate(installUnityStartupTelemetry, { moveId: 'double_leg' });
    const observed = await page.evaluate(async (name) => {
      const emit = (overrides) => window.dispatchEvent(new CustomEvent('jiuquest:unity', { detail: {
        protocolVersion: 1, instanceId: 'fixture-a', requestId: 'fixture-a:2', type: 'state', moveId: 'double_leg', progress: 0, playing: false, ...overrides,
      } }));
      const stage = document.querySelector('.unity-stage'), canvas = document.querySelector('canvas'), play = document.querySelector('button');
      if (name === 'hidden') canvas.style.visibility = 'hidden';
      if (name === 'hidden-parent') stage.hidden = true;
      if (name === 'disabled') play.disabled = true;
      if (name === 'loading') stage.dataset.unityStatus = 'loading-move';
      if (name === 'zero-canvas') canvas.width = 0;
      emit({ type: 'ready' });
      const afterBootstrap = { ...window.__unityStartupTelemetry };
      if (name !== 'bootstrap') emit({
        ...(name === 'wrong-move' ? { moveId: 'standing_stance' } : {}),
        ...(name === 'wrong-instance' ? { instanceId: 'fixture-other' } : {}),
        ...(name === 'playing' ? { playing: true } : {}),
        ...(name === 'noninitial' ? { progress: 0.5 } : {}),
        ...(name === 'error' ? { type: 'error', message: 'Intentional fixture error' } : {}),
      });
      const beforeFrames = { ...window.__unityStartupTelemetry };
      if (name === 'interrupted-error') requestAnimationFrame(() => emit({ type: 'error', message: 'Intentional between-frame fixture error' }));
      if (name === 'interrupted-instance') requestAnimationFrame(() => emit({ type: 'ready', instanceId: 'fixture-new' }));
      const afterFirstFrame = await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame({ ...window.__unityStartupTelemetry })));
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      return { afterBootstrap, beforeFrames, afterFirstFrame, settled: { ...window.__unityStartupTelemetry }, observedAtMs: performance.now() };
    }, scenario);
    assert.equal(observed.afterBootstrap.renderedReadyMs, null, `${scenario}: bootstrap is not rendered readiness`);
    assert.equal(observed.beforeFrames.renderedReadyMs, null, `${scenario}: synchronous events are not rendered readiness`);
    assert.equal(observed.afterFirstFrame.renderedReadyMs, null, `${scenario}: one frame is insufficient`);
    if (scenario === 'valid') {
      assert.equal(observed.settled.renderedFrames, 2);
      assert.equal(observed.settled.instanceId, 'fixture-a');
      assert.equal(observed.settled.requestId, 'fixture-a:2');
      assert.ok(Number.isFinite(observed.settled.renderedReadyMs));
      assert.ok(observed.settled.renderedReadyMs >= observed.settled.firstMoveStateMs);
      assert.ok(observed.settled.renderedReadyMs <= observed.observedAtMs);
      // Deliberately late automation observation must not move the page milestone.
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.__unityStartupTelemetry.renderedReadyMs), observed.settled.renderedReadyMs);
    } else assert.equal(observed.settled.renderedReadyMs, null, `${scenario}: must not create a false-ready milestone`);
    report.cases.push({ scenario, status: 'passed', ...observed });
    await page.close();
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  report.completedAtUtc = new Date().toISOString();
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, artifacts, failure: report.failure }, null, 2));
}
