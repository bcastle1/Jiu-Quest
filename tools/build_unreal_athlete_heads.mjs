// Builds the head pictures of the Unreal athlete: the faces, hairstyles, hair
// colours and beards a player can choose in the Fighter Creator
// (src/unreal/athleteHeadOptions.js), for the two pictures the athlete appears
// in: the front view of the Fighter Creator (src/unreal/athlete.js) and the
// standing position still (src/unreal/positionStills.js).
//
//   node tools/build_unreal_athlete_heads.mjs <heads.json>
//        [--public <folder>] [--module <file>] [--debug <folder>]
//
// heads.json lists Unreal renders with their size and SHA-256 (they are not in
// this repository: renders of licensed characters stay with the renderer). Every
// render is the published scene with another head on the same body: the same
// pose, camera, light and black gi, one render per choice. From them the tool
// writes, under public/assets/unreal-athlete/athlete-01/heads and
// public/assets/unreal-positions/standing/heads:
//
//   base-<face>.webp            the whole picture for a face that is not the published one
//                               (another skin shows on the hands, feet and chest too)
//   jacket-<face>.webp          that face's jacket layer: the published one, with the face's own
//                               gi light around its head (another neck shows other parts of the collar)
//   <face>-<hair>-<colour>-<beard>.webp
//                               a small picture with soft edges, laid over the head of
//                               that face's base picture: only where the render differs
//   thumb-<face>-<hair>.webp    the head, for the buttons of the Fighter Creator
//
// (in the standing still's folder the names begin with lead- or other-, the
// place of the athlete), and two modules: src/unreal/athleteHeads.data.js, the
// little the page needs (folders, sizes, where a head lies), and
// src/unreal/athleteHeads.pins.js, which pins every published file (size and
// SHA-256) and the hashes of the renders they came from, for the tests.
// --module names the first; it must end in .data.js, and the second is written
// beside it as .pins.js. --public names another folder to write the pictures
// under; a trial run names both, and the tool stops if --public comes alone.
//
// Nothing published is touched until every picture is built: the tool writes
// into a folder beside each published one and exchanges the two at the end, so
// a run that stops leaves the published pictures and both modules as they were.
//
// The gi layers stay the published ones. They are added on top of a base in the
// browser (see src/unreal/athlete.js), so a base must show the black gi exactly
// where the published base does. A head made for a bigger body keeps a little
// shoulder skin above the cloth; where a render shows anything but the reference
// render inside the gi, the reference render's pixels are used.
//
// sharp is not a dependency of this project: the tool loads the copy pnpm keeps
// in node_modules for the build tools, or a sharp that Node can resolve.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATHLETE_BEARDS, ATHLETE_FACES, ATHLETE_HAIRS, ATHLETE_HAIR_COLORS, DEFAULT_ATHLETE_HEAD, athleteFace, athleteHeadKey, athleteHeadKeys,
} from '../src/unreal/athleteHeadOptions.js';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Once the tool has begun to write, this removes what a stopped run has written so far.
let discardUnfinished = () => {};
const fail = (message) => { console.error(`build_unreal_athlete_heads: ${message}`); discardUnfinished(); process.exit(1); };

function loadSharp() {
  try { return require('sharp'); } catch { /* not resolvable by name: use pnpm's copy */ }
  const store = join(ROOT, 'node_modules', '.pnpm');
  const folder = existsSync(store) ? readdirSync(store).filter((name) => /^sharp@\d/.test(name)).sort().pop() : null;
  if (!folder) fail('sharp is not installed: run pnpm install, or install sharp where Node can find it');
  return require(join(store, folder, 'node_modules', 'sharp'));
}

