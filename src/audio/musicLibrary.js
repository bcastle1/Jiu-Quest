// Which music the game plays where, and which tracks a player is offered.
//
// Licensed songs are not in this repository (see docs/music.md). When a build has them,
// tools/vite_licensed_music.mjs writes their index into the bundle as __JQ_LICENSED_MUSIC__;
// a build without them offers only the tracks in src/storage.js.

export const LICENSED_MUSIC_BASE = "/assets/audio/licensed/";
export const MUSIC_INTENSITY_LEVELS = [1, 2, 3];
// The id saved as the selected track when the game picks the music for each page.
export const SOUNDTRACK_ID = "soundtrack";
export const SOUNDTRACK_TITLE = "JiuQuest soundtrack";

// The soundtrack: the song each screen plays and how intense it is (1 low, 2 medium, 3 full).
// Screens not named here play what the home screen plays.
const PAGE_SOUNDTRACK = {
  dashboard: { song: "fist-fight", level: 2 },
  profile: { song: "in-the-storm", level: 3 },
  training: { song: "sneak-attack", level: 1 },
  grappling: { song: "sneak-attack", level: 1 },
  combat: { song: "binder", level: 3 },
};
const HOME_PAGE = "dashboard";

const TRACK_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const PACK_FILE = /^[a-z0-9][a-z0-9.-]{0,90}\.jqm$/;

// The index this build was made with. Browser checks may put a small test index on the page
// before the app starts; nothing else sets it.
export function readLicensedMusicIndex() {
  if (typeof window !== "undefined" && window.__jqLicensedMusicForTests) return window.__jqLicensedMusicForTests;
  return typeof __JQ_LICENSED_MUSIC__ !== "undefined" ? __JQ_LICENSED_MUSIC__ : null;
}

function licensedTrack(entry, base) {
  if (!entry || typeof entry !== "object") return null;
  const { id, title, files } = entry;
  const loopSeconds = Number(entry.loopSeconds);
  const prerollSeconds = Number(entry.prerollSeconds);
  if (typeof id !== "string" || !TRACK_ID.test(id) || typeof title !== "string" || !title.trim()) return null;
  if (!Number.isFinite(loopSeconds) || loopSeconds < 1 || !Number.isFinite(prerollSeconds) || prerollSeconds < 0 || prerollSeconds > 2) return null;
  if (!files || typeof files !== "object") return null;
  const urls = {};
  for (const level of MUSIC_INTENSITY_LEVELS) {
    const file = files[level];
    if (typeof file !== "string" || !PACK_FILE.test(file)) return null;
    urls[level] = `${base}${file}`;
  }
  const credit = typeof entry.credit === "string" ? entry.credit : "";
  return {
    id: `licensed-${id}`,
    song: id,
    title: title.trim(),
    bpm: Number(entry.bpm) || 0,
    mood: typeof entry.mood === "string" && entry.mood ? entry.mood : credit,
    credit,
    collection: typeof entry.collection === "string" ? entry.collection : "",
    licensed: true,
    playerEnabled: true,
    url: "",
    loopSeconds,
    prerollSeconds,
    files: urls,
  };
}

export function licensedTracksFrom(index) {
  const entries = Array.isArray(index?.tracks) ? index.tracks : [];
  // A folder on this site only: "/x/", never "//host/x/".
  const base = typeof index?.base === "string" && /^\/(?!\/)/.test(index.base) && index.base.endsWith("/") ? index.base : LICENSED_MUSIC_BASE;
  const seen = new Set();
  return entries
    .map((entry) => licensedTrack(entry, base))
    .filter((track) => track && !seen.has(track.id) && seen.add(track.id));
}

// Licensed tracks lead the list; the saved tracks follow, minus any the admin hid.
export function playerTrackList(licensedTracks, savedTracks) {
  const licensedIds = new Set(licensedTracks.map((track) => track.id));
  return [...licensedTracks, ...savedTracks.filter((track) => track.playerEnabled !== false && !licensedIds.has(track.id))];
}

