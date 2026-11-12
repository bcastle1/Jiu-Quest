import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import showcaseCards from '../src/showcaseCards.data.js';

const repoPath = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const repoFile = (path) => readFileSync(repoPath(path));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('the Overview shows the five showcase cards, in order, under their names', () => {
  assert.deepEqual(showcaseCards.map((card) => [card.id, card.label]), [
    ['crimson-guard', 'Crimson Guard'], ['void-striker', 'Void Striker'], ['blue-surge', 'Blue Surge'], ['emerald-guard', 'Emerald Guard'], ['gold-hunter', 'Gold Hunter'],
  ]);
  const app = repoFile('src/App.jsx').toString('utf8');
  assert.match(app, /import showcaseFighters from '\.\/showcaseCards\.data\.js';/);
  assert.match(app, /\{showcaseFighters\.map\(\(item\) => \(\s*<figure className="showcase-card" key=\{item\.id\}>\s*<img src=\{item\.src\} alt=\{`\$\{item\.label\} fighter style`\} width=\{item\.width\} height=\{item\.height\} loading="lazy" decoding="async" \/>\s*<figcaption>\{item\.label\}<\/figcaption>/);
  assert.doesNotMatch(app, /challenger-\d/, 'the earlier illustrations are gone');
  assert.throws(() => { showcaseCards.push({}); }, TypeError);
  assert.throws(() => { showcaseCards[0].src = 'changed'; }, TypeError);
});

test('every published card is the pinned file: a four-by-five WebP light enough for a phone', () => {
  let total = 0;
  for (const card of showcaseCards) {
    assert.equal(card.src, `/assets/showcase/${card.id}.webp`);
    const bytes = repoFile(`public${card.src}`);
    assert.equal(bytes.length, card.bytes, `${card.id} size`);
    assert.equal(sha256(bytes), card.sha256, `${card.id} was replaced or re-encoded`);
    assert.equal(bytes.toString('latin1', 0, 4) + bytes.toString('latin1', 8, 16), 'RIFFWEBPVP8 ', `${card.id} is a lossy WebP`);
    assert.deepEqual([bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff], [card.width, card.height], `${card.id} pixel size`);
    assert.deepEqual([card.width, card.height], [900, 1125]);
    assert.ok(card.bytes < 220 * 1024, `${card.id} is ${card.bytes} bytes`);
    // The picture the card was made from, as its receipt listed it.
    assert.match(card.sourceSha256, /^[0-9a-f]{64}$/);
    assert.notEqual(card.sourceSha256, card.sha256);
    total += card.bytes;
  }
  assert.ok(total < 900 * 1024, `the strip is ${total} bytes`);
  assert.equal(new Set(showcaseCards.map((card) => card.sourceSha256)).size, showcaseCards.length, 'five different pictures');
  // Nothing is published that the list does not pin.
  assert.deepEqual(readdirSync(repoPath('public/assets/showcase')).sort(), showcaseCards.map((card) => `${card.id}.webp`).sort());
});
