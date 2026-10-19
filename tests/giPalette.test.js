import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGiPalette, fabricChannel, parseGiColor } from '../src/arena/giPalette.js';

test('the four source fabrics map to independent athlete jacket and pant channels', () => {
  assert.equal(fabricChannel(36, 76, 221), 0);
  assert.equal(fabricChannel(32, 189, 221), 1);
  assert.equal(fabricChannel(21, 147, 75), 2);
  assert.equal(fabricChannel(141, 207, 40), 3);
});
test('skin, grayscale mat, hair, and belt are not recolored as gi fabric', () => {
  for (const pixel of [[218, 162, 117], [238, 190, 134], [211, 168, 93], [87, 91, 96], [22, 19, 21], [12, 15, 18]]) assert.equal(fabricChannel(...pixel), -1);
});
test('yellow and pale lime fabric highlights follow dark pants instead of leaking source green', () => {
  const source = new Uint8ClampedArray([235, 218, 75, 255, 233, 239, 162, 255]);
  const result = applyGiPalette(source, ['#ffffff', '#ffffff', '#ffffff', '#151922']);
  assert.ok(result[0] < 60 && result[1] < 60);
  assert.ok(result[4] < 60 && result[5] < 60);
  assert.equal(result[3],255); assert.equal(result[7],255);
});
test('swapping player and opponent palettes swaps fabric colors without touching skin or alpha', () => {
  const source = new Uint8ClampedArray([36, 76, 221, 255, 21, 147, 75, 255, 218, 162, 117, 255]);
  const first = applyGiPalette(source.slice(), ['#ff0000', '#ffffff', '#0000ff', '#000000']);
  const swapped = applyGiPalette(source.slice(), ['#0000ff', '#ffffff', '#ff0000', '#000000']);
  assert.ok(first[0] > first[2]); assert.ok(swapped[2] > swapped[0]);
  assert.ok(first[6] > first[4]); assert.ok(swapped[4] > swapped[6]);
  assert.deepEqual([...first.slice(8)], [...source.slice(8)]);
  assert.equal(first[3], 255); assert.equal(first[7], 255);
});
test('invalid stored colors use a safe palette fallback', () => {
  assert.deepEqual(parseGiColor('url(evil)'), [248,251,255]);
});
