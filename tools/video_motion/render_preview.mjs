#!/usr/bin/env node
// Render a JiuQuest paired choreography GLB (two athletes under JQ_Pair, see
// tools/video_motion/rig.py) to PNG frames, and optionally an MP4, in headless
// Chromium with three.js. Made for previewing fitted motion in a container
// without a GPU: WebGL runs on SwiftShader.
//
// Usage:
//   node tools/video_motion/render_preview.mjs --glb <file.glb> --out <dir>
//       [--from 0] [--to N] [--step 1] [--frames 0,40,80,125]
//       [--width 1280 --height 720]
//       [--camera side|front|top|orbit:<deg>|json:<file>] [--fov 35]
//       [--skeleton] [--floor mat|none] [--shadows] [--joints]
//       [--appearance <file.json>] [--mp4 <file.mp4>] [--fps 30]
//       [--browser <chrome executable>]
//
// Frames. Frame i is the GLB's first animation at its i-th key time (the
// union of its samplers' input times, read from the GLB). It is posed with
// AnimationMixer.setTime, never a clock, so a run is deterministic. --from and
// --to (inclusive, default: every key; a --to past the end stops at the last
// key) and --step pick a range; --frames picks a list instead, rendered (and
// encoded) in the order given. Frame i is written to <out>/frame_<i, 4 digits>.png, and
// <out>/frames.json records every frame's time and camera, the rectangle each
// athlete covers in the image (from the CPU-skinned meshes) and whether that
// rectangle is wholly inside the image. --joints also records every joint's
// world position (scene space, metres) and image position (pixels from the
// top-left corner) per frame, in the order of "joint_names".
//
// Cameras. All but json are fixed for the clip and fitted to the joint
// positions of both athletes over every key, so the bodies stay in frame for
// the whole clip whatever --from/--to are:
//   side      perpendicular to the line from the attacker's pelvis to the
//             defender's at key 0, 10 degrees above level; the attacker is on
//             the left of the image. When the pelvises are stacked (under
//             10 cm apart on the mat), the attacker's torso facing, or its
//             pelvis-to-neck axis when lying down, stands in for that line
//             (frames.json "pelvis_line" says which was used)
//   front     along that line, from behind the defender
//   top       overhead oblique: 60 degrees above level, turned 30 degrees from
//             side toward front
//   orbit:<d> side turned d degrees about the vertical (orbit:90 is front,
//             orbit:-90 looks from behind the attacker)
//   json:<f>  {"position":[x,y,z],"target":[x,y,z],"fov_deg":v,"up":[0,1,0]} in
//             the GLB's scene space (Y-up, metres). Add "frames": a list with
//             one entry per key (the last holds), or entries that each carry
//             "frame" (linear in between); entries may leave fields out.
// --fov sets the vertical field of view of the fitted cameras (default 35).
//
// Look. The athletes are dressed as on the site (src/animation/pairedMaterials.js
// and MoveAnimationManager's palette logic): the attacker in a white gi with a
// crew cut, the defender in a navy gi with slicked-back hair, both blue belts.
// Unlike the site, the preview also tints the gi and belt sheen with the cloth
// color; with the authored white sheen a navy gi reads silver from above.
// --appearance takes {"JQ_Attacker": {...}, "JQ_Defender": {...}} with any of
// giTop, giPants, skinTone, hairColor (#rrggbb), hairStyle (Crew, Long, Slick,
// Mohawk, Spikes, Bald or a site name), belt (white, blue, purple, brown,
// black) and stripes (0-4). --floor mat (default) lays a muted green-grey mat
// with 1 m squares at y = 0; --shadows lets the key light cast shadows.
// --skeleton draws each athlete's bones over everything (attacker orange,
// defender cyan; lighter on the athlete's left side, darker on the right).
//
// Output video. --mp4 encodes the rendered frames, in order, as H.264 yuv420p
// at --fps (default 30) with ffmpeg (FFMPEG overrides the binary).
//
// Needs the repository's node_modules (pnpm install --frozen-lockfile). When
// Playwright's pinned browser is not installed, the newest Chromium found in
// PLAYWRIGHT_BROWSERS_PATH (or ~/.cache/ms-playwright) is used; --browser or
// JIUQUEST_BROWSER_EXECUTABLE names one explicitly.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = '/tools/video_motion/preview/index.html';
const GLB_URL = '/__input.glb';
// The only repository paths the local server hands out.
const SERVED = ['/tools/video_motion/preview/', '/node_modules/three/', '/src/animation/pairedMaterials.js'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};
const CHROME_ARGS = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
const HEX = /^#[0-9a-f]{6}$/i;
// The manifest's hairstyles and the site's names for them (src/storage.js).
const HAIR_STYLES = ['crew', 'long', 'slick', 'mohawk', 'spikes', 'bald', 'shadow spikes', 'short fade', 'braided top',
  'curly guard', 'wave cut', 'storm tail', 'crew cut', 'long hair', 'slicked back'];

