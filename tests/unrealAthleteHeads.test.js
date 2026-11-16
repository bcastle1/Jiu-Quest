import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ATHLETE_BEARDS, ATHLETE_FACES, ATHLETE_HAIRS, ATHLETE_HAIR_COLORS, ATHLETE_HEAD_FIELDS, DEFAULT_ATHLETE_HEAD,
  athleteHeadFields, athleteHeadKey, athleteHeadKeys, athleteHeadOf, isBaseAthleteHead, isDefaultAthleteHead,
} from '../src/unreal/athleteHeadOptions.js';
import {
  ATHLETE_HEADS, PUBLISHED_ATHLETE_PICTURE, athleteBaseUrl, athleteHeadPicture, athleteHeadThumb, athleteHeadUrl, athleteJacketUrl,
  standingBaseUrl, standingHeadPictures, standingHeadUrl, standingJacketUrl,
} from '../src/unreal/athleteHeads.js';
import pins from '../src/unreal/athleteHeads.pins.js';
import { UNREAL_ATHLETE } from '../src/unreal/athlete.js';
import { findUnrealPositionStill } from '../src/unreal/positionStills.js';
import { ATHLETE_STAND_IN, classicStandIn, standInAppearance } from '../src/unreal/athleteStandIn.js';
import { toUnityAthlete } from '../src/unity/bridge.js';
import { createFighter, customizationOptions, loadState, saveState } from '../src/storage.js';

const repoFile = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)));
const STORAGE_KEY = 'jiuquest:v1';
const baseKey = (face) => athleteHeadKey({ face: face.id, ...face.base });
const KEYS = athleteHeadKeys();
const BASE_KEYS = ATHLETE_FACES.map(baseKey);
const LAID = KEYS.filter((key) => !BASE_KEYS.includes(key));
const OTHER_FACES = ATHLETE_FACES.slice(1).map((face) => face.id);
const still = findUnrealPositionStill('standing');
const { athlete, standing } = ATHLETE_HEADS;
const withHead = (head) => ({ name: 'Tester', giTop: '#f8fbff', giPants: '#f8fbff', ...Object.fromEntries(Object.entries(head).map(([part, id]) => [ATHLETE_HEAD_FIELDS[part], id])) });