// ---- what the site shows of each render ----
// front: the athlete inside the 2400 x 3000 render and the published size, as tools/build_unreal_athlete_layers.py.
// headBox is in published pixels; 14 render pixels are 9 published ones, so it is cut on multiples of 9.
export const SCENES = Object.freeze({
  front: Object.freeze({
    render: [2400, 3000], crop: [538, 166, 1400, 2738], size: [900, 1760],
    headBox: [261, 0, 324, 306], thumbBox: [306, 9, 234, 234], thumbSize: 128,
    folder: 'assets/unreal-athlete/athlete-01/heads',
  }),
  // standing: one render pixel per published pixel, as tools/build_unreal_position_layers.mjs.
  standing: Object.freeze({
    render: [2560, 1440], crop: [510, 255, 1620, 1080], size: [1620, 1080],
    headBoxes: Object.freeze({ lead: [500, 80, 250, 280], other: [880, 40, 250, 280] }),
    folder: 'assets/unreal-positions/standing/heads',
  }),
});
const SETTINGS = Object.freeze({
  giThreshold: 14,          // a pixel is gi where every channel brightens by more than this when the gi turns white
  pokeThreshold: 12,        // inside the gi a base may differ from the reference by this much before it is replaced
  clothCeiling: 56,         // the black gi of the reference render is darker than this in every channel; skin is not
  changeThreshold: 7,       // a head picture covers the pixels that differ from the face's base by more than this
  donorLimit: 0.01,         // share of a published head's pixels that may differ clearly from the same choice rendered with the variants
  grow: 6, feather: 3,      // pixels the covered region is grown by, and the width of its soft edge
  baseQuality: 90, headQuality: 88, thumbQuality: 82,
});

