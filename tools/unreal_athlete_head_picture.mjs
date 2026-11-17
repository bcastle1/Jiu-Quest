// The picture laid over the head of the Unreal athlete: the pixels in which the
// render of one head choice differs from the base picture of its face, with a
// soft edge. tools/build_unreal_athlete_heads.mjs builds every published head
// picture with it and takes its masks from the helpers here.
// tests/unrealAthleteHeads.test.js tries the rules on small made-up boxes; the
// tool itself runs as a script and needs the renders, so it cannot be tested
// that way.
//
// Plain arithmetic: no files, no sharp. An image is { width, height, data },
// three bytes a pixel (RGB), row by row; a head picture has four (RGBA).

export const HEAD_PICTURE = Object.freeze({
  changeThreshold: 7,       // a head picture covers the pixels that differ from the face's base by more than this
  // A part of a head picture that would reach the edge of its box is left out when no pixel of it differs from the
  // base by more than this: it is light the head throws on what lies beside it, not the head. In the dojo set's
  // standing still a beard changes the light on the lead's hand, which reaches into the lower corner of his head box,
  // by up to 17 of 255. A part that differs more still stops the tool: a head too big for its box.
  faintEdge: 20,
  grow: 6, feather: 3,      // pixels the covered region is grown by, and the width of its soft edge
});

// Largest channel difference of two regions of the same size.
export function difference(a, b) {
  const out = new Uint8Array(a.width * a.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 3) {
    out[i] = Math.max(Math.abs(a.data[p] - b.data[p]), Math.abs(a.data[p + 1] - b.data[p + 1]), Math.abs(a.data[p + 2] - b.data[p + 2]));
  }
  return out;
}
// For every pixel, how many set pixels lie in the square of the given radius around it (outside the picture counts as unset).
export function counts(mask, width, height, radius) {
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
export const over = (values, limit) => Uint8Array.from(values, (value) => (value > limit ? 1 : 0));
// Three box blurs along each axis: close to a Gaussian of the given radius. Values are 0..1.
export function blur(values, width, height, radius) {
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

// The picture laid over a head: the render where it differs from the base, with a soft edge. Null when nothing differs.
// `touchesEdge` counts the pixels where the picture would reach the edge of its box; the tool stops on any. `leftOut`
// says what faint parts at the edge were left out, when there were any.
export function headPicture(render, base) {
  const width = render.width, height = render.height;
  const delta = difference(render, base);
  const changed = over(delta, HEAD_PICTURE.changeThreshold);
  // a changed pixel counts when at least two of its eight neighbours changed too (single noisy pixels do not)
  const steady = Uint8Array.from(counts(changed, width, height, 1), (count, i) => (changed[i] && count >= 3 ? 1 : 0));
  const picture = coverChange(render, steady);
  if (!picture?.touchesEdge) return picture;
  // The picture would reach the edge of its box. Faint parts there are light the head throws beside it: leave them out.
  const faint = faintEdgeParts(steady, delta, width, height);
  if (!faint.parts) return picture;
  const trimmed = coverChange(render, faint.steady);
  return trimmed && { ...trimmed, leftOut: { parts: faint.parts, pixels: faint.pixels, largestDifference: faint.largest } };
}
// The parts of a change (its pixels joined as the covered region grows them) that come within two pixels of the edge of
// the box and change no pixel by more than HEAD_PICTURE.faintEdge. Returns the change without them.
function faintEdgeParts(steady, delta, width, height) {
  const grown = over(counts(steady, width, height, HEAD_PICTURE.grow), 0);
  const partOf = new Int32Array(width * height).fill(-1);
  const parts = [];
  for (let start = 0; start < partOf.length; start += 1) {
    if (!grown[start] || partOf[start] >= 0) continue;
    const id = parts.length, members = [start];
    let edge = false, largest = 0;
    partOf[start] = id;
    for (let k = 0; k < members.length; k += 1) {
      const i = members[k], x = i % width, y = (i - x) / width;
      if (Math.min(x, y, width - 1 - x, height - 1 - y) < 2) edge = true;
      if (steady[i]) largest = Math.max(largest, delta[i]);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy, j = ny * width + nx;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && grown[j] && partOf[j] < 0) { partOf[j] = id; members.push(j); }
        }
      }
    }
    parts.push(edge && largest <= HEAD_PICTURE.faintEdge ? largest : null);
  }
  const kept = Uint8Array.from(steady);
  let pixels = 0;
  for (let i = 0; i < kept.length; i += 1) if (kept[i] && parts[partOf[i]] !== null) { kept[i] = 0; pixels += 1; }
  const faint = parts.filter((largest) => largest !== null);
  return { steady: kept, parts: faint.length, pixels, largest: Math.max(0, ...faint) };
}
// The covered region of a change: grown, with a soft edge that ends inside the box.
function coverChange(render, steady) {
  const width = render.width, height = render.height;
  const total = steady.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  const grown = over(counts(steady, width, height, HEAD_PICTURE.grow), 0);
  const soft = blur(grown, width, height, HEAD_PICTURE.feather);
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
