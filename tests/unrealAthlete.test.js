import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLASSIC_ONLY_CHOICES,
  FIGHTER_LOOKS,
  NEW_FIGHTER_LOOK,
  UNREAL_ATHLETE,
  normalizeFighterLook,
  savedFighterLook,
  unrealAthleteColors,
  usesUnrealAthlete,
} from '../src/unreal/athlete.js';
import { createFighter, customizationOptions, loadState, saveState } from '../src/storage.js';
import { beltColors } from '../src/data/curriculum.js';
import { resolveCombatRenderer } from '../src/unreal/renderer.js';

const repoFile = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)));
const STORAGE_KEY = 'jiuquest:v1';

// A device with the given saved fighters, or a first visit when none are given.
function onDevice(fighters, run) {
  const original = globalThis.window;
  const values = new Map();
  if (fighters) values.set(STORAGE_KEY, JSON.stringify({ selectedFighterId: fighters[0].id, fighters }));
  globalThis.window = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
  try { return run(values); } finally {
    if (original === undefined) delete globalThis.window; else globalThis.window = original;
  }
}

test('each published layer is the pinned 450 by 880 opaque WebP', () => {
  assert.deepEqual(Object.keys(UNREAL_ATHLETE.layers), ['base', 'jacket', 'pants', 'belt']);
  assert.deepEqual(Object.keys(UNREAL_ATHLETE.files), Object.keys(UNREAL_ATHLETE.layers));
  for (const [name, url] of Object.entries(UNREAL_ATHLETE.layers)) {
    assert.equal(url, `/assets/unreal-athlete/athlete-01/front-${name}.webp`);
    const bytes = repoFile(`public${url}`);
    assert.equal(bytes.length, UNREAL_ATHLETE.files[name].bytes, `${name} size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), UNREAL_ATHLETE.files[name].sha256, `${name} was replaced or re-encoded`);
    assert.equal(bytes.toString('latin1', 0, 4), 'RIFF');
    assert.equal(bytes.toString('latin1', 8, 12), 'WEBP');
    // Plain lossy VP8: no alpha chunk, so black adds nothing when layers are summed.
    assert.equal(bytes.toString('latin1', 12, 16), 'VP8 ', `${name} must stay an opaque VP8 image`);
    assert.deepEqual([...bytes.subarray(23, 26)], [0x9d, 0x01, 0x2a], `${name} frame header`);
    assert.equal(bytes.readUInt16LE(26) & 0x3fff, UNREAL_ATHLETE.width, `${name} width`);
    assert.equal(bytes.readUInt16LE(28) & 0x3fff, UNREAL_ATHLETE.height, `${name} height`);
  }
  assert.throws(() => { UNREAL_ATHLETE.files.base.sha256 = 'changed'; }, TypeError);
  assert.throws(() => { UNREAL_ATHLETE.layers.base = '/elsewhere.webp'; }, TypeError);
});

test('the layer tool and the page pin the same four Unreal captures and the same crop', () => {
  const tool = repoFile('tools/build_unreal_athlete_layers.py').toString('utf8');
  const pinned = Object.fromEntries([...tool.matchAll(/"([a-z-]+\.png)": "([0-9a-f]{64})"/g)].map((match) => [match[1], match[2]]));
  assert.deepEqual(pinned, { ...UNREAL_ATHLETE.sources });
  assert.equal(Object.keys(pinned).length, 4);
  const crop = tool.match(/^CROP = \((\d+), (\d+), (\d+), (\d+)\)$/m);
  assert.deepEqual(crop.slice(3).map(Number), [UNREAL_ATHLETE.width, UNREAL_ATHLETE.height]);
  // The round portrait square has to sit inside the layer.
  const { left, top, size } = UNREAL_ATHLETE.portrait;
  assert.ok(left >= 0 && top >= 0 && left + size <= UNREAL_ATHLETE.width && top + size <= UNREAL_ATHLETE.height);
});

test('the portrait rule in the stylesheet matches the portrait square', () => {
  const css = repoFile('src/components/UnrealAthlete.css').toString('utf8');
  const { left, top, size } = UNREAL_ATHLETE.portrait;
  const rule = css.match(/\.mini-portrait \.unreal-athlete \{([^}]+)\}/)[1];
  const percent = (property) => Number(rule.match(new RegExp(`${property}:\\s*(-?[\\d.]+)%`))[1]);
  // The figure is scaled so the square fills the circle; offsets are in circle widths.
  assert.ok(Math.abs(percent('width') - (UNREAL_ATHLETE.width / size) * 100) < 0.01);
  assert.ok(Math.abs(percent('left') + (left / size) * 100) < 0.01);
  assert.ok(Math.abs(percent('top') + (top / size) * 100) < 0.01);
});

test('only the two known looks are accepted', () => {
  assert.deepEqual([...FIGHTER_LOOKS], ['unreal', 'classic']);
  assert.equal(NEW_FIGHTER_LOOK, 'unreal');
  assert.equal(normalizeFighterLook('unreal'), 'unreal');
  assert.equal(normalizeFighterLook('classic'), 'classic');
  for (const value of [undefined, null, '', 'Unreal', 'CLASSIC', 'unity', 3, {}, ['unreal']]) {
    assert.equal(normalizeFighterLook(value), 'unreal');
    assert.equal(normalizeFighterLook(value, 'classic'), 'classic');
  }
  assert.equal(usesUnrealAthlete({ look: 'unreal' }), true);
  for (const fighter of [{ look: 'classic' }, {}, null, undefined, { look: 'Unreal' }]) assert.equal(usesUnrealAthlete(fighter), false);
});

test('only six-digit hex colors reach the athlete', () => {
  assert.deepEqual(unrealAthleteColors({ giTop: '#112A58', giPants: '#151922' }, '#2563EB'), { jacket: '#112a58', pants: '#151922', belt: '#2563eb' });
  const white = { jacket: '#f8fbff', pants: '#f8fbff', belt: '#f8fbff' };
  assert.deepEqual(unrealAthleteColors(null, undefined), white);
  assert.deepEqual(unrealAthleteColors({}, ''), white);
  for (const bad of ['red', '#fff', '#12345', '#1234567', 'url(https://invalid.test/x)', '#12345g', 'rgb(1,2,3)', ' #112a58', 7, {}, ['#112a58']]) {
    assert.deepEqual(unrealAthleteColors({ giTop: bad, giPants: bad }, bad), white, String(bad));
  }
  // Every color the game offers is accepted as chosen.
  for (const color of customizationOptions.giColors) assert.equal(unrealAthleteColors({ giTop: color }).jacket, color.toLowerCase());
  for (const [belt, color] of Object.entries(beltColors)) assert.equal(unrealAthleteColors({}, color).belt, color.toLowerCase(), belt);
});

test('a new fighter and a first visit start as the Unreal athlete', () => {
  assert.equal(createFighter().look, 'unreal');
  assert.equal(createFighter({ look: 'classic' }).look, 'classic');
  assert.equal(createFighter({ look: 'something else' }).look, 'unreal');
  onDevice(null, () => {
    const state = loadState();
    assert.equal(state.fighters[0].look, 'unreal');
  });
});

test('a saved stock fighter moves to the Unreal athlete and a customized one keeps its classic art', () => {
  const stock = createFighter();
  assert.equal(savedFighterLook({}, stock), 'unreal');
  assert.equal(savedFighterLook({ giTop: '#7d52ff', giPants: '#151922', aura: 'mat gold', stance: 'sumo base' }, stock), 'unreal', 'gi, aura and stance carry over');
  for (const key of CLASSIC_ONLY_CHOICES) assert.equal(savedFighterLook({ [key]: stock[key] }, stock), 'unreal', `${key} left as stock`);
  const changed = { gender: 'girl', skinTone: '#6f432f', hairColor: '#d7c09a', hairStyle: 'bald', emblem: 'none' };
  assert.deepEqual(Object.keys(changed), [...CLASSIC_ONLY_CHOICES]);
  for (const [key, value] of Object.entries(changed)) assert.equal(savedFighterLook({ [key]: value }, stock), 'classic', `${key} was customized`);
  // A look that was already saved always wins.
  assert.equal(savedFighterLook({ look: 'classic' }, stock), 'classic');
  assert.equal(savedFighterLook({ look: 'unreal', ...changed }, stock), 'unreal');
  assert.equal(savedFighterLook({ look: 'nonsense', hairStyle: 'bald' }, stock), 'classic');
  assert.equal(savedFighterLook(null, stock), 'unreal');
});

test('fighters saved before the Unreal athlete load with the right look and keep every saved choice', () => {
  const saved = [
    { id: 'stock', name: 'Stock', giTop: '#b61f2b', progress: { 'double-leg-takedown': 7 } },
    { id: 'designed', name: 'Designed', gender: 'girl', hairStyle: 'braided top', skinTone: '#a86b4d', hairColor: '#3b251b', emblem: 'lion', giTop: '#1d7d68' },
    { id: 'chose-classic', name: 'Chose classic', look: 'classic' },
  ];
  onDevice(saved, (values) => {
    const state = loadState();
    assert.deepEqual(state.fighters.map((fighter) => fighter.look), ['unreal', 'classic', 'classic']);
    assert.equal(state.fighters[0].giTop, '#b61f2b');
    assert.equal(state.fighters[0].progress['double-leg-takedown'], 7);
    const designed = state.fighters[1];
    assert.deepEqual([designed.gender, designed.hairStyle, designed.skinTone, designed.hairColor, designed.emblem, designed.giTop], ['girl', 'braided top', '#a86b4d', '#3b251b', 'lion', '#1d7d68']);

    // Switching looks is saved, and the choices the Unreal athlete cannot show are kept for the way back.
    designed.look = 'unreal';
    state.fighters[0].look = 'classic';
    assert.equal(saveState(state).ok, true);
    const reloaded = loadState();
    assert.deepEqual(reloaded.fighters.map((fighter) => fighter.look), ['classic', 'unreal', 'classic']);
    assert.deepEqual([reloaded.fighters[1].gender, reloaded.fighters[1].hairStyle, reloaded.fighters[1].emblem], ['girl', 'braided top', 'lion']);
    assert.match(values.get(STORAGE_KEY), /"look":"unreal"/);
  });
});

test('the athlete is still images only: it imports no renderer, stream or storage code', () => {
  const imports = (path) => [...repoFile(path).toString('utf8').matchAll(/^import (?:[^'"]* from )?['"]([^'"]+)['"];?$/gm)].map((match) => match[1]);
  assert.deepEqual(imports('src/unreal/athlete.js'), []);
  assert.deepEqual(imports('src/components/UnrealAthlete.jsx'), ['react', '../data/curriculum.js', '../unreal/athlete.js', './UnrealAthlete.css']);
  // A fighter's look is not an input to renderer selection.
  assert.equal(resolveCombatRenderer.length, 1);
  assert.equal(resolveCombatRenderer('https://jiuquest.com/?look=unreal'), resolveCombatRenderer('https://jiuquest.com/'));
});
