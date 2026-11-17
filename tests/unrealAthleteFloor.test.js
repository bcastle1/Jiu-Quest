import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNREAL_ATHLETE } from '../src/unreal/athlete.js';
import { UNREAL_ATHLETE_FLOOR, UNREAL_ATHLETE_FLOOR_STYLE } from '../src/unreal/athleteFloor.js';
import { FLOOR, athleteSilhouette, floorHeightShare, renderDataFile, renderFloor } from '../tools/build_unreal_athlete_floor.mjs';

const repoPath = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const repoFile = (path) => readFileSync(repoPath(path));
// A Windows checkout holds text files with CRLF line ends; the tools write plain ones.
const repoText = (path) => repoFile(path).toString('utf8').replaceAll('\r\n', '\n');
const FOLDER = 'public/assets/unreal-athlete/athlete-01/floor';

test('the floor is two pinned WebP pictures: the lit mat on black and the outline of the athlete', () => {
  const { picture, silhouette } = UNREAL_ATHLETE_FLOOR;
  assert.equal(picture.url, '/assets/unreal-athlete/athlete-01/floor/tatami.webp');
  assert.equal(silhouette.url, '/assets/unreal-athlete/athlete-01/floor/front-silhouette.webp');
  for (const [name, file] of Object.entries({ picture, silhouette })) {
    const bytes = repoFile(`public${file.url}`);
    assert.equal(bytes.length, file.bytes, `${name} size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${name} was replaced or re-encoded`);
    assert.equal(bytes.toString('latin1', 0, 4), 'RIFF');
    assert.equal(bytes.toString('latin1', 8, 12), 'WEBP');
  }
  // The mat is plain lossy VP8 without an alpha chunk: black adds nothing where the stage adds it.
  const mat = repoFile(`public${picture.url}`);
  assert.equal(mat.toString('latin1', 12, 16), 'VP8 ', 'the mat must stay an opaque VP8 image');
  assert.deepEqual([mat.readUInt16LE(26) & 0x3fff, mat.readUInt16LE(28) & 0x3fff], [picture.width, picture.height]);
  assert.deepEqual([picture.width, picture.height], [FLOOR.width, FLOOR.rows]);
  // The outline is lossless with alpha, and exactly the size of the athlete's own picture.
  const outline = repoFile(`public${silhouette.url}`);
  assert.equal(outline.toString('latin1', 12, 16), 'VP8L', 'the outline must stay a lossless image, its edge is what cuts the mat');
  const bits = outline.readUInt32LE(21);
  assert.deepEqual([(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1], [UNREAL_ATHLETE.width, UNREAL_ATHLETE.height]);
  assert.equal((bits >>> 28) & 1, 1, 'the outline carries alpha');
  assert.deepEqual([silhouette.width, silhouette.height], [UNREAL_ATHLETE.width, UNREAL_ATHLETE.height]);
  assert.throws(() => { UNREAL_ATHLETE_FLOOR.picture.sha256 = 'changed'; }, TypeError);
});

test("only the rendered floor is published: the bought surface's own maps are nowhere under public", () => {
  assert.deepEqual(readdirSync(repoPath(FOLDER)).sort(), ['front-silhouette.webp', 'tatami.webp']);
  const names = readdirSync(repoPath('public'), { recursive: true }).map(String);
  assert.deepEqual(names.filter((name) => /tlvheccfw|basecolor|_normal\.|_roughness\.|_displacement\.|\.mhpkg$/i.test(name)), []);
  assert.deepEqual(UNREAL_ATHLETE_FLOOR.surface, { name: 'Japanese Tatami Mats', id: 'tlvheccfw', from: 'Fab (Quixel Megascans)' });
  assert.match(UNREAL_ATHLETE_FLOOR.sources.baseColor, /^[0-9a-f]{64}$/);
  assert.match(UNREAL_ATHLETE_FLOOR.sources.normal, /^[0-9a-f]{64}$/);
});

test('the pinned list is what the tool writes, and the page scales the floor by the share the tool rendered', () => {
  const { picture, silhouette, sources } = UNREAL_ATHLETE_FLOOR;
  assert.equal(repoText('src/unreal/athleteFloor.data.js'), renderDataFile({ picture: { ...picture }, silhouette: { ...silhouette }, sources: { ...sources } }));
  assert.equal(floorHeightShare(), '42.045%');
  assert.equal(UNREAL_ATHLETE_FLOOR.heightShare, floorHeightShare());
  // The floor's rows are the athlete's lowest rows, and it is centred on his picture.
  assert.ok(FLOOR.rows < UNREAL_ATHLETE.height && FLOOR.width > UNREAL_ATHLETE.width);
  assert.equal(FLOOR.camera.centerX, UNREAL_ATHLETE.width / 2);
  assert.ok(FLOOR.camera.horizonY < UNREAL_ATHLETE.height - FLOOR.rows, 'the horizon lies above the floor picture, so every row of it is ground');
});

test('the stage adds the floor and cuts the athlete out of it, and shows it only with the athlete', () => {
  const { picture, silhouette, heightShare } = UNREAL_ATHLETE_FLOOR;
  assert.deepEqual({ ...UNREAL_ATHLETE_FLOOR_STYLE }, {
    '--athlete-floor-share': heightShare,
    backgroundImage: `url(${picture.url})`,
    WebkitMaskImage: `url(${silhouette.url}), linear-gradient(#000, #000)`,
    maskImage: `url(${silhouette.url}), linear-gradient(#000, #000)`,
  });
  const css = repoText('src/components/UnrealAthlete.css');
  const rule = css.slice(css.indexOf('.app-shell .unreal-athlete-floor {'), css.indexOf('}', css.indexOf('.app-shell .unreal-athlete-floor {')));
  // Scaled with the athlete and centred where he stands: the floor by its share, the outline over his whole height.
  assert.match(rule, /background-position: 50% 100%;/);
  assert.match(rule, /background-size: auto var\(--athlete-floor-share\);/);
  assert.match(rule, /mask-position: 50% 100%, 0 0;/);
  assert.match(rule, /mask-size: auto 100%, 100% 100%;/);
  // Light is added, and the outline is taken out of the layer that covers the stage.
  assert.match(rule, /mix-blend-mode: plus-lighter;/);
  assert.match(rule, /mask-composite: exclude;/);
  assert.match(rule, /opacity: 0;/);
  assert.match(css, /\.unreal-athlete-stage-figure\.is-ready ~ \.unreal-athlete-floor \{\s*opacity: 1;/);
  assert.match(css, /@supports not \(\(mask-composite: exclude\) or \(-webkit-mask-composite: xor\)\) \{\s*\.app-shell \.unreal-athlete-floor \{\s*display: none;/);
  // The floor element comes after the athlete, which the rule above relies on, and only once both files are in the page.
  const stage = repoText('src/components/UnrealAthlete.jsx');
  const figure = stage.indexOf('className="unreal-athlete-stage-figure"'), floor = stage.indexOf('className="unreal-athlete-floor"');
  assert.ok(figure > 0 && floor > figure);
  assert.match(stage, /const onMat = inPage\.picture && inPage\.silhouette;/);
  assert.match(stage, /\{onMat && \(\s*<span className="unreal-athlete-floor"/);
});

test('the outline closes dark creases inside the athlete and stays off the ground beside him', () => {
  const { width: W, height: H } = UNREAL_ATHLETE;
  // One lit block with a dark crease through it, as between two toes, and a second block far from it.
  const layer = { data: Buffer.alloc(W * H * 3) };
  const paint = (left, top, right, bottom, value) => { for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) layer.data.fill(value, (y * W + x) * 3, (y * W + x) * 3 + 3); };
  paint(300, 1500, 500, 1700, 200);
  paint(398, 1500, 402, 1700, 0);
  paint(700, 1600, 760, 1660, 9);
  const dark = { data: Buffer.alloc(W * H * 3) };
  const alpha = athleteSilhouette([layer, dark, dark, dark]);
  const at = (x, y) => alpha[y * W + x];
  assert.equal(alpha.length, W * H);
  assert.equal(at(400, 1600), 255, 'a crease four pixels wide belongs to the athlete');
  assert.equal(at(350, 1600), 255);
  assert.equal(at(250, 1600), 0, 'the ground beside him is clear');
  assert.equal(at(600, 1600), 0, 'a gap as wide as the one between his legs stays open');
  assert.equal(at(730, 1630), 0, 'what is nearly black is not the athlete');
  assert.ok(at(300, 1600) > 0 && at(300, 1600) < 255 && at(298, 1600) === 0, 'the edge is soft over one pixel and no wider');
  // Light from any layer counts: the layers are summed, as the page sums them.
  const faint = { data: Buffer.alloc(W * H * 3, 5) }, middle = (H / 2) * W + W / 2;
  assert.equal(athleteSilhouette([faint, faint, faint, dark])[middle], 255);
  assert.equal(athleteSilhouette([faint, faint, dark, dark])[middle], 0);
});

test('the renderer lights the mat under the lamp, leaves the far ground and the edges black, and darkens it under a foot', () => {
  // A plain straw-colored surface with flat relief, and a small picture of the ground around the feet.
  const plain = (rgb) => ({ width: 8, height: 8, data: Buffer.from(Array.from({ length: 64 }, () => rgb).flat()) });
  const straw = plain([200, 170, 125]), flat = plain([128, 128, 255]);
  const small = { ...FLOOR, width: 400, rows: 200 };
  const pixels = renderFloor(straw, flat, small);
  assert.equal(pixels.length, small.width * small.rows * 3);
  const at = (column, row) => [...pixels.subarray((row * small.width + column) * 3, (row * small.width + column) * 3 + 3)];
  const top = UNREAL_ATHLETE.height - small.rows, left = FLOOR.camera.centerX - small.width / 2;
  // Where a point on the ground shows in this picture.
  const shows = (x, z) => [Math.round(FLOOR.camera.centerX + (FLOOR.camera.focal * x) / z - left), Math.round(FLOOR.camera.horizonY + (FLOOR.camera.focal * FLOOR.camera.height) / z - top)];
  const open = at(...shows(-0.08, 3.6));
  assert.ok(open[0] > 90 && open[0] > open[1] && open[1] > open[2], `the mat is lit, and warm (${open})`);
  const [front] = FLOOR.shadows;
  const underFoot = at(...shows(front.x, front.z));
  assert.ok(underFoot[0] < open[0] * 0.5, `the front foot darkens the mat under it (${underFoot} against ${open})`);
  // The picture has no edge: its first row and its outermost columns are black.
  for (let column = 0; column < small.width; column += 20) assert.deepEqual(at(column, 0), [0, 0, 0]);
  for (let row = 0; row < small.rows; row += 20) { assert.deepEqual(at(0, row), [0, 0, 0]); assert.deepEqual(at(small.width - 1, row), [0, 0, 0]); }
  // The same surface again renders the same bytes.
  assert.ok(pixels.equals(renderFloor(straw, flat, small)));
});
