// Run by the deploy after it places licensed music. It fails unless every song the index
// lists is one the build will carry and the game will accept, every pack is a real pack, and
// nothing else is in the folder: a build that was meant to carry music never ships without
// it, or with only part of it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { licensedTracksFrom } from "../src/audio/musicLibrary.js";
import { isMusicPack } from "../src/audio/musicPack.js";
import { LICENSED_MUSIC_DIR, readLicensedMusic } from "./vite_licensed_music.mjs";

const root = process.cwd();
const dir = path.join(root, LICENSED_MUSIC_DIR);
const indexFile = path.join(dir, "index.json");
const problems = [];
const listed = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")).tracks : null;
if (!Array.isArray(listed) || !listed.length) {
  problems.push("index.json lists no songs");
} else {
  // What the build will put in the bundle, then what the game makes of that.
  const built = readLicensedMusic(root).tracks;
  const playable = licensedTracksFrom({ tracks: built });
  const name = (track) => track?.title ?? track?.id ?? "a song";
  for (const track of listed) {
    if (!built.includes(track) && !built.some((kept) => kept.id === track?.id)) problems.push(`${name(track)} is listed but its three packs are not all there`);
    else if (!playable.some((kept) => kept.song === track.id)) problems.push(`${name(track)} is listed but the game would not accept its entry`);
  }
  const expected = new Set(["index.json", ...built.flatMap((track) => Object.values(track.files))]);
  for (const track of built) {
    for (const file of Object.values(track.files)) {
      if (!isMusicPack(new Uint8Array(readFileSync(path.join(dir, file))))) problems.push(`${file} is not a music pack`);
    }
  }
  for (const file of readdirSync(dir)) {
    if (!expected.has(file)) problems.push(`${file} is in the licensed music folder but no song uses it`);
  }
  if (!problems.length) console.log(`Licensed music: ${playable.map((track) => track.title).join(", ")}.`);
}
if (problems.length) {
  console.error(`Licensed music check failed: ${problems.join("; ")}.`);
  process.exit(1);
}
