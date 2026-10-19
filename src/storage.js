import { allMoves, beltMoveCount, moves } from "./data/curriculum.js";

export const ADMIN_CODE = "patriots";
export const MAX_FIGHTERS = 5;
const STORAGE_KEY = "jiuquest:v1";
const RECOVERY_KEY = `${STORAGE_KEY}:recovery`;
let unreadableStoredState = null;
let storageStatus = { ok: true, message: "Progress is stored on this device." };
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const palette = {
  skin: ["#f1c6a8", "#d99b71", "#a86b4d", "#6f432f", "#3d241b", "#120805"],
  hair: ["#11131c", "#3b251b", "#8a5b2d", "#d7c09a", "#6b6f86", "#f8f4ea"],
  gi: ["#f8fbff", "#112a58", "#151922", "#7f8794", "#b61f2b", "#7d52ff", "#1d7d68"],
};

const fightingStances = ["wrestling stance", "sumo base", "boxer shell", "karate stance", "muay thai guard", "sambo crouch", "capoeira rhythm"];
const defaultFightingStance = "wrestling stance";

const normalizeStance = (stance) => (fightingStances.includes(stance) ? stance : defaultFightingStance);

export const defaultMusicTracks = [
  {
    id: "ascension-gate",
    title: "Ascension Gate",
    bpm: 145,
    mood: "Dark techno combat surge",
    source: "Generated from broad energy reference: 01 Believer.mp3",
    url: "/assets/audio/ascension-gate.wav",
    playerEnabled: true,
    notes: "Original instrumental loop for JiuQuest. No singing, no lyrics, no copied melody, and no recognizable beat pattern from the source file.",
  },
  {
    id: "power-clash",
    title: "Power Clash",
    bpm: 145,
    mood: "Aggressive arena boss-fight rhythm",
    source: "Generated from broad energy reference: 01 Boom Boom Pow.mp3",
    url: "/assets/audio/power-clash.wav",
    playerEnabled: true,
    notes: "Original instrumental loop for JiuQuest. No singing, no lyrics, no copied melody, and no recognizable beat pattern from the source file.",
  },
  {
    id: "paradise-circuit",
    title: "Paradise Circuit",
    bpm: 138,
    mood: "Bright cyber build with combat drop",
    source: "Generated from broad energy reference: 03 Paradise.mp3",
    url: "/assets/audio/paradise-circuit.wav",
    playerEnabled: true,
    notes: "Original instrumental loop for JiuQuest. No singing, no lyrics, no copied melody, and no recognizable beat pattern from the source file.",
  },
  {
    id: "dojo-pulse",
    title: "Dojo Pulse",
    bpm: 132,
    mood: "Focused training pulse",
    source: "Procedural synth",
    url: "",
    playerEnabled: true,
    notes: "Default mat-room training loop. Instrumental only; no singing or lyrical vocals.",
  },
];

export const customizationOptions = {
  skinTones: palette.skin,
  hairColors: palette.hair,
  giColors: palette.gi,
  genders: ["boy", "girl", "non-binary"],
  hairStyles: ["shadow spikes", "short fade", "braided top", "curly guard", "wave cut", "storm tail", "bald", "crew cut", "mohawk", "long hair", "slicked back"],
  countries: ["United States", "Brazil", "Japan", "Mexico", "Canada", "Philippines", "France", "Nigeria", "United Kingdom"],
  stances: fightingStances,
  auras: ["void violet", "mat gold", "blue flame", "red surge", "emerald focus"],
  emblems: ["none", "triangle", "lion", "wave", "star", "phoenix", "mountain"],
};

export const defaultAdminSettings = {
  algorithm: {
    baseTechnique: 1,
    stepAccuracy: 1,
    trainingBonus: 1,
    beltBonus: 1,
    matchBonus: 1,
    scenarioBonus: 1,
    basicMovePenalty: 0.7,
    npcVariance: 18,
  },
  categoryWeights: {
    strike: 0.74,
    takedown: 1,
    control: 0.94,
    transition: 0.98,
    escape: 0.92,
    sweep: 1.02,
    pass: 1.03,
    defense: 0.9,
    submission: 1.14,
  },
  music: {
    activeTrackId: "ascension-gate",
    volume: 0.34,
    tracks: defaultMusicTracks,
  },
};

