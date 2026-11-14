// Builds the tintable two-athlete position stills from the Unreal render pack:
// the Node twin of tools/build_unreal_position_layers.py, and the tool of record
// on a machine without Python. Both read the same five renders per position,
// do the same arithmetic with the same settings (POSITIONS below is kept equal
// to POSITIONS in the .py), and write the same files: seven WebP layers per
// still under public/assets/unreal-positions and src/unreal/positionStills.data.js.
// The .py explains the method; this file says where it stands in for a library.
//
//   node tools/build_unreal_position_layers.mjs <Unreal-render-pack/positions>
//        [--debug <folder>] [--public <folder>] [--module <file>] [--settings <json file>]
//
// --debug writes, per athlete, the still with the jacket blue and the pants red;
// look at them at full size before publishing. --public, --module and --settings
// let the tool be tried on other renders or settings without touching the
// published files. Without them it writes where the .py writes, with POSITIONS.
//
// sharp (WebP encoding, and a second PNG decode to check the first) is not a
// dependency of this project. The tool loads the copy pnpm keeps in node_modules
// for the build tools, or a sharp that Node can resolve.
//
// Where the tool stands in for a library the .py uses:
//   PNG decode       own decoder (zlib inflate + PNG filters), checked against sharp's decode.
//                    Pillow's convert("RGB") drops alpha; so does this.
//   MedianFilter(n)  Pillow replicates the edge pixels, then takes rank n*n//2. On a 0/255 mask
//                    that is a majority vote, counted here with a box sum over replicated edges.
//   MaxFilter(n)     same, "any pixel set".
//   GaussianBlur(r)  Pillow does not convolve with a Gaussian kernel. It runs three passes of an
//                    "extended box blur" along x, then three along y, rounding to 8 bits after
//                    every pass, with 24-bit fixed-point weights and replicated edges. This tool
//                    repeats that scheme from the Pillow source as remembered (BoxBlur.c). If a
//                    Pillow release rounds a weight differently the blurred edge of a region can
//                    differ by one level in 255.
//   median_filter    SciPy rank filter along one axis, mode "nearest" (replicate) or "constant" (0).
//   np.interp        linear between points, flat outside them.
//   resize(LANCZOS)  Pillow's two-pass resample: 22-bit fixed-point Lanczos-3 coefficients,
//                    horizontal pass rounded to 8 bits, then the vertical pass.
//   WebP             sharp (libvips 8.17.3, libwebp 1.6.0), quality 90 or 88, effort 6, no metadata.
//                    Pillow hands the same RGB to libwebp with quality and method=6. The bytes
//                    depend on the libwebp release, so they are not expected to equal Pillow's.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function loadSharp() {
  try { return require('sharp'); } catch { /* not resolvable by name: use pnpm's copy */ }
  const store = join(ROOT, 'node_modules', '.pnpm');
  const folder = existsSync(store) ? readdirSync(store).filter((name) => /^sharp@\d/.test(name)).sort().pop() : null;
  if (!folder) fail('sharp is not installed: run pnpm install, or install sharp where Node can find it');
  return require(join(store, folder, 'node_modules', 'sharp'));
}

const PASSES = ['base', 'lead-gi-white', 'other-gi-white', 'lead-belt-white', 'other-belt-white'];

