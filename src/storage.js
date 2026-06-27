import { allMoves, beltMoveCount, moves } from "./data/curriculum";

export const ADMIN_CODE = "patriots";
export const MAX_FIGHTERS = 5;
const STORAGE_KEY = "jiuquest:v1";

const palette = {
  skin: ["#f1c6a8", "#d99b71", "#a86b4d", "#6f432f", "#3d241b"],
  hair: ["#11131c", "#3b251b", "#8a5b2d", "#d7c09a", "#6b6f86", "#f8f4ea"],
  gi: ["#f8fbff", "#112a58", "#151922", "#b61f2b", "#7d52ff", "#1d7d68"],
};

export const customizationOptions = {
  skinTones: palette.skin,
  hairColors: palette.hair,
  giColors: palette.gi,
  genders: ["boy", "girl", "non-binary"],
  hairStyles: ["shadow spikes", "short fade", "braided top", "curly guard", "wave cut", "storm tail"],
  countries: ["United States", "Brazil", "Japan", "Mexico", "Canada", "Philippines", "France", "Nigeria", "United Kingdom"],
  stances: ["wrestling stance", "sumo base", "boxer shell", "karate stance", "muay thai guard", "combat base", "sambo crouch", "capoeira rhythm"],
  auras: ["void violet", "mat gold", "blue flame", "red surge", "emerald focus"],
  emblems: ["triangle", "lion", "wave", "star", "phoenix", "mountain"],
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
    activeTrack: "Dojo Pulse",
    volume: 0.34,
    tracks: ["Dojo Pulse", "Arena Surge", "Shadow Drill"],
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
    stance: "combat base",
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
    stance: overrides.stance ?? "combat base",
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
    stance: "combat base",
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
  const fighters = Array.isArray(state?.fighters) && state.fighters.length ? state.fighters.slice(0, MAX_FIGHTERS) : fallback.fighters;
  const normalizedFighters = fighters.map((fighter) => ({
    ...createFighter(fighter),
    ...fighter,
    progress: { ...defaultProgress(), ...(fighter.progress ?? {}) },
  }));

  return {
    selectedFighterId:
      normalizedFighters.some((fighter) => fighter.id === state?.selectedFighterId) ? state.selectedFighterId : normalizedFighters[0].id,
    fighters: normalizedFighters,
    npcs: Array.isArray(state?.npcs) && state.npcs.length ? state.npcs : fallback.npcs,
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
        ...(state?.adminSettings?.music ?? {}),
      },
    },
  };
}

export function loadState() {
  if (typeof window === "undefined") return defaultState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
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
