// Tells the app which licensed music this build carries.
//
// Licensed music is never in this repository. A build that has it finds packs and an
// index.json in public/assets/audio/licensed (git-ignored; see docs/music.md). This plugin
// reads that index when Vite starts and writes it into the bundle as __JQ_LICENSED_MUSIC__.
// A build without the folder gets an empty list and offers only the tracks in src/storage.js.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const LICENSED_MUSIC_DIR = "public/assets/audio/licensed";
const LEVELS = ["1", "2", "3"];

// The index, keeping only tracks whose three packs are really there: a track listed without
// its files would be offered to players and then fail to play.
export function readLicensedMusic(root) {
  const dir = path.join(root, LICENSED_MUSIC_DIR);
  const indexFile = path.join(dir, "index.json");
  if (!existsSync(indexFile)) return { version: 1, tracks: [] };
  const index = JSON.parse(readFileSync(indexFile, "utf8"));
  const tracks = (Array.isArray(index.tracks) ? index.tracks : []).filter(
    (track) =>
      track &&
      typeof track === "object" &&
      track.files &&
      LEVELS.every((level) => typeof track.files[level] === "string" && path.basename(track.files[level]) === track.files[level] && existsSync(path.join(dir, track.files[level]))),
  );
  return { version: 1, tracks };
}

export default function licensedMusic() {
  return {
    name: "jiuquest-licensed-music",
    config(config) {
      const root = config.root ? path.resolve(config.root) : process.cwd();
      return { define: { __JQ_LICENSED_MUSIC__: JSON.stringify(readLicensedMusic(root)) } };
    },
  };
}
