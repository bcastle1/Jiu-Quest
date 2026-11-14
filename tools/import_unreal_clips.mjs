// Import pre-rendered Unreal technique clips into the site.
//
// Reads the render pack's clips/technique-clips.json, checks every video against
// that manifest and against what the site can play, then:
//
//   - copies each MP4 unchanged to public/assets/unreal-clips/<move>/<performer>-<camera>.mp4
//   - encodes a smaller lossy WebP poster beside it: from the pack's lossless
//     poster for a looping clip, from frame 0 of the MP4 for a clip that plays once
//   - writes src/unreal/techniqueClips.data.js, which pins every published file
//
// An entry marked "draft": true is left out and listed under draftsLeftOut.
// A technique clip is a clip of any curriculum technique: its move is one of
// TECHNIQUE_IDS, the clip id every technique has (src/unreal/techniqueIds.js).
// It is imported only when its file and SHA-256 are listed in
// tools/unreal_clip_acceptance.json; otherwise it is left out and listed under
// notAccepted. Stance clips need no acceptance line.
//
// Usage:
//   node tools/import_unreal_clips.mjs <Unreal-render-pack/clips> <ffmpeg bin dir> [--out <dir>] [--acceptance <file>]
//
// --out writes public/assets/unreal-clips/... and src/unreal/techniqueClips.data.js
// under <dir> instead of this working copy (a dry run). --acceptance reads another
// acceptance list (for a rehearsal). The render pack is not in this repository.
// Needs ffmpeg and ffprobe (with libwebp) in the given folder. Node only, no Python.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allMoves } from '../src/data/curriculum.js';
import { unrealClipMoveId } from '../src/unreal/techniqueIds.js';

// The clip id of every curriculum technique, in curriculum order, each once:
// any technique can take clips. None is a stance clip name
// (tests/unrealTechniqueIds.test.js), so the two kinds never overlap.
export const TECHNIQUE_IDS = Object.freeze([...new Set(allMoves.map((move) => unrealClipMoveId(move.id)))]);
export const PERFORMERS = Object.freeze(['fighter', 'opponent']);
export const CAMERAS = Object.freeze(['side', 'front']);
export const POSTER_QUALITY = 82;
// A move name: a lower-case letter, then lower-case letters, digits and underscores.
const NAME = /^[a-z][a-z0-9_]*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC = 'public/assets/unreal-clips';
const DATA = 'src/unreal/techniqueClips.data.js';
const ACCEPTANCE = 'tools/unreal_clip_acceptance.json';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fail = (message) => { throw new Error(message); };
const isTechnique = (move) => TECHNIQUE_IDS.includes(move);
const isStance = (move) => move === 'standing_stance' || /^(stance|enter)_[a-z][a-z0-9_]*$/.test(move);

// The owner's acceptance list: [{ file, sha256, acceptedOn }]. Checked for shape.
export function readAcceptance(list) {
  if (!Array.isArray(list)) fail('the acceptance list must be a JSON array');
  const files = new Set();
  for (const line of list) {
    if (!line || typeof line.file !== 'string' || !SHA256.test(line.sha256 ?? '') || !DAY.test(line.acceptedOn ?? '')) {
      fail(`acceptance line ${JSON.stringify(line)} needs file, a lowercase sha256 and acceptedOn as YYYY-MM-DD`);
    }
    const key = `${line.file} ${line.sha256}`;
    if (files.has(key)) fail(`acceptance line for ${line.file} is repeated`);
    files.add(key);
  }
  return list;
}