// Size and transparency of a WebP file from its first chunk.
function webp(bytes) {
  assert.equal(bytes.toString('latin1', 0, 4), 'RIFF');
  assert.equal(bytes.toString('latin1', 8, 12), 'WEBP');
  const kind = bytes.toString('latin1', 12, 16);
  if (kind === 'VP8 ') return { alpha: false, width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8X') return { alpha: (bytes[20] & 0x10) !== 0, width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (kind === 'VP8L') { const bits = bytes.readUInt32LE(21); return { alpha: ((bits >>> 28) & 1) === 1, width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }; }
  throw new Error(`unexpected WebP chunk ${kind}`);
}

function onDevice(fighters, run) {
  const original = globalThis.window;
  const values = new Map();
  if (fighters) values.set(STORAGE_KEY, JSON.stringify({ selectedFighterId: fighters[0].id, fighters }));
  globalThis.window = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
  try { return run(values); } finally {
    if (original === undefined) delete globalThis.window; else globalThis.window = original;
  }
}

// Every published file the choices need, by the page's own naming.
function expectedFiles() {
  const files = [];
  for (const face of OTHER_FACES) files.push({ url: athleteBaseUrl(face), size: [athlete.width, athlete.height], alpha: false, what: `front base ${face}` });
  for (const face of OTHER_FACES) files.push({ url: athleteJacketUrl(face), size: [athlete.width, athlete.height], alpha: false, what: `front jacket ${face}` });
  for (const key of LAID) files.push({ url: athleteHeadUrl(key), size: athlete.headBox.slice(2), alpha: true, what: `front head ${key}` });
  for (const face of ATHLETE_FACES) for (const hair of ATHLETE_HAIRS) files.push({ url: athleteHeadThumb(face.id, hair.id), size: [athlete.thumbSize, athlete.thumbSize], alpha: false, what: `thumb ${face.id} ${hair.id}` });
  for (const role of ['lead', 'other']) {
    for (const face of OTHER_FACES) files.push({ url: standingBaseUrl(still, role, face), size: [standing.width, standing.height], alpha: false, what: `standing ${role} base ${face}` });
    for (const face of OTHER_FACES) files.push({ url: standingJacketUrl(still, role, face), size: [standing.width, standing.height], alpha: false, what: `standing ${role} jacket ${face}` });
    for (const key of LAID) files.push({ url: standingHeadUrl(role, key), size: standing[role].headBox.slice(2), alpha: true, what: `standing ${role} head ${key}` });
  }
  return files;
}

test('the head choices are two faces, five hairstyles, four hair colours and two beards', () => {
  assert.deepEqual(ATHLETE_FACES.map((face) => face.id), ['original', 'dean']);
  assert.deepEqual(ATHLETE_HAIRS.map((hair) => hair.id), ['fringe', 'skin-fade', 'coily-fade', 'coil-buzz', 'shaved']);
  assert.deepEqual(ATHLETE_HAIR_COLORS.map((color) => color.id), ['black', 'brown', 'blond', 'grey']);
  assert.deepEqual(ATHLETE_BEARDS.map((beard) => beard.id), ['none', 'stubble']);
  for (const list of [ATHLETE_FACES, ATHLETE_HAIRS, ATHLETE_HAIR_COLORS, ATHLETE_BEARDS]) {
    assert.equal(new Set(list.map((option) => option.id)).size, list.length);
    for (const option of list) assert.ok(option.label.length > 2 && /^[a-z-]+$/.test(option.id), option.id);
    assert.throws(() => { list[0].label = 'changed'; }, TypeError);
  }
  for (const color of ATHLETE_HAIR_COLORS) assert.match(color.swatch, /^#[0-9a-f]{6}$/);
  // The first face is the published athlete, and a default head is exactly that athlete.
  assert.deepEqual({ face: ATHLETE_FACES[0].id, ...ATHLETE_FACES[0].base }, { ...DEFAULT_ATHLETE_HEAD });
  assert.deepEqual(Object.keys(ATHLETE_HEAD_FIELDS), ['face', 'hair', 'hairColor', 'beard']);
  for (const face of ATHLETE_FACES) assert.ok(KEYS.includes(baseKey(face)), `${face.id} base is one of the choices`);
});

test('a head is named face/hair/colour/beard, and a shaved head without a beard has one picture for every colour', () => {
  assert.equal(athleteHeadKey(DEFAULT_ATHLETE_HEAD), 'original/fringe/black/none');
  assert.equal(athleteHeadKey({ face: 'dean', hair: 'shaved', hairColor: 'grey', beard: 'none' }), 'dean/shaved/black/none');
  assert.equal(athleteHeadKey({ face: 'dean', hair: 'shaved', hairColor: 'grey', beard: 'stubble' }), 'dean/shaved/grey/stubble');
  // per face: four hairstyles in four colours with and without a beard, a shaved head, and a shaved head with a beard in four colours
  assert.equal(KEYS.length, ATHLETE_FACES.length * (4 * 4 * 2 + 1 + 4));
  assert.equal(new Set(KEYS).size, KEYS.length);
  assert.ok(isDefaultAthleteHead(DEFAULT_ATHLETE_HEAD));
  assert.ok(isBaseAthleteHead({ face: 'dean', ...ATHLETE_FACES[1].base }));
  assert.ok(!isBaseAthleteHead({ ...DEFAULT_ATHLETE_HEAD, face: 'dean' }), 'Dean with the hair of the first athlete is not his base picture');
});

test('a fighter without head choices, or with unknown ones, is the published athlete', () => {
  assert.deepEqual(athleteHeadOf(undefined), { ...DEFAULT_ATHLETE_HEAD });
  assert.deepEqual(athleteHeadOf({}), { ...DEFAULT_ATHLETE_HEAD });
  assert.deepEqual(athleteHeadOf({ athleteFace: 'dean', athleteHair: 'mullet', athleteHairColor: 7, athleteBeard: null }), { face: 'dean', hair: 'fringe', hairColor: 'black', beard: 'none' });
  assert.deepEqual(athleteHeadFields({ athleteFace: 'dean', athleteHair: 'coily-fade', athleteHairColor: 'grey', athleteBeard: 'stubble' }),
    { athleteFace: 'dean', athleteHair: 'coily-fade', athleteHairColor: 'grey', athleteBeard: 'stubble' });
  // The classic appearance fields are other fields: they never choose an Unreal head.
  assert.deepEqual(athleteHeadOf({ hairStyle: 'bald', hairColor: '#f8f4ea', skinTone: '#3d241b' }), { ...DEFAULT_ATHLETE_HEAD });
});

test('the page knows where the head pictures are and how large, and every other face has a base of its own', () => {
  assert.deepEqual([athlete.width, athlete.height], [UNREAL_ATHLETE.width, UNREAL_ATHLETE.height]);
  assert.deepEqual([standing.width, standing.height], [still.width, still.height]);
  assert.equal(athlete.folder, '/assets/unreal-athlete/athlete-01/heads');
  assert.equal(standing.folder, '/assets/unreal-positions/standing/heads');
  assert.deepEqual([...ATHLETE_HEADS.baseFaces], OTHER_FACES);
  // the boxes lie inside their pictures
  for (const [box, width, height] of [[athlete.headBox, athlete.width, athlete.height], [standing.lead.headBox, standing.width, standing.height], [standing.other.headBox, standing.width, standing.height]]) {
    assert.ok(box[0] >= 0 && box[1] >= 0 && box[0] + box[2] <= width && box[1] + box[3] <= height, `${box}`);
  }
  // 14 render pixels are 9 published ones: the front box falls on whole render pixels
  for (const value of athlete.headBox) assert.equal(value % 9, 0, `${value}`);
  assert.throws(() => { athlete.headBox[0] = 1; }, TypeError);
});

test('every choice has its published picture, pinned by size and SHA-256, and nothing else is published', () => {
  const files = expectedFiles();
  // per other face a base and a jacket layer, in the front view and in both places of the standing still
  assert.equal(files.length, 2 * OTHER_FACES.length + LAID.length + ATHLETE_FACES.length * ATHLETE_HAIRS.length + 2 * (2 * OTHER_FACES.length + LAID.length));
  assert.deepEqual(Object.keys(pins.files).sort(), files.map((file) => file.url).sort(), 'the pinned files are exactly the files the choices need');
  for (const file of files) {
    const bytes = repoFile(`public${file.url}`);
    const pin = pins.files[file.url];
    assert.equal(bytes.length, pin.bytes, `${file.what} size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, `${file.what} was replaced or re-encoded`);
    const info = webp(bytes);
    assert.deepEqual([info.width, info.height], file.size, `${file.what} pixel size`);
    assert.equal(info.alpha, file.alpha, `${file.what} ${file.alpha ? 'needs' : 'must not have'} transparency`);
  }
  for (const folder of [athlete.folder, standing.folder]) {
    const onDisk = readdirSync(fileURLToPath(new URL(`../public${folder}`, import.meta.url))).map((name) => `${folder}/${name}`).sort();
    assert.deepEqual(onDisk, files.map((file) => file.url).filter((url) => url.startsWith(`${folder}/`)).sort(), folder);
  }
  // every render the pictures came from is named
  for (const scene of ['front', 'standing']) {
    for (const key of KEYS) assert.match(pins.sources[scene][key], /^[0-9a-f]{64}$/, `${scene} ${key}`);
    // and no render stands in for a second choice
    assert.equal(new Set(KEYS.map((key) => pins.sources[scene][key])).size, KEYS.length, `${scene}: every choice has a render of its own`);
  }
  assert.throws(() => { pins.files[files[0].url].sha256 = 'changed'; }, TypeError);
});

test('the pins are for the tests: the page never loads them', () => {
  const sources = (folder) => readdirSync(fileURLToPath(new URL(`../${folder}`, import.meta.url)), { recursive: true })
    .filter((name) => /\.(js|jsx)$/.test(name)).map((name) => `${folder}/${String(name).replaceAll('\\', '/')}`);
  // Comments may name the module; no file of the page imports it, statically or on demand.
  const importing = sources('src').filter((file) => /(?:^|\n)\s*import\b[^;]*athleteHeads\.pins|import\(\s*['"][^'"]*athleteHeads\.pins/.test(repoFile(file).toString('utf8')));
  assert.deepEqual(importing, []);
  assert.ok(sources('src').length > 40, 'the page sources were read');
  assert.doesNotMatch(repoFile('src/unreal/athleteHeads.data.js').toString('utf8'), /[0-9a-f]{64}/, 'the page module carries no hashes');
});

test('the athlete of a fighter is the base of the chosen face with the chosen head laid over it', () => {
  const published = UNREAL_ATHLETE.layers.base;
  const jacket = UNREAL_ATHLETE.layers.jacket;
  assert.deepEqual(athleteHeadPicture({ name: 'New' }), { key: 'original/fringe/black/none', baseKey: 'original/fringe/black/none', base: published, jacket, head: null });
  assert.deepEqual({ ...PUBLISHED_ATHLETE_PICTURE }, { key: null, baseKey: null, base: published, jacket, head: null });
  const fade = athleteHeadPicture(withHead({ face: 'original', hair: 'skin-fade', hairColor: 'blond', beard: 'stubble' }));
  assert.equal(fade.key, 'original/skin-fade/blond/stubble');
  assert.equal(fade.baseKey, 'original/fringe/black/none', 'what the base shows by itself: it stays if the head picture cannot load');
  assert.deepEqual([fade.base, fade.jacket], [published, jacket], 'another hairstyle of the first face keeps the published base and jacket layer');
  assert.equal(fade.head.url, '/assets/unreal-athlete/athlete-01/heads/original-skin-fade-blond-stubble.webp');
  const [left, top, width, height] = athlete.headBox;
  assert.deepEqual(fade.head.style, { left: `${(left / 900) * 100}%`, top: `${(top / 1760) * 100}%`, width: `${(width / 900) * 100}%`, height: `${(height / 1760) * 100}%` });
  // Dean's own look is his base picture; any other head of his is laid over that base.
  const dean = athleteHeadPicture(withHead({ face: 'dean', ...ATHLETE_FACES[1].base }));
  // another neck uncovers other parts of the collar: Dean has a jacket layer of his own, and the published pants and belt
  assert.deepEqual(dean, { key: baseKey(ATHLETE_FACES[1]), baseKey: baseKey(ATHLETE_FACES[1]), base: '/assets/unreal-athlete/athlete-01/heads/base-dean.webp', jacket: '/assets/unreal-athlete/athlete-01/heads/jacket-dean.webp', head: null });
  const deanFringe = athleteHeadPicture(withHead({ face: 'dean', hair: 'fringe', hairColor: 'black', beard: 'none' }));
  assert.deepEqual([deanFringe.base, deanFringe.jacket], [dean.base, dean.jacket]);
  assert.equal(deanFringe.head.url, '/assets/unreal-athlete/athlete-01/heads/dean-fringe-black-none.webp');
  assert.equal(deanFringe.baseKey, baseKey(ATHLETE_FACES[1]));
  // every choice resolves to pinned files
  for (const key of KEYS) {
    const [face, hair, hairColor, beard] = key.split('/');
    const picture = athleteHeadPicture(withHead({ face, hair, hairColor, beard }));
    assert.equal(picture.key, key);
    assert.ok(picture.base === published || pins.files[picture.base], key);
    assert.ok(picture.jacket === jacket || pins.files[picture.jacket], key);
    assert.equal(picture.base === published, picture.jacket === jacket, `${key}: a base and its jacket layer belong together`);
    assert.equal(picture.head === null, BASE_KEYS.includes(key), key);
    if (picture.head) assert.ok(pins.files[picture.head.url], key);
  }
  for (const face of ATHLETE_FACES) for (const hair of ATHLETE_HAIRS) assert.ok(pins.files[athleteHeadThumb(face.id, hair.id)], `${face.id} ${hair.id}`);
  assert.equal(athleteHeadThumb('nobody', 'fringe'), null);
  assert.equal(athleteHeadThumb('dean', 'mullet'), null);
});

test('the standing still shows the player\'s head in the player\'s place and the published athlete in the other', () => {
  const opponent = { name: 'Ryu Tanaka', giTop: '#112a58', giPants: '#f8fbff', hairStyle: 'shadow spikes' };
  const plain = standingHeadPictures(still, { lead: withHead(DEFAULT_ATHLETE_HEAD), other: opponent });
  assert.deepEqual(plain, { key: still.layers.base, base: still.layers.base, layers: {}, heads: [] });
  const player = withHead({ face: 'original', hair: 'coily-fade', hairColor: 'brown', beard: 'none' });
  const asLead = standingHeadPictures(still, { lead: player, other: opponent });
  assert.deepEqual([asLead.base, asLead.layers], [still.layers.base, {}]);
  assert.deepEqual(asLead.heads.map((head) => [head.role, head.url]), [['lead', '/assets/unreal-positions/standing/heads/lead-original-coily-fade-brown-none.webp']]);
  const asOther = standingHeadPictures(still, { lead: opponent, other: player });
  assert.deepEqual(asOther.heads.map((head) => [head.role, head.url]), [['other', '/assets/unreal-positions/standing/heads/other-original-coily-fade-brown-none.webp']]);
  const box = standing.other.headBox;
  assert.deepEqual(asOther.heads[0].style, { left: `${(box[0] / still.width) * 100}%`, top: `${(box[1] / still.height) * 100}%`, width: `${(box[2] / still.width) * 100}%`, height: `${(box[3] / still.height) * 100}%` });
  // another face: the whole picture changes (hands and feet too), and the head choice is laid over it
  const dean = withHead({ face: 'dean', hair: 'fringe', hairColor: 'grey', beard: 'stubble' });
  const deanLead = standingHeadPictures(still, { lead: dean, other: opponent });
  assert.equal(deanLead.base, '/assets/unreal-positions/standing/heads/lead-base-dean.webp');
  assert.deepEqual(deanLead.layers, { leadJacket: '/assets/unreal-positions/standing/heads/lead-jacket-dean.webp' }, 'the jacket layer of the athlete with the other face is replaced, and only that one');
  assert.deepEqual(deanLead.heads.map((head) => head.url), ['/assets/unreal-positions/standing/heads/lead-dean-fringe-grey-stubble.webp']);
  const deanOther = standingHeadPictures(still, { lead: opponent, other: withHead({ face: 'dean', ...ATHLETE_FACES[1].base }) });
  assert.deepEqual(deanOther, { key: '/assets/unreal-positions/standing/heads/other-base-dean.webp', base: '/assets/unreal-positions/standing/heads/other-base-dean.webp',
    layers: { otherJacket: '/assets/unreal-positions/standing/heads/other-jacket-dean.webp' }, heads: [] });
  // two athletes with another face: the lead's face is shown, the other keeps the published head (never a wrong skin)
  const both = standingHeadPictures(still, { lead: dean, other: dean });
  assert.deepEqual([both.base, both.layers], [deanLead.base, deanLead.layers]);
  assert.deepEqual(both.heads.map((head) => head.role), ['lead']);
  assert.notEqual(asLead.key, asOther.key);
  // every file a still can ask for is pinned
  for (const role of ['lead', 'other']) {
    for (const key of KEYS) {
      const [face, hair, hairColor, beard] = key.split('/');
      const athletes = role === 'lead' ? { lead: withHead({ face, hair, hairColor, beard }), other: opponent } : { lead: opponent, other: withHead({ face, hair, hairColor, beard }) };
      const pictures = standingHeadPictures(still, athletes);
      assert.ok(pictures.base === still.layers.base || pins.files[pictures.base], `${role} ${key}`);
      for (const head of pictures.heads) assert.ok(pins.files[head.url], `${role} ${key}`);
      for (const [name, url] of Object.entries(pictures.layers)) assert.ok(still.layers[name] && pins.files[url], `${role} ${key} ${name}`);
      assert.equal(pictures.base === still.layers.base, Object.keys(pictures.layers).length === 0, `${role} ${key}: a base and its jacket layer belong together`);
      assert.equal(pictures.heads.length, BASE_KEYS.includes(key) ? 0 : 1, `${role} ${key}`);
    }
  }
});

test('head choices are saved with the fighter and survive a reload; older saves load as the published athlete', () => {
  const fresh = createFighter({ name: 'Fresh' });
  assert.deepEqual(athleteHeadOf(fresh), { ...DEFAULT_ATHLETE_HEAD });
  for (const field of Object.values(ATHLETE_HEAD_FIELDS)) assert.equal(typeof fresh[field], 'string', field);
  const chosen = createFighter({ name: 'Chosen', athleteFace: 'dean', athleteHair: 'skin-fade', athleteHairColor: 'grey', athleteBeard: 'stubble' });
  assert.deepEqual(athleteHeadOf(chosen), { face: 'dean', hair: 'skin-fade', hairColor: 'grey', beard: 'stubble' });
  onDevice([
    { id: 'old', name: 'Saved before heads', look: 'unreal', giTop: '#b61f2b', giPants: '#151922' },
    { id: 'kept', name: 'Kept', look: 'unreal', athleteFace: 'dean', athleteHair: 'coily-fade', athleteHairColor: 'blond', athleteBeard: 'stubble', giTop: '#1d7d68' },
    { id: 'odd', name: 'Odd', look: 'unreal', athleteFace: 'someone', athleteHair: 'shaved', athleteHairColor: 'blue', athleteBeard: 'none' },
  ], (values) => {
    const state = loadState();
    assert.deepEqual(state.fighters.map(athleteHeadOf), [
      { ...DEFAULT_ATHLETE_HEAD },
      { face: 'dean', hair: 'coily-fade', hairColor: 'blond', beard: 'stubble' },
      { face: 'original', hair: 'shaved', hairColor: 'black', beard: 'none' },
    ]);
    // gi colours are untouched by the head choices
    assert.deepEqual(state.fighters.map((fighter) => fighter.giTop), ['#b61f2b', '#1d7d68', '#f8fbff']);
    assert.equal(state.fighters[0].giPants, '#151922');
    assert.equal(saveState(state).ok, true);
    assert.match(values.get(STORAGE_KEY), /"athleteFace":"dean"/);
    assert.deepEqual(loadState().fighters.map(athleteHeadOf), state.fighters.map(athleteHeadOf));
  });
});

test('the pictures tool and the page read the same choices and the same boxes', () => {
  const tool = repoFile('tools/build_unreal_athlete_heads.mjs').toString('utf8');
  assert.match(tool, /from '\.\.\/src\/unreal\/athleteHeadOptions\.js';/);
  const box = (name) => JSON.parse(tool.match(new RegExp(`${name}: (\\[[\\d, ]+\\])`))[1]);
  assert.deepEqual(box('headBox'), [...athlete.headBox]);
  assert.deepEqual(box('lead'), [...standing.lead.headBox]);
  assert.deepEqual(box('other'), [...standing.other.headBox]);
  assert.equal(Number(tool.match(/thumbSize: (\d+)/)[1]), athlete.thumbSize);
});

// ---- Where the Unreal athlete cannot be shown (src/unreal/athleteStandIn.js) ----

test('the classic pictures and the Unity scene take the nearest classic look from the chosen head, and nothing is saved', () => {
  const classicFields = ['gender', 'skinTone', 'hairStyle', 'hairColor', 'emblem'];
  const player = createFighter({ name: 'Stand-in', look: 'unreal', gender: 'girl', skinTone: '#120805', hairColor: '#f8f4ea', hairStyle: 'long hair', emblem: 'lion', ...withHead({ face: 'dean', hair: 'shaved', hairColor: 'grey', beard: 'stubble' }) });
  const drawn = classicStandIn(player);
  assert.notEqual(drawn, player);
  // no patch either: the Unreal athlete's gi has none, and the Fighter Creator offers none for it
  assert.deepEqual(classicFields.map((field) => drawn[field]), ['boy', '#a86b4d', 'bald', '#6b6f86', 'none']);
  // everything else is the fighter's own: the name, the gi colors, the head fields
  for (const [field, value] of Object.entries(player)) if (!classicFields.includes(field)) assert.deepEqual(drawn[field], value, field);
  // the fighter keeps its own classic fields, for the day it wears the Classic look again
  assert.deepEqual(classicFields.map((field) => player[field]), ['girl', '#120805', 'long hair', '#f8f4ea', 'lion']);
  // a fighter with the Classic look, an opponent and nothing at all come back as they are
  const classic = createFighter({ look: 'classic', hairStyle: 'mohawk' });
  assert.equal(classicStandIn(classic), classic);
  const rival = { name: 'Ryu Tanaka', hairStyle: 'short fade', skinTone: '#d99b71' };
  assert.equal(classicStandIn(rival), rival);
  assert.equal(classicStandIn(undefined), undefined);
  // every choice has a classic value the classic renderers know
  for (const face of ATHLETE_FACES) {
    assert.ok(customizationOptions.skinTones.includes(ATHLETE_STAND_IN.face[face.id].skinTone), face.id);
    assert.ok(customizationOptions.genders.includes(ATHLETE_STAND_IN.face[face.id].gender), face.id);
  }
  for (const hair of ATHLETE_HAIRS) assert.ok(customizationOptions.hairStyles.includes(ATHLETE_STAND_IN.hairStyle[hair.id]), hair.id);
  for (const color of ATHLETE_HAIR_COLORS) assert.ok(customizationOptions.hairColors.includes(ATHLETE_STAND_IN.hairColor[color.id]), color.id);
  // The classic list has two short cuts for the three here: the two buzz cuts share the crew cut, and the short
  // coily cut is the short fade (the classic curly style is a tall head of curls, not a short cut).
  assert.deepEqual({ ...ATHLETE_STAND_IN.hairStyle }, { fringe: 'wave cut', 'skin-fade': 'crew cut', 'coily-fade': 'short fade', 'coil-buzz': 'crew cut', shaved: 'bald' });
  assert.equal(ATHLETE_STAND_IN.emblem, 'none');
  assert.ok(customizationOptions.emblems.includes(ATHLETE_STAND_IN.emblem));
  assert.deepEqual(standInAppearance({}), { gender: 'boy', skinTone: '#d99b71', hairStyle: 'wave cut', hairColor: '#11131c', emblem: 'none' }, 'the head of a new fighter');
  // the Unity scene is sent the same look
  const unity = toUnityAthlete(drawn, 'white');
  assert.deepEqual([unity.skinTone, unity.hairStyle, unity.hairColor], ['#a86b4d', 'bald', '#6b6f86']);
  // the stages that draw the classic picture and the Unity scene ask for it
  assert.match(repoFile('src/components/GrapplingSnapshotStage.jsx').toString('utf8'), /const player = useMemo\(\(\) => classicStandIn\(fighter\), \[fighter\]\);/);
  for (const stage of ['UnityGrapplingStage', 'UnrealGrapplingStage']) {
    assert.match(repoFile(`src/components/${stage}.jsx`).toString('utf8'), /fighter: toUnityAthlete\(classicStandIn\(fighter\), fighterBelt\)/, stage);
  }
});

// ---- The Arena scoreboard (src/components/CombatArenaView.jsx) ----

test('the Arena scoreboard shows the round portrait of a player with the Unreal athlete, at every width', () => {
  const arena = repoFile('src/components/CombatArenaView.jsx').toString('utf8');
  assert.match(arena, /const portrait = usesUnrealAthlete\(athlete\);/);
  // the portrait where the two gi swatches stand for everyone else; the name beside it says who it is
  assert.match(arena, /\{portrait \? \(\r?\n\s+<span className="mini-portrait" aria-hidden="true">\r?\n\s+<UnrealAthlete fighter=\{athlete\} belt=\{belt\} \/>\r?\n\s+<\/span>\r?\n\s+\) : \(\r?\n\s+<span className="snapshot-kit" aria-hidden="true">/);
  const css = repoFile('src/game/arena.css').toString('utf8');
  // older rules hide a portrait in this bar at some widths
  assert.match(css, /\.app-shell\.jq-game \.fighter-card \.mini-portrait \{[^}]*display: block;[^}]*border-radius: 50%;[^}]*\}/);
  // The portrait stands above the name where the bar is narrow. The bar measures itself, so that holds on phones
  // and in every wider window where the Arena has two columns and a long word would otherwise break inside.
  assert.match(css, /\.app-shell\.jq-game \.arena-top \{\r?\n\s+container: jiuquest-versus \/ inline-size;\r?\n\}\r?\n@container jiuquest-versus \(max-width: 560px\) \{\r?\n\s+\.app-shell\.jq-game \.arena-top:has\(\.fighter-card\.has-portrait\) \.fighter-card \{[^}]*flex-direction: column;/);
});

// ---- Pictures that cannot load (src/components/UnrealAthlete.jsx) ----

test('a head picture that cannot load leaves the chosen face as its base shows it, and a missing base leaves the published athlete', () => {
  const component = repoFile('src/components/UnrealAthlete.jsx').toString('utf8');
  assert.match(component, /const shown = !hasBody \? PUBLISHED_PICTURE : hasHead \? wanted : \{ \.\.\.wanted, key: wanted\.baseKey, head: null \};/);
  // the files are tried again twice, whichever file failed, and a pending try ends with the athlete
  assert.match(component, /const RETRY_DELAYS = \[4000, 15000\];/);
  assert.match(component, /const waiting = !arrived\.every\(Boolean\) && tries < RETRY_DELAYS\.length;/);
  assert.match(component, /if \(waiting\) timer = setTimeout\(\(\) => setRetry\(\{ id, count: tries \+ 1 \}\), RETRY_DELAYS\[tries\]\);/);
  // while a failed file is still to be tried again the stand-in shows another head than the pressed buttons,
  // so the athlete keeps its sign that it is working on it
  assert.match(component, /changing: decided\.id !== id \|\| decided\.waiting,/);
  // After a try that followed a failure every picture is a new element (one that failed keeps its broken picture
  // while its address is the same); a new choice alone never makes them anew.
  assert.match(component, /setDecided\(\(previous\) => \(\{ id, shown, waiting, attempt: tries > 0 \? previous\.attempt \+ 1 : previous\.attempt \}\)\);/);
  for (const key of ['key={`base-${attempt}`}', 'key={`head-${attempt}`}', 'key={`${name}-${attempt}`}']) assert.ok(component.includes(key), key);
  assert.match(component, /return \(\) => \{ mounted = false; clearTimeout\(timer\); \};/);
  // the first time an athlete shows, its own images are in the page; after that it stays shown
  assert.match(component, /const whole = Boolean\(shown\) && inPage\.base === picture\.base && \(!picture\.head \|\| inPage\.head === picture\.head\.url\);\r?\n\s+if \(whole && !revealed\) setRevealed\(true\);/);
  assert.match(component, /className=\{`unreal-athlete \$\{revealed \? 'is-ready' : ''\} \$\{changing \? 'is-changing' : ''\} \$\{className\}`/);
});

// ---- The build tool (tools/build_unreal_athlete_heads.mjs) ----

test('the build tool stops before it reads or writes anything when a flag has no value or a trial names no module', () => {
  const tool = fileURLToPath(new URL('../tools/build_unreal_athlete_heads.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
  // the pack named here does not exist: the tool must stop on the flags first
  const noValue = run('no-such-pack.json', '--public');
  assert.equal(noValue.status, 1);
  assert.match(noValue.stderr, /--public needs a value/);
  const flagAsValue = run('no-such-pack.json', '--module', '--debug', 'somewhere');
  assert.equal(flagAsValue.status, 1);
  assert.match(flagAsValue.stderr, /--module needs a value/);
  const trialWithoutModule = run('no-such-pack.json', '--public', 'somewhere');
  assert.equal(trialWithoutModule.status, 1);
  assert.match(trialWithoutModule.stderr, /--public needs --module too/);
  const source = repoFile('tools/build_unreal_athlete_heads.mjs').toString('utf8');
  // Nothing published is touched until every picture is built: pictures go to a folder beside the published one,
  // and the only removal of a published folder is the exchange at the end.
  assert.match(source, /const target = join\(publicDir, building\(folder\), name\);/);
  assert.equal(source.match(/rmSync\(/g).length, 2, 'the unfinished folders, and the exchange at the end');
  assert.ok(source.indexOf('const standingVariants = variantsOf(\'standing\');') < source.indexOf('discardUnfinished = () => { for (const scene of'), 'both lists are read before anything is written');
  assert.ok(source.indexOf('rmSync(target, { recursive: true, force: true });') > source.indexOf('// ---- the data module ----'), 'the exchange comes after every picture');
});