const USAGE = 'Usage: node tools/video_motion/render_preview.mjs --glb <file.glb> --out <dir>\n'
  + '  [--from 0] [--to N] [--step 1] [--frames 0,40,80] [--width 1280 --height 720]\n'
  + '  [--camera side|front|top|orbit:<deg>|json:<file>] [--fov 35] [--skeleton]\n'
  + '  [--floor mat|none] [--shadows] [--joints] [--appearance <file.json>] [--mp4 <file.mp4>] [--fps 30]\n'
  + '  [--browser <chrome executable>]\n'
  + 'The comment at the top of tools/video_motion/render_preview.mjs explains each option.';

class UsageError extends Error {}

function integer(name, value, min, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new UsageError(`--${name} must be an integer in [${min}, ${max}], not "${value}"`);
  }
  return Number(value);
}

function number(name, value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new UsageError(`--${name} must be a number in [${min}, ${max}], not "${value}"`);
  return parsed;
}

function vector3(value, where) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new UsageError(`${where} must be an array of three numbers`);
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

async function cameraSpec(text) {
  if (['side', 'front', 'top'].includes(text)) return { kind: text };
  const orbit = /^orbit:(-?\d+(?:\.\d+)?)$/.exec(text);
  if (orbit) return { kind: 'orbit', deg: Number(orbit[1]) };
  if (text.startsWith('json:')) {
    const file = path.resolve(text.slice(5));
    let spec;
    try {
      spec = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      throw new UsageError(`--camera ${text}: ${error.message}`);
    }
    if (!isObject(spec)) throw new UsageError(`--camera ${text}: the file must hold a JSON object`);
    const frames = Array.isArray(spec.frames) ? spec.frames : [];
    if (spec.frames !== undefined && !frames.length) throw new UsageError(`--camera ${text}: "frames" must be a non-empty list`);
    const entries = frames.length ? frames.map((entry) => ({ ...spec, frames: undefined, ...entry })) : [spec];
    entries.forEach((entry, k) => {
      const where = frames.length ? `${file}: frames[${k}]` : file;
      vector3(entry.position, `${where} position`);
      vector3(entry.target, `${where} target`);
      if (entry.up !== undefined) vector3(entry.up, `${where} up`);
      if (entry.up !== undefined && entry.up.every((v) => v === 0)) throw new UsageError(`${where} up must not be zero`);
      if (entry.position.every((v, j) => v === entry.target[j])) throw new UsageError(`${where} position and target must differ`);
      if (entry.fov_deg !== undefined && !(entry.fov_deg > 0 && entry.fov_deg < 180)) throw new UsageError(`${where} fov_deg must be in (0, 180)`);
    });
    if (!frames.every(isObject)) throw new UsageError(`--camera ${text}: every entry of "frames" must be an object`);
    const keyed = frames.filter((entry) => entry.frame !== undefined);
    if (keyed.length && (keyed.length !== frames.length || !keyed.every((entry) => Number.isInteger(entry.frame) && entry.frame >= 0))) {
      throw new UsageError(`--camera ${text}: either every entry of "frames" has an integer "frame" >= 0, or none has`);
    }
    return { kind: 'json', file, spec };
  }
  throw new UsageError(`--camera must be side, front, top, orbit:<deg> or json:<file>, not "${text}"`);
}