// Pure: decides which pack entries are imported, from the manifest and the
// acceptance list alone. Throws on a malformed entry. Files are checked later.
export function selectEntries(entries, acceptance = []) {
  if (!Array.isArray(entries)) fail('technique-clips.json must be a JSON array');
  const accepted = new Set(readAcceptance(acceptance).map((line) => `${line.file} ${line.sha256}`));
  const seen = new Set();
  const selected = [];
  const held = [];
  const notAccepted = [];
  const lengths = new Map();
  for (const entry of entries) {
    // A draft is a take its maker lists a visible flaw in. It waits for the
    // owner and never blocks the files around it.
    if (entry.draft) { held.push(entry.file); continue; }
    const { moveId: move, performerSide: performer, camera } = entry;
    const key = `${move}/${performer}/${camera}`;
    if (typeof move !== 'string' || !NAME.test(move) || !PERFORMERS.includes(performer) || !CAMERAS.includes(camera) || seen.has(key)) {
      fail(`unexpected or repeated clip ${key}`);
    }
    seen.add(key);
    const stem = `${move}/${performer}-${camera}`;
    if (entry.file !== `${stem}.mp4` || entry.poster !== `${stem}.webp`) fail(`${key}: file names do not follow <move>/<performer>-<camera>`);
    if (!Number.isInteger(entry.frames) || entry.frames < 1 || !(entry.fps > 0)) fail(`${entry.file}: frames and fps must be positive`);
    if (Math.abs(entry.frames / entry.fps - entry.durationSeconds) > 0.001) fail(`${entry.file}: duration does not match its frame count`);

    if (isTechnique(move)) {
      if (entry.loops !== false || entry.draft !== false) fail(`${entry.file}: a technique clip plays once ("loops": false) and is not a draft ("draft": false)`);
      const group = `${move}/${performer}`;
      const length = lengths.get(group);
      if (length && length.frames !== entry.frames) {
        fail(`${entry.file}: ${entry.frames} frames, but ${length.file} has ${length.frames}; every view of one performer must have the same length`);
      }
      lengths.set(group, length ?? { frames: entry.frames, file: entry.file });
      if (!accepted.has(`${entry.file} ${entry.sha256}`)) { notAccepted.push(entry.file); continue; }
    } else if (isStance(move)) {
      const loops = !move.startsWith('enter_');
      if (entry.loops !== loops) fail(`${entry.file}: a ${loops ? 'stance' : 'stance entry'} clip must have "loops": ${loops}`);
    } else {
      fail(`${entry.file}: ${move} is neither a technique (the clip id of a curriculum technique, see src/unreal/techniqueIds.js) nor a stance clip`);
    }
    selected.push(entry);
  }
  selected.sort((left, right) => (left.moveId < right.moveId ? -1 : left.moveId > right.moveId ? 1 : 0)
    || PERFORMERS.indexOf(left.performerSide) - PERFORMERS.indexOf(right.performerSide)
    || CAMERAS.indexOf(left.camera) - CAMERAS.indexOf(right.camera));
  return { selected, draftsLeftOut: held, notAccepted };
}

// Python's json.dumps layout, so the generated file reads the same as before.
const dump = (clip) => `{${Object.entries(clip).map(([key, value]) => `${JSON.stringify(key)}: ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`).join(', ')}}`;

