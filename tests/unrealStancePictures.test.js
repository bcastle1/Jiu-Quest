import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import unrealStancePictures from '../src/unreal/stancePictures.data.js';
import { customizationOptions } from '../src/storage.js';

const repoPath = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const repoFile = (path) => readFileSync(repoPath(path));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('there is one Unreal-style picture for every stance a player can pick, in the picker\'s order', () => {
  assert.deepEqual(unrealStancePictures.map((picture) => picture.stance), customizationOptions.stances);
  assert.equal(unrealStancePictures.length, 7);
  assert.throws(() => { unrealStancePictures.push({}); }, TypeError);
  assert.throws(() => { unrealStancePictures[0].src = 'changed'; }, TypeError);
});

test('every published stance picture is the pinned file: a small four-by-five WebP', () => {
  let total = 0;
  for (const picture of unrealStancePictures) {
    assert.match(picture.src, /^\/assets\/unreal-stances\/[a-z-]+\.webp$/);
    const bytes = repoFile(`public${picture.src}`);
    assert.equal(bytes.length, picture.bytes, `${picture.stance} size`);
    assert.equal(sha256(bytes), picture.sha256, `${picture.stance} was replaced or re-encoded`);
    assert.equal(bytes.toString('latin1', 0, 4) + bytes.toString('latin1', 8, 16), 'RIFFWEBPVP8 ', `${picture.stance} is a lossy WebP`);
    assert.deepEqual([bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff], [picture.width, picture.height], `${picture.stance} pixel size`);
    assert.deepEqual([picture.width, picture.height], [480, 600]);
    assert.ok(picture.bytes < 90 * 1024, `${picture.stance} is ${picture.bytes} bytes`);
    // The picture it was made from, as the image job's receipt listed it.
    assert.match(picture.sourceSha256, /^[0-9a-f]{64}$/);
    assert.notEqual(picture.sourceSha256, picture.sha256);
    total += picture.bytes;
  }
  assert.ok(total < 450 * 1024, `the seven pictures are ${total} bytes`);
  assert.equal(new Set(unrealStancePictures.map((picture) => picture.sourceSha256)).size, unrealStancePictures.length, 'seven different pictures');
  assert.equal(new Set(unrealStancePictures.map((picture) => picture.src)).size, unrealStancePictures.length);
  // Nothing is published that the list does not pin.
  assert.deepEqual(readdirSync(repoPath('public/assets/unreal-stances')).map((file) => `/assets/unreal-stances/${file}`).sort(), unrealStancePictures.map((picture) => picture.src).sort());
});

test('the stance picker shows them only to fighters with the Unreal look', () => {
  const app = repoFile('src/App.jsx').toString('utf8');
  assert.match(app, /import unrealStancePictures from '\.\/unreal\/stancePictures\.data\.js';/);
  assert.match(app, /const unrealStanceArt = Object\.fromEntries\(unrealStancePictures\.map\(\(picture\) => \[picture\.stance, picture\.src\]\)\);/);
  assert.match(app, /className=\{unrealLook \? "unreal-stances" : ""\}/);
  assert.match(app, /getImage=\{\(stance\) => \(unrealLook \? unrealStanceArt\[stance\] : null\) \?\? stanceArt\[stance\] \?\? stanceArt\["wrestling stance"\]\}/);
  assert.match(app, /renderPreview=\{unrealLook \? undefined : \(stance\) => \(\s*<FighterArt/, 'the classic look keeps its own stance figures');
  // On a narrow hero the Unreal athletes stand behind the headline.
  assert.match(repoFile('src/components/UnrealAthlete.css').toString('utf8'), /\.app-shell \.hero-stage\.has-athlete \{\s*background:[^}]*url\('\/assets\/unreal-clips\/standing_stance\/fighter-side\.webp'\)/);
});