async function appearanceSpec(file) {
  if (!file) return {};
  let spec;
  try {
    spec = JSON.parse(await readFile(path.resolve(file), 'utf8'));
  } catch (error) {
    throw new UsageError(`--appearance ${file}: ${error.message}`);
  }
  if (!isObject(spec)) throw new UsageError(`--appearance ${file}: the file must hold a JSON object`);
  for (const [role, look] of Object.entries(spec)) {
    if (!['JQ_Attacker', 'JQ_Defender'].includes(role)) throw new UsageError(`--appearance: unknown athlete "${role}"`);
    if (!isObject(look)) throw new UsageError(`--appearance ${role} must be an object`);
    for (const [key, value] of Object.entries(look)) {
      if (['giTop', 'giPants', 'skinTone', 'hairColor'].includes(key)) {
        if (!HEX.test(value)) throw new UsageError(`--appearance ${role}.${key} must be #rrggbb`);
      } else if (key === 'belt') {
        if (!['white', 'blue', 'purple', 'brown', 'black'].includes(value)) throw new UsageError(`--appearance ${role}.belt must be white, blue, purple, brown or black`);
      } else if (key === 'stripes') {
        if (!Number.isInteger(value) || value < 0 || value > 4) throw new UsageError(`--appearance ${role}.stripes must be 0-4`);
      } else if (key === 'hairStyle') {
        if (!HAIR_STYLES.includes(String(value).trim().toLowerCase())) throw new UsageError(`--appearance ${role}.hairStyle must be one of ${HAIR_STYLES.join(', ')}`);
      } else {
        throw new UsageError(`--appearance ${role}: unknown field "${key}"`);
      }
    }
  }
  return spec;
}

export async function parseOptions(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        glb: { type: 'string' },
        out: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        step: { type: 'string', default: '1' },
        frames: { type: 'string' },
        width: { type: 'string', default: '1280' },
        height: { type: 'string', default: '720' },
        camera: { type: 'string', default: 'side' },
        fov: { type: 'string', default: '35' },
        skeleton: { type: 'boolean', default: false },
        floor: { type: 'string', default: 'mat' },
        shadows: { type: 'boolean', default: false },
        joints: { type: 'boolean', default: false },
        appearance: { type: 'string' },
        mp4: { type: 'string' },
        fps: { type: 'string', default: '30' },
        browser: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (values.help) return { help: true };
  if (!values.glb || !values.out) throw new UsageError('--glb and --out are required');
  const glb = path.resolve(values.glb);
  if (!existsSync(glb)) throw new UsageError(`--glb ${values.glb} does not exist`);
  if (!['mat', 'none'].includes(values.floor)) throw new UsageError('--floor must be mat or none');
  let frames;
  if (values.frames !== undefined) {
    if (values.from !== undefined || values.to !== undefined) throw new UsageError('use --frames or --from/--to, not both');
    frames = values.frames.split(',').map((item) => integer('frames', item.trim(), 0));
    if (!frames.length) throw new UsageError('--frames is empty');
  }
  return {
    glb,
    out: path.resolve(values.out),
    from: integer('from', values.from, 0),
    to: integer('to', values.to, 0),
    step: integer('step', values.step, 1),
    frames,
    // 8192 is the largest drawing buffer SwiftShader offers.
    width: integer('width', values.width, 16, 8192),
    height: integer('height', values.height, 16, 8192),
    camera: await cameraSpec(values.camera),
    cameraText: values.camera,
    fov: number('fov', values.fov, 1, 170),
    skeleton: values.skeleton,
    floor: values.floor,
    shadows: values.shadows,
    joints: values.joints,
    appearance: await appearanceSpec(values.appearance),
    mp4: values.mp4 ? path.resolve(values.mp4) : null,
    fps: number('fps', values.fps, 0.1, 1000),
    browser: values.browser ?? process.env.JIUQUEST_BROWSER_EXECUTABLE ?? null,
  };
}

export function selectFrames(opts, keyCount) {
  const last = keyCount - 1;
  if (opts.frames) {
    const bad = opts.frames.filter((index) => index > last);
    if (bad.length) throw new UsageError(`--frames ${bad.join(',')} outside 0..${last} (the GLB has ${keyCount} keys)`);
    return opts.frames;
  }
  const from = opts.from ?? 0;
  const to = Math.min(opts.to ?? last, last);
  if (from > to) throw new UsageError(`--from ${from} is after --to ${to} (the GLB has ${keyCount} keys)`);
  const list = [];
  for (let index = from; index <= to; index += opts.step) list.push(index);
  return list;
}

