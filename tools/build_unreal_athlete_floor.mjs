// Builds the tatami floor of the Unreal athlete's stage (the Fighter Creator
// and the rank path).
//
// The floor is the "Japanese Tatami Mats" surface the owner bought on Fab
// (Quixel Megascans, id tlvheccfw): a scan of two mats, 2 m by 2 m. This tool
// lays that surface on the ground the athlete stands on and renders it as the
// athlete's camera sees it, under one lamp, with the shadows of his feet. Only
// that rendered picture is published. The surface's own maps stay with the
// owner and are never in this repository.
//
// It writes
//   public/assets/unreal-athlete/athlete-01/floor/tatami.webp
//     the lit floor on black, covering the lowest FLOOR.rows of the athlete's
//     1760 rows and wide enough for the widest stage. The page adds it to the
//     black stage, so black means "no light".
//   public/assets/unreal-athlete/athlete-01/floor/front-silhouette.webp
//     where the athlete is: opaque inside his outline, clear outside. It comes
//     from the published layers, whose sum with every color white is the
//     white-gi render. The page cuts the floor out there, so the mat lies
//     behind him whatever gi he wears.
//   src/unreal/athleteFloor.data.js, which pins both files.
//
// Usage:
//   node tools/build_unreal_athlete_floor.mjs --base <BaseColor image> --normal <Normal image> --ffmpeg <ffmpeg bin dir> [--out <dir>]
//
// The two images are the surface's BaseColor and Normal maps, at any size.
// Needs ffmpeg and ffprobe (with libwebp) in the given folder. Node only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UNREAL_ATHLETE } from '../src/unreal/athlete.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOLDER = 'public/assets/unreal-athlete/athlete-01/floor';
const DATA = 'src/unreal/athleteFloor.data.js';
const PICTURE = Object.freeze({ width: UNREAL_ATHLETE.width, height: UNREAL_ATHLETE.height });

// Everything below is in pixels of the athlete's 900 by 1760 picture and in
// metres on the ground: x to the right, z away from the camera.
export const FLOOR = Object.freeze({
  // The floor picture: this wide, centred on the athlete's picture, and this
  // many rows up from its bottom edge.
  width: 2600,
  rows: 740,
  // The camera of the athlete's render. Unreal's own numbers are not in the
  // pack, so these are read off the picture: the athlete is 1.75 m from the
  // crown (row 39) to the toes of the front foot (row 1724), the front foot's
  // toes and the rear foot's sole stand 0.40 m apart in depth (rows 1724 and
  // 1612), and the camera is level at chest height. A point on the ground at
  // (x, z) shows at column centerX + focal * x / z and row horizonY + focal * height / z.
  camera: Object.freeze({ centerX: 450, horizonY: 609, focal: 3661, height: 1.1 }),
  // The scan is 2 m by 2 m: two mats side by side, each 1 m by 2 m with its
  // cloth border. The athlete stands in the middle of a mat, and the seam
  // between two rows of mats runs 5 m from the camera, behind him.
  tile: Object.freeze({ metres: 2, matCentreAtX: 0, seamAtZ: 5 }),
  // One lamp above the athlete: how far its pool reaches on the ground, how
  // bright it is, and its warm color. The lamp itself hangs a little toward
  // the camera, which is what the weave's relief is lit from.
  lamp: Object.freeze({ x: -0.05, z: 3.85, reachX: 1.0, reachZ: 1.4, power: 0.6, color: Object.freeze([1, 0.93, 0.82]), at: Object.freeze([0.4, 3.2, 2.9]) }),
  // Where the athlete darkens the mat: the front foot, the rear foot turned
  // outward, and the soft shade under the body.
  shadows: Object.freeze([
    Object.freeze({ x: 0.165, z: 3.77, reachX: 0.085, reachZ: 0.16, dark: 0.85 }),
    Object.freeze({ x: -0.265, z: 4.03, reachX: 0.14, reachZ: 0.07, dark: 0.82 }),
    Object.freeze({ x: -0.07, z: 4.0, reachX: 0.45, reachZ: 0.36, dark: 0.42 }),
  ]),
});