export const defaultNpcs = [
  {
    id: "npc-ryu",
    name: "Ryu Tanaka",
    country: "Japan",
    belt: "white",
    stripes: 0,
    difficulty: 42,
    skinTone: "#d99b71",
    hairColor: "#11131c",
    hairStyle: "shadow spikes",
    gender: "boy",
    giTop: "#112a58",
    giPants: "#f8fbff",
    stance: "karate stance",
    aura: "blue flame",
    emblem: "triangle",
  },
  {
    id: "npc-luana",
    name: "Luana Rocha",
    country: "Brazil",
    belt: "white",
    stripes: 2,
    difficulty: 54,
    skinTone: "#a86b4d",
    hairColor: "#3b251b",
    hairStyle: "braided top",
    gender: "girl",
    giTop: "#f8fbff",
    giPants: "#151922",
    stance: "sumo base",
    aura: "mat gold",
    emblem: "lion",
  },
  {
    id: "npc-dante",
    name: "Dante Silva",
    country: "United States",
    belt: "blue",
    stripes: 1,
    difficulty: 66,
    skinTone: "#6f432f",
    hairColor: "#11131c",
    hairStyle: "short fade",
    gender: "boy",
    giTop: "#151922",
    giPants: "#151922",
    stance: "wrestling stance",
    aura: "void violet",
    emblem: "mountain",
  },
];

const defaultProgress = () =>
  allMoves.reduce((progress, move) => {
    progress[move.id] = 0;
    return progress;
  }, {});

export function createFighter(overrides = {}) {
  const now = Date.now();
  return {
    id: overrides.id ?? `fighter-${now}-${Math.random().toString(16).slice(2)}`,
    name: overrides.name ?? "New Challenger",
    country: overrides.country ?? "United States",
    gender: overrides.gender ?? "boy",
    skinTone: overrides.skinTone ?? palette.skin[1],
    hairColor: overrides.hairColor ?? palette.hair[0],
    hairStyle: overrides.hairStyle ?? "shadow spikes",
    giTop: overrides.giTop ?? palette.gi[0],
    giPants: overrides.giPants ?? palette.gi[0],
    stance: normalizeStance(overrides.stance),
    aura: overrides.aura ?? "void violet",
    emblem: overrides.emblem ?? "triangle",
    startPose: overrides.startPose ?? "standing",
    progress: { ...defaultProgress(), ...(overrides.progress ?? {}) },
    matches: overrides.matches ?? 0,
    wins: overrides.wins ?? 0,
    losses: overrides.losses ?? 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: now,
  };
}

const seedFighters = () => [
  createFighter({
    id: "fighter-ryon",
    name: "Ryon Gracie",
    country: "Brazil",
    gender: "boy",
    giTop: "#f8fbff",
    giPants: "#f8fbff",
    skinTone: "#d99b71",
    hairColor: "#11131c",
    hairStyle: "shadow spikes",
    stance: "wrestling stance",
    aura: "void violet",
    progress: {
      "take-the-back-mount": 4,
      "rear-naked-choke": 3,
      "establish-clinch": 5,
      "trap-roll-escape": 5,
    },
  }),
];

const defaultState = () => ({
  selectedFighterId: "fighter-ryon",
  fighters: seedFighters(),
  npcs: defaultNpcs,
  adminSettings: defaultAdminSettings,
});

function normalizeState(state) {
  const fallback = defaultState();
  const validFighters = Array.isArray(state?.fighters) ? state.fighters.filter(isRecord) : [];
  const fighters = validFighters.length ? validFighters.slice(0, MAX_FIGHTERS) : fallback.fighters;
  const normalizedFighters = fighters.map((fighter) => ({
    ...createFighter(fighter),
    ...fighter,
    stance: normalizeStance(fighter.stance),
    progress: { ...defaultProgress(), ...(fighter.progress ?? {}) },
  }));
  const validNpcs = Array.isArray(state?.npcs) ? state.npcs.filter(isRecord) : [];
  const rawNpcs = validNpcs.length ? validNpcs : fallback.npcs;
  const normalizedNpcs = rawNpcs.map((npc, index) => ({
    ...(fallback.npcs[index % fallback.npcs.length] ?? fallback.npcs[0]),
    ...npc,
    stance: normalizeStance(npc.stance),
  }));
  const rawMusic = state?.adminSettings?.music ?? {};
  const rawTracks = Array.isArray(rawMusic.tracks) ? rawMusic.tracks.filter((track) => typeof track === "string" || isRecord(track)) : [];
  const baseTracks = [...rawTracks];
  defaultMusicTracks.forEach((track) => {
    const exists = baseTracks.some((item) => (typeof item === "string" ? item === track.title : item.id === track.id));
    if (!exists) baseTracks.push(track);
  });
  const normalizedTracks = baseTracks.map((track, index) => {
    if (typeof track === "string") {
      const fallbackTrack = defaultMusicTracks[index] ?? defaultMusicTracks[0];
      return {
        ...fallbackTrack,
        id: track.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `track-${index + 1}`,
        title: track,
      };
    }
    const fallbackTrack = defaultMusicTracks[index] ?? defaultMusicTracks[0];
    return {
      ...fallbackTrack,
      ...track,
      id: track.id ?? `track-${Date.now()}-${index}`,
      title: track.title ?? fallbackTrack.title,
      bpm: Number(track.bpm ?? fallbackTrack.bpm),
      playerEnabled: track.playerEnabled !== false,
      notes: track.notes ?? fallbackTrack.notes ?? "Instrumental only; no singing or lyrical vocals.",
    };
  });
  const activeTrackId =
    rawMusic.activeTrackId ??
    normalizedTracks.find((track) => track.title === rawMusic.activeTrack)?.id ??
    normalizedTracks[0]?.id ??
    defaultMusicTracks[0].id;

  return {
    selectedFighterId:
      normalizedFighters.some((fighter) => fighter.id === state?.selectedFighterId) ? state.selectedFighterId : normalizedFighters[0].id,
    fighters: normalizedFighters,
    npcs: normalizedNpcs,
    adminSettings: {
      ...defaultAdminSettings,
      ...(state?.adminSettings ?? {}),
      algorithm: {
        ...defaultAdminSettings.algorithm,
        ...(state?.adminSettings?.algorithm ?? {}),
      },
      categoryWeights: {
        ...defaultAdminSettings.categoryWeights,
        ...(state?.adminSettings?.categoryWeights ?? {}),
      },
      music: {
        ...defaultAdminSettings.music,
        ...rawMusic,
        activeTrackId,
        tracks: normalizedTracks,
      },
    },
  };
}