// What the site shows of each render, and where each jacket ends: the same
// settings as POSITIONS in tools/build_unreal_position_layers.py, which explains
// each one. Change both together.
let POSITIONS = {
  standing: {
    crop: [510, 255, 1620, 1080],
    size: [1620, 1080],
    families: ['standing'],
    jacket: {
      lead: [
        [700, 300], [1400, 300], [1400, 860], [1100, 860], [1010, 800], [980, 800], [968, 805.5], [960.5, 807.3],
        [958, 807.6], [954, 804.4], [950, 801], [946, 797.3], [942, 793.3], [938, 789.5], [934, 786], [930, 782.5],
        [926, 779.3], [922, 778.8], [920, 778], [916, 775.6], [912, 773.7], [908, 772], [900, 770], [890, 778],
        [880, 779], [876.3, 782.5], [874.5, 788], [873.5, 793], [872.7, 796], [871.5, 798], [870.8, 800], [869.5, 802],
        [869.2, 804], [868, 806], [867, 808], [866.2, 810], [868, 811.8], [873.5, 812.3], [890, 815.5], [908, 819],
        [916, 822.5], [922, 825], [927, 828.5], [924, 830.3], [920, 831.6], [916, 833.4], [912, 835], [908, 836.5],
        [904, 838.4], [900, 840], [896, 841.3], [892, 842.5], [888, 843.5], [884, 844.5], [880, 845.4], [876, 846],
        [872, 846.8], [868, 847.3], [864, 847.4], [860, 847.6], [856, 848.6], [852, 848.6], [848, 847.5], [844, 847.4],
        [840, 847.7], [836, 847.1], [832, 846.5], [828, 845.5], [824, 844.5], [820, 843.8], [816, 842.8], [812, 841.5],
        [810, 840.6], [808, 839.7], [800, 846], [700, 870],
      ],
      other: [
        [1250, 300], [1950, 300], [1950, 826], [1818, 819], [1812.5, 814.8], [1810, 816.1], [1808, 817.1], [1804, 818.7],
        [1800, 820.5], [1796, 822.3], [1792, 823.8], [1788, 825.1], [1784, 826.3], [1780, 827.5], [1776, 828.3], [1772, 829.1],
        [1768, 829.8], [1764, 830.2], [1760, 830.9], [1756, 831.2], [1752, 831.6], [1748, 831.9], [1744, 832], [1740, 832.2],
        [1736.5, 833], [1737.8, 830.5], [1738.6, 828], [1739.3, 826], [1740, 824], [1740.8, 822], [1741.7, 820], [1742.5, 818],
        [1743.2, 816], [1744.2, 814], [1744.2, 796], [1744.1, 792], [1743.2, 788], [1741.5, 784],
        [1738.7, 780], [1735.6, 776], [1732.5, 772], [1729.7, 768], [1728.7, 765], [1729.7, 762], [1730.8, 759.5], [1731.5, 756],
        [1735, 748], [1722, 748], [1700, 758], [1680, 766], [1660, 776], [1635, 783], [1590, 790], [1500, 800],
        [1250, 800],
      ],
    },
  },
};

const fail = (message) => { console.error(`build_unreal_position_layers: ${message}`); process.exit(1); };
const f32 = Math.fround;
// The sRGB transfer function on 0..255 values, to linear light (0..1) and back (clamped to 0..255).
const toLinear = (value) => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const fromLinear = (light) => { const l = Math.min(1, Math.max(0, light)); return 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055); };

// ---- PNG ----
function decodePng(data) {
  if (data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('not a PNG');
  let offset = 8, header = null;
  const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header || header.depth !== 8 || ![2, 6].includes(header.color) || header.interlace !== 0) throw new Error(`unsupported PNG ${JSON.stringify(header)}`);
  const { width, height } = header;
  const bpp = header.color === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error('PNG data has the wrong length');
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1, out = y * stride, up = out - stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? pixels[out + x - bpp] : 0;
      const b = y > 0 ? pixels[up + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[up + x - bpp] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) throw new Error(`PNG filter ${filter}`);
      pixels[out + x] = (raw[line + x] + predicted) & 255;
    }
  }
  // convert("RGB"): keep red, green, blue and drop alpha.
  const rgb = new Float32Array(width * height * 3);
  for (let index = 0, count = width * height; index < count; index += 1) {
    rgb[index * 3] = pixels[index * bpp]; rgb[index * 3 + 1] = pixels[index * bpp + 1]; rgb[index * 3 + 2] = pixels[index * bpp + 2];
  }
  return { width, height, rgb };
}

