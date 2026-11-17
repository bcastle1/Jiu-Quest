// A separate owner-approved draft publication, never an acceptance-list entry.
// Copy only the exact approved MP4 and canonical poster; preserve every current
// published row and file. The normal pack importer continues to reject drafts.
// Usage: node tools/publish_unreal_clip_draft.mjs <pack/clips> <ffmpeg bin> [--out <private directory>]
//        node tools/publish_unreal_clip_draft.mjs --restore [--out <private directory>]
//
// --restore puts the draft's row back from the approved pair that is already in
// this working copy (public/assets/unreal-clips/double_leg). That is the step
// after a normal import, which rewrites the list without the draft and leaves
// its two files where they are. It needs no pack and no ffmpeg, so it still
// works once the pack's take has been rendered again: the pinned bytes are the
// ones checked, wherever they are read from.
//
// --out writes the pair and the new list under another folder, for a private
// rehearsal. The rows and files that are already published are still read from
// this working copy, so a rehearsal here does not follow a rehearsal of the
// importer in the same folder: rehearse this tool after a real import.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import published from '../src/unreal/techniqueClips.data.js';
import { OWNER_PUBLISHED_DRAFT, isOwnerPublishedDraft } from '../src/unreal/techniquePicture.js';
import { renderDataFile } from './import_unreal_clips.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Where this working copy publishes its clips.
const PUBLISHED_CLIPS = join(ROOT, 'public/assets/unreal-clips');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// What the approved take is, besides the bytes OWNER_PUBLISHED_DRAFT pins.
const TAKE = Object.freeze({ file: 'double_leg/fighter-side.mp4', poster: 'double_leg/fighter-side.webp', width: 1280, height: 720, fps: 30, frames: 126, durationSeconds: 4.2 });
const NOT_THE_APPROVED_TAKE = 'this is not the approved take. To put the approved row back, run this tool with --restore; another take needs its own publication decision (OWNER_PUBLISHED_DRAFT)';

export function draftPublicationRow(entry, video, poster) {
  const pin = OWNER_PUBLISHED_DRAFT;
  for (const key of ['moveId', 'performerSide', 'camera', 'bytes', 'sha256']) assert.equal(entry[key], pin[key], `${key}: ${NOT_THE_APPROVED_TAKE}`);
  assert.equal(entry.file, TAKE.file);
  assert.equal(entry.poster, TAKE.poster);
  assert.deepEqual([entry.draft, entry.choreographyReviewed, entry.loops], [true, false, false]);
  assert.deepEqual([entry.width, entry.height, entry.fps, entry.frames, entry.durationSeconds], [TAKE.width, TAKE.height, TAKE.fps, TAKE.frames, TAKE.durationSeconds]);
  assert.equal(video.length, pin.bytes); assert.equal(digest(video), pin.sha256);
  assert.equal(poster.length, pin.posterBytes); assert.equal(digest(poster), pin.posterSha256);
  assert.ok(video.indexOf('moov') > 0 && video.indexOf('moov') < video.indexOf('mdat'));
  return {
    moveId: entry.moveId, performerSide: entry.performerSide, camera: entry.camera,
    video: `/assets/unreal-clips/${entry.file}`, bytes: entry.bytes, sha256: entry.sha256,
    poster: `/assets/unreal-clips/${entry.poster}`, posterBytes: poster.length, posterSha256: digest(poster),
    posterSourceSha256: digest(poster), width: entry.width, height: entry.height, fps: entry.fps, frames: entry.frames,
    durationSeconds: entry.durationSeconds, loops: false, choreographyReviewed: false, posterFrame: 63,
    draft: true, ownerDraftPublishedOn: pin.ownerDraftPublishedOn, draftNotice: pin.draftNotice,
  };
}