export function loadState() {
  unreadableStoredState = null;
  storageStatus = { ok: true, message: "Progress is stored on this device." };
  if (typeof window === "undefined") return defaultState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    try {
      return normalizeState(JSON.parse(raw));
    } catch {
      unreadableStoredState = raw;
      storageStatus = {
        ok: false,
        error: "invalid-data",
        message: "Saved progress could not be read. A recovery copy will be kept before new progress is saved.",
      };
      return defaultState();
    }
  } catch {
    storageStatus = {
      ok: false,
      error: "unavailable",
      message: "Device storage is unavailable. Changes will last only while this page remains open.",
    };
    return defaultState();
  }
}

export function getStorageStatus() {
  return { ...storageStatus };
}

export function saveState(state) {
  if (typeof window === "undefined") {
    storageStatus = { ok: false, error: "unavailable", message: "Device storage is unavailable. Changes have not been saved." };
    return getStorageStatus();
  }
  try {
    const serialized = JSON.stringify(normalizeState(state));
    const recovered = unreadableStoredState !== null;
    // Never overwrite unreadable progress unless an exact recovery copy was saved.
    if (recovered) window.localStorage.setItem(RECOVERY_KEY, unreadableStoredState);
    window.localStorage.setItem(STORAGE_KEY, serialized);
    unreadableStoredState = null;
    storageStatus = {
      ok: true,
      recovered,
      message: recovered ? "New progress saved. Previous unreadable data was preserved in a recovery copy." : "Changes saved on this device.",
    };
  } catch (error) {
    storageStatus = {
      ok: false,
      error: error?.name ?? "storage-error",
      message: error?.name === "QuotaExceededError"
        ? "Device storage is full. Changes are still on this page but have not been saved. Free some browser storage and try again."
        : "Changes could not be saved on this device. Keep this page open and check your browser storage settings.",
    };
  }
  return getStorageStatus();
}

export function getBeltStatus(fighter) {
  const blueMoves = moves.filter((move) => move.belt === "blue" && !move.preview);
  const learnedBlue = blueMoves.filter((move) => (fighter.progress?.[move.id] ?? 0) >= 5).length;
  const blueTotal = beltMoveCount("blue");
  const blueRatio = blueTotal ? learnedBlue / blueTotal : 0;

  if (learnedBlue >= blueTotal && blueTotal > 0) {
    return {
      belt: "blue",
      stripes: 0,
      next: "Purple Belt path opens soon",
      learnedBlue,
      blueTotal,
      blueRatio,
    };
  }

  return {
    belt: "white",
    stripes: Math.min(4, Math.floor(blueRatio * 4)),
    next: `${Math.max(0, blueTotal - learnedBlue)} blue-belt techniques remain`,
    learnedBlue,
    blueTotal,
    blueRatio,
  };
}

export function getTrainingTotals(fighter) {
  const learned = moves.filter((move) => (fighter.progress?.[move.id] ?? 0) >= 5).length;
  const mastered = moves.filter((move) => (fighter.progress?.[move.id] ?? 0) >= 50).length;
  const attempts = Object.values(fighter.progress ?? {}).reduce((sum, count) => sum + Math.min(50, count), 0);
  return { learned, mastered, attempts };
}

export function isMoveUnlocked(fighter, move) {
  return move.type === "basic" || (fighter.progress?.[move.id] ?? 0) >= 5;
}

export function clampProgress(value) {
  return Math.max(0, Math.min(50, Number(value) || 0));
}