// ---- Pillow filters on an 8-bit mask ----
// Number of set pixels in the size x size window around each pixel, edges replicated.
function windowCount(mask, width, height, size) {
  const reach = size >> 1;
  const rows = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const at = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let step = -reach; step <= reach; step += 1) sum += mask[at + Math.min(width - 1, Math.max(0, x + step))] ? 1 : 0;
      rows[at + x] = sum;
    }
  }
  const counts = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let step = -reach; step <= reach; step += 1) sum += rows[Math.min(height - 1, Math.max(0, y + step)) * width + x];
      counts[y * width + x] = sum;
    }
  }
  return counts;
}
// ImageFilter.MedianFilter(size) on a mask of 0 and 255.
function medianMask(mask, width, height, size) {
  const counts = windowCount(mask, width, height, size), need = (size * size + 1) / 2;
  return Uint8Array.from(counts, (count) => (count >= need ? 255 : 0));
}
// ImageFilter.MaxFilter(size) on a mask of 0 and 255.
function maxMask(mask, width, height, size) {
  return Uint8Array.from(windowCount(mask, width, height, size), (count) => (count >= 1 ? 255 : 0));
}
// Pillow's _gaussian_blur_radius, in single precision like the C code.
function boxRadius(radius, passes) {
  const sigma2 = f32(f32(f32(radius) * f32(radius)) / passes);
  const L = f32(Math.sqrt(12.0 * sigma2 + 1.0));
  const l = f32(Math.floor((L - 1.0) / 2.0));
  let a = f32(f32(2 * l + 1) * f32(f32(l * f32(l + 1)) - f32(3 * sigma2)));
  a = f32(a / f32(6 * f32(sigma2 - f32(f32(l + 1) * f32(l + 1)))));
  return f32(l + a);
}
// One pass of Pillow's ImagingLineBoxBlur8 along a line of `count` pixels, `step` apart.
function boxBlurLine(source, target, start, step, count, radius, ww, fw) {
  const last = count - 1;
  const at = (index) => source[start + Math.min(last, Math.max(0, index)) * step];
  for (let x = 0; x < count; x += 1) {
    let acc = 0;
    for (let offset = -radius; offset <= radius; offset += 1) acc += at(x + offset);
    const bulk = acc * ww + (at(x - radius - 1) + at(x + radius + 1)) * fw;
    target[start + x * step] = Math.floor((bulk + 8388608) / 16777216) & 255;
  }
}
// ImageFilter.GaussianBlur(radius) on an 8-bit image: three box passes along x, then three along y.
function gaussianBlur(image, width, height, blurRadius) {
  const floatRadius = boxRadius(blurRadius, 3);
  const radius = Math.trunc(floatRadius);
  const ww = Math.trunc(f32(16777216 / f32(f32(floatRadius * 2) + 1)));
  const fw = Math.floor((16777216 - (radius * 2 + 1) * ww) / 2);
  let current = image;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y += 1) boxBlurLine(current, next, y * width, 1, width, radius, ww, fw);
    current = next;
  }
  for (let pass = 0; pass < 3; pass += 1) {
    const next = new Uint8Array(current.length);
    for (let x = 0; x < width; x += 1) boxBlurLine(current, next, x, width, height, radius, ww, fw);
    current = next;
  }
  return current;
}

// soft() and region() of the Python tool: a Float32Array of 0..1 per pixel.
function region(delta, width, height, median, blur) {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) mask[index] = Math.min(delta[index * 3], delta[index * 3 + 1], delta[index * 3 + 2]) > 14 ? 255 : 0;
  const blurred = gaussianBlur(maxMask(medianMask(mask, width, height, median), width, height, 5), width, height, blur);
  return Float32Array.from(blurred, (value) => f32(value / 255));
}