// ---------------------------------------------------------------- local server

export async function startServer(glbPath) {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') throw new Error('not served');
      const url = new URL(request.url, 'http://127.0.0.1');
      let file;
      if (url.pathname === GLB_URL) {
        file = glbPath;
      } else {
        const pathname = path.posix.normalize(decodeURIComponent(url.pathname));
        const allowed = SERVED.some((prefix) => (prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix));
        if (!allowed) throw new Error('not served');
        file = path.join(ROOT, pathname);
        if (!file.startsWith(ROOT + path.sep)) throw new Error('not served');
      }
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

// ---------------------------------------------------------------- browser

// The newest Chromium (headless shell preferred) installed for Playwright.
function installedChromium() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  const layouts = {
    chromium_headless_shell: ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-win64/chrome-headless-shell.exe'],
    chromium: ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
  };
  const found = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const match = /^(chromium_headless_shell|chromium)-(\d+)$/.exec(entry);
      if (!match) continue;
      for (const relative of layouts[match[1]]) {
        const executable = path.join(root, entry, relative);
        if (existsSync(executable)) found.push({ executable, build: Number(match[2]), shell: match[1] !== 'chromium' });
      }
    }
  }
  found.sort((a, b) => b.build - a.build || Number(b.shell) - Number(a.shell));
  return found[0]?.executable ?? null;
}

async function launchBrowser(executable) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('playwright is not installed: run "pnpm install --frozen-lockfile" in the repository root');
  }
  if (executable) return chromium.launch({ executablePath: executable, args: CHROME_ARGS });
  try {
    return await chromium.launch({ args: CHROME_ARGS });
  } catch (error) {
    const fallback = /Executable doesn't exist/i.test(String(error?.message)) ? installedChromium() : null;
    if (!fallback) throw error;
    console.error(`render_preview: Playwright's own browser build is not installed; using ${fallback}`);
    return chromium.launch({ executablePath: fallback, args: CHROME_ARGS });
  }
}

// ---------------------------------------------------------------- ffmpeg