// ---- arguments ----
const args = process.argv.slice(2);
// A flag without its value stops the tool: read as absent, `--public` alone would write into the real folder.
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const value = args.splice(at, 2)[1];
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value`);
  return value;
};
const publicOption = option('--public'), moduleOption = option('--module');
const publicDir = resolve(publicOption ?? join(ROOT, 'public'));
const moduleFile = resolve(moduleOption ?? join(ROOT, 'src', 'unreal', 'athleteHeads.data.js'));
const debugDir = option('--debug');
if (!moduleFile.endsWith('.data.js')) fail('--module must name a file ending in .data.js (the pins are written beside it as .pins.js)');
// A trial run names both: pictures written to another folder must not be described by the page's own modules.
if (publicOption && !moduleOption) fail('--public needs --module too, or the trial would overwrite src/unreal/athleteHeads.data.js and .pins.js');
if (args.length !== 1) fail('usage: node tools/build_unreal_athlete_heads.mjs <heads.json> [--public <folder>] [--module <file>] [--debug <folder>]');
const packFile = resolve(args[0]);
if (!existsSync(packFile)) fail(`not found: ${packFile}`);
const pack = JSON.parse(readFileSync(packFile, 'utf8'));
const sharp = loadSharp();
sharp.cache(false);

// ---- renders ----
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const verified = new Map();
function checked(entry, what) {
  if (!entry?.file) fail(`heads.json lacks ${what}`);
  if (!verified.has(entry.file)) {
    if (!existsSync(entry.file)) fail(`${what}: file not found: ${entry.file}`);
    const data = readFileSync(entry.file);
    if (data.length !== entry.bytes || sha256(data) !== entry.sha256) fail(`${what}: ${entry.file} is not the render heads.json describes`);
    verified.set(entry.file, data);
  }
  return verified.get(entry.file);
}
// A region of a render as RGB bytes. box is [left, top, width, height] in render pixels.
async function region(entry, what, scene, box) {
  const image = sharp(checked(entry, what));
  const meta = await image.metadata();
  if (meta.width !== scene.render[0] || meta.height !== scene.render[1]) fail(`${what}: ${meta.width} x ${meta.height}, expected ${scene.render.join(' x ')}`);
  const [left, top, width, height] = box;
  const data = await image.removeAlpha().extract({ left, top, width, height }).raw().toBuffer();
  return { width, height, data };
}
const renderBox = (scene, [left, top, width, height]) => {
  const scale = scene.crop[2] / scene.size[0];
  const box = [scene.crop[0] + left * scale, scene.crop[1] + top * scale, width * scale, height * scale];
  if (box.some((value) => Math.abs(value - Math.round(value)) > 1e-6)) fail(`box ${[left, top, width, height]} does not fall on whole render pixels`);
  return box.map(Math.round);
};

// ---- masks ----
// Largest channel difference of two regions of the same size.
function difference(a, b) {
  const out = new Uint8Array(a.width * a.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 3) {
    out[i] = Math.max(Math.abs(a.data[p] - b.data[p]), Math.abs(a.data[p + 1] - b.data[p + 1]), Math.abs(a.data[p + 2] - b.data[p + 2]));
  }
  return out;
}
// For every pixel, how many set pixels lie in the square of the given radius around it (outside the picture counts as unset).
function counts(mask, width, height, radius) {
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += mask[y * width + x] ? 1 : 0;
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + row;
    }
  }
  const out = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
      out[y * width + x] = integral[bottom * (width + 1) + right] - integral[top * (width + 1) + right] - integral[bottom * (width + 1) + left] + integral[top * (width + 1) + left];
    }
  }
  return out;
}
const over = (values, limit) => Uint8Array.from(values, (value) => (value > limit ? 1 : 0));
// Three box blurs along each axis: close to a Gaussian of the given radius. Values are 0..1.
function blur(values, width, height, radius) {
  let current = Float32Array.from(values);
  const pass = (source, horizontal) => {
    const out = new Float32Array(source.length);
    const lines = horizontal ? height : width, length = horizontal ? width : height;
    for (let line = 0; line < lines; line += 1) {
      const at = (i) => source[horizontal ? line * width + i : i * width + line];
      let sum = 0;
      for (let i = -radius; i <= radius; i += 1) sum += at(Math.min(length - 1, Math.max(0, i)));
      for (let i = 0; i < length; i += 1) {
        out[horizontal ? line * width + i : i * width + line] = sum / (2 * radius + 1);
        sum += at(Math.min(length - 1, i + radius + 1)) - at(Math.max(0, i - radius));
      }
    }
    return out;
  };
  for (let i = 0; i < 3; i += 1) current = pass(pass(current, true), false);
  return current;
}
// The gi of the reference athlete: where every channel brightens clearly when the gi turns white.
function giMask(white, black) {
  const width = white.width, height = white.height;
  const raw = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < raw.length; i += 1, p += 3) {
    const delta = Math.min(white.data[p] - black.data[p], white.data[p + 1] - black.data[p + 1], white.data[p + 2] - black.data[p + 2]);
    raw[i] = delta > SETTINGS.giThreshold ? 1 : 0;
  }
  // a majority vote over 7 x 7 removes specks, then the region grows by two pixels
  const voted = Uint8Array.from(counts(raw, width, height, 3), (count) => (count > 24 ? 1 : 0));
  return over(counts(voted, width, height, 2), 0);
}
// Where a base render shows something other than the gi inside the reference athlete's gi (a head made for a
// bigger body keeps a little shoulder skin above the cloth): per pixel, how much of the reference render to take.
function pokeWeights(render, reference, gi) {
  const width = render.width, height = render.height;
  const delta = difference(render, reference);
  // only well inside the gi: its edge belongs to the render (the skin beside it has this face's colour)
  const inside = Uint8Array.from(counts(gi, width, height, 2), (count) => (count === 25 ? 1 : 0));
  const poke = new Uint8Array(width * height);
  let poked = 0;
  for (let i = 0, p = 0; i < poke.length; i += 1, p += 3) {
    // Cloth only. Skin under the chin also brightens when the gi turns white (the gi lights it), so it is in the
    // gi mask; in the black-gi reference it is skin-bright, where the cloth is nearly black.
    const cloth = Math.max(reference.data[p], reference.data[p + 1], reference.data[p + 2]) < SETTINGS.clothCeiling;
    if (inside[i] && cloth && delta[i] > SETTINGS.pokeThreshold) { poke[i] = 1; poked += 1; }
  }
  const grown = over(counts(poke, width, height, 3), 0);
  for (let i = 0; i < grown.length; i += 1) grown[i] = grown[i] && gi[i] ? 1 : 0;
  const weights = blur(grown, width, height, 1);
  for (let i = 0; i < weights.length; i += 1) weights[i] = Math.min(1, weights[i] * 1.6);
  return { weights, poked };
}
// A render with the reference render's pixels where the weights say so. The black-gi and the white-gi render of a
// face take the same weights, so that the gi light between them stays the gi's.
function patched(render, reference, weights) {
  const data = Buffer.alloc(render.data.length);
  for (let i = 0, p = 0; i < weights.length; i += 1, p += 3) {
    const w = weights[i];
    for (let c = 0; c < 3; c += 1) data[p + c] = Math.round(render.data[p + c] * (1 - w) + reference.data[p + c] * w);
  }
  return { width: render.width, height: render.height, data };
}
// The part of an image inside a box given in the image's own pixels.
function cut(image, [left, top, width, height]) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) image.data.copy(data, y * width * 3, ((top + y) * image.width + left) * 3, ((top + y) * image.width + left + width) * 3);
  return { width, height, data };
}
// The light a white gi adds to a black one, inside the gi only (the jacket layer of the page, see src/unreal/athlete.js).
function giLight(white, black) {
  const width = white.width, height = white.height;
  const soft = blur(giMask(white, black), width, height, 2);
  const data = Buffer.alloc(white.data.length);
  for (let i = 0, p = 0; i < soft.length; i += 1, p += 3) {
    const m = Math.min(1, soft[i] * 1.15);
    for (let c = 0; c < 3; c += 1) data[p + c] = Math.round(Math.max(0, white.data[p + c] - black.data[p + c]) * m);
  }
  return { width, height, data };
}
// A published jacket layer with the head box replaced by another face's own gi light: beside another neck the collar
// shows where the first athlete's neck was, and the other way round. `piece` has the size of the box; it fades into
// the published layer over a few pixels at the box's edge, where the two agree (the same gi on the same body).
async function jacketWith(publishedFile, piece, [left, top, width, height]) {
  const { data, info } = await sharp(readFileSync(publishedFile)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (piece.width !== width || piece.height !== height) fail('a jacket piece does not have the size of its box');
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // 0 at the box's edge, 1 from eight pixels in; the picture's own edge needs no fade
      const edge = Math.min(left === 0 ? Infinity : x, top === 0 ? Infinity : y, left + width === info.width ? Infinity : width - 1 - x, top + height === info.height ? Infinity : height - 1 - y);
      const f = Math.min(1, edge / 8);
      const at = ((top + y) * info.width + left + x) * 3, from = (y * width + x) * 3;
      for (let c = 0; c < 3; c += 1) data[at + c] = Math.round(data[at + c] * (1 - f) + piece.data[from + c] * f);
    }
  }
  return { width: info.width, height: info.height, data };
}
// The picture laid over a head: the render where it differs from the base, with a soft edge. Null when nothing differs.
function headPicture(render, base) {
  const width = render.width, height = render.height;
  const changed = over(difference(render, base), SETTINGS.changeThreshold);
  // a changed pixel counts when at least two of its eight neighbours changed too (single noisy pixels do not)
  const steady = Uint8Array.from(counts(changed, width, height, 1), (count, i) => (changed[i] && count >= 3 ? 1 : 0));
  const total = steady.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  const grown = over(counts(steady, width, height, SETTINGS.grow), 0);
  const soft = blur(grown, width, height, SETTINGS.feather);
  const data = Buffer.alloc(width * height * 4);
  let touchesEdge = 0, covered = 0;
  for (let i = 0; i < soft.length; i += 1) {
    const x = i % width, y = (i - x) / width;
    // nothing may reach the edge of the box: the picture ends there
    const margin = Math.min(x, y, width - 1 - x, height - 1 - y);
    let alpha = Math.min(1, Math.max(0, (soft[i] - 0.08) / 0.84));
    if (alpha > 0.5 && margin < 2) touchesEdge += 1;
    alpha *= Math.min(1, margin / 4);
    const a = Math.round(alpha * 255);
    if (a === 0) continue;
    covered += 1;
    data[i * 4] = render.data[i * 3];
    data[i * 4 + 1] = render.data[i * 3 + 1];
    data[i * 4 + 2] = render.data[i * 3 + 2];
    data[i * 4 + 3] = a;
  }
  return { width, height, data, changed: total, covered, touchesEdge };
}

// ---- output ----
// Nothing published is touched until every picture is built. The tool writes into a folder beside each published
// one and exchanges the two at the end, so a run that stops (a pack it refuses, a render that does not fit) leaves
// the published pictures and both modules exactly as they were.
const building = (folder) => `${folder}.building`;
const written = [];
async function publish(folder, name, pipeline, options) {
  const data = await pipeline.webp({ effort: 6, ...options }).toBuffer();
  const target = join(publicDir, building(folder), name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  written.push(`${folder}/${name}`);
  return { url: `/${folder}/${name}`, bytes: data.length, sha256: sha256(data) };
}
const rgb = (image) => sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } });
const rgba = (image) => sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } });
const fileKey = (key) => key.replaceAll('/', '-');
async function debug(name, image, channels = 3) {
  if (!debugDir) return;
  mkdirSync(debugDir, { recursive: true });
  await sharp(image.data, { raw: { width: image.width, height: image.height, channels } }).png().toFile(join(debugDir, name));
}

// ---- the plan: which render is which ----
const KEYS = athleteHeadKeys();
const keyOfEntry = (entry) => athleteHeadKey({ face: entry.face, hair: entry.hair, hairColor: entry.hairColor, beard: entry.beard });
function variantsOf(sceneName) {
  const map = new Map();
  // Every choice has a render of its own: one render standing in for a second choice would publish a wrong head.
  const renders = new Map();
  for (const entry of pack[sceneName]?.variants ?? []) {
    const key = keyOfEntry(entry);
    if (!KEYS.includes(key)) fail(`${sceneName}: heads.json has a render for the unknown choice ${key}`);
    if (map.has(key)) fail(`${sceneName}: heads.json has two renders for ${key}`);
    for (const id of [entry.file, entry.sha256]) {
      if (renders.has(id)) fail(`${sceneName}: ${key} and ${renders.get(id)} name the same render`);
      renders.set(id, key);
    }
    map.set(key, entry);
  }
  const missing = KEYS.filter((key) => !map.has(key));
  if (missing.length) fail(`${sceneName}: heads.json has no render for ${missing.length} choice(s): ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}`);
  return map;
}
const baseKey = (face) => athleteHeadKey({ face: face.id, ...face.base });
// The head pictures of the published face are laid over the published base, so the variants must have been rendered
// as that base was: the variant of the published choice has to match the reference render of the same scene. A
// camera or exposure that drifted between the runs would lay every head displaced or off-tone.
function sameHead(variantHead, referenceHead, what) {
  const delta = difference(variantHead, referenceHead);
  const over12 = delta.reduce((count, value) => count + (value > 12 ? 1 : 0), 0);
  if (over12 > delta.length * SETTINGS.donorLimit) fail(`${what}: the variant of the published head differs from the reference render in ${over12} of ${delta.length} pixels: not rendered as the published scene`);
  return { over12, pixels: delta.length };
}
const published = ATHLETE_FACES[0];
if (baseKey(published) !== athleteHeadKey(DEFAULT_ATHLETE_HEAD)) fail('the first face must be the published athlete');
const report = { front: {}, standing: {} };
// Both lists are read before anything is written: a choice without a render stops the tool at once.
const frontVariants = variantsOf('front');
const standingVariants = variantsOf('standing');

discardUnfinished = () => { for (const scene of Object.values(SCENES)) rmSync(join(publicDir, building(scene.folder)), { recursive: true, force: true }); };
discardUnfinished();   // what an earlier run that stopped may have left

// ---- the Fighter Creator athlete ----
const front = SCENES.front;
const frontData = { headBox: front.headBox, bases: {}, jackets: {}, heads: {}, thumbs: {} };
{
  const reference = pack.front.reference;
  const black = await region(reference.black, 'front reference (black gi)', front, front.crop);
  const white = await region(reference.white, 'front reference (white gi)', front, front.crop);
  const gi = giMask(white, black);
  const headRender = renderBox(front, front.headBox);
  const thumbRender = renderBox(front, front.thumbBox);
  const resize = (pipeline, [width, height]) => pipeline.resize(width, height, { kernel: 'lanczos3', fit: 'fill' });
  // How close this renderer's reference comes to the published base: the published layers are added to bases made from it.
  const publishedBase = await sharp(readFileSync(join(ROOT, 'public', 'assets', 'unreal-athlete', 'athlete-01', 'front-base.webp'))).removeAlpha().raw().toBuffer();
  const referenceSmall = await resize(rgb(black), front.size).raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < publishedBase.length; i += 1) sum += Math.abs(publishedBase[i] - referenceSmall[i]);
  report.front.referenceAgainstPublishedBase = +(sum / publishedBase.length).toFixed(3);
  if (report.front.referenceAgainstPublishedBase > 1.5) fail(`front: the reference render differs from the published base by ${report.front.referenceAgainstPublishedBase} of 255 on average: not the published scene`);

  for (const face of ATHLETE_FACES) {
    const baseEntry = frontVariants.get(baseKey(face));
    const baseHead = await region(baseEntry, `front ${baseKey(face)}`, front, headRender);
    if (face.id === published.id) {
      // The published base stays. Its head must be what this renderer gives for the same choice.
      const referenceHead = await region(reference.black, 'front reference (black gi)', front, headRender);
      report.front.publishedHeadAgainstDonor = sameHead(baseHead, referenceHead, 'front');
    } else {
      const whole = await region(baseEntry, `front ${baseKey(face)}`, front, front.crop);
      const wholeWhite = await region(pack.front.white?.[face.id], `front ${face.id} in a white gi`, front, front.crop);
      const { weights, poked } = pokeWeights(whole, black, gi);
      const baseImage = patched(whole, black, weights);
      await debug(`front-base-${face.id}.png`, baseImage);
      frontData.bases[face.id] = await publish(front.folder, `base-${face.id}.webp`, resize(rgb(baseImage), front.size), { quality: SETTINGS.baseQuality });
      // The jacket layer of this face: the published one, with this face's own gi light around its head.
      const cropBox = [headRender[0] - front.crop[0], headRender[1] - front.crop[1], headRender[2], headRender[3]];
      const light = giLight(cut(patched(wholeWhite, white, weights), cropBox), cut(baseImage, cropBox));
      const piece = await resize(rgb(light), [front.headBox[2], front.headBox[3]]).raw().toBuffer();
      const jacket = await jacketWith(join(ROOT, 'public', 'assets', 'unreal-athlete', 'athlete-01', 'front-jacket.webp'), { width: front.headBox[2], height: front.headBox[3], data: piece }, front.headBox);
      await debug(`front-jacket-${face.id}.png`, jacket);
      frontData.jackets[face.id] = await publish(front.folder, `jacket-${face.id}.webp`, rgb(jacket), { quality: SETTINGS.headQuality });
      report.front[`base-${face.id}`] = { pixelsTakenFromReference: poked };
    }
    for (const key of KEYS.filter((candidate) => candidate.startsWith(`${face.id}/`))) {
      const entry = frontVariants.get(key);
      const [, hair, hairColor, beard] = key.split('/');
      if (hairColor === 'black' && beard === 'none') {
        const thumb = await region(entry, `front ${key}`, front, thumbRender);
        frontData.thumbs[`${face.id}/${hair}`] = await publish(front.folder, `thumb-${face.id}-${hair}.webp`, resize(rgb(thumb), [front.thumbSize, front.thumbSize]), { quality: SETTINGS.thumbQuality });
      }
      if (key === baseKey(face)) continue;
      const picture = headPicture(await region(entry, `front ${key}`, front, headRender), baseHead);
      if (!picture) fail(`front: ${key} shows nothing the base of ${face.id} does not`);
      if (picture.touchesEdge) fail(`front: the head of ${key} reaches the edge of its box (${picture.touchesEdge} pixels): widen headBox`);
      await debug(`front-${fileKey(key)}.png`, picture, 4);
      frontData.heads[key] = await publish(front.folder, `${fileKey(key)}.webp`, resize(rgba(picture), [front.headBox[2], front.headBox[3]]), { quality: SETTINGS.headQuality, alphaQuality: 92 });
    }
  }
}

// ---- the standing position still ----
const standing = SCENES.standing;
const standingData = { lead: { headBox: standing.headBoxes.lead, bases: {}, jackets: {}, heads: {} }, other: { headBox: standing.headBoxes.other, bases: {}, jackets: {}, heads: {} } };
{
  const reference = pack.standing.reference;
  const base = await region(reference.base, 'standing reference (base)', standing, standing.crop);
  const leadWhite = await region(reference.leadGiWhite, 'standing reference (lead gi white)', standing, standing.crop);
  const otherWhite = await region(reference.otherGiWhite, 'standing reference (other gi white)', standing, standing.crop);
  const leadGi = giMask(leadWhite, base), otherGi = giMask(otherWhite, base);
  const gi = Uint8Array.from(leadGi, (value, i) => (value || otherGi[i] ? 1 : 0));
  const publishedBase = await sharp(readFileSync(join(ROOT, 'public', 'assets', 'unreal-positions', 'standing', 'base.webp'))).removeAlpha().raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < publishedBase.length; i += 1) sum += Math.abs(publishedBase[i] - base.data[i]);
  report.standing.referenceAgainstPublishedBase = +(sum / publishedBase.length).toFixed(3);
  if (report.standing.referenceAgainstPublishedBase > 1.5) fail(`standing: the reference render differs from the published base by ${report.standing.referenceAgainstPublishedBase} of 255 on average: not the published scene`);

  for (const role of ['lead', 'other']) {
    const headRender = renderBox(standing, standing.headBoxes[role]);
    for (const face of ATHLETE_FACES) {
      const baseEntry = standingVariants.get(baseKey(face));
      const baseHead = await region(baseEntry, `standing ${baseKey(face)}`, standing, headRender);
      if (face.id === published.id) {
        const referenceHead = await region(reference.base, 'standing reference (base)', standing, headRender);
        report.standing[`publishedHeadAgainstDonor-${role}`] = sameHead(baseHead, referenceHead, `standing (${role})`);
      } else {
        // The whole picture with this face on one athlete and the published face on the other.
        const mixed = pack.standing.mixed?.[face.id]?.[role];
        const whole = await region(mixed, `standing mixed ${face.id} ${role}`, standing, standing.crop);
        // the same picture with that athlete's gi white, for the jacket layer beside this face's neck
        const wholeWhite = await region(pack.standing.mixedWhite?.[face.id]?.[role], `standing mixed ${face.id} ${role} in a white gi`, standing, standing.crop);
        const { weights, poked } = pokeWeights(whole, base, gi);
        const baseImage = patched(whole, base, weights);
        await debug(`standing-${role}-base-${face.id}.png`, baseImage);
        standingData[role].bases[face.id] = await publish(standing.folder, `${role}-base-${face.id}.webp`, rgb(baseImage), { quality: SETTINGS.baseQuality });
        const light = giLight(cut(patched(wholeWhite, role === 'lead' ? leadWhite : otherWhite, weights), standing.headBoxes[role]), cut(baseImage, standing.headBoxes[role]));
        const jacket = await jacketWith(join(ROOT, 'public', 'assets', 'unreal-positions', 'standing', `${role}-jacket.webp`), light, standing.headBoxes[role]);
        await debug(`standing-${role}-jacket-${face.id}.png`, jacket);
        standingData[role].jackets[face.id] = await publish(standing.folder, `${role}-jacket-${face.id}.webp`, rgb(jacket), { quality: SETTINGS.headQuality });
        report.standing[`${role}-base-${face.id}`] = { pixelsTakenFromReference: poked };
      }
      for (const key of KEYS.filter((candidate) => candidate.startsWith(`${face.id}/`))) {
        if (key === baseKey(face)) continue;
        const picture = headPicture(await region(standingVariants.get(key), `standing ${key}`, standing, headRender), baseHead);
        if (!picture) fail(`standing: ${key} shows nothing the base of ${face.id} does not (${role})`);
        if (picture.touchesEdge) fail(`standing: the ${role} head of ${key} reaches the edge of its box (${picture.touchesEdge} pixels): widen headBoxes.${role}`);
        await debug(`standing-${role}-${fileKey(key)}.png`, picture, 4);
        standingData[role].heads[key] = await publish(standing.folder, `${role}-${fileKey(key)}.webp`, rgba(picture), { quality: SETTINGS.headQuality, alphaQuality: 92 });
      }
    }
  }
}

// ---- the data module ----
const sources = {};
for (const sceneName of ['front', 'standing']) {
  const rows = {};
  for (const [name, entry] of Object.entries(pack[sceneName].reference)) rows[`reference/${name}`] = entry.sha256;
  for (const [face, roles] of Object.entries(pack[sceneName].mixed ?? {})) for (const [role, entry] of Object.entries(roles)) rows[`mixed/${face}/${role}`] = entry.sha256;
  for (const [face, entry] of Object.entries(pack[sceneName].white ?? {})) rows[`white/${face}`] = entry.sha256;
  for (const [face, roles] of Object.entries(pack[sceneName].mixedWhite ?? {})) for (const [role, entry] of Object.entries(roles)) rows[`mixed-white/${face}/${role}`] = entry.sha256;
  for (const key of KEYS) rows[key] = (sceneName === 'front' ? frontVariants : standingVariants).get(key).sha256;
  sources[sceneName] = rows;
}
const literal = (value, indent = '') => {
  if (Array.isArray(value)) return `Object.freeze([${value.map((item) => literal(item, indent)).join(', ')}])`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const simple = keys.every((key) => value[key] === null || typeof value[key] !== 'object' || Array.isArray(value[key])) && keys.length <= 4;
    const name = (key) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`);
    if (simple) return `Object.freeze({ ${keys.map((key) => `${name(key)}: ${literal(value[key], indent)}`).join(', ')} })`;
    return `Object.freeze({\n${keys.map((key) => `${indent}  ${name(key)}: ${literal(value[key], `${indent}  `)},`).join('\n')}\n${indent}})`;
  }
  return typeof value === 'string' ? `'${value}'` : String(value);
};
// The page needs little: where the pictures are and how large. A picture's name follows from its choice
// (src/unreal/athleteHeads.js), so the page carries no list of files.
const data = {
  renderer: pack.renderer ?? 'Unreal Engine',
  // faces with a base picture of their own, in both scenes
  baseFaces: Object.keys(frontData.bases),
  athlete: { width: front.size[0], height: front.size[1], folder: `/${front.folder}`, headBox: front.headBox, thumbSize: front.thumbSize },
  standing: { width: standing.size[0], height: standing.size[1], folder: `/${standing.folder}`, lead: { headBox: standing.headBoxes.lead }, other: { headBox: standing.headBoxes.other } },
};
const moduleText = `// Written by tools/build_unreal_athlete_heads.mjs from Unreal renders. Do not edit by hand.
// Where the head pictures of the Unreal athlete are published and how large they are.
// src/unreal/athleteHeads.js names each picture; athleteHeads.pins.js pins every file.
export default ${literal(data)};
`;
// Every picture is built. Exchange each published folder for the one just written, then write the two modules
// that describe them. (A copy, not a rename: a dev server watching the public folder can hold a folder open.)
for (const scene of Object.values(SCENES)) {
  const target = join(publicDir, scene.folder);
  rmSync(target, { recursive: true, force: true });
  cpSync(join(publicDir, building(scene.folder)), target, { recursive: true });
}
discardUnfinished();
discardUnfinished = () => {};
mkdirSync(dirname(moduleFile), { recursive: true });
writeFileSync(moduleFile, moduleText);
// Every published file with its size and SHA-256, and the hashes of the renders they were made from.
// Read by the tests, never by the page: hundreds of hashes would only make the page's script larger.
const pinned = {};
for (const rows of [frontData.bases, frontData.jackets, frontData.heads, frontData.thumbs, standingData.lead.bases, standingData.lead.jackets, standingData.lead.heads, standingData.other.bases, standingData.other.jackets, standingData.other.heads]) {
  for (const file of Object.values(rows)) pinned[file.url] = { bytes: file.bytes, sha256: file.sha256 };
}
const pinsText = `// Written by tools/build_unreal_athlete_heads.mjs from Unreal renders. Do not edit by hand.
// Every published head picture with its size and SHA-256, and the hashes of the
// renders they were made from. tests/unrealAthleteHeads.test.js checks the files.
// The page never imports this module.
export default ${literal({ files: pinned, sources })};
`;
writeFileSync(moduleFile.replace(/\.data\.js$/, '.pins.js'), pinsText);

const bytes = (rows) => Object.values(rows).reduce((sum, row) => sum + row.bytes, 0);
report.files = written.length;
report.front.bytes = { bases: bytes(frontData.bases), jackets: bytes(frontData.jackets), heads: bytes(frontData.heads), thumbs: bytes(frontData.thumbs) };
report.standing.bytes = { bases: bytes(standingData.lead.bases) + bytes(standingData.other.bases), jackets: bytes(standingData.lead.jackets) + bytes(standingData.other.jackets), heads: bytes(standingData.lead.heads) + bytes(standingData.other.heads) };
report.choices = { faces: ATHLETE_FACES.length, hairs: ATHLETE_HAIRS.length, hairColors: ATHLETE_HAIR_COLORS.length, beards: ATHLETE_BEARDS.length, pictures: KEYS.length, base: Object.fromEntries(ATHLETE_FACES.map((face) => [face.id, baseKey(athleteFace(face.id))])) };
console.log(JSON.stringify(report, null, 2));