// How intense a screen is, whatever licensed song is playing on it.
export function pageMusicLevel(view) {
  return (PAGE_SOUNDTRACK[view] ?? PAGE_SOUNDTRACK[HOME_PAGE]).level;
}

// The game's own synth pulse keeps the tempo it always had on each screen: fastest in the
// Arena, on the beat in Training, slow everywhere else. (A hosted file has one level.)
export function pulseLevel(view) {
  return view === "combat" ? 3 : view === "training" ? 2 : 1;
}

// The soundtrack's song and level for a screen, or null when this build has no licensed songs.
// A song the build does not carry is replaced by the first one it does.
export function pageMusic(view, licensedTracks) {
  if (!licensedTracks.length) return null;
  const page = PAGE_SOUNDTRACK[view] ?? PAGE_SOUNDTRACK[HOME_PAGE];
  const track = licensedTracks.find((candidate) => candidate.song === page.song) ?? licensedTracks[0];
  return { track, level: page.level };
}

// Every song and level the soundtrack can ask for, once each: what to fetch ahead.
export function soundtrackMusic(licensedTracks) {
  const seen = new Set();
  return Object.keys(PAGE_SOUNDTRACK)
    .map((view) => pageMusic(view, licensedTracks))
    .filter((music) => music && !seen.has(`${music.track.id}:${music.level}`) && seen.add(`${music.track.id}:${music.level}`));
}

// What should be playing on a screen.
//   selectedId  the saved choice: SOUNDTRACK_ID, or the id of a song the player keeps everywhere
//   pagePickId  a song picked for this screen only (it is forgotten when the screen changes)
// A chosen licensed song plays at the screen's own level; one of the game's own tracks keeps
// the levels it always had. Without licensed songs there is no soundtrack and the selected
// saved track plays.
export function resolveMusic({ view, licensedTracks, playerTracks, selectedId, pagePickId }) {
  const levelFor = (track) => (track?.licensed ? pageMusicLevel(view) : pulseLevel(view));
  const chosenId = pagePickId ?? (selectedId === SOUNDTRACK_ID ? null : selectedId);
  const chosen = chosenId ? playerTracks.find((track) => track.id === chosenId) : null;
  if (chosen) return { mode: "song", track: chosen, level: levelFor(chosen) };
  const page = pageMusic(view, licensedTracks);
  if (page) return { mode: "soundtrack", ...page };
  const first = playerTracks[0] ?? null;
  return { mode: "song", track: first, level: levelFor(first) };
}

// The first time a device sees licensed music, the soundtrack becomes the selection. Once
// only: after that the player's own choice stands.
export function licensedDefaultPatch(music, licensedTracks) {
  if (!licensedTracks.length || music?.licensedDefaultApplied) return null;
  return { activeTrackId: SOUNDTRACK_ID, licensedDefaultApplied: true };
}

// Whether a saved selection can still be honoured by this build.
export function isSelectableMusic(selectedId, licensedTracks, playerTracks) {
  if (selectedId === SOUNDTRACK_ID) return licensedTracks.length > 0;
  return playerTracks.some((track) => track.id === selectedId);
}

// What to save in place of a selection this build cannot honour, or null to leave it alone.
// A build without licensed songs leaves a saved soundtrack or licensed song as it is: the
// first own track plays meanwhile, and the choice is still there when the music is back.
export function repairedSelection(selectedId, licensedTracks, playerTracks) {
  if (isSelectableMusic(selectedId, licensedTracks, playerTracks)) return null;
  if (!licensedTracks.length) {
    if (selectedId === SOUNDTRACK_ID || (typeof selectedId === "string" && selectedId.startsWith("licensed-"))) return null;
    return playerTracks[0]?.id ?? null;
  }
  return SOUNDTRACK_ID;
}

// Changes only when what would be played changes, so editing a track's notes does not restart it.
export function musicTrackKey(track) {
  if (!track) return "";
  return JSON.stringify([track.id, track.url ?? "", track.licensed ? [track.files, track.loopSeconds, track.prerollSeconds] : Number(track.bpm) || 0]);
}
