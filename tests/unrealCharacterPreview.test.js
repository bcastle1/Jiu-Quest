import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  UNREAL_CHARACTER_RENDERS,
  UNREAL_PREVIEW_AHEAD,
  UNREAL_PREVIEW_ASSET_ROOT,
  UNREAL_PREVIEW_PATH,
  UNREAL_PREVIEW_SHOWN,
  findUnrealRender,
  resolvePreviewPage,
  unrealRenderUrl,
} from '../src/unreal/characterPreview.js';
import { isUnityEnabled } from '../src/unity/bridge.js';
import { resolveCombatRenderer } from '../src/unreal/renderer.js';

const publicFile = (url) => readFileSync(fileURLToPath(new URL(`../public${url}`, import.meta.url)));

test('every published still is the exact pinned Unreal capture', () => {
  assert.equal(UNREAL_CHARACTER_RENDERS.length, 3);
  for (const render of UNREAL_CHARACTER_RENDERS) {
    const bytes = publicFile(unrealRenderUrl(render));
    assert.equal(bytes.length, render.bytes, `${render.file} size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), render.sha256, `${render.file} was replaced or re-encoded`);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${render.file} is not a PNG`);
    assert.equal(bytes.readUInt32BE(16), render.width, `${render.file} width`);
    assert.equal(bytes.readUInt32BE(20), render.height, `${render.file} height`);
  }
});

test('each view has its own id, file, label and description', () => {
  for (const key of ['id', 'file', 'label', 'title', 'sha256']) {
    assert.equal(new Set(UNREAL_CHARACTER_RENDERS.map((render) => render[key])).size, UNREAL_CHARACTER_RENDERS.length, key);
  }
  for (const render of UNREAL_CHARACTER_RENDERS) {
    assert.match(render.id, /^[a-z-]+$/);
    assert.match(render.file, /^[a-z-]+\.png$/);
    assert.ok(render.caption.length > 20 && render.alt.length > 40, `${render.id} needs a caption and alternative text`);
    assert.match(render.alt, /^Unreal Engine (close-up )?capture/);
    assert.equal(unrealRenderUrl(render), `${UNREAL_PREVIEW_ASSET_ROOT}/${render.file}`);
    assert.equal(findUnrealRender(render.id), render);
  }
  assert.equal(findUnrealRender('missing'), UNREAL_CHARACTER_RENDERS[0]);
  assert.throws(() => { UNREAL_CHARACTER_RENDERS[0].sha256 = 'changed'; }, TypeError);
});

test('standalone preview pages are selected only by their exact names', () => {
  assert.equal(resolvePreviewPage('?preview=unreal'), 'unreal');
  assert.equal(resolvePreviewPage('?engine=snapshot&preview=unreal'), 'unreal');
  assert.equal(resolvePreviewPage('?preview=unity'), 'unity');
  assert.equal(resolvePreviewPage(new URL(UNREAL_PREVIEW_PATH, 'https://jiuquest.com').search), 'unreal');
  for (const search of ['', '?preview=', '?preview=Unreal', '?preview=unreal2', '?engine=unreal', '?view=unreal']) {
    assert.equal(resolvePreviewPage(search), null, search);
  }
});

test('opening the still preview never selects an Unreal or Unity combat renderer', () => {
  const href = `https://jiuquest.com${UNREAL_PREVIEW_PATH}`;
  assert.equal(resolveCombatRenderer(href, { development: false }), 'snapshot');
  assert.equal(resolveCombatRenderer(href, { development: false, configuredEngine: 'unity' }), 'unity');
  assert.equal(resolveCombatRenderer(`${href}&engine=unreal`, { development: false, configuredEngine: 'unity' }), 'unity');
  assert.equal(isUnityEnabled(new URL(href).search, undefined), false);
});

test('the status lists keep live Unreal gameplay under work still ahead', () => {
  assert.ok(UNREAL_PREVIEW_AHEAD.some((item) => /Arena and Training/.test(item)));
  assert.ok(UNREAL_PREVIEW_AHEAD.some((item) => /stream/i.test(item)));
  assert.ok(UNREAL_PREVIEW_AHEAD.some((item) => /grappling/i.test(item)));
  for (const item of UNREAL_PREVIEW_SHOWN) assert.doesNotMatch(item, /stream|arena|training|grappl|live|gameplay/i);
});

test('the Overview card thumbnail is a small WebP', () => {
  const bytes = publicFile(`${UNREAL_PREVIEW_ASSET_ROOT}/card-thumb.webp`);
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP');
  assert.ok(bytes.length < 20000, 'the Overview must not load a full capture for its thumbnail');
});