function startEncoder(file, fps) {
  const child = spawn(process.env.FFMPEG || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', 'pipe:0',
    // H.264 4:2:0 needs even dimensions.
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  let failure = null;
  child.stdin.on('error', (error) => { failure = failure ?? error; });
  const done = new Promise((resolve, reject) => {
    child.on('error', (error) => reject(new Error(`could not run ffmpeg: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
  });
  done.catch(() => {});
  return {
    write(buffer) {
      if (failure) return Promise.reject(failure);
      if (child.stdin.write(buffer)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        child.stdin.once('drain', resolve);
        // Never wait for a drain from an ffmpeg that has gone.
        done.then(() => reject(new Error('ffmpeg exited before the last frame')), reject);
      });
    },
    async finish() {
      child.stdin.end();
      await done;
      if (failure) throw failure;
    },
    // A failed run leaves no partial video that could pass for a whole one.
    async abort() {
      child.kill('SIGKILL');
      await done.catch(() => {});
      await rm(file, { force: true });
    },
  };
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = await parseOptions(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const started = performance.now();
  await mkdir(opts.out, { recursive: true });
  if (opts.mp4) await mkdir(path.dirname(opts.mp4), { recursive: true });
  const glbBytes = await readFile(opts.glb);

  const server = await startServer(opts.glb);
  let browser = null;
  let encoder = null;
  try {
    browser = await launchBrowser(opts.browser);
    const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(10 * 60 * 1000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    page.on('console', (message) => {
      const text = message.text();
      if (!['error', 'warning'].includes(message.type()) || /GPU stall due to ReadPixels/.test(text)) return;
      console.error(`[page ${message.type()}] ${text}`);
    });
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}${PAGE}`);
    await page.waitForFunction(() => window.jqPreview?.ready === true);

    const loadStarted = performance.now();
    const info = await page.evaluate((config) => window.jqPreview.load(config), {
      glbUrl: GLB_URL,
      width: opts.width,
      height: opts.height,
      camera: opts.camera,
      fovDeg: opts.fov,
      skeleton: opts.skeleton,
      floor: opts.floor,
      shadows: opts.shadows,
      appearance: opts.appearance,
    });
    const loadSeconds = (performance.now() - loadStarted) / 1000;
    for (const warning of info.warnings) console.error(`render_preview: warning: ${warning}`);
    const indices = selectFrames(opts, info.key_count);
    if (opts.camera.kind === 'json' && Array.isArray(opts.camera.spec.frames)) {
      const keyed = opts.camera.spec.frames.every((entry) => Number.isInteger(entry.frame));
      if (!keyed && opts.camera.spec.frames.length < info.key_count) {
        console.error(`render_preview: warning: the camera file has ${opts.camera.spec.frames.length} frames for ${info.key_count} keys; the last one holds`);
      }
    }

    if (opts.mp4) encoder = startEncoder(opts.mp4, opts.fps);
    const frames = [];
    const renderStarted = performance.now();
    for (const index of indices) {
      const result = await page.evaluate(([i, joints]) => window.jqPreview.renderFrame(i, { joints }), [index, opts.joints]);
      if (pageErrors.length) throw pageErrors[0];
      const png = Buffer.from(result.png.slice(result.png.indexOf(',') + 1), 'base64');
      const name = `frame_${String(index).padStart(4, '0')}.png`;
      await writeFile(path.join(opts.out, name), png);
      if (encoder) await encoder.write(png);
      frames.push({ index, time: result.time, file: name, camera: result.camera, athletes: result.athletes, joints: result.joints });
    }
    const renderSeconds = (performance.now() - renderStarted) / 1000;
    if (encoder) {
      await encoder.finish();
      encoder = null;
    }

    const outOfFrame = frames.filter((frame) => Object.values(frame.athletes).some((athlete) => !athlete.in_frame));
    const report = {
      tool: 'tools/video_motion/render_preview.mjs',
      glb: opts.glb,
      glb_sha256: createHash('sha256').update(glbBytes).digest('hex'),
      animation: info.animation,
      animation_count: info.animation_count,
      key_count: info.key_count,
      duration: info.duration,
      times: info.times,
      width: opts.width,
      height: opts.height,
      camera: opts.cameraText,
      camera_frame0: info.camera_frame0,
      pelvis_line: info.pelvis_line,
      joint_bounds: info.joint_bounds,
      skeleton: opts.skeleton,
      floor: opts.floor,
      shadows: opts.shadows,
      appearance: info.appearance,
      joint_names: opts.joints ? info.joint_names : undefined,
      mp4: opts.mp4,
      fps: opts.mp4 ? opts.fps : undefined,
      browser: browser.version(),
      renderer: info.renderer,
      three: info.three,
      timing: {
        load_seconds: Number(loadSeconds.toFixed(3)),
        seconds_per_frame: Number((renderSeconds / Math.max(1, frames.length)).toFixed(3)),
        total_seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
      },
      frames_out_of_frame: outOfFrame.map((frame) => frame.index),
      warnings: info.warnings,
      frames,
    };
    await writeFile(path.join(opts.out, 'frames.json'), `${JSON.stringify(report, null, 2)}\n`);

    console.log(`render_preview: ${frames.length} frame(s) of ${info.key_count} keys -> ${opts.out}`
      + (opts.mp4 ? `, ${opts.mp4}` : ''));
    console.log(`render_preview: ${report.timing.seconds_per_frame} s/frame at ${opts.width}x${opts.height} (load ${report.timing.load_seconds} s, ${info.renderer})`);
    if (outOfFrame.length) {
      console.error(`render_preview: warning: an athlete leaves the image in frame(s) ${outOfFrame.map((frame) => frame.index).join(', ')}`);
    }
  } finally {
    if (encoder) await encoder.abort();
    await browser?.close().catch(() => {});
    server.close();
  }
}

// Run only when executed, so the helpers above can be imported by tests.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`render_preview: ${error instanceof UsageError ? error.message : error?.stack ?? error}`);
    if (error instanceof UsageError) console.error(USAGE);
    process.exitCode = 1;
  });
}