// ---- SciPy and NumPy helpers on one axis ----
// scipy.ndimage.median_filter(values, size, mode): mode 'nearest' repeats the end values, 'constant' pads with 0.
function medianFilter1d(values, size, mode) {
  const reach = size >> 1, count = values.length, out = new Float64Array(count), window = new Float64Array(size);
  for (let index = 0; index < count; index += 1) {
    for (let step = -reach; step <= reach; step += 1) {
      const at = index + step;
      window[step + reach] = at < 0 || at >= count ? (mode === 'nearest' ? values[Math.min(count - 1, Math.max(0, at))] : 0) : values[at];
    }
    out[index] = Float64Array.from(window).sort()[reach];
  }
  return out;
}
// np.interp(x, xp, fp)
function interp(x, xp, fp) {
  if (x <= xp[0]) return fp[0];
  const last = xp.length - 1;
  if (x >= xp[last]) return fp[last];
  let low = 0, high = last;
  while (high - low > 1) { const middle = (low + high) >> 1; if (xp[middle] <= x) low = middle; else high = middle; }
  return (fp[low + 1] - fp[low]) / (xp[low + 1] - xp[low]) * (x - xp[low]) + fp[low];
}

// The jacket hem as one row per render column. See hem_line in the Python tool.
function hemLine(white, gi, belt, window, width) {
  const [first, last] = window.columns, [top, bottom] = window.rows;
  const columns = [], found = [];
  for (let column = first; column < last; column += 1) {
    let usable = 0, darkest = Infinity, darkestRow = top;
    for (let row = top; row < bottom; row += 1) {
      const pixel = row * width + column;
      if (!(gi[pixel] > 0.9 && belt[pixel] < 0.05)) continue;
      usable += 1;
      // The mean of three whole numbers orders the same as their sum; the first darkest row wins, like argmin.
      const luminance = white[pixel * 3] + white[pixel * 3 + 1] + white[pixel * 3 + 2];
      if (luminance < darkest) { darkest = luminance; darkestRow = row; }
    }
    if (usable > (bottom - top) * 0.6) { columns.push(column); found.push(darkestRow); }
  }
  if (columns.length < 40) fail(`too few usable hem columns (${columns.length}) in ${JSON.stringify(window)}`);
  const smooth = medianFilter1d(found, 41, 'nearest');
  const close = found.map((row, index) => (Math.abs(row - smooth[index]) <= 6 ? 1 : 0));
  const agreed = medianFilter1d(close, 21, 'constant');
  const steadyColumns = [], steadyRows = [];
  for (let index = 0; index < columns.length; index += 1) if (close[index] && agreed[index] > 0) { steadyColumns.push(columns[index]); steadyRows.push(smooth[index]); }
  if (steadyColumns.length < 30) fail(`the hem is not steady enough in ${JSON.stringify(window)}`);
  const line = new Float64Array(width);
  for (let x = 0; x < width; x += 1) line[x] = interp(x, steadyColumns, steadyRows);
  return { line, steady: [Math.min(...steadyColumns), Math.max(...steadyColumns)], columns, found, smooth, close, agreed };
}

// How far inside a traced outline each pixel centre is, in pixels; negative outside.
// See inside_outline in the Python tool: the same sums in the same order, in double precision.
function insideOutline(outline, width, height) {
  const inside = new Uint8Array(width * height), nearest = new Float64Array(width * height).fill(Infinity);
  for (let index = 0; index < outline.length; index += 1) {
    const [x0, y0] = outline[index], [x1, y1] = outline[(index + 1) % outline.length];
    const dx = x1 - x0, dy = y1 - y0, length = dx * dx + dy * dy;
    if (length === 0) fail(`the jacket outline repeats the point ${x0}, ${y0}`);
    for (let y = 0; y < height; y += 1) {
      // Even-odd rule: count the outline edges that a ray to the right of the pixel crosses.
      const crosses = dy !== 0 && (y >= y0) !== (y >= y1);
      const crossing = crosses ? x0 + (y - y0) * dx / dy : 0;
      for (let x = 0; x < width; x += 1) {
        const at = y * width + x;
        if (crosses && x < crossing) inside[at] ^= 1;
        const along = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / length));
        const offX = x - x0 - along * dx, offY = y - y0 - along * dy;
        const distance = Math.sqrt(offX * offX + offY * offY);
        if (distance < nearest[at]) nearest[at] = distance;
      }
    }
  }
  for (let at = 0; at < nearest.length; at += 1) if (!inside[at]) nearest[at] = -nearest[at];
  return nearest;
}