export function renderDataFile(clips) {
  const lines = ["// Generated by tools/import_unreal_clips.mjs from the Unreal render pack's", '// clips/technique-clips.json. Do not edit by hand: rerun the tool.', 'export default Object.freeze(['];
  for (const clip of clips) lines.push(`  Object.freeze(${dump(clip)}),`);
  lines.push(']);', '');
  return lines.join('\n');
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const tool = (ffbin, name) => path.join(ffbin, process.platform === 'win32' ? `${name}.exe` : name);

function probe(ffbin, file) {
  const out = execFileSync(tool(ffbin, 'ffprobe'), ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames', '-of', 'json', file], { encoding: 'utf8' });
  const streams = JSON.parse(out).streams;
  const video = streams.filter((stream) => stream.codec_type === 'video');
  if (video.length !== 1 || streams.length !== 1) fail(`${file}: expected one video stream and nothing else`);
  const stream = video[0];
  const [numerator, denominator] = stream.r_frame_rate.split('/').map(Number);
  const data = readFileSync(file);
  // A browser can start playing before the whole file arrives only if the index comes first.
  const [moov, mdat] = [data.indexOf('moov'), data.indexOf('mdat')];
  return { codec: stream.codec_name, profile: stream.profile, pixelFormat: stream.pix_fmt, width: stream.width, height: stream.height,
    fps: numerator / denominator, frames: Number(stream.nb_read_frames), faststart: moov >= 0 && moov < mdat };
}

function pictureSize(ffbin, file) {
  const out = execFileSync(tool(ffbin, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file], { encoding: 'utf8' });
  const stream = JSON.parse(out).streams[0];
  return [stream.width, stream.height];
}

export function importClips({ source, ffbin, out = ROOT, acceptance }) {
  const entries = JSON.parse(readFileSync(path.join(source, 'technique-clips.json'), 'utf8'));
  const { selected, draftsLeftOut, notAccepted } = selectEntries(entries, acceptance);
  const clips = [];
  for (const entry of selected) {
    const stem = `${entry.moveId}/${entry.performerSide}-${entry.camera}`;
    const video = path.join(source, entry.file);
    if (statSync(video).size !== entry.bytes || sha256(video) !== entry.sha256) fail(`${entry.file} is not the file its manifest describes`);
    const found = probe(ffbin, video);
    const expected = { codec: 'h264', profile: 'High', pixelFormat: 'yuv420p', width: entry.width, height: entry.height, fps: Number(entry.fps), frames: entry.frames, faststart: true };
    if (JSON.stringify(found) !== JSON.stringify(expected)) fail(`${entry.file}: found ${JSON.stringify(found)}, expected ${JSON.stringify(expected)}`);

    const posterSource = path.join(source, entry.poster);
    const size = pictureSize(ffbin, posterSource);
    if (size[0] !== entry.width || size[1] !== entry.height) fail(`${entry.poster}: poster and video sizes differ`);

    const target = path.join(out, PUBLIC, `${stem}.mp4`);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(video, target);
    const posterTarget = path.join(out, PUBLIC, `${stem}.webp`);
    // A clip that plays once rests on its first frame before it starts, so its
    // poster is frame 0 of the video. A loop keeps the pack's poster.
    const posterFrame = entry.loops ? null : 0;
    // A smaller lossy copy, colour only (no alpha).
    execFileSync(tool(ffbin, 'ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', posterFrame === 0 ? video : posterSource, '-frames:v', '1',
      '-c:v', 'libwebp', '-lossless', '0', '-quality', String(POSTER_QUALITY), '-compression_level', '6', '-pix_fmt', 'yuv420p', posterTarget]);

    clips.push({
      moveId: entry.moveId, performerSide: entry.performerSide, camera: entry.camera,
      video: `/assets/unreal-clips/${stem}.mp4`, bytes: entry.bytes, sha256: entry.sha256,
      poster: `/assets/unreal-clips/${stem}.webp`, posterBytes: statSync(posterTarget).size, posterSha256: sha256(posterTarget),
      posterSourceSha256: sha256(posterSource),
      width: entry.width, height: entry.height, fps: entry.fps, frames: entry.frames,
      durationSeconds: entry.durationSeconds, loops: Boolean(entry.loops),
      choreographyReviewed: Boolean(entry.choreographyReviewed),
      posterFrame,
    });
  }
  const data = path.join(out, DATA);
  mkdirSync(path.dirname(data), { recursive: true });
  writeFileSync(data, renderDataFile(clips));
  return { clips: clips.length, moves: [...new Set(clips.map((clip) => clip.moveId))].sort(), draftsLeftOut, notAccepted,
    videoBytes: clips.reduce((sum, clip) => sum + clip.bytes, 0), posterBytes: clips.reduce((sum, clip) => sum + clip.posterBytes, 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    if (at < 0) return undefined;
    const [, value] = args.splice(at, 2);
    if (!value) fail(`${name} needs a value`);
    return value;
  };
  const out = option('--out');
  const acceptanceFile = option('--acceptance') ?? path.join(ROOT, ACCEPTANCE);
  const [source, ffbin] = args;
  if (!source || !ffbin || args.length !== 2) {
    console.error('usage: node tools/import_unreal_clips.mjs <Unreal-render-pack/clips> <ffmpeg bin dir> [--out <dir>] [--acceptance <file>]');
    process.exit(2);
  }
  const acceptance = JSON.parse(readFileSync(acceptanceFile, 'utf8'));
  console.log(JSON.stringify(importClips({ source, ffbin, out: out ? path.resolve(out) : ROOT, acceptance }), null, 2));
}