// The share of the athlete's height the floor picture covers, as the page
// needs it: a CSS percentage.
export const floorHeightShare = (floor = FLOOR) => `${Math.round((floor.rows / PICTURE.height) * 100000) / 1000}%`;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const tool = (ffbin, name) => path.join(ffbin, process.platform === 'win32' ? `${name}.exe` : name);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smooth = (edge0, edge1, value) => { const t = clamp((value - edge0) / (edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); };
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const linearToSrgb = (c) => Math.round(255 * clamp(c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055, 0, 1));

// An image file as RGB bytes.
function readRgb(ffbin, file) {
  const [width, height] = execFileSync(tool(ffbin, 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
  const data = execFileSync(tool(ffbin, 'ffmpeg'), ['-loglevel', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 29 });
  if (data.length !== width * height * 3) throw new Error(`${file}: expected ${width} x ${height} RGB bytes, read ${data.length}`);
  return { width, height, data };
}

// The image and its halvings, as numbers the renderer can blend: far ground
// reads from a smaller level, so the weave does not shimmer into a pattern.
function levelsOf(image, convert) {
  let level = { w: image.width, h: image.height, data: Float32Array.from(image.data, convert) };
  const levels = [level];
  while (level.w >= 8 && level.h >= 8) {
    const w = level.w >> 1, h = level.h >> 1, data = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      const at = (yy, xx) => level.data[((y * 2 + yy) * level.w + x * 2 + xx) * 3 + c];
      data[(y * w + x) * 3 + c] = (at(0, 0) + at(0, 1) + at(1, 0) + at(1, 1)) / 4;
    }
    level = { w, h, data };
    levels.push(level);
  }
  return levels;
}

// One level of the tiled image at (u, v), blended from its four neighbours.
function bilinear(level, u, v, out) {
  const { w, h, data } = level;
  const x = (u - Math.floor(u)) * w - 0.5, y = (v - Math.floor(v)) * h - 0.5;
  const xf = Math.floor(x), yf = Math.floor(y), fx = x - xf, fy = y - yf;
  const xa = (xf + w) % w, xb = (xa + 1) % w, ya = (yf + h) % h, yb = (ya + 1) % h;
  for (let c = 0; c < 3; c++) {
    out[c] = (data[(ya * w + xa) * 3 + c] * (1 - fx) + data[(ya * w + xb) * 3 + c] * fx) * (1 - fy)
      + (data[(yb * w + xa) * 3 + c] * (1 - fx) + data[(yb * w + xb) * 3 + c] * fx) * fy;
  }
}

const near = [0, 0, 0], far = [0, 0, 0];
function sample(levels, u, v, lod, out) {
  const last = levels.length - 1, low = Math.min(last, Math.floor(lod)), t = low === last ? 0 : lod - low;
  bilinear(levels[low], u, v, near);
  if (t === 0) { out[0] = near[0]; out[1] = near[1]; out[2] = near[2]; return; }
  bilinear(levels[low + 1], u, v, far);
  for (let c = 0; c < 3; c++) out[c] = near[c] * (1 - t) + far[c] * t;
}

const bell = (dx, reachX, dz, reachZ) => Math.exp(-0.5 * ((dx / reachX) ** 2 + (dz / reachZ) ** 2));

// The floor as the athlete's camera sees it: RGB bytes, FLOOR.width by FLOOR.rows.
export function renderFloor(baseColor, normalMap, floor = FLOOR) {
  const { width: W, rows: R, camera, tile, lamp, shadows } = floor;
  const { centerX, horizonY, focal, height: cameraHeight } = camera;
  const base = levelsOf(baseColor, (value) => SRGB_TO_LINEAR[value]);
  const relief = levelsOf(normalMap, (value) => (value / 255) * 2 - 1);
  const texelsPerMetre = baseColor.width / tile.metres;
  const left = centerX - W / 2, top = PICTURE.height - R;
  const out = Buffer.alloc(W * R * 3);
  const color = [0, 0, 0], bump = [0, 0, 0];
  const light = (x, z) => lamp.power * bell(x - lamp.x, lamp.reachX, z - lamp.z, lamp.reachZ);
  const ACROSS = 4;
  for (let row = 0; row < R; row++) {
    const zRow = (focal * cameraHeight) / (top + row + 0.5 - horizonY);
    // One pixel covers this many texels across and in depth. Depth is the
    // long one, so it gets more samples, and what is left over picks the level.
    const across = (zRow / focal) * texelsPerMetre, deep = ((zRow * zRow) / (focal * cameraHeight)) * texelsPerMetre;
    const DEEP = clamp(Math.ceil(deep), 4, 16);
    const lod = Math.max(0, Math.log2(Math.max(across / ACROSS, deep / DEEP)));
    // The top rows fade out, so the picture has no upper edge.
    const rowFade = smooth(0, 0.14 * R, row);
    for (let column = 0; column < W; column++) {
      // The picture's sides fade out too: a stage wider than it sees no edge.
      const fade = rowFade * smooth(0, 0.16 * W, column + 0.5) * smooth(0, 0.16 * W, W - column - 0.5);
      const xMid = ((left + column + 0.5 - centerX) * zRow) / focal;
      if (fade * light(xMid, zRow) < 0.0015) continue;
      let red = 0, green = 0, blue = 0;
      for (let sy = 0; sy < DEEP; sy++) {
        const z = (focal * cameraHeight) / (top + row + (sy + 0.5) / DEEP - horizonY);
        for (let sx = 0; sx < ACROSS; sx++) {
          const x = ((left + column + (sx + 0.5) / ACROSS - centerX) * z) / focal;
          const u = (x - tile.matCentreAtX) / tile.metres + 0.25, v = (z - tile.seamAtZ) / tile.metres;
          sample(base, u, v, lod, color);
          sample(relief, u, v, lod, bump);
          // The weave's relief, lit from the lamp: brighter where a straw
          // faces it than where the ground lies flat.
          let lx = lamp.at[0] - x, ly = lamp.at[1], lz = lamp.at[2] - z;
          const lampDistance = Math.hypot(lx, ly, lz); lx /= lampDistance; ly /= lampDistance; lz /= lampDistance;
          let nx = bump[0], ny = Math.max(0.05, bump[2]), nz = bump[1];
          const normalLength = Math.hypot(nx, ny, nz); nx /= normalLength; ny /= normalLength; nz /= normalLength;
          const facing = clamp(Math.max(0, nx * lx + ny * ly + nz * lz) / Math.max(0.2, ly), 0.35, 1.8);
          // A faint sheen where the straw mirrors the lamp toward the camera.
          const viewDistance = Math.hypot(x, cameraHeight, z);
          const hx = lx - x / viewDistance, hy = ly + cameraHeight / viewDistance, hz = lz - z / viewDistance;
          const halfLength = Math.hypot(hx, hy, hz);
          const sheen = 0.05 * Math.max(0, (nx * hx + ny * hy + nz * hz) / halfLength) ** 40;
          let lit = light(x, z);
          for (const shadow of shadows) lit *= 1 - shadow.dark * bell(x - shadow.x, shadow.reachX, z - shadow.z, shadow.reachZ);
          red += lit * (color[0] * facing + sheen) * lamp.color[0];
          green += lit * (color[1] * facing + sheen) * lamp.color[1];
          blue += lit * (color[2] * facing + sheen) * lamp.color[2];
        }
      }
      const scale = fade / (ACROSS * DEEP), at = (row * W + column) * 3;
      out[at] = linearToSrgb(red * scale); out[at + 1] = linearToSrgb(green * scale); out[at + 2] = linearToSrgb(blue * scale);
    }
  }
  return out;
}

// Where the athlete is in his 900 by 1760 picture: 255 inside his outline,
// 0 outside, soft over one pixel. `layers` are the four published layers as RGB.
export function athleteSilhouette(layers) {
  const { width: W, height: H } = PICTURE;
  const lit = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    let brightest = 0;
    for (let c = 0; c < 3; c++) brightest = Math.max(brightest, layers.reduce((sum, layer) => sum + layer.data[i * 3 + c], 0));
    lit[i] = brightest > 12 ? 1 : 0;
  }
  // Dark creases inside the outline (between the toes, under a hem) are part
  // of the athlete: grow the lit area by a few pixels, then shrink it back.
  const spread = (source, grow) => {
    const REACH = 6, pass = (from, horizontal) => {
      const to = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let value = grow ? 0 : 1;
        for (let d = -REACH; d <= REACH && value === (grow ? 0 : 1); d++) {
          const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d;
          const inside = xx >= 0 && xx < W && yy >= 0 && yy < H ? from[yy * W + xx] : 0;
          if (grow ? inside : !inside) value = grow ? 1 : 0;
        }
        to[y * W + x] = value;
      }
      return to;
    };
    return pass(pass(source, true), false);
  };
  const closed = spread(spread(lit, true), false);
  // Soft over one pixel: the page scales the outline and the athlete
  // separately, and neither a hairline of mat nor a dark rim should show on
  // his edge.
  const alpha = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += closed[clamp(y + dy, 0, H - 1) * W + clamp(x + dx, 0, W - 1)];
    alpha[y * W + x] = Math.round((255 * sum) / 9);
  }
  return alpha;
}