// Writes the list with the draft's row in its place under `out`, after checking
// the rows it starts from. `copies` are [file, published path] pairs to put
// under `out` first. Returns how many other rows were kept.
function writeRow(row, { rows, out, copies }) {
  // Fail rather than pairing a new draft with any historical camera/performer.
  // The refusal names the row and both ways it comes about: the previous draft
  // still in the list under new pins, or an accepted take an import brought.
  for (const clip of rows.filter(clip => clip.moveId === row.moveId)) {
    assert.ok(isOwnerPublishedDraft(clip), `Another take is already published for this move: ${clip.performerSide}-${clip.camera}${clip.draft === true ? ' (a draft, but not the approved one)' : ''}. The draft is published only while the list has no other row of the move. If that row is the previous draft, run the importer first: it leaves every draft out. If it is an accepted take, the draft's row stays out (docs/unreal-integration.md, "Owner-published double-leg draft").`);
  }
  for (const clip of rows) for (const [path, hash] of [[clip.video, clip.sha256], [clip.poster, clip.posterSha256]]) {
    assert.equal(digest(readFileSync(join(ROOT, 'public', path))), hash, `Existing media changed: ${path}`);
  }
  const kept = rows.filter(clip => clip.moveId !== row.moveId);
  const next = [...kept, row].sort((a, b) => a.moveId < b.moveId ? -1 : a.moveId > b.moveId ? 1 : 0);
  for (const [from, path] of copies) {
    const target = join(out, 'public', path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(from, target);
  }
  const data = join(out, 'src/unreal/techniqueClips.data.js');
  mkdirSync(dirname(data), { recursive: true }); writeFileSync(data, renderDataFile(next));
  return kept.length;
}

export function publishDraft({ source, ffbin, out = ROOT, rows = published }) {
  const entries = JSON.parse(readFileSync(join(source, 'technique-clips.json'), 'utf8'));
  const matching = entries.filter(entry => entry.file === TAKE.file);
  assert.equal(matching.length, 1, 'Exactly one current canonical fighter-side entry is required');
  const entry = matching[0];
  const videoPath = join(source, entry.file), posterPath = join(source, entry.poster);
  const row = draftPublicationRow(entry, readFileSync(videoPath), readFileSync(posterPath));
  const probe = file => JSON.parse(execFileSync(join(ffbin, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
    ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames', '-of', 'json', file], { encoding: 'utf8' })).streams;
  const streams = probe(videoPath);
  assert.equal(streams.length, 1);
  const v = streams[0];
  assert.deepEqual([v.codec_type, v.codec_name, v.profile, v.pix_fmt, v.width, v.height, v.r_frame_rate, Number(v.nb_read_frames)], ['video', 'h264', 'High', 'yuv420p', 1280, 720, '30/1', 126]);
  const images = probe(posterPath);
  assert.equal(images.length, 1);
  assert.deepEqual([images[0].codec_name, images[0].width, images[0].height], ['webp', 1280, 720]);
  const preservedRows = writeRow(row, { rows, out, copies: [[videoPath, row.video], [posterPath, row.poster]] });
  return { row, preservedRows, sourcePackModified: false, choreographyAccepted: false };
}

// The same row, from the approved pair this working copy already publishes.
// `rows` is the list to start from: by default the one in this working copy,
// which after a normal import no longer has the draft's row. `folder` is where
// the pair is read from; only the tests name another one.
export function restoreDraft({ out = ROOT, rows = published, folder = PUBLISHED_CLIPS } = {}) {
  const pin = OWNER_PUBLISHED_DRAFT;
  const videoPath = join(folder, TAKE.file), posterPath = join(folder, TAKE.poster);
  const read = file => (existsSync(file) ? readFileSync(file) : null);
  const video = read(videoPath), poster = read(posterPath);
  // Checked here, before the row's own checks, so that the refusal names the
  // way out instead of two sizes or two hashes.
  assert.ok(video && poster && digest(video) === pin.sha256 && digest(poster) === pin.posterSha256,
    'The approved pair is no longer under public/assets/unreal-clips/double_leg: a file is missing, or has other bytes than OWNER_PUBLISHED_DRAFT pins. Take the pair from the commit that published it: git checkout <commit> -- public/assets/unreal-clips/double_leg. A newly approved take is published from its pack instead: <pack/clips> <ffmpeg bin>.');
  const entry = { moveId: pin.moveId, performerSide: pin.performerSide, camera: pin.camera, bytes: pin.bytes, sha256: pin.sha256, ...TAKE, loops: false, choreographyReviewed: false, draft: true };
  const row = draftPublicationRow(entry, video, poster);
  // In place the pair is already where it belongs; a rehearsal gets a copy.
  const inPlace = out === ROOT && folder === PUBLISHED_CLIPS;
  const preservedRows = writeRow(row, { rows, out, copies: inPlace ? [] : [[videoPath, row.video], [posterPath, row.poster]] });
  return { row, preservedRows, restoredFrom: folder === PUBLISHED_CLIPS ? 'public/assets/unreal-clips/double_leg' : join(folder, 'double_leg'), sourcePackModified: false, choreographyAccepted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const output = at < 0 ? undefined : args.splice(at, 2)[1];
  assert.ok(at < 0 || output, '--out needs a directory');
  const restore = args[0] === '--restore';
  assert.ok(restore ? args.length === 1 : args.length === 2, 'Provide pack/clips and ffmpeg bin, or --restore, and optionally --out <private directory>');
  const out = output ? resolve(output) : ROOT;
  console.log(JSON.stringify(restore ? restoreDraft({ out }) : publishDraft({ source: args[0], ffbin: args[1], out }), null, 2));
}
