// Packs prepared music loops for the site.
//
//   node tools/pack_licensed_music.mjs --from <prepared folder> --songs fist-fight,in-the-storm
//        [--out <folder>] [--credit "Ovani Sound"] [--collection "Hyper Action"]
//
// <prepared folder> is what tools/prepare_music_loops.mjs wrote: one folder per song with
// i1.mp3, i2.mp3, i3.mp3 and manifest.json. The output holds exactly the songs named, in the
// order given, which is the order of the track menu: packs of songs not named are removed.
// Which song plays on which screen is the soundtrack table in src/audio/musicLibrary.js.
//
// The output is licensed audio. Without --out it goes to this repository's git-ignored folder
// public/assets/audio/licensed, wherever the tool is run from. Any other folder inside the
// repository is refused.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMusicPack, encodeMusicPack } from "../src/audio/musicPack.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LICENSED_DIR = path.join(REPO, "public", "assets", "audio", "licensed");
const inside = (folder, parent) => folder === parent || folder.startsWith(parent + path.sep);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1] ?? ""]);
    return pairs;
  }, []),
);
if (!args.from || !args.songs) {
  console.error('usage: node tools/pack_licensed_music.mjs --from <prepared folder> --songs a,b [--out folder] [--credit text] [--collection text]');
  process.exit(2);
}
const outDir = args.out ? path.resolve(args.out) : LICENSED_DIR;
if (inside(outDir, REPO) && !inside(outDir, LICENSED_DIR)) {
  console.error(`Refusing to write licensed music to ${outDir}: inside this repository only ${LICENSED_DIR} is git-ignored for it.`);
  process.exit(2);
}
const credit = args.credit || "Ovani Sound";
const collection = args.collection || "";
const songs = [...new Set(args.songs.split(",").map((name) => name.trim()).filter(Boolean))];

// Read and check everything before writing anything, so a wrong name leaves the folder as it was.
const prepared = songs.map((song) => {
  const folder = path.join(args.from, song);
  const manifestFile = path.join(folder, "manifest.json");
  const missing = [manifestFile, ...[1, 2, 3].map((level) => path.join(folder, `i${level}.mp3`))].filter((file) => !existsSync(file));
  if (missing.length) {
    console.error(`No prepared song "${song}": missing ${missing.join(", ")}. Nothing was written.`);
    process.exit(1);
  }
  return { folder, manifest: JSON.parse(readFileSync(manifestFile, "utf8")) };
});

mkdirSync(outDir, { recursive: true });
const tracks = [];
const written = new Set(["index.json"]);
for (const { folder, manifest } of prepared) {
  const files = {};
  const bytes = {};
  for (const level of [1, 2, 3]) {
    const audio = new Uint8Array(readFileSync(path.join(folder, `i${level}.mp3`)));
    const digest = createHash("sha256").update(audio).digest();
    const pack = encodeMusicPack(audio, digest.readUInt32LE(0));
    const unpacked = decodeMusicPack(pack);
    if (unpacked.length !== audio.length || unpacked.some((byte, index) => byte !== audio[index])) throw new Error(`pack check failed for ${manifest.id} level ${level}`);
    const name = `${manifest.id}.${level}.${digest.toString("hex").slice(0, 8)}.jqm`;
    writeFileSync(path.join(outDir, name), pack);
    written.add(name);
    files[level] = name;
    bytes[level] = pack.length;
  }
  tracks.push({
    id: manifest.id,
    title: manifest.title,
    credit,
    collection: collection || manifest.pack || "",
    mood: collection ? `${credit}: ${collection}` : credit,
    bpm: manifest.bpm,
    loopSeconds: manifest.loopSeconds,
    prerollSeconds: manifest.prerollSeconds,
    sampleRate: manifest.sampleRate,
    files,
    bytes,
  });
}
// Packs from an earlier run that this one did not write are no longer part of the set.
for (const name of readdirSync(outDir)) {
  if (name.endsWith(".jqm") && !written.has(name)) rmSync(path.join(outDir, name), { force: true });
}
writeFileSync(path.join(outDir, "index.json"), `${JSON.stringify({ version: 1, tracks }, null, 2)}\n`);
const total = tracks.reduce((sum, track) => sum + Object.values(track.bytes).reduce((a, b) => a + b, 0), 0);
console.log(`${tracks.length} song(s) in ${outDir}: ${tracks.map((track) => track.title).join(", ")} (${(total / 1048576).toFixed(1)} MB)`);
