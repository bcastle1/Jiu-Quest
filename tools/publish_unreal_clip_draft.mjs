// A separate owner-approved draft publication, never an acceptance-list entry.
// Copy only the exact approved MP4 and canonical poster; preserve every current
// published row and file. The normal pack importer continues to reject drafts.
// Usage: node tools/publish_unreal_clip_draft.mjs <pack/clips> <ffmpeg bin> [--out <private directory>]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import published from '../src/unreal/techniqueClips.data.js';
import { OWNER_PUBLISHED_DRAFT, isOwnerPublishedDraft } from '../src/unreal/techniquePicture.js';
import { renderDataFile } from './import_unreal_clips.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function draftPublicationRow(entry, video, poster) {
  const pin = OWNER_PUBLISHED_DRAFT;
  for (const key of ['moveId', 'performerSide', 'camera', 'bytes', 'sha256']) assert.equal(entry[key], pin[key], key);
  assert.equal(entry.file, 'double_leg/fighter-side.mp4');
  assert.equal(entry.poster, 'double_leg/fighter-side.webp');
  assert.deepEqual([entry.draft, entry.choreographyReviewed, entry.loops], [true, false, false]);
  assert.deepEqual([entry.width, entry.height, entry.fps, entry.frames, entry.durationSeconds], [1280, 720, 30, 126, 4.2]);
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

export function publishDraft({ source, ffbin, out = ROOT }) {
  const entries = JSON.parse(readFileSync(join(source, 'technique-clips.json'), 'utf8'));
  const matching = entries.filter(entry => entry.file === 'double_leg/fighter-side.mp4');
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
  // Fail rather than pairing a new draft with any historical camera/performer.
  for (const clip of published.filter(clip => clip.moveId === row.moveId)) assert.ok(isOwnerPublishedDraft(clip), 'Another take is already published for this move');
  for (const clip of published) for (const [path, hash] of [[clip.video, clip.sha256], [clip.poster, clip.posterSha256]]) {
    assert.equal(digest(readFileSync(join(ROOT, 'public', path))), hash, `Existing media changed: ${path}`);
  }
  const rows = [...published.filter(clip => clip.moveId !== row.moveId), row].sort((a, b) => a.moveId < b.moveId ? -1 : a.moveId > b.moveId ? 1 : 0);
  for (const [from, path] of [[videoPath, row.video], [posterPath, row.poster]]) {
    const target = join(out, 'public', path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(from, target);
  }
  const data = join(out, 'src/unreal/techniqueClips.data.js');
  mkdirSync(dirname(data), { recursive: true }); writeFileSync(data, renderDataFile(rows));
  return { row, preservedRows: published.filter(clip => clip.moveId !== row.moveId).length, sourcePackModified: false, choreographyAccepted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, ffbin, option, output] = process.argv.slice(2);
  assert.ok(source && ffbin && (!option || option === '--out' && output), 'Provide pack/clips, ffmpeg bin, and optional --out');
  console.log(JSON.stringify(publishDraft({ source, ffbin, out: output ? resolve(output) : ROOT }), null, 2));
}