// ---- Pillow's Image.resize(size, LANCZOS) for 8-bit RGB ----
const sinc = (x) => { if (x === 0) return 1; const scaled = x * Math.PI; return Math.sin(scaled) / scaled; };
const lanczos = (x) => (x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);
function coefficients(inSize, outSize) {
  const scale = inSize / outSize, filterscale = Math.max(scale, 1), support = 3 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2), kernel = new Int32Array(outSize * ksize);
  for (let xx = 0; xx < outSize; xx += 1) {
    const center = (xx + 0.5) * scale, ss = 1 / filterscale;
    const xmin = Math.max(0, Math.trunc(center - support + 0.5));
    const xmax = Math.min(inSize, Math.trunc(center + support + 0.5)) - xmin;
    const weights = new Float64Array(xmax);
    let total = 0;
    for (let x = 0; x < xmax; x += 1) { weights[x] = lanczos((x + xmin - center + 0.5) * ss); total += weights[x]; }
    for (let x = 0; x < xmax; x += 1) {
      const weight = total !== 0 ? weights[x] / total : weights[x];
      kernel[xx * ksize + x] = Math.trunc((weight < 0 ? -0.5 : 0.5) + weight * 4194304);
    }
    bounds[xx * 2] = xmin; bounds[xx * 2 + 1] = xmax;
  }
  return { ksize, bounds, kernel };
}
const clip8 = (value) => Math.min(255, Math.max(0, Math.floor(value / 4194304)));
function resizeLanczos(pixels, width, height, outWidth, outHeight) {
  const across = coefficients(width, outWidth), down = coefficients(height, outHeight);
  const firstRow = down.bounds[0], lastRow = down.bounds[outHeight * 2 - 2] + down.bounds[outHeight * 2 - 1];
  const rows = lastRow - firstRow;
  const middle = new Uint8Array(outWidth * rows * 3);
  for (let y = 0; y < rows; y += 1) {
    const source = (y + firstRow) * width * 3;
    for (let xx = 0; xx < outWidth; xx += 1) {
      const xmin = across.bounds[xx * 2], xmax = across.bounds[xx * 2 + 1], k = xx * across.ksize;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 2097152;
        for (let x = 0; x < xmax; x += 1) sum += pixels[source + (x + xmin) * 3 + channel] * across.kernel[k + x];
        middle[(y * outWidth + xx) * 3 + channel] = clip8(sum);
      }
    }
  }
  const out = new Uint8Array(outWidth * outHeight * 3);
  for (let yy = 0; yy < outHeight; yy += 1) {
    const ymin = down.bounds[yy * 2] - firstRow, ymax = down.bounds[yy * 2 + 1], k = yy * down.ksize;
    for (let xx = 0; xx < outWidth; xx += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 2097152;
        for (let y = 0; y < ymax; y += 1) sum += middle[((y + ymin) * outWidth + xx) * 3 + channel] * down.kernel[k + y];
        out[(yy * outWidth + xx) * 3 + channel] = clip8(sum);
      }
    }
  }
  return out;
}