const encode = (ffbin, input, size, format, options, file) => execFileSync(tool(ffbin, 'ffmpeg'), ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', format, '-s', size, '-i', '-', '-frames:v', '1', '-c:v', 'libwebp', ...options, file], { input });

export function renderDataFile({ picture, silhouette, sources, floor = FLOOR }) {
  const row = (entry) => `Object.freeze(${JSON.stringify(entry)})`;
  return [
    '// Generated by tools/build_unreal_athlete_floor.mjs. Do not edit by hand: rerun the tool.',
    'export default Object.freeze({',
    '  // The surface the floor was rendered from. Its own maps are not published.',
    `  surface: ${row({ name: 'Japanese Tatami Mats', id: 'tlvheccfw', from: 'Fab (Quixel Megascans)' })},`,
    '  // The lit floor on black: added to the stage, centred under the athlete.',
    `  picture: ${row(picture)},`,
    "  // The athlete's outline in his own picture: the floor is cut out there.",
    `  silhouette: ${row(silhouette)},`,
    "  // The share of the athlete's height the floor picture covers, from the bottom.",
    `  heightShare: ${JSON.stringify(floorHeightShare(floor))},`,
    '  // The two maps of the surface this picture was rendered from, by SHA-256.',
    `  sources: ${row(sources)},`,
    '});',
    '',
  ].join('\n');
}

export function buildFloor({ base, normal, ffbin, out = ROOT }) {
  const baseColor = readRgb(ffbin, base), normalMap = readRgb(ffbin, normal);
  if (baseColor.width !== normalMap.width || baseColor.height !== normalMap.height) throw new Error('The BaseColor and Normal maps differ in size');
  const folder = path.join(out, FOLDER);
  mkdirSync(folder, { recursive: true });
  const pictureFile = path.join(folder, 'tatami.webp'), silhouetteFile = path.join(folder, 'front-silhouette.webp');
  encode(ffbin, renderFloor(baseColor, normalMap), `${FLOOR.width}x${FLOOR.rows}`, 'rgb24', ['-quality', '80', '-compression_level', '6', '-preset', 'photo'], pictureFile);
  const layers = Object.values(UNREAL_ATHLETE.layers).map((url) => readRgb(ffbin, path.join(ROOT, 'public', url)));
  const alpha = athleteSilhouette(layers);
  const rgba = Buffer.alloc(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = alpha[i];
  encode(ffbin, rgba, `${PICTURE.width}x${PICTURE.height}`, 'rgba', ['-lossless', '1', '-compression_level', '6'], silhouetteFile);
  const pin = (file, url, width, height) => { const bytes = readFileSync(file); return { url, width, height, bytes: bytes.length, sha256: sha256(bytes) }; };
  const result = {
    picture: pin(pictureFile, '/assets/unreal-athlete/athlete-01/floor/tatami.webp', FLOOR.width, FLOOR.rows),
    silhouette: pin(silhouetteFile, '/assets/unreal-athlete/athlete-01/floor/front-silhouette.webp', PICTURE.width, PICTURE.height),
    sources: { baseColor: sha256(readFileSync(base)), normal: sha256(readFileSync(normal)) },
  };
  const data = path.join(out, DATA);
  mkdirSync(path.dirname(data), { recursive: true });
  writeFileSync(data, renderDataFile(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = (name) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const [base, normal, ffbin, out] = ['--base', '--normal', '--ffmpeg', '--out'].map(value);
  if (!base || !normal || !ffbin) {
    console.error('usage: node tools/build_unreal_athlete_floor.mjs --base <BaseColor image> --normal <Normal image> --ffmpeg <ffmpeg bin dir> [--out <dir>]');
    process.exit(2);
  }
  console.log(JSON.stringify(buildFloor({ base, normal, ffbin, out: out ? path.resolve(out) : ROOT }), null, 2));
}
