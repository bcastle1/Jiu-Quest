// Merge a PARTIAL Unreal render pack into the published clip list, through the
// importer's own checks, without dropping the clips that came from other packs.
//
// tools/import_unreal_clips.mjs rewrites the whole list from one render pack. A pack
// that holds only some clips (for example one new technique rendered on another
// machine) would drop every other row. This tool instead:
//   1. adds an acceptance line for each clip of the pack to tools/unreal_clip_acceptance.json
//      (the owner's publication decision, dated by --accepted-on),
//   2. runs the importer on the pack into a temporary folder (same checks: H.264 High,
//      yuv420p, size, frame rate, frame count, index before media, no audio, equal
//      length for every view of one performer; same WebP poster from frame 0),
//   3. copies the files into public/assets/unreal-clips/<move>/ and merges their rows into
//      src/unreal/techniqueClips.data.js, keeping every other row exactly as it was,
//   4. records the merged rows in tools/unreal_clips_merged.json, so that `--restore`
//      puts them back after a full import has rewritten the list (as
//      publish_unreal_clip_draft.mjs --restore does for the owner draft).
//
// Usage:
//   node tools/merge_unreal_clips.mjs <pack clips folder with technique-clips.json> --accepted-on YYYY-MM-DD [--ffbin /usr/bin]
//   node tools/merge_unreal_clips.mjs --restore
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importClips, renderDataFile, readAcceptance, PERFORMERS, CAMERAS } from './import_unreal_clips.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'src/unreal/techniqueClips.data.js');
const ACCEPTANCE = path.join(ROOT, 'tools/unreal_clip_acceptance.json');
const RECORD = path.join(ROOT, 'tools/unreal_clips_merged.json');
const PUBLIC = path.join(ROOT, 'public');

const fail = (message) => { console.error(`merge_unreal_clips: ${message}`); process.exit(1); };
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const key = (row) => `${row.moveId}/${row.performerSide}/${row.camera}`;
const order = (a, b) => (a.moveId < b.moveId ? -1 : a.moveId > b.moveId ? 1 : 0)
  || PERFORMERS.indexOf(a.performerSide) - PERFORMERS.indexOf(b.performerSide)
  || CAMERAS.indexOf(a.camera) - CAMERAS.indexOf(b.camera);

async function currentRows() {
  // Import a copy so Node's module cache never serves a stale list.
  const copy = path.join(mkdtempSync(path.join(os.tmpdir(), 'jq-clips-')), 'list.mjs');
  writeFileSync(copy, readFileSync(DATA, 'utf8'));
  const rows = (await import(pathToFileURL(copy).href)).default;
  return rows.map((row) => ({ ...row }));
}

function writeRows(rows) {
  rows.sort(order);
  writeFileSync(DATA, renderDataFile(rows));
}

function mergeAcceptance(lines) {
  const list = existsSync(ACCEPTANCE) ? JSON.parse(readFileSync(ACCEPTANCE, 'utf8')) : [];
  const files = new Set(lines.map((line) => line.file));
  const merged = [...list.filter((line) => !files.has(line.file)), ...lines];
  readAcceptance(merged);
  writeFileSync(ACCEPTANCE, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

async function publish(pack, acceptedOn, ffbin) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acceptedOn ?? '')) fail('--accepted-on YYYY-MM-DD is required (the owner\'s publication decision)');
  const entries = JSON.parse(readFileSync(path.join(pack, 'technique-clips.json'), 'utf8'));
  const lines = entries.map((entry) => ({ file: entry.file, sha256: sha256(path.join(pack, entry.file)), acceptedOn }));
  const acceptance = mergeAcceptance(lines);
  const out = mkdtempSync(path.join(os.tmpdir(), 'jq-merge-clips-'));
  const result = importClips({ source: pack, ffbin, out, acceptance });
  if (result.notAccepted.length || result.draftsLeftOut.length) fail(`not imported: ${[...result.notAccepted, ...result.draftsLeftOut].join(', ')}`);
  const fresh = (await import(pathToFileURL(path.join(out, 'src/unreal/techniqueClips.data.js')).href)).default.map((row) => ({ ...row }));
  for (const row of fresh) {
    for (const file of [row.video, row.poster]) {
      const target = path.join(PUBLIC, file);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(out, 'public', file), target);
    }
  }
  const keys = new Set(fresh.map(key));
  const rows = [...(await currentRows()).filter((row) => !keys.has(key(row))), ...fresh];
  writeRows(rows);
  const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : [];
  const kept = record.filter((row) => !keys.has(key(row)));
  writeFileSync(RECORD, `${JSON.stringify([...kept, ...fresh].sort(order), null, 2)}\n`);
  rmSync(out, { recursive: true, force: true });
  console.log(`merged ${fresh.length} clip(s): ${fresh.map(key).join(', ')}; list now has ${rows.length} rows`);
}

async function restore() {
  if (!existsSync(RECORD)) fail(`${path.relative(ROOT, RECORD)} is missing`);
  const record = JSON.parse(readFileSync(RECORD, 'utf8'));
  for (const row of record) {
    for (const [file, bytes, hash] of [[row.video, row.bytes, row.sha256], [row.poster, row.posterBytes, row.posterSha256]]) {
      const target = path.join(PUBLIC, file);
      if (!existsSync(target) || statSync(target).size !== bytes || sha256(target) !== hash) fail(`${file} is missing or is not the recorded file`);
    }
  }
  const acceptance = JSON.parse(readFileSync(ACCEPTANCE, 'utf8'));
  for (const row of record) {
    const file = row.video.replace('/assets/unreal-clips/', '');
    if (!acceptance.some((line) => line.file === file && line.sha256 === row.sha256)) fail(`no acceptance line for ${file}`);
  }
  const keys = new Set(record.map(key));
  const rows = [...(await currentRows()).filter((row) => !keys.has(key(row))), ...record.map((row) => ({ ...row }))];
  writeRows(rows);
  console.log(`restored ${record.length} merged clip row(s); list now has ${rows.length} rows`);
}

const args = process.argv.slice(2);
if (args[0] === '--restore') await restore();
else {
  const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  if (!args[0] || args[0].startsWith('--')) fail('usage: merge_unreal_clips.mjs <pack clips folder> --accepted-on YYYY-MM-DD [--ffbin /usr/bin] | --restore');
  await publish(path.resolve(args[0]), option('--accepted-on'), option('--ffbin', '/usr/bin'));
}