// np.rint rounds halves to the even number; then clip to 0..255.
const rint8 = (value) => {
  const floor = Math.floor(value), rest = value - floor;
  const rounded = rest > 0.5 ? floor + 1 : rest < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
  return Math.min(255, Math.max(0, rounded));
};
function cropped(pixels, width, [left, top, cropWidth, cropHeight], convert) {
  const out = new Uint8Array(cropWidth * cropHeight * 3);
  for (let y = 0; y < cropHeight; y += 1) {
    const source = ((y + top) * width + left) * 3, target = y * cropWidth * 3;
    for (let x = 0; x < cropWidth * 3; x += 1) out[target + x] = convert(pixels[source + x]);
  }
  return out;
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const round = (value, digits) => Number(value.toFixed(digits));

async function main() {
  const sharp = loadSharp();
  const args = process.argv.slice(2);
  const option = (name) => { const index = args.indexOf(name); if (index < 0) return null; const [, value] = args.splice(index, 2); return value; };
  const debug = option('--debug');
  const publicFolder = resolve(option('--public') ?? join(ROOT, 'public', 'assets', 'unreal-positions'));
  const modulePath = resolve(option('--module') ?? join(ROOT, 'src', 'unreal', 'positionStills.data.js'));
  const settingsFile = option('--settings');
  if (settingsFile) POSITIONS = JSON.parse(readFileSync(settingsFile, 'utf8'));
  if (args.length !== 1) fail('usage: node tools/build_unreal_position_layers.mjs <Unreal-render-pack/positions> [--debug <folder>]');
  const source = args[0];
  const manifest = JSON.parse(readFileSync(join(source, 'positions.json'), 'utf8'));
  const listed = {};
  for (const entry of manifest) (listed[entry.position] ??= {})[entry.pass] = entry;

  const stills = [], report = {};
  for (const [position, settings] of Object.entries(POSITIONS)) {
    const entries = listed[position];
    if (!entries || JSON.stringify(Object.keys(entries).sort()) !== JSON.stringify([...PASSES].sort())) fail(`${position}: positions.json must list exactly ${PASSES.join(', ')}`);
    const renders = {}, sources = {};
    let width = 0, height = 0;
    for (const name of PASSES) {
      const entry = entries[name];
      if (entry.file !== `${position}/${name}.png`) fail(`${position}/${name}: unexpected file name ${entry.file}`);
      const data = readFileSync(join(source, entry.file));
      const digest = sha256(data);
      if (data.length !== entry.bytes || digest !== entry.sha256) fail(`${entry.file} does not match positions.json`);
      const image = decodePng(data);
      if (image.width !== entry.width || image.height !== entry.height) fail(`${entry.file} is ${image.width} x ${image.height}, not the listed size`);
      // This tool's own decoder must agree with sharp's, pixel for pixel.
      const check = await sharp(data).removeAlpha().raw().toBuffer();
      for (let index = 0; index < check.length; index += 1) if (check[index] !== image.rgb[index]) fail(`${entry.file}: the two PNG decoders disagree at byte ${index}`);
      renders[name] = image.rgb;
      sources[`${name}.png`] = digest;
      ({ width, height } = image);
    }
    const base = renders.base;
    const [left, top, cropWidth, cropHeight] = settings.crop;
    if (Math.abs(cropWidth / cropHeight - settings.size[0] / settings.size[1]) > 0.002) fail(`${position}: crop and size have different proportions`);

    const layers = { base };
    const details = {};
    const pixelCount = width * height;
    for (const athlete of ['lead', 'other']) {
      const white = renders[`${athlete}-gi-white`], beltWhite = renders[`${athlete}-belt-white`];
      const beltDelta = new Float32Array(pixelCount * 3), giDelta = new Float32Array(pixelCount * 3);
      for (let index = 0; index < beltDelta.length; index += 1) {
        beltDelta[index] = Math.min(255, Math.max(0, beltWhite[index] - base[index]));
        giDelta[index] = Math.min(255, Math.max(0, white[index] - base[index]));
      }
      const beltRegion = region(beltDelta, width, height, 5, 1.4);
      const giRegion = region(giDelta, width, height, 7, 1.8);
      const belt = new Float32Array(pixelCount * 3);
      for (let index = 0; index < pixelCount; index += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          giDelta[index * 3 + channel] = f32(giDelta[index * 3 + channel] * giRegion[index]);
          belt[index * 3 + channel] = f32(beltDelta[index * 3 + channel] * beltRegion[index]);
        }
      }
      // Where the belt's edge lies over the gi both layers add light, and a white belt on a
      // white gi would show a bright rim. Take the excess out of the gi, so that base + gi +
      // belt is never brighter than the two white renders added in linear light: what a
      // pixel that is part gi and part belt shows when both are white. Each render adds only
      // where it is brighter than the base, as the layers do. See the .py.
      let overlapPixels = 0;
      for (let at = 0; at < giDelta.length; at += 1) {
        const dark = toLinear(base[at]);
        const both = f32(fromLinear(dark + Math.max(0, toLinear(white[at]) - dark) + Math.max(0, toLinear(beltWhite[at]) - dark)));
        const excess = f32(f32(giDelta[at] + belt[at]) - f32(Math.max(white[at], beltWhite[at], both) - base[at]));
        if (excess > 0) { giDelta[at] = f32(Math.max(0, f32(giDelta[at] - excess))); overlapPixels += 1; }
      }
      layers[`${athlete}Belt`] = belt;
      const window = settings.hem?.[athlete], outline = settings.jacket?.[athlete];
      if (window && outline) fail(`${position}/${athlete}: give a hem window or a jacket outline, not both`);
      let rebuilt;
      if (window || outline) {
        const hem = window ? hemLine(white, giRegion, beltRegion, window, width) : null;
        const depth = outline ? insideOutline(outline, width, height) : null;
        const jacket = new Float32Array(pixelCount * 3), pants = new Float32Array(pixelCount * 3);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            // The same four-pixel ramp either way: across the hem row, or across the traced outline.
            const share = outline ? 0.5 + depth[y * width + x] / 4.0 : (hem.line[x] + 2.0 - y) / 4.0;
            const above = f32(Math.min(1, Math.max(0, share))), below = f32(1 - above);
            const at = (y * width + x) * 3;
            for (let channel = 0; channel < 3; channel += 1) {
              jacket[at + channel] = f32(giDelta[at + channel] * above);
              pants[at + channel] = f32(giDelta[at + channel] * below);
            }
          }
        }
        layers[`${athlete}Jacket`] = jacket;
        layers[`${athlete}Pants`] = pants;
        if (outline) {
          details[athlete] = { outlinePoints: outline.length };
        } else {
          const [first, last] = window.columns;
          const span = Array.from(hem.line.subarray(first, last));
          details[athlete] = { hemRows: [round(Math.min(...span), 1), round(Math.max(...span), 1)], hemColumns: hem.steady };
        }
        rebuilt = (index) => f32(f32(base[index] + jacket[index]) + pants[index]);
        if (debug && hem) {
          mkdirSync(debug, { recursive: true });
          writeFileSync(join(debug, `${position}-${athlete}-hem.json`), JSON.stringify({ columns: hem.columns, found: hem.found, smooth: Array.from(hem.smooth), close: hem.close, agreed: Array.from(hem.agreed), line: Array.from(hem.line, (value) => round(value, 2)) }));
        }
      } else {
        layers[`${athlete}Gi`] = giDelta;
        details[athlete] = {};
        rebuilt = (index) => f32(base[index] + giDelta[index]);
      }
      let giPixels = 0, beltPixels = 0, errorSum = 0, errorCount = 0;
      for (let index = 0; index < pixelCount; index += 1) {
        if (giRegion[index] > 0.5) giPixels += 1;
        if (beltRegion[index] > 0.5) beltPixels += 1;
        if (giRegion[index] > f32(0.98) && beltRegion[index] < f32(0.02)) {
          for (let channel = 0; channel < 3; channel += 1) errorSum += Math.abs(rebuilt(index * 3 + channel) - white[index * 3 + channel]);
          errorCount += 3;
        }
      }
      details[athlete].giPixels = giPixels;
      details[athlete].beltPixels = beltPixels;
      // With a white gi the layers must give back the white-gi render, away from the belt,
      // where the overlap trim above takes light out of the gi on purpose.
      details[athlete].whiteMeanError = round(errorSum / errorCount, 3);
      details[athlete].beltOverlapTrimmed = overlapPixels;
      if (debug && (window || outline)) {
        mkdirSync(debug, { recursive: true });
        const jacket = layers[`${athlete}Jacket`], pants = layers[`${athlete}Pants`];
        const jacketTint = [0.1, 0.25, 0.9].map(f32), pantsTint = [0.9, 0.2, 0.15].map(f32);
        const preview = new Float32Array(pixelCount * 3);
        for (let index = 0; index < preview.length; index += 1) {
          const channel = index % 3;
          preview[index] = Math.min(255, Math.max(0, base[index] + jacket[index] * jacketTint[channel] + pants[index] * pantsTint[channel] + belt[index]));
        }
        await sharp(Buffer.from(cropped(preview, width, settings.crop, Math.trunc)), { raw: { width: cropWidth, height: cropHeight, channels: 3 } }).png().toFile(join(debug, `${position}-${athlete}-split.png`));
      }
    }

    const folder = join(publicFolder, position);
    mkdirSync(folder, { recursive: true });
    for (const stale of readdirSync(folder)) if (stale.endsWith('.webp')) unlinkSync(join(folder, stale));
    const files = {}, urls = {};
    for (const [name, pixels] of Object.entries(layers)) {
      const fileName = `${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.webp`;
      const cut = cropped(pixels, width, settings.crop, rint8);
      const resized = resizeLanczos(cut, cropWidth, cropHeight, settings.size[0], settings.size[1]);
      // When the crop already has the published size, Pillow returns it unchanged. The resample here must agree.
      if (cropWidth === settings.size[0] && cropHeight === settings.size[1] && Buffer.compare(Buffer.from(cut), Buffer.from(resized)) !== 0) fail(`${position}/${name}: resampling at the same size changed the picture`);
      const data = await sharp(Buffer.from(resized), { raw: { width: settings.size[0], height: settings.size[1], channels: 3 } }).webp({ quality: name === 'base' ? 90 : 88, effort: 6 }).toBuffer();
      writeFileSync(join(folder, fileName), data);
      files[name] = { bytes: data.length, sha256: sha256(data) };
      urls[name] = `/assets/unreal-positions/${position}/${fileName}`;
    }
    const first = entries.base;
    stills.push({
      position,
      families: settings.families,
      width: settings.size[0],
      height: settings.size[1],
      camera: first.camera,
      sourceClip: first.sourceClip ?? null,
      sourceFrame: first.sourceFrame ?? null,
      poseReviewed: Object.values(entries).every((entry) => entry.poseReviewed === true),
      layers: urls,
      files,
      sources,
    });
    report[position] = { crop: settings.crop, size: settings.size, ...details, bytes: Object.values(files).reduce((sum, item) => sum + item.bytes, 0) };
  }

  const body = JSON.stringify(stills, null, 2);
  const text = '// Generated by tools/build_unreal_position_layers.mjs (or its twin, the .py) from the Unreal render pack.\n'
    + '// Do not edit by hand: run the tool again when the pack changes.\n'
    + `const stills = ${body};\n\n`
    + 'export default Object.freeze(stills.map((still) => Object.freeze({\n'
    + '  ...still,\n'
    + '  families: Object.freeze(still.families),\n'
    + '  layers: Object.freeze(still.layers),\n'
    + '  files: Object.freeze(still.files),\n'
    + '  sources: Object.freeze(still.sources),\n'
    + '})));\n';
  // Python's write_text on Windows writes CRLF line ends; so does this.
  writeFileSync(modulePath, text.replace(/\n/g, '\r\n'), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

await main();
