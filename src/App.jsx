import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BadgePlus,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  Dumbbell,
  Gauge,
  Headphones,
  Home,
  Lock,
  Music,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Shield,
  Swords,
  Trash2,
  Trophy,
  User,
  Volume2,
  X,
} from "lucide-react";
import {
  allMoves,
  beltColors,
  beltLabels,
  BELTS,
  moves,
  positionLabels,
  starterMoves,
} from "./data/curriculum";
import {
  ADMIN_CODE,
  clampProgress,
  createFighter,
  customizationOptions,
  defaultAdminSettings,
  defaultMusicTracks,
  defaultNpcs,
  getBeltStatus,
  getTrainingTotals,
  isMoveUnlocked,
  loadState,
  MAX_FIGHTERS,
  saveState,
  getStorageStatus,
} from "./storage";
import GrapplingSnapshotStage from "./components/GrapplingSnapshotStage";
import CombatArena from "./components/CombatArenaView";
import GrapplingLab from "./components/GrapplingPositionLab";
import { createArenaState, getPositionForSide, getArenaPositionLabel, isArenaCounterApplicable, resolveArenaOutcome } from "./arena/outcome.js";
import {
  BJJ_ANIMATION_KEYS,
  bjjAnimationCatalog,
  getBjjAnimationForMove,
  getBjjAnimationKeyForMove,
} from "./animation/bjjAnimationMap";

const navItems = [
  { id: "dashboard", label: "Overview", icon: Home },
  { id: "profile", label: "Profile", icon: User },
  { id: "training", label: "Training", icon: BookOpen },
  { id: "combat", label: "Arena", icon: Swords },
  { id: "grappling", label: "Lab", icon: Activity },
  { id: "progress", label: "Insights", icon: Trophy },
];

const auraColors = {
  "void violet": "#8a5cff",
  "mat gold": "#f7c852",
  "blue flame": "#4aa3ff",
  "red surge": "#ff4f55",
  "emerald focus": "#3ee0a0",
};

const skinToneLabels = {
  "#f1c6a8": "Light",
  "#d99b71": "Warm light",
  "#a86b4d": "Medium",
  "#6f432f": "Deep",
  "#3d241b": "Dark",
  "#120805": "Very dark",
};

const stanceCopy = {
  "wrestling stance": "low hips, forward pressure",
  "sumo base": "wide base, heavy center",
  "boxer shell": "hands high, sharp angle",
  "karate stance": "long range, quick entry",
  "muay thai guard": "upright clinch threat",
  "sambo crouch": "low hooks, takedown chain",
  "capoeira rhythm": "mobile feints, spinning lane",
};

const profileArt = "/assets/characters/profile-realistic-v2.webp";

const fighterArtSources = {
  profile: { image: profileArt, mask: "v2/profile", pose: "profile" },
  wrestling: { image: "/assets/stances/wrestling-stance-realistic-v2.webp", mask: "v2/wrestling", pose: "wrestling" },
  sumo: { image: "/assets/stances/sumo-stance-realistic-v2.webp", mask: "v2/sumo", pose: "sumo" },
  boxing: { image: "/assets/stances/boxing-stance-realistic-v2.webp", mask: "v2/boxing", pose: "boxing" },
  karate: { image: "/assets/stances/karate-stance-realistic-v2.webp", mask: "v2/karate", pose: "karate" },
  "muay-thai": { image: "/assets/stances/muay-thai-stance-realistic-v2.webp", mask: "v2/muay-thai", pose: "muay-thai" },
  sambo: { image: "/assets/stances/sambo-stance-realistic-v2.webp", mask: "v2/sambo", pose: "sambo" },
  capoeira: { image: "/assets/stances/capoeira-stance-realistic-v2.webp", mask: "v2/capoeira", pose: "capoeira" },
};

const profileHairstyleArtSources = {
  bald: { image: "/assets/characters/profile-realistic-v2-bald.webp", mask: "v2/profile-bald", pose: "profile" },
  "crew cut": { image: "/assets/characters/profile-realistic-v2-crew-cut.webp", mask: "v2/profile-crew-cut", pose: "profile" },
  "short fade": { image: "/assets/characters/profile-realistic-v2-crew-cut.webp", mask: "v2/profile-crew-cut", pose: "profile" },
  mohawk: { image: "/assets/characters/profile-realistic-v2-mohawk.webp", mask: "v2/profile-mohawk", pose: "profile" },
  "long hair": { image: "/assets/characters/profile-realistic-v2-long-hair.webp", mask: "v2/profile-long-hair", pose: "profile" },
  "braided top": { image: "/assets/characters/profile-realistic-v2-long-hair.webp", mask: "v2/profile-long-hair", pose: "profile" },
  "storm tail": { image: "/assets/characters/profile-realistic-v2-long-hair.webp", mask: "v2/profile-long-hair", pose: "profile" },
  "curly guard": { image: "/assets/characters/profile-realistic-v2-long-hair.webp", mask: "v2/profile-long-hair", pose: "profile" },
  "slicked back": { image: "/assets/characters/profile-realistic-v2-slicked-back.webp", mask: "v2/profile-slicked-back", pose: "profile" },
  "wave cut": { image: "/assets/characters/profile-realistic-v2-slicked-back.webp", mask: "v2/profile-slicked-back", pose: "profile" },
};

function resolveFighterArtSource(pose, hairStyle) {
  const fallbackSource = fighterArtSources[pose] ?? fighterArtSources.profile;
  if (pose !== "profile") return fallbackSource;

  return profileHairstyleArtSources[hairStyle?.trim().toLowerCase()] ?? fallbackSource;
}

const stancePose = {
  "wrestling stance": "wrestling",
  "sumo base": "sumo",
  "boxer shell": "boxing",
  "karate stance": "karate",
  "muay thai guard": "muay-thai",
  "sambo crouch": "sambo",
  "capoeira rhythm": "capoeira",
};

const stanceArt = {
  "wrestling stance": "/assets/stances/wrestling-stance-realistic-v2.webp",
  "sumo base": "/assets/stances/sumo-stance-realistic-v2.webp",
  "boxer shell": "/assets/stances/boxing-stance-realistic-v2.webp",
  "karate stance": "/assets/stances/karate-stance-realistic-v2.webp",
  "muay thai guard": "/assets/stances/muay-thai-stance-realistic-v2.webp",
  "sambo crouch": "/assets/stances/sambo-stance-realistic-v2.webp",
  "capoeira rhythm": "/assets/stances/capoeira-stance-realistic-v2.webp",
};

const showcaseFighters = [
  { src: "/assets/showcase/challenger-1.png", label: "Crimson Guard" },
  { src: "/assets/showcase/challenger-2.png", label: "Void Striker" },
  { src: "/assets/showcase/challenger-3.png", label: "Blue Surge" },
  { src: "/assets/showcase/challenger-4.png", label: "Emerald Guard" },
  { src: "/assets/showcase/challenger-5.png", label: "Gold Hunter" },
];

const techniqueArtwork = {
  guard: { src: "/assets/techniques/guard-position.png", label: "Guard Position" },
  headlock: { src: "/assets/techniques/headlock-position.png", label: "Headlock Position" },
  mount: { src: "/assets/techniques/mount-position.png", label: "Mount Position" },
  rearChoke: { src: "/assets/techniques/rear-choke-position.png", label: "Rear Choke Position" },
};

const emblemAssets = {
  none: "/assets/emblems/none.png",
  triangle: "/assets/emblems/triangle.png",
  lion: "/assets/emblems/lion.png",
  wave: "/assets/emblems/wave.png",
  star: "/assets/emblems/star.png",
  phoenix: "/assets/emblems/phoenix.png",
  mountain: "/assets/emblems/mountain.png",
};

const countryFlagBackgrounds = {
  "United States":
    "radial-gradient(circle at 18% 24%, rgba(60,59,110,0.68) 0 20%, transparent 21%), repeating-linear-gradient(180deg, rgba(178,34,52,0.44) 0 8%, rgba(248,248,248,0.26) 8% 16%)",
  Brazil:
    "radial-gradient(circle at 69% 34%, rgba(0,39,118,0.68) 0 12%, transparent 13%), linear-gradient(135deg, transparent 0 21%, rgba(255,223,0,0.52) 22% 40%, transparent 41%), linear-gradient(90deg, rgba(0,156,59,0.7), rgba(0,86,42,0.58))",
  Japan: "radial-gradient(circle at 62% 34%, rgba(188,0,45,0.58) 0 17%, transparent 18%), linear-gradient(120deg, rgba(255,255,255,0.46), rgba(210,214,224,0.24))",
  Mexico: "linear-gradient(90deg, rgba(0,104,71,0.62) 0 33%, rgba(255,255,255,0.28) 33% 66%, rgba(206,17,38,0.56) 66%)",
  Canada: "linear-gradient(90deg, rgba(255,0,0,0.58) 0 25%, rgba(255,255,255,0.28) 25% 75%, rgba(255,0,0,0.58) 75%)",
  Philippines:
    "linear-gradient(135deg, rgba(255,255,255,0.4) 0 28%, transparent 29%), linear-gradient(180deg, rgba(0,56,168,0.62) 0 50%, rgba(206,17,38,0.58) 50%), radial-gradient(circle at 24% 50%, rgba(252,209,22,0.52) 0 9%, transparent 10%)",
  France: "linear-gradient(90deg, rgba(0,35,149,0.62) 0 33%, rgba(255,255,255,0.26) 33% 66%, rgba(237,41,57,0.58) 66%)",
  Nigeria: "linear-gradient(90deg, rgba(0,135,81,0.62) 0 33%, rgba(255,255,255,0.28) 33% 66%, rgba(0,135,81,0.62) 66%)",
  "United Kingdom":
    "linear-gradient(45deg, transparent 0 43%, rgba(255,255,255,0.35) 44% 49%, rgba(200,16,46,0.48) 50% 55%, transparent 56%), linear-gradient(-45deg, transparent 0 43%, rgba(255,255,255,0.35) 44% 49%, rgba(200,16,46,0.48) 50% 55%, transparent 56%), linear-gradient(90deg, rgba(1,33,105,0.68), rgba(1,33,105,0.5))",
};

const arenaSceneGroups = {
  white: ["studio"],
  blue: ["tournament"],
  purple: ["street"],
  brown: ["octagon"],
  black: ["temple"],
};

const arenaSceneLabels = {
  studio: "Academy Studio",
  tournament: "Tournament Mat",
  street: "Street Challenge",
  octagon: "MMA Lights",
  temple: "Temple Mastery",
};

const sourceReferenceTracks = [
  {
    label: "Ascension Gate",
    source: "C:/Users/Owner/Desktop/01 Believer.mp3",
    instruction: "Use only broad energy, tension, and pacing as reference. Do not copy the melody, lyrics, vocal sound, or beat pattern.",
  },
  {
    label: "Power Clash",
    source: "C:/Users/Owner/Desktop/01 Boom Boom Pow.mp3",
    instruction: "Use only broad club/combat intensity as reference. Do not copy the hook, lyrics, vocal sound, or beat pattern.",
  },
  {
    label: "Paradise Circuit",
    source: "C:/Users/Owner/Desktop/03 Paradise.mp3",
    instruction: "Use only broad uplifting build energy as reference. Do not copy the melody, lyrics, vocal sound, or beat pattern.",
  },
];

const musicWorkflowSteps = [
  "Use only audio the admin owns or has permission to transform. For commercial songs, treat files as broad reference only unless licensed for remix use.",
  "All JiuQuest game tracks must be instrumental: no singing, no lyrical vocals, no lead vocal lines, and no recognizable vocal hooks.",
  "Extract or analyze the reference audio with FFmpeg when permitted, then save tempo, loudness, and rough section notes in JSON.",
  "If stems are legally permitted, use Demucs to separate vocals, drums, bass, and other stems. Remove vocals from the final game track.",
  "Create a new dark techno, cyberpunk combat, or boss-fight arrangement at 135 to 150 BPM. Default to 145 BPM for Ground Combat.",
  "Replace the source beat with original four-on-the-floor drums, tight claps, fast hats, fills, risers, impacts, sidechain pumping, and distorted bass.",
  "Use only tiny transformed non-vocal textures when legally permitted, such as reversed atmosphere, filtered chords, or abstract rhythmic texture.",
  "Do not make karaoke, a speed-up, or a normal remix with a beat added on top. The result should sound like a new game soundtrack cue.",
  "Export a full version and a loopable version as WAV and MP3 when possible, with clean loudness, no clipping, and game-ready loop points.",
  "Recommended folders: input, extracted, stems, processed, and output. Include README notes, required tools, install steps, and error handling.",
  "If no samples or stem tools are available, generate synthetic drums, bass, synth stabs, drones, and impacts so the workflow still produces a usable instrumental loop.",
];

const beltOrderBonus = {
  white: 0,
  blue: 6,
  purple: 10,
  brown: 14,
  black: 18,
};

const npcBeltBase = {
  white: 42,
  blue: 58,
  purple: 70,
  brown: 80,
  black: 90,
};

function shuffle(list) {
  return [...list]
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

function moveItem(list, from, to) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function titleCase(value = "") {
  if (value === "none") return "No Patch";
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getFighterPose(fighter, fallback = "profile") {
  return stancePose[fighter?.stance] ?? stancePose["wrestling stance"] ?? fallback;
}

function techniqueArtworkForMove(move) {
  if (!move) return null;
  const text = `${move.id} ${move.name} ${move.lesson} ${move.category} ${move.phase}`.toLowerCase();
  const positions = [...(move.starts ?? []), ...(move.good ?? []), move.endsIn ?? ""].join(" ").toLowerCase();

  if (text.includes("headlock") || positions.includes("headlock")) {
    return techniqueArtwork.headlock;
  }
  if (move.id === "rear-naked-choke" || text.includes("rear naked choke") || positions.includes("back-control")) {
    return techniqueArtwork.rearChoke;
  }
  if (positions.includes("mount") || text.includes("mount")) {
    return techniqueArtwork.mount;
  }
  if (positions.includes("guard") || text.includes("guard")) {
    return techniqueArtwork.guard;
  }
  return null;
}

function chooseArenaKey(belt = "white") {
  const scenes = arenaSceneGroups[belt] ?? arenaSceneGroups.white;
  return scenes[Math.floor(Math.random() * scenes.length)] ?? "studio";
}

function correctRatio(order, steps) {
  const correct = order.filter((step, index) => step === steps[index]).length;
  return correct / steps.length;
}

function App() {
  const [store, setStore] = useState(loadState);
  const [saveStatus, setSaveStatus] = useState(getStorageStatus);
  const previousStorageOkRef = useRef(saveStatus.ok);
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);
  const notify = useCallback((message, tone = "success") => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ message, tone, id: Date.now() });
    if (tone !== "error") noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const [view, setView] = useState("dashboard");
  const [selectedBelt, setSelectedBelt] = useState("blue");
  const [selectedMoveId, setSelectedMoveId] = useState("rear-naked-choke");
  const [trainingOrder, setTrainingOrder] = useState([]);
  const [trainingResult, setTrainingResult] = useState(null);
  const [adminGateOpen, setAdminGateOpen] = useState(false);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [musicOn, setMusicOn] = useState(false);
  const [combat, setCombat] = useState(() => createCombatState(store.npcs[0]));
  const audioRef = useRef(null);
  const recordedCombatSignalRef = useRef(null);
  const activeFighterRef = useRef(store.selectedFighterId);

  useEffect(() => {
    if (activeFighterRef.current === store.selectedFighterId) return;
    activeFighterRef.current = store.selectedFighterId;
    setCombat(createCombatState(store.npcs[0]));
    notify('Active fighter changed. Your next match will use this fighter and appearance.', 'info');
  }, [store.selectedFighterId, store.npcs, notify]);

  const fighter = useMemo(
    () => store.fighters.find((item) => item.id === store.selectedFighterId) ?? store.fighters[0],
    [store.fighters, store.selectedFighterId],
  );
  const beltStatus = useMemo(() => getBeltStatus(fighter), [fighter]);
  const trainingTotals = useMemo(() => getTrainingTotals(fighter), [fighter]);
  const selectedMove = useMemo(
    () => allMoves.find((move) => move.id === selectedMoveId) ?? moves[0],
    [selectedMoveId],
  );
  const beltMoves = useMemo(
    () => moves.filter((move) => move.belt === selectedBelt),
    [selectedBelt],
  );
  const unlockedMoves = useMemo(
    () => allMoves.filter((move) => isMoveUnlocked(fighter, move)),
    [fighter],
  );
  const musicTracks = useMemo(() => {
    const tracks = store.adminSettings.music?.tracks;
    return Array.isArray(tracks) && tracks.length ? tracks : defaultMusicTracks;
  }, [store.adminSettings.music?.tracks]);
  const playerMusicTracks = useMemo(
    () => musicTracks.filter((track) => track.playerEnabled !== false),
    [musicTracks],
  );
  const activeMusicTrack = useMemo(() => {
    const activeId = store.adminSettings.music?.activeTrackId;
    return (
      playerMusicTracks.find((track) => track.id === activeId) ??
      playerMusicTracks[0] ??
      musicTracks.find((track) => track.id === activeId) ??
      musicTracks[0] ??
      defaultMusicTracks[0]
    );
  }, [musicTracks, playerMusicTracks, store.adminSettings.music?.activeTrackId]);

  useEffect(() => {
    const status = saveState(store);
    const recoveredStorage = previousStorageOkRef.current === false && status.ok;
    previousStorageOkRef.current = status.ok;
    setSaveStatus(status);
    if (!status.ok || status.recovered) notify(status.message, status.ok ? "info" : "error");
    else if (recoveredStorage) notify(status.message, "success");
  }, [store, notify]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    const sources = [
      resolveFighterArtSource("profile", fighter.hairStyle),
      fighterArtSources[getFighterPose(fighter)] ?? fighterArtSources.profile,
    ];
    const urls = new Set(sources.map((source) => source.image));
    sources.forEach((source) => {
      [source.pose === "profile" ? "body-no-belt" : "body-no-hair-no-belt", "skin", "hair", "jacket", "pants", "belt"].forEach((mask) => {
        urls.add(`/assets/characters/masks/${source.mask}-${mask}.png`);
      });
    });
    urls.forEach((url) => {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    });
  }, [fighter.hairStyle, fighter.stance]);

  useEffect(() => {
    if (!trainingOrder.length || selectedMove.steps.some((step) => !trainingOrder.includes(step))) {
      setTrainingOrder(shuffle(selectedMove.steps));
      setTrainingResult(null);
    }
  }, [selectedMove, trainingOrder.length]);

  useEffect(() => {
    const nextNpc = store.npcs.find((npc) => npc.id === combat.npc?.id);
    if (!nextNpc) {
      setCombat(createCombatState(store.npcs[0]));
      notify("Selected opponent was removed. The arena has been reset.", "info");
      return;
    }
    setCombat((current) => {
      return current.npc?.id === nextNpc.id && nextNpc !== current.npc ? { ...current, npc: nextNpc } : current;
    });
  }, [store.npcs, combat.npc?.id, notify]);

  useEffect(() => {
    if (!musicOn) {
      stopAudio(audioRef);
      return;
    }
    startAudio(audioRef, view, store.adminSettings.music.volume, activeMusicTrack, (message) => {
      setMusicOn(false);
      notify(message, "error");
    });
    return () => stopAudio(audioRef);
  }, [activeMusicTrack, musicOn, view, store.adminSettings.music.volume]);

  useEffect(() => {
    if (!playerMusicTracks.length) return;
    const activeId = store.adminSettings.music?.activeTrackId;
    if (playerMusicTracks.some((track) => track.id === activeId)) return;
    setStore((current) => ({
      ...current,
      adminSettings: {
        ...current.adminSettings,
        music: {
          ...current.adminSettings.music,
          activeTrackId: playerMusicTracks[0].id,
        },
      },
    }));
  }, [playerMusicTracks, store.adminSettings.music?.activeTrackId]);

  useEffect(() => {
    if (!combat.active || combat.phase !== "ordering") return;
    if (combat.secondsLeft <= 0) {
      resolveCombatTurn();
      return;
    }
    const timer = window.setTimeout(() => {
      setCombat((current) => ({ ...current, secondsLeft: current.secondsLeft - 1 }));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [combat.active, combat.phase, combat.secondsLeft]);

  const updateFighter = (patch) => {
    setStore((current) => ({
      ...current,
      fighters: current.fighters.map((item) =>
        item.id === fighter.id ? { ...item, ...patch, updatedAt: Date.now() } : item,
      ),
    }));
  };

  const updateProgress = (moveId, nextCount) => {
    setStore((current) => ({
      ...current,
      fighters: current.fighters.map((item) =>
        item.id === fighter.id
          ? {
              ...item,
              progress: {
                ...item.progress,
                [moveId]: clampProgress(nextCount),
              },
              updatedAt: Date.now(),
            }
          : item,
      ),
    }));
  };

  const createNewFighter = () => {
    if (store.fighters.length >= MAX_FIGHTERS) { notify("Your roster is full. Remove a fighter before creating another.", "error"); return; }
    const next = createFighter({
      name: `Fighter ${store.fighters.length + 1}`,
      giTop: customizationOptions.giColors[store.fighters.length % customizationOptions.giColors.length],
      aura: customizationOptions.auras[store.fighters.length % customizationOptions.auras.length],
    });
    setStore((current) => ({
      ...current,
      selectedFighterId: next.id,
      fighters: [...current.fighters, next],
    }));
    setView("profile");
    notify(`${next.name} created. Customize your fighter below.`);
  };

  const deleteFighter = (fighterId) => {
    const target = store.fighters.find((item) => item.id === fighterId);
    if (!target) return;
    const confirmed = window.confirm(`Delete ${target.name} permanently? This fighter's training and combat record will be lost.`);
    if (!confirmed) return;
    setStore((current) => {
      const nextFighters = current.fighters.filter((item) => item.id !== fighterId);
      if (!nextFighters.length) {
        const replacement = createFighter({ name: "New Challenger" });
        return { ...current, fighters: [replacement], selectedFighterId: replacement.id };
      }
      return {
        ...current,
        fighters: nextFighters,
        selectedFighterId: current.selectedFighterId === fighterId ? nextFighters[0].id : current.selectedFighterId,
      };
    });
    notify(`${target.name} removed from your roster.`);
  };

  const runTrainingTest = () => {
    const ratio = correctRatio(trainingOrder, selectedMove.steps);
    if (ratio === 1) {
      const next = Math.min(50, (fighter.progress?.[selectedMove.id] ?? 0) + 1);
      updateProgress(selectedMove.id, next);
      setTrainingResult({
        tone: "success",
        title: next >= 5 ? "Technique unlocked for combat." : "Clean rep logged.",
        message: `${selectedMove.name} is now ${next}/50. ${Math.max(0, 5 - next)} more clean reps until arena unlock.`,
      });
      setTrainingOrder(shuffle(selectedMove.steps));
      return;
    }
    setTrainingResult({
      tone: "danger",
      title: "Sequence broke under pressure.",
      message: `${formatPercent(ratio * 100)} of the steps were in the right slot. Study the scroll and try the test again.`,
    });
  };

  const openAdmin = () => {
    if (adminAuthed) {
      setView("admin");
      return;
    }
    setAdminGateOpen(true);
  };

  const submitAdminCode = (event) => {
    event.preventDefault();
    if (adminCode.trim().toLowerCase() === ADMIN_CODE) {
      setAdminAuthed(true);
      setAdminGateOpen(false);
      setAdminCode("");
      setView("admin");
      notify("Admin controls opened for this device.");
    } else {
      notify("That access code was not accepted. Please try again.", "error");
    }
  };

  const startCombat = (npc = combat.npc, startPosition = fighter.startPose) => {
    setCombat({
      ...createCombatState(npc),
      active: true,
      phase: "selecting",
      ...createArenaState(startPosition),
      startPosition,
      log: [`Match started from ${getArenaPositionLabel(createArenaState(startPosition))}. Choose your first action.`],
    });
  };

  const chooseCombatMove = (move) => {
    if (!combat.active || combat.phase === "ordering" || !move.starts.includes(getPositionForSide(combat))) {
      notify("That technique is unavailable from your current position.", "error");
      return;
    }
    notify(`${move.name} selected. Order the steps, then submit.`, "info");
    setCombat((current) => ({
      ...current,
      active: true,
      selectedMoveId: move.id,
      order: shuffle(move.steps),
      secondsLeft: 10,
      phase: "ordering",
      result: null,
      log: [
        `${move.name} selected. Put the steps in order before the timer ends.`,
        ...(current.active ? [] : [`Gate opened from ${positionLabels[current.position]}.`]),
        ...current.log,
      ].slice(0, 8),
    }));
  };

  const resolveCombatTurn = () => {
    if (!combat.active || combat.phase !== "ordering" || !combat.selectedMoveId) return;
    const npcPosition = getPositionForSide(combat, "opponent");
    const playerMoveForTurn = allMoves.find((move) => move.id === combat.selectedMoveId);
    const npcMoveForTurn = chooseNpcMove(combat.npc, npcPosition, playerMoveForTurn);
    const npcScoreForTurn = scoreNpc({
      npc: combat.npc,
      move: npcMoveForTurn,
      position: npcPosition,
      settings: store.adminSettings,
    });
    const resolutionTimestamp = Date.now();
    setCombat((current) => {
      if (!current.active || current.phase !== "ordering" || !current.selectedMoveId) return current;
      const move = allMoves.find((item) => item.id === current.selectedMoveId);
      if (!move || !move.starts.includes(getPositionForSide(current))) return { ...current, phase: "selecting", selectedMoveId: null };
      const npcMove = npcMoveForTurn;
      const playerCounterApplies = isArenaCounterApplicable(move, current, npcMove, "fighter");
      const playerScore = scoreMove({
        move,
        fighter,
        position: current.position,
        order: current.order,
        settings: store.adminSettings,
        belt: beltStatus.belt,
      });
      if (!playerCounterApplies) playerScore.total = 0;
      const npcScore = npcScoreForTurn;
      const exchangePlayerWins = playerCounterApplies && playerScore.total >= npcScore.total;
      const winnerMove = exchangePlayerWins ? move : npcMove;
      const losingMove = exchangePlayerWins ? npcMove : move;
      const actorName = exchangePlayerWins ? fighter.name : current.npc.name;
      const opponentName = exchangePlayerWins ? current.npc.name : fighter.name;
      const actorScore = exchangePlayerWins ? playerScore.total : npcScore.total;
      const opponentScore = exchangePlayerWins ? npcScore.total : playerScore.total;
      const techniqueName = winnerMove.name;
      const nextArenaState = resolveArenaOutcome(current, winnerMove, exchangePlayerWins ? "fighter" : "opponent", { opposingMove: losingMove });
      const submission = winnerMove.isSubmission && Math.max(playerScore.total, npcScore.total) >= 52;
      const finished = submission || current.round >= 8;
      const nextPlayerExchanges = (current.playerExchanges ?? 0) + (exchangePlayerWins ? 1 : 0);
      const nextNpcExchanges = (current.npcExchanges ?? 0) + (exchangePlayerWins ? 0 : 1);
      const nextPlayerPoints = (current.playerPoints ?? 0) + playerScore.total;
      const nextNpcPoints = (current.npcPoints ?? 0) + npcScore.total;
      const nextBestPlayer = exchangePlayerWins && (!current.bestPlayer || playerScore.total >= current.bestPlayer.score)
        ? { move, score: playerScore.total }
        : current.bestPlayer;
      const nextBestNpc = !exchangePlayerWins && (!current.bestNpc || npcScore.total >= current.bestNpc.score)
        ? { move: npcMove, score: npcScore.total }
        : current.bestNpc;
      const decisionPlayerWins = nextPlayerExchanges === nextNpcExchanges
        ? nextPlayerPoints >= nextNpcPoints
        : nextPlayerExchanges > nextNpcExchanges;
      const matchPlayerWins = submission ? exchangePlayerWins : finished ? decisionPlayerWins : null;
      const winningMove = submission
        ? winnerMove
        : finished
          ? (matchPlayerWins ? nextBestPlayer.move : nextBestNpc.move)
          : null;
      const winnerName = finished ? (matchPlayerWins ? fighter.name : current.npc.name) : null;
      const winningTechniqueName = winningMove?.name ?? null;
      const animationKey = getBjjAnimationKeyForMove(winnerMove);
      const outcome = submission ? "submission" : finished ? "decision" : "exchange";
      const headline = submission
        ? `${winnerName} wins by submission with ${winningTechniqueName}`
        : finished
          ? `${winnerName} wins by decision — winning technique: ${winningTechniqueName}`
          : `${actorName} successfully executes ${techniqueName}`;
      const animationHeadline = `${actorName} successfully executes ${techniqueName}`;
      const counterFeedback = playerCounterApplies ? "" : `${fighter.name}'s ${move.name} could not trigger because ${current.npc.name} did not use the required attack. `;
      const resolutionLine = `${counterFeedback}${actorName} successfully executes ${techniqueName} at ${formatPercent(actorScore)}. ${opponentName}'s ${losingMove.name} scores ${formatPercent(opponentScore)}.`;
      const outcomeLine = submission
        ? `${winnerName} wins by submission with ${winningTechniqueName}. ${opponentName} taps.`
        : finished
          ? `${winnerName} wins the match by decision. Winning technique: ${winningTechniqueName}.`
          : `${actorName} takes the exchange with ${techniqueName}. Prepare for next action.`;
      const result = {
        round: current.round,
        playerWins: finished ? matchPlayerWins : exchangePlayerWins,
        actorIsPlayer: exchangePlayerWins,
        matchPlayerWins,
        finished,
        outcome,
        actorName,
        techniqueName,
        winnerName,
        winningTechniqueName,
        headline,
        animationHeadline,
        move: winnerMove,
        animationKey,
        animationSignal: `${winnerMove.id}-${current.round}-${resolutionTimestamp}`,
        playerScore,
        npcScore,
        line: resolutionLine,
        positionLabel: getArenaPositionLabel(nextArenaState),
      };

      return {
        ...current,
        phase: finished ? "finished" : "result",
        active: !finished,
        round: finished ? current.round : current.round + 1,
        ...nextArenaState,
        playerExchanges: nextPlayerExchanges,
        npcExchanges: nextNpcExchanges,
        playerPoints: nextPlayerPoints,
        npcPoints: nextNpcPoints,
        bestPlayer: nextBestPlayer,
        bestNpc: nextBestNpc,
        selectedMoveId: null,
        secondsLeft: 10,
        result,
        log: [
          outcomeLine,
          result.line,
          ...current.log,
        ].slice(0, 8),
      };
    });
  };

  const recordCombatResult = (win, loss) => {
    setStore((current) => ({
      ...current,
      fighters: current.fighters.map((item) =>
        item.id === fighter.id
          ? {
              ...item,
              matches: item.matches + 1,
              wins: item.wins + (win ? 1 : 0),
              losses: item.losses + (loss ? 1 : 0),
              updatedAt: Date.now(),
            }
          : item,
      ),
    }));
  };

  useEffect(() => {
    const result = combat.result;
    if (!result?.finished || !result.animationSignal || recordedCombatSignalRef.current === result.animationSignal) return;
    recordedCombatSignalRef.current = result.animationSignal;
    recordCombatResult(result.matchPlayerWins === true, result.matchPlayerWins === false);
  }, [combat.result?.animationSignal]);

  const resetProgress = () => {
    const confirmed = window.confirm(`Clear all progress for ${fighter.name}? Customization will stay.`);
    if (!confirmed) return;
    updateFighter({
      progress: allMoves.reduce((acc, move) => ({ ...acc, [move.id]: 0 }), {}),
      matches: 0,
      wins: 0,
      losses: 0,
    });
    setCombat(createCombatState(combat.npc));
    notify(`Progress cleared for ${fighter.name}. Your appearance is saved.`);
  };

  const selectMusicTrack = (activeTrackId) => {
    setStore((current) => ({
      ...current,
      adminSettings: {
        ...current.adminSettings,
        music: {
          ...current.adminSettings.music,
          activeTrackId,
        },
      },
    }));
  };

  return (
    <div className={`app-shell view-${view}`}>
      <div className="energy-field" aria-hidden="true" />
      {notice && <div className={`app-feedback ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live={notice.tone === "error" ? "assertive" : "polite"}>
        <span>{notice.message}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button>
      </div>}
      <Header
        fighter={fighter}
        fighters={store.fighters}
        selectedId={store.selectedFighterId}
        setStore={setStore}
        beltStatus={beltStatus}
        musicOn={musicOn}
        setMusicOn={setMusicOn}
        musicTracks={playerMusicTracks}
        activeTrackId={activeMusicTrack.id}
        selectMusicTrack={selectMusicTrack}
        openAdmin={openAdmin}
      />

      <BottomNav view={view} setView={setView} />

      <main>
        <div className={`save-status ${saveStatus.ok === false ? "error" : ""}`}>
          <span role="status">{saveStatus.message}</span>
          {saveStatus.ok === false && (
            <button className="save-retry" type="button" onClick={() => {
              const status = saveState(store);
              previousStorageOkRef.current = status.ok;
              setSaveStatus(status);
              notify(status.message, status.ok ? "success" : "error");
            }}>
              <RotateCcw size={13} aria-hidden="true" />
              Retry save
            </button>
          )}
        </div>
        {view === "dashboard" && (
          <Dashboard
            fighter={fighter}
            fighters={store.fighters}
            beltStatus={beltStatus}
            trainingTotals={trainingTotals}
            selectedMove={selectedMove}
            setStore={setStore}
            createNewFighter={createNewFighter}
            deleteFighter={deleteFighter}
            setView={setView}
            setSelectedMoveId={setSelectedMoveId}
            startCombat={startCombat}
            npcs={store.npcs}
          />
        )}

        {view === "profile" && (
          <ProfileBuilder
            fighter={fighter}
            beltStatus={beltStatus}
            updateFighter={updateFighter}
            createNewFighter={createNewFighter}
            canCreate={store.fighters.length < MAX_FIGHTERS}
            resetProgress={resetProgress}
            saveStatus={saveStatus}
          />
        )}

        {view === "training" && (
          <Training
            fighter={fighter}
            beltStatus={beltStatus}
            selectedBelt={selectedBelt}
            setSelectedBelt={setSelectedBelt}
            beltMoves={beltMoves}
            selectedMove={selectedMove}
            setSelectedMoveId={setSelectedMoveId}
            trainingOrder={trainingOrder}
            setTrainingOrder={setTrainingOrder}
            runTrainingTest={runTrainingTest}
            trainingResult={trainingResult}
          />
        )}

        {view === "combat" && (
          <CombatArena
            fighter={fighter}
            beltStatus={beltStatus}
            combat={combat}
            setCombat={setCombat}
            npcs={store.npcs}
            unlockedMoves={unlockedMoves}
            chooseCombatMove={chooseCombatMove}
            resolveCombatTurn={resolveCombatTurn}
            startCombat={startCombat}
            notify={notify}
            onTrain={() => setView("training")}
          />
        )}

        {view === "grappling" && (
          <GrapplingLab
            fighter={fighter}
            opponent={combat.npc}
            notify={notify}
            beltStatus={beltStatus}
          />
        )}

        {view === "progress" && <ProgressLab fighter={fighter} beltStatus={beltStatus} />}

        {view === "admin" && adminAuthed && (
          <AdminPanel
            store={store}
            setStore={setStore}
            setView={setView}
          />
        )}
      </main>

      <button className="corner-admin" onClick={openAdmin}>
        Admin
      </button>

      {adminGateOpen && (
        <Modal title="Admin Access" onClose={() => setAdminGateOpen(false)}>
          <form className="gate-form" onSubmit={submitAdminCode}>
            <label htmlFor="admin-code">Access code</label>
            <input
              id="admin-code"
              autoFocus
              value={adminCode}
              onChange={(event) => setAdminCode(event.target.value)}
              placeholder="Enter code"
              type="password"
            />
            <button className="primary-button" type="submit">
              <Shield size={18} />
              Open Admin
            </button>
            {adminCode && adminCode.trim().toLowerCase() !== ADMIN_CODE && (
              <p className="form-error">Code not accepted.</p>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}

function Header({
  fighter,
  fighters,
  selectedId,
  setStore,
  beltStatus,
  musicOn,
  setMusicOn,
  musicTracks,
  activeTrackId,
  selectMusicTrack,
  openAdmin,
}) {
  const [trackMenuOpen, setTrackMenuOpen] = useState(false);
  const activeTrack = musicTracks.find((track) => track.id === activeTrackId) ?? musicTracks[0];

  return (
    <header className="topbar">
      <button className="brand-lockup" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Scroll to top">
        <span className="brand-sigil">JQ</span>
        <span>JiuQuest</span>
      </button>
      <label className="fighter-select">
        <MiniPortrait fighter={fighter} beltStatus={beltStatus} />
        <span>
          <strong>{fighter.name}</strong>
          <small>{beltLabels[beltStatus.belt]}</small>
        </span>
        <select
          aria-label="Active fighter"
          value={selectedId}
          onChange={(event) =>
            setStore((current) => ({
              ...current,
              selectedFighterId: event.target.value,
            }))
          }
        >
          {fighters.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <ChevronDown size={18} />
      </label>
      <button className={`music-toggle ${musicOn ? "active" : ""}`} aria-label={musicOn ? "Turn music off" : "Turn music on"} aria-pressed={musicOn} onClick={() => setMusicOn((value) => !value)}>
        <Music size={19} />
        <span>Music</span>
        <span className="toggle-dot" />
        <Volume2 size={17} />
      </button>
      {musicTracks.length ? (
        <div className={`player-track-select ${trackMenuOpen ? "open" : ""}`}>
          <button type="button" className="player-track-trigger" onClick={() => setTrackMenuOpen((open) => !open)}>
            <Headphones size={16} />
            <span>{activeTrack?.title ?? "Select Track"}</span>
            <ChevronDown size={16} />
          </button>
          {trackMenuOpen ? (
            <div className="player-track-menu">
              <small>Player Music Library</small>
              {musicTracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  className={track.id === activeTrack?.id ? "active" : ""}
                  onClick={() => {
                    selectMusicTrack(track.id);
                    setTrackMenuOpen(false);
                  }}
                >
                  <span>{track.title}</span>
                  <em>{track.mood}</em>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <button className="ghost-button top-admin" onClick={openAdmin}>
        <Settings size={18} />
        Admin
      </button>
    </header>
  );
}

function Dashboard({
  fighter,
  fighters,
  beltStatus,
  trainingTotals,
  selectedMove,
  setStore,
  createNewFighter,
  deleteFighter,
  setView,
  setSelectedMoveId,
  startCombat,
  npcs,
}) {
  const featuredMoves = ["take-the-back-mount", "rear-naked-choke", "guillotine-choke"].map((id) =>
    allMoves.find((move) => move.id === id),
  );

  return (
    <section className="dashboard-grid">
      <aside className="fighter-rail panel">
        <h2>Roster</h2>
        <div className="fighter-slots">
          {fighters.map((item) => (
            <button
              key={item.id}
              className={`fighter-slot ${item.id === fighter.id ? "selected" : ""}`}
              onClick={() => setStore((current) => ({ ...current, selectedFighterId: item.id }))}
            >
              <MiniPortrait fighter={item} beltStatus={getBeltStatus(item)} />
              <span>
                <strong>{item.name}</strong>
                <small>{beltLabels[getBeltStatus(item).belt]}</small>
              </span>
              {item.id === fighter.id ? <Check size={18} /> : null}
              {fighters.length > 1 ? (
                <span
                  className="slot-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteFighter(item.id);
                  }}
                >
                  <Trash2 size={15} />
                </span>
              ) : null}
            </button>
          ))}
          {fighters.length < MAX_FIGHTERS && (
            <button className="fighter-slot create" onClick={createNewFighter}>
              <span className="plus-box">
                <Plus size={30} />
              </span>
              <span>
                <strong>New Fighter</strong>
                <small>{MAX_FIGHTERS - fighters.length} slot{MAX_FIGHTERS - fighters.length === 1 ? "" : "s"} open</small>
              </span>
            </button>
          )}
        </div>
        <button className="primary-button full" onClick={createNewFighter} disabled={fighters.length >= MAX_FIGHTERS}>
          <BadgePlus size={18} />
          New Fighter
        </button>
        <button className="secondary-button full" onClick={() => setView("profile")}>
          <User size={18} />
          Manage Profile
        </button>
      </aside>

      <section className="dashboard-center">
        <div className="hero-stage">
          <div className="dojo-backdrop" />
          <div className="hero-content">
            <span className="dashboard-kicker">JiuQuest Platform</span>
            <h1>Training command center</h1>
            <p>
              Manage fighters, structure skill development, and bring tested techniques into scenario-based rounds.
            </p>
            <div className="hero-metrics">
              <span>
                <small>Clean reps</small>
                <em>{trainingTotals.attempts}</em>
              </span>
              <span>
                <small>Learned moves</small>
                <em>{trainingTotals.learned}</em>
              </span>
              <span>
                <small>Rank path</small>
                <em>{beltLabels[beltStatus.belt]}</em>
              </span>
            </div>
          </div>
        </div>
        <div className="mode-cards">
          <button className="mode-card skill" onClick={() => setView("training")}>
            <span className="mode-mark">01</span>
            <span>
              <strong>Skill Development</strong>
              <small>Run structured reps</small>
            </span>
            <ChevronRight size={28} />
          </button>
          <button className="mode-card combat" onClick={() => setView("combat")}>
            <span className="mode-mark fist">02</span>
            <span>
              <strong>Ground Combat</strong>
              <small>Test scenario decisions</small>
            </span>
            <ChevronRight size={28} />
          </button>
        </div>
        <div className="showcase-strip" aria-label="Example JiuQuest fighter styles">
          {showcaseFighters.map((item) => (
            <figure className="showcase-card" key={item.src}>
              <img src={item.src} alt={`${item.label} fighter style`} />
              <figcaption>{item.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <aside className="quest-rail">
        <div className="rank-card panel">
          <Belt belt={beltStatus.belt} stripes={beltStatus.stripes} />
          <div>
            <h2>{beltLabels[beltStatus.belt]}</h2>
            <p>{beltStatus.next}</p>
            <ProgressBar value={beltStatus.blueRatio * 100} label={`${beltStatus.learnedBlue}/${beltStatus.blueTotal} Blue Belt Path`} />
          </div>
        </div>

        <div className="panel quest-list">
          <h2>Technique Pipeline</h2>
          {featuredMoves.map((move) => (
            <button
              className="quest-row"
              key={move.id}
              onClick={() => {
                setSelectedMoveId(move.id);
                setView("training");
              }}
            >
              <TechniqueThumbnail move={move} fighter={fighter} />
              <span>
                <strong>{move.name}</strong>
                <small>{move.lesson}</small>
                <ProgressBar value={((fighter.progress?.[move.id] ?? 0) / 50) * 100} mini />
              </span>
              <span className="xp-chip">XP</span>
            </button>
          ))}
          <button className="secondary-button full" onClick={() => setView("training")}>
            Open Training
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="panel combat-card">
          <h2>Scenario Readiness</h2>
          <div className="arena-preview">
            <GrapplingSnapshotStage state={createArenaState(fighter.startPose)} fighter={fighter} opponent={npcs[0]} fighterBelt={beltStatus} compact />
          </div>
          <button
            className="danger-button full"
            onClick={() => {
              startCombat(npcs[0], fighter.startPose);
              setView("combat");
            }}
          >
            <Swords size={20} />
            Open Arena
          </button>
        </div>

        <div className="stats-strip">
          <Stat icon={Dumbbell} label="Clean Reps" value={trainingTotals.attempts} />
          <Stat icon={BookOpen} label="Learned" value={trainingTotals.learned} />
          <Stat icon={Trophy} label="Wins" value={fighter.wins} />
        </div>
      </aside>
    </section>
  );
}

function ProfileBuilder({ fighter, beltStatus, updateFighter, createNewFighter, canCreate, resetProgress, saveStatus }) {
  return (
    <section className="profile-grid">
      <div className="profile-stage panel">
        <FighterProfileArt fighter={fighter} beltStatus={beltStatus} />
        <div className="profile-rank">
          <Belt belt={beltStatus.belt} stripes={beltStatus.stripes} />
          <div>
            <h1>{fighter.name || "Unnamed Fighter"}</h1>
            <p>{fighter.country} - {fighter.stance}</p>
          </div>
        </div>
      </div>

      <div className="builder-panel panel">
        <div className="section-heading">
          <span>
            <h1>Fighter Creator</h1>
            <p>Build the avatar that carries your belt, stripes, and unlocked technique loadout.</p>
          </span>
          <button className="secondary-button" onClick={createNewFighter} disabled={!canCreate}>
            <Plus size={18} />
            New Slot
          </button>
        </div>

        <div className="form-grid">
          <Field label="Name">
            <input value={fighter.name} onChange={(event) => updateFighter({ name: event.target.value })} maxLength={28} />
          </Field>
          <Field label="Country">
            <select value={fighter.country} onChange={(event) => updateFighter({ country: event.target.value })}>
              {customizationOptions.countries.map((country) => (
                <option key={country}>{country}</option>
              ))}
            </select>
          </Field>
          <Field label="Gender">
            <Segmented
              label="Gender"
              value={fighter.gender}
              options={customizationOptions.genders}
              onChange={(gender) => updateFighter({ gender })}
            />
          </Field>
          <Field label="Start Position">
            <Segmented
              label="Start position"
              value={fighter.startPose}
              options={["standing", "kneeling"]}
              onChange={(startPose) => updateFighter({ startPose })}
            />
          </Field>
          <Field label="Hair Style">
            <select value={fighter.hairStyle} onChange={(event) => updateFighter({ hairStyle: event.target.value })}>
              {customizationOptions.hairStyles.map((style) => (
                <option key={style}>{style}</option>
              ))}
            </select>
          </Field>
          <Field label="Fighting Stance">
            <ImageSelect
              value={fighter.stance}
              options={customizationOptions.stances}
              onChange={(stance) => updateFighter({ stance })}
              getImage={(stance) => stanceArt[stance] ?? stanceArt["wrestling stance"]}
              renderPreview={(stance) => (
                <FighterArt
                  fighter={fighter}
                  beltStatus={beltStatus}
                  pose={stancePose[stance] ?? "wrestling"}
                  className="image-select-fighter"
                  showAura={false}
                  showPatches={false}
                />
              )}
              getLabel={titleCase}
              getMeta={(stance) => stanceCopy[stance]}
            />
            <small>{stanceCopy[fighter.stance] ?? stanceCopy["wrestling stance"]}</small>
          </Field>
        </div>

        <Swatches label="Skin Tone" value={fighter.skinTone} options={customizationOptions.skinTones} onChange={(skinTone) => updateFighter({ skinTone })} />
        <Swatches label="Hair Color" value={fighter.hairColor} options={customizationOptions.hairColors} onChange={(hairColor) => updateFighter({ hairColor })} />
        <Swatches label="Gi Jacket" value={fighter.giTop} options={customizationOptions.giColors} onChange={(giTop) => updateFighter({ giTop })} />
        <Swatches label="Gi Pants" value={fighter.giPants} options={customizationOptions.giColors} onChange={(giPants) => updateFighter({ giPants })} />

        <div className="form-grid compact">
          <Field label="Aura">
            <select value={fighter.aura} onChange={(event) => updateFighter({ aura: event.target.value })}>
              {customizationOptions.auras.map((aura) => (
                <option key={aura}>{aura}</option>
              ))}
            </select>
          </Field>
          <Field label="Patch Emblem">
            <ImageSelect
              value={fighter.emblem}
              options={customizationOptions.emblems}
              onChange={(emblem) => updateFighter({ emblem })}
              getImage={(emblem) => emblemAssets[emblem] ?? emblemAssets.triangle}
              getLabel={titleCase}
              getMeta={(emblem) => (emblem === "none" ? "No patch emblem" : `${titleCase(emblem)} patch`)}
              compact
            />
          </Field>
        </div>

        <div className="button-row">
          <span className={`save-indicator ${saveStatus.ok === false ? 'form-error' : ''}`} role="status">
            <Save size={18} />
            {saveStatus.ok === false ? 'Changes could not be saved on this device' : 'Appearance saved on this device'}
          </span>
          <button className="secondary-button" onClick={resetProgress}>
            <RotateCcw size={18} />
            Clear Progress
          </button>
        </div>
      </div>
    </section>
  );
}

function Training({
  fighter,
  beltStatus,
  selectedBelt,
  setSelectedBelt,
  beltMoves,
  selectedMove,
  setSelectedMoveId,
  trainingOrder,
  setTrainingOrder,
  runTrainingTest,
  trainingResult,
}) {
  const selectedProgress = fighter.progress?.[selectedMove.id] ?? 0;
  const lockedFullPath = selectedMove.belt !== "blue" && selectedMove.preview;
  const trainingPosition = createArenaState(selectedMove.endsIn ?? selectedMove.starts[0]);

  return (
    <section className="training-grid">
      <div className="panel training-sidebar">
        <h1>Skill Development</h1>
        <p>Train the step order until the technique becomes combat-ready. Five clean reps unlock the move. Fifty reps caps the efficiency bonus.</p>
        <div className="belt-tabs">
          {BELTS.slice(1).map((belt) => (
            <button key={belt} className={selectedBelt === belt ? "active" : ""} onClick={() => setSelectedBelt(belt)}>
              <span style={{ background: beltColors[belt] }} />
              {beltLabels[belt]}
            </button>
          ))}
        </div>
        <div className="move-list">
          {beltMoves.map((move) => {
            const count = fighter.progress?.[move.id] ?? 0;
            const learned = count >= 5;
            return (
              <button
                key={move.id}
                className={`move-row ${selectedMove.id === move.id ? "selected" : ""}`}
                onClick={() => setSelectedMoveId(move.id)}
              >
                <TechniqueThumbnail move={move} fighter={fighter} />
                <span>
                  <strong>{move.name}</strong>
                  <small>{move.category} - {move.phase}</small>
                  <ProgressBar value={(count / 50) * 100} mini />
                </span>
                {move.preview ? <Lock size={15} /> : learned ? <Check size={16} /> : <span className="rep-count">{count}/5</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel technique-stage">
        <div className="technique-head">
          <span>
            <small>{selectedMove.lesson}</small>
            <h1>{selectedMove.name}</h1>
            <p>{selectedMove.description}</p>
          </span>
          <div className="progress-orb">
            <strong>{selectedProgress}/50</strong>
            <small>clean reps</small>
          </div>
        </div>
        <div className="training-animation-card">
          <div className="training-animation-head"><span><h3>Position reference</h3><p>The settled position for this technique. Follow the steps below for the full sequence and required setup.</p></span></div>
          <GrapplingSnapshotStage state={trainingPosition} fighter={fighter} opponent={defaultNpcs[0]} fighterBelt={beltStatus} compact />
        </div>
        <div className="scenario-box">
          <h3>Ideal Scenario</h3>
          <p>{selectedMove.scenario}</p>
        </div>
        <div className="step-scroll">
          {selectedMove.steps.map((step, index) => (
            <div key={step} className="step-line">
              <span>{index + 1}</span>
              <p>{step}</p>
            </div>
          ))}
        </div>
        {lockedFullPath && (
          <div className="soon-banner">
            Purple, brown, and black belt full programs are coming soon. These three shadow moves can still be drilled and unlocked for experimental combat.
          </div>
        )}
      </div>

      <div className="panel test-panel">
        <div className="section-heading">
          <span>
            <h2>Proficiency Test</h2>
            <p>Put the randomized sequence back in order and perform the move.</p>
          </span>
          <Gauge size={28} />
        </div>
        <ProgressBar value={(selectedProgress / 5) * 100} label={selectedProgress >= 5 ? "Arena unlocked" : `${Math.max(0, 5 - selectedProgress)} clean reps to unlock`} />
        <div className="order-stack">
          {trainingOrder.map((step, index) => (
            <div key={`${step}-${index}`} className="order-card">
              <span>{index + 1}</span>
              <p>{step}</p>
              <div>
                <button onClick={() => setTrainingOrder((list) => moveItem(list, index, index - 1))} aria-label="Move step up">
                  <ChevronLeft size={16} />
                </button>
                <button onClick={() => setTrainingOrder((list) => moveItem(list, index, index + 1))} aria-label="Move step down">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button className="primary-button full" onClick={runTrainingTest} disabled={selectedProgress >= 50}>
          <Activity size={18} />
          Perform Technique
        </button>
        <button className="secondary-button full" onClick={() => setTrainingOrder(shuffle(selectedMove.steps))}>
          <RotateCcw size={18} />
          Try Test Again
        </button>
        {trainingResult && (
          <div className={`result-card ${trainingResult.tone}`}>
            <strong>{trainingResult.title}</strong>
            <p>{trainingResult.message}</p>
          </div>
        )}
        <div className="belt-mini">
          <FighterArt fighter={fighter} beltStatus={beltStatus} pose="profile" className="mini-fighter" />
          <Belt belt={beltStatus.belt} stripes={beltStatus.stripes} />
        </div>
      </div>
    </section>
  );
}

function ProgressLab({ fighter, beltStatus }) {
  const learned = moves.filter((move) => (fighter.progress?.[move.id] ?? 0) >= 5);
  const blueMoves = moves.filter((move) => move.belt === "blue" && !move.preview);
  return (
    <section className="progress-grid">
      <div className="panel progress-hero">
        <FighterProfileArt fighter={fighter} beltStatus={beltStatus} className="progress-profile-art" />
        <div>
          <h1>{fighter.name}'s Rank Path</h1>
          <p>{beltStatus.next}</p>
          <Belt belt={beltStatus.belt} stripes={beltStatus.stripes} />
          <ProgressBar value={beltStatus.blueRatio * 100} label={`${beltStatus.learnedBlue}/${beltStatus.blueTotal} blue-belt techniques learned`} />
        </div>
      </div>
      <div className="panel belt-roadmap">
        {BELTS.map((belt) => (
          <div key={belt} className={belt === beltStatus.belt ? "current" : ""}>
            <span style={{ background: beltColors[belt] }} />
            <strong>{beltLabels[belt]}</strong>
            <small>
              {belt === "white"
                ? `${beltStatus.stripes}/4 stripes`
                : belt === "blue"
                  ? `${learned.filter((move) => move.belt === "blue").length}/${blueMoves.length} learned`
                  : "3 shadow moves available"}
            </small>
          </div>
        ))}
      </div>
      <div className="panel progress-table">
        <h2>Technique Efficiency</h2>
        {moves.map((move) => {
          const count = fighter.progress?.[move.id] ?? 0;
          return (
            <div key={move.id} className="progress-row">
              <span>
                <strong>{move.name}</strong>
                <small>{beltLabels[move.belt]} - {move.category}</small>
              </span>
              <ProgressBar value={(count / 50) * 100} label={`${count}/50`} />
            </div>
          );
        })}
      </div>
      <div className="panel combat-bonus">
        <h2>Combat Instinct</h2>
        <p>Every match adds a tiny permanent arena-read bonus, capped at 10% after 1,000 matches.</p>
        <ProgressBar value={Math.min(100, fighter.matches / 10)} label={`${fighter.matches}/1000 matches - ${Math.min(10, fighter.matches / 100).toFixed(2)}% bonus`} />
        <div className="stats-strip">
          <Stat icon={Swords} label="Matches" value={fighter.matches} />
          <Stat icon={Trophy} label="Wins" value={fighter.wins} />
          <Stat icon={X} label="Losses" value={fighter.losses} />
        </div>
      </div>
    </section>
  );
}

function AdminPanel({ store, setStore, setView }) {
  const [adminMode, setAdminMode] = useState("console");
  const music = store.adminSettings.music ?? defaultAdminSettings.music;
  const tracks = Array.isArray(music.tracks) && music.tracks.length ? music.tracks : defaultMusicTracks;

  const updateAlgorithm = (key, value) => {
    setStore((current) => ({
      ...current,
      adminSettings: {
        ...current.adminSettings,
        algorithm: {
          ...current.adminSettings.algorithm,
          [key]: Number(value),
        },
      },
    }));
  };

  const updateCategory = (key, value) => {
    setStore((current) => ({
      ...current,
      adminSettings: {
        ...current.adminSettings,
        categoryWeights: {
          ...current.adminSettings.categoryWeights,
          [key]: Number(value),
        },
      },
    }));
  };

  const updateNpc = (id, patch) => {
    setStore((current) => ({
      ...current,
      npcs: current.npcs.map((npc) => (npc.id === id ? { ...npc, ...patch } : npc)),
    }));
  };

  const addNpc = () => {
    const npc = {
      ...defaultNpcs[0],
      id: `npc-${Date.now()}`,
      name: "New Rival",
      difficulty: 50,
    };
    setStore((current) => ({ ...current, npcs: [...current.npcs, npc] }));
  };

  const updateMusic = (patch) => {
    setStore((current) => ({
      ...current,
      adminSettings: {
        ...current.adminSettings,
        music: {
          ...current.adminSettings.music,
          ...patch,
        },
      },
    }));
  };

  const updateTrack = (id, patch) => {
    updateMusic({
      tracks: tracks.map((track) => (track.id === id ? { ...track, ...patch } : track)),
    });
  };

  const addTrack = () => {
    const id = `track-${Date.now()}`;
    updateMusic({
      tracks: [
        ...tracks,
        {
          id,
          title: "New Instrumental Combat Track",
          bpm: 145,
          mood: "Dark techno combat",
          source: "Admin generated",
          url: "",
          playerEnabled: false,
          notes: "Instrumental only; no singing, no lyrics, and no lead vocal lines.",
        },
      ],
    });
  };

  const removeTrack = (id) => {
    const nextTracks = tracks.filter((track) => track.id !== id);
    updateMusic({
      tracks: nextTracks.length ? nextTracks : tracks,
      activeTrackId: music.activeTrackId === id ? nextTracks[0]?.id ?? tracks[0]?.id : music.activeTrackId,
    });
  };

  if (adminMode === "music") {
    return (
      <MusicGeneratorPage
        music={music}
        tracks={tracks}
        updateMusic={updateMusic}
        updateTrack={updateTrack}
        addTrack={addTrack}
        removeTrack={removeTrack}
        setAdminMode={setAdminMode}
        setView={setView}
      />
    );
  }

  return (
    <section className="admin-grid">
      <div className="panel admin-hero">
        <div>
          <h1>Admin Console</h1>
          <p>Tune rivals, music, move weighting, and scenario math without touching the code.</p>
        </div>
        <div className="admin-actions">
          <button className="primary-button" onClick={() => setAdminMode("music")}>
            <Headphones size={18} />
            Music Generator
          </button>
          <button className="secondary-button" onClick={() => setView("dashboard")}>
            <Home size={18} />
            Back to App
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Algorithm Weights</h2>
        <div className="slider-grid">
          {Object.entries(store.adminSettings.algorithm).map(([key, value]) => (
            <label key={key}>
              <span>{key}</span>
              <input
                type="range"
                min={key === "npcVariance" ? 0 : 0.1}
                max={key === "npcVariance" ? 35 : 2}
                step={key === "npcVariance" ? 1 : 0.05}
                value={value}
                onChange={(event) => updateAlgorithm(key, event.target.value)}
              />
              <strong>{value}</strong>
            </label>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Move Category Multipliers</h2>
        <div className="slider-grid">
          {Object.entries(store.adminSettings.categoryWeights).map(([key, value]) => (
            <label key={key}>
              <span>{key}</span>
              <input type="range" min="0.4" max="1.6" step="0.02" value={value} onChange={(event) => updateCategory(key, event.target.value)} />
              <strong>{value}</strong>
            </label>
          ))}
        </div>
      </div>

      <div className="panel npc-admin">
        <div className="section-heading">
          <span>
            <h2>Non-Player Characters</h2>
            <p>These rivals appear in Ground Combat. Change names, belts, stripes, gi colors, stance, and looks.</p>
          </span>
          <button className="primary-button" onClick={addNpc}>
            <Plus size={18} />
            Add Rival
          </button>
        </div>
        {store.npcs.map((npc) => (
          <div className="npc-editor" key={npc.id}>
            <div className="npc-preview-card">
              <FighterArt
                fighter={npc}
                beltStatus={{ belt: npc.belt, stripes: npc.stripes }}
                pose={getFighterPose(npc)}
                className="admin-npc-fighter"
              />
            </div>
            <div className="npc-admin-fields">
              <label className="npc-field">
                <span>Name</span>
                <input value={npc.name} onChange={(event) => updateNpc(npc.id, { name: event.target.value })} />
              </label>
              <label className="npc-field">
                <span>Country</span>
                <select value={npc.country ?? "United States"} onChange={(event) => updateNpc(npc.id, { country: event.target.value })}>
                  {customizationOptions.countries.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </label>
              <label className="npc-field">
                <span>Belt</span>
                <select value={npc.belt} onChange={(event) => updateNpc(npc.id, { belt: event.target.value })}>
                  {BELTS.map((belt) => (
                    <option key={belt} value={belt}>
                      {beltLabels[belt]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="npc-field">
                <span>Stripes</span>
                <input
                  type="number"
                  min="0"
                  max="4"
                  value={npc.stripes}
                  onChange={(event) => updateNpc(npc.id, { stripes: Math.max(0, Math.min(4, Number(event.target.value) || 0)) })}
                  aria-label="NPC stripes"
                />
              </label>
              <div className="npc-field npc-field-wide">
                <span>Fighting Stance</span>
                <ImageSelect
                  compact
                  value={npc.stance ?? customizationOptions.stances[0]}
                  options={customizationOptions.stances}
                  onChange={(stance) => updateNpc(npc.id, { stance })}
                  getImage={(stance) => stanceArt[stance] ?? stanceArt["wrestling stance"]}
                  renderPreview={(stance) => (
                    <FighterArt
                      fighter={npc}
                      beltStatus={{ belt: npc.belt, stripes: npc.stripes }}
                      pose={stancePose[stance] ?? "wrestling"}
                      className="image-select-fighter"
                      showAura={false}
                      showPatches={false}
                    />
                  )}
                  getLabel={(stance) => titleCase(stance)}
                  getMeta={(stance) => stanceCopy[stance]}
                />
              </div>
              <label className="npc-field">
                <span>Gender</span>
                <select value={npc.gender ?? "boy"} onChange={(event) => updateNpc(npc.id, { gender: event.target.value })}>
                  {customizationOptions.genders.map((gender) => (
                    <option key={gender} value={gender}>
                      {gender}
                    </option>
                  ))}
                </select>
              </label>
              <label className="npc-field">
                <span>Hair Style</span>
                <select value={npc.hairStyle ?? "shadow spikes"} onChange={(event) => updateNpc(npc.id, { hairStyle: event.target.value })}>
                  {customizationOptions.hairStyles.map((style) => (
                    <option key={style} value={style}>
                      {style}
                    </option>
                  ))}
                </select>
              </label>
              <label className="npc-field">
                <span>Aura</span>
                <select value={npc.aura ?? "void violet"} onChange={(event) => updateNpc(npc.id, { aura: event.target.value })}>
                  {customizationOptions.auras.map((aura) => (
                    <option key={aura} value={aura}>
                      {aura}
                    </option>
                  ))}
                </select>
              </label>
              <label className="npc-field">
                <span>Patch</span>
                <select value={npc.emblem ?? "triangle"} onChange={(event) => updateNpc(npc.id, { emblem: event.target.value })}>
                  {customizationOptions.emblems.map((emblem) => (
                    <option key={emblem} value={emblem}>
                      {emblem}
                    </option>
                  ))}
                </select>
              </label>
              <div className="npc-field npc-swatch-field">
                <span>Skin</span>
                <SwatchInput options={customizationOptions.skinTones} value={npc.skinTone} onChange={(skinTone) => updateNpc(npc.id, { skinTone })} label="NPC skin tone" />
              </div>
              <div className="npc-field npc-swatch-field">
                <span>Hair</span>
                <SwatchInput options={customizationOptions.hairColors} value={npc.hairColor} onChange={(hairColor) => updateNpc(npc.id, { hairColor })} label="NPC hair color" />
              </div>
              <div className="npc-field npc-swatch-field">
                <span>Gi Jacket</span>
                <SwatchInput options={customizationOptions.giColors} value={npc.giTop} onChange={(giTop) => updateNpc(npc.id, { giTop })} label="NPC gi jacket" />
              </div>
              <div className="npc-field npc-swatch-field">
                <span>Gi Pants</span>
                <SwatchInput options={customizationOptions.giColors} value={npc.giPants} onChange={(giPants) => updateNpc(npc.id, { giPants })} label="NPC gi pants" />
              </div>
              <label className="npc-field npc-field-wide">
                <span className="npc-difficulty-label">
                  Difficulty <strong>{npc.difficulty}</strong>
                </span>
                <input
                  type="range"
                  min="20"
                  max="98"
                  value={npc.difficulty}
                  onChange={(event) => updateNpc(npc.id, { difficulty: Number(event.target.value) })}
                  aria-label="NPC difficulty"
                />
              </label>
            </div>
            <button
              className="icon-button npc-delete"
              onClick={() => setStore((current) => ({ ...current, npcs: current.npcs.filter((item) => item.id !== npc.id) }))}
              disabled={store.npcs.length <= 1}
              aria-label={`Delete ${npc.name}`}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="panel deploy-admin">
        <h2>Domain Launch Checklist</h2>
        <p>The app is configured for GitHub Pages and `jiuquest.com`. DNS still has to be saved in Namecheap and Pages must be enabled in GitHub.</p>
        <code>A @ 185.199.108.153</code>
        <code>A @ 185.199.109.153</code>
        <code>A @ 185.199.110.153</code>
        <code>A @ 185.199.111.153</code>
        <code>AAAA @ 2606:50c0:8000::153</code>
        <code>AAAA @ 2606:50c0:8001::153</code>
        <code>AAAA @ 2606:50c0:8002::153</code>
        <code>AAAA @ 2606:50c0:8003::153</code>
        <code>CNAME www owner.github.io</code>
        <code>TXT @ v=spf1 -all</code>
        <code>TXT _dmarc v=DMARC1; p=reject; adkim=s; aspf=s</code>
      </div>
    </section>
  );
}

function MusicGeneratorPage({ music, tracks, updateMusic, updateTrack, addTrack, removeTrack, setAdminMode, setView }) {
  const activeTrackId = music.activeTrackId ?? tracks[0]?.id;

  return (
    <section className="admin-grid music-generator-page">
      <div className="panel admin-hero music-hero">
        <div>
          <h1>Music Generator</h1>
          <p>Create and curate instrumental combat tracks for the JiuQuest background music library.</p>
        </div>
        <div className="admin-actions">
          <button className="secondary-button" onClick={() => setAdminMode("console")}>
            <Settings size={18} />
            Admin Console
          </button>
          <button className="secondary-button" onClick={() => setView("dashboard")}>
            <Home size={18} />
            Back to App
          </button>
        </div>
      </div>

      <div className="panel workflow-panel">
        <div className="section-heading">
          <span>
            <h2>Generation Rules</h2>
            <p>These instructions keep the game music punchy, loopable, original, and safe for a public app.</p>
          </span>
          <Headphones size={28} />
        </div>
        <div className="source-reference-list">
          {sourceReferenceTracks.map((track) => (
            <div key={track.label}>
              <strong>{track.label}</strong>
              <small>{track.source}</small>
              <p>{track.instruction}</p>
            </div>
          ))}
        </div>
        <ol className="workflow-steps">
          {musicWorkflowSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <pre className="workflow-prompt">
{`Prompt for an outside music generator:
Create an original instrumental JiuQuest background track for a Brazilian jiu-jitsu combat game. Style: dark techno, cyberpunk boss fight, gaming arena, driving kick, heavy bass, distorted synths, risers, impacts, glitch fills, and sidechain pumping. Target 135-150 BPM, default 145 BPM. No singing. No lyrics. No lead vocals. Do not copy melody, hook, drums, lyrics, vocal sound, or recognizable beat pattern from any reference song. Use reference files only for broad energy and pacing when legally permitted. Export a full version and a seamless loop as WAV and MP3.`}
        </pre>
      </div>

      <div className="panel music-library">
        <div className="section-heading">
          <span>
            <h2>Admin Music Library</h2>
            <p>Choose which tracks players can select, set the default, and point tracks to hosted audio files.</p>
          </span>
          <button className="primary-button" onClick={addTrack}>
            <Plus size={18} />
            Add Track
          </button>
        </div>

        <div className="music-controls">
          <Field label="Default Track">
            <select value={activeTrackId} onChange={(event) => updateMusic({ activeTrackId: event.target.value })}>
              {tracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.title}
                </option>
              ))}
            </select>
          </Field>
          <label className="field">
            <span>Game Volume</span>
            <input
              type="range"
              min="0"
              max="0.8"
              step="0.02"
              value={music.volume}
              onChange={(event) => updateMusic({ volume: Number(event.target.value) })}
            />
            <small>{Math.round((music.volume ?? 0) * 100)}%</small>
          </label>
        </div>

        <div className="track-editor-list">
          {tracks.map((track) => (
            <div className="track-card" key={track.id}>
              <div className="track-card-head">
                <label className="track-permission">
                  <input
                    type="checkbox"
                    checked={track.playerEnabled !== false}
                    onChange={(event) => updateTrack(track.id, { playerEnabled: event.target.checked })}
                  />
                  Show to players
                </label>
                <button className="icon-button" onClick={() => removeTrack(track.id)} disabled={tracks.length <= 1}>
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="track-fields">
                <Field label="Title">
                  <input value={track.title} onChange={(event) => updateTrack(track.id, { title: event.target.value })} />
                </Field>
                <Field label="BPM">
                  <input
                    type="number"
                    min="90"
                    max="180"
                    value={track.bpm}
                    onChange={(event) => updateTrack(track.id, { bpm: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Mood">
                  <input value={track.mood} onChange={(event) => updateTrack(track.id, { mood: event.target.value })} />
                </Field>
                <Field label="Audio URL or Path">
                  <input value={track.url} onChange={(event) => updateTrack(track.id, { url: event.target.value })} />
                </Field>
                <Field label="Source Reference">
                  <input value={track.source} onChange={(event) => updateTrack(track.id, { source: event.target.value })} />
                </Field>
                <label className="field track-notes">
                  <span>Notes</span>
                  <textarea value={track.notes} onChange={(event) => updateTrack(track.id, { notes: event.target.value })} />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function createCombatState(npc) {
  return {
    npc,
    arenaKey: chooseArenaKey(npc?.belt),
    active: false,
    phase: "idle",
    ...createArenaState("standing"),
    round: 1,
    selectedMoveId: null,
    order: [],
    secondsLeft: 10,
    playerExchanges: 0,
    npcExchanges: 0,
    playerPoints: 0,
    npcPoints: 0,
    bestPlayer: null,
    bestNpc: null,
    result: null,
    log: ["Choose a standing or kneeling start to begin your match."],
  };
}

function chooseNpcMove(npc, position, opposingMove) {
  const known = allMoves.filter((move) => {
    if (move.belt === "white") return true;
    const beltRank = BELTS.indexOf(move.belt);
    const npcRank = BELTS.indexOf(npc.belt);
    return beltRank <= Math.max(1, npcRank + 1) && !move.preview;
  });
  const fitting = known.filter((move) => move.starts.includes(position) && isArenaCounterApplicable(move, { position }, opposingMove));
  return shuffle(fitting)[0] ?? starterMoves.find((move) => move.id === "protect-position");
}

function scoreMove({ move, fighter, position, order, settings, belt }) {
  const ratio = correctRatio(order, move.steps);
  const progress = fighter.progress?.[move.id] ?? 0;
  const trainingBonus = Math.min(20, Math.floor(progress / 5) * 2) * settings.algorithm.trainingBonus;
  const matchBonus = Math.min(10, fighter.matches / 100) * settings.algorithm.matchBonus;
  const rankBonus = (beltOrderBonus[belt] ?? 0) * settings.algorithm.beltBonus;
  const category = settings.categoryWeights[move.category] ?? 1;
  const scenario =
    move.good.includes(position) ? 12 : move.poor.includes(position) ? -50 : move.starts.includes(position) ? 4 : -25;
  const basicPenalty = move.type === "basic" ? settings.algorithm.basicMovePenalty : 1;
  const total =
    ((move.weight * settings.algorithm.baseTechnique * category * basicPenalty) +
      ratio * 35 * settings.algorithm.stepAccuracy +
      trainingBonus +
      matchBonus +
      rankBonus +
      scenario * settings.algorithm.scenarioBonus) /
    1.55;
  return {
    total: Math.max(0, Math.min(100, total)),
    ratio,
    trainingBonus,
    matchBonus,
    rankBonus,
    scenario,
  };
}

function scoreNpc({ npc, move, position, settings }) {
  const scenario = move.good.includes(position) ? 10 : move.poor.includes(position) ? -35 : move.starts.includes(position) ? 3 : -18;
  const base = npc.difficulty ?? npcBeltBase[npc.belt] ?? 44;
  const random = Math.random() * settings.algorithm.npcVariance;
  const stripeBonus = (npc.stripes ?? 0) * 2;
  const category = settings.categoryWeights[move.category] ?? 1;
  return {
    total: Math.max(0, Math.min(100, base * category + random + stripeBonus + scenario)),
    scenario,
    ratio: Math.random(),
  };
}

function startAudio(audioRef, view, volume, track, onError) {
  if (audioRef.current) return;
  const hostedUrl = track?.url?.trim();
  if (hostedUrl) {
    const audio = new Audio(hostedUrl);
    audio.loop = true;
    audio.volume = volume;
    const reportError = () => {
      if (audioRef.current?.audio !== audio) return;
      audio.pause();
      audioRef.current = null;
      onError?.("Music could not play. Check your connection and try again.");
    };
    audioRef.current = { audio };
    audio.onerror = reportError;
    audio.play().catch(reportError);
    return;
  }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) { onError?.("Audio is unavailable in this browser."); return; }
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = volume;
  gain.connect(context.destination);
  const bpm = Math.max(90, Math.min(180, Number(track?.bpm) || 132));
  const beatSeconds = 60 / bpm;
  const tempo = view === "combat" ? beatSeconds / 2 : view === "training" ? beatSeconds : beatSeconds * 1.5;
  const root = track?.id === "paradise-circuit" ? 123.47 : track?.id === "power-clash" ? 98 : 110;
  const oscillators = [root, root * 1.334, root * 2].map((frequency, index) => {
    const osc = context.createOscillator();
    const oscGain = context.createGain();
    osc.type = index === 0 ? "sine" : "triangle";
    osc.frequency.value = frequency;
    oscGain.gain.value = index === 0 ? 0.08 : 0.025;
    osc.connect(oscGain).connect(gain);
    osc.start();
    return { osc, oscGain };
  });
  const pulse = window.setInterval(() => {
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(volume * 0.55, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.03);
    gain.gain.linearRampToValueAtTime(volume * 0.48, now + 0.22);
  }, tempo * 1000);
  audioRef.current = { context, oscillators, pulse };
  context.resume().catch(() => { if (audioRef.current?.context === context) onError?.("Audio playback was blocked. Try enabling music again."); });
}

function stopAudio(audioRef) {
  if (!audioRef.current) return;
  const { audio, context, oscillators = [], pulse } = audioRef.current;
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audioRef.current = null;
    return;
  }
  window.clearInterval(pulse);
  oscillators.forEach(({ osc }) => osc.stop());
  context?.close();
  audioRef.current = null;
}

function EmblemMark({ emblem, className = "" }) {
  if (!emblem || emblem === "none") return null;
  const src = emblemAssets[emblem] ?? emblemAssets.triangle;
  return <img className={`emblem-mark ${className}`.trim()} src={src} alt={`${titleCase(emblem)} emblem`} />;
}

function FighterProfileArt({ fighter, beltStatus, className = "" }) {
  const stancePoseId = getFighterPose(fighter);
  const countryBackground = countryFlagBackgrounds[fighter.country] ?? countryFlagBackgrounds["United States"];
  return (
    <div className={`profile-art ${className}`.trim()} style={{ "--country-flag": countryBackground }}>
      <div className="profile-character-shell">
        <FighterArt fighter={fighter} beltStatus={beltStatus} pose="profile" className="profile-main-fighter" />
      </div>
      <aside className="stance-reference-card">
        <span>Starting Stance</span>
        <strong>{titleCase(fighter.stance)}</strong>
        <FighterArt fighter={fighter} beltStatus={beltStatus} pose={stancePoseId} className="stance-reference-fighter" showAura={false} />
      </aside>
      <div className="profile-art-tags">
        <span>{fighter.country}</span>
        <span>{beltLabels[beltStatus.belt]}</span>
      </div>
    </div>
  );
}

function FighterArt({ fighter, beltStatus, pose = "profile", className = "", facing = "front", showAura = true, showPatches = true, showPatchCovers = false }) {
  const source = resolveFighterArtSource(pose, fighter.hairStyle);
  const maskBase = `/assets/characters/masks/${source.mask}`;
  const poseClass = source.pose ?? "profile";
  const hairStyle = fighter.hairStyle ?? "shadow spikes";
  const hairStyleSlug = hairStyle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const bodyMask = poseClass === "profile" ? "body-no-belt" : "body-no-hair-no-belt";
  const artStyle = {
    "--fighter-src": `url("${source.image}")`,
    "--skin-mask": `url("${maskBase}-skin.png")`,
    "--hair-mask": `url("${maskBase}-hair.png")`,
    "--jacket-mask": `url("${maskBase}-jacket.png")`,
    "--pants-mask": `url("${maskBase}-pants.png")`,
    "--belt-mask": `url("${maskBase}-belt.png")`,
    "--body-mask": `url("${maskBase}-${bodyMask}.png")`,
    "--skin": fighter.skinTone ?? "#d99b71",
    "--hair": fighter.hairColor ?? "#11131c",
    "--gi-top": fighter.giTop ?? "#f8fbff",
    "--gi-pants": fighter.giPants ?? "#f8fbff",
    "--belt-color": beltColors[beltStatus?.belt ?? fighter.belt ?? "white"],
    "--aura": auraColors[fighter.aura] ?? "#8a5cff",
  };

  return (
    <span
      className={`fighter-art fighter-pose-${poseClass} facing-${facing} hair-style-${hairStyleSlug} ${className}`.trim()}
      data-hair-style={hairStyle}
      style={artStyle}
      aria-label={`${fighter.name} fighter art`}
    >
      {showAura ? <span className="fighter-art-aura" /> : null}
      <span className="fighter-art-layer fighter-art-base" />
      <span className="fighter-art-layer fighter-art-tint fighter-art-skin" />
      <span className="fighter-art-layer fighter-art-tint fighter-art-hair" />
      <span className="fighter-art-layer fighter-art-hair-detail" />
      <span className="fighter-art-layer fighter-art-tint fighter-art-jacket" />
      <span className="fighter-art-layer fighter-art-tint fighter-art-pants" />
      <span className="fighter-art-layer fighter-art-tint fighter-art-belt" />
      <span className="fighter-art-layer fighter-art-detail" />
      <span className="fighter-art-layer fighter-art-belt-detail" />
      {showPatchCovers ? (
        <>
          <span className={`fighter-art-patch-cover heart pose-${poseClass}`} />
          <span className={`fighter-art-patch-cover lower-leg pose-${poseClass}`} />
        </>
      ) : null}
      {showPatches ? (
        <>
          <EmblemMark emblem={fighter.emblem} className={`fighter-art-emblem heart pose-${poseClass}`} />
          <EmblemMark emblem={fighter.emblem} className={`fighter-art-emblem lower-leg pose-${poseClass}`} />
        </>
      ) : null}
      <span className="fighter-art-stripes">
        {Array.from({ length: beltStatus?.stripes ?? fighter.stripes ?? 0 }).map((_, index) => (
          <i key={index} />
        ))}
      </span>
    </span>
  );
}

function Avatar({ fighter, beltStatus, size = "profile", facing = "front" }) {
  const aura = auraColors[fighter.aura] ?? "#8a5cff";
  const hairStyleClass = fighter.hairStyle?.replaceAll(" ", "-");
  return (
    <div
      className={`avatar avatar-${size} facing-${facing} stance-${fighter.stance?.replaceAll(" ", "-")}`}
      style={{
        "--skin": fighter.skinTone,
        "--hair": fighter.hairColor,
        "--gi-top": fighter.giTop,
        "--gi-pants": fighter.giPants,
        "--aura": aura,
        "--belt-color": beltColors[beltStatus.belt],
      }}
      aria-label={`${fighter.name} avatar`}
    >
      <span className="avatar-aura" />
      <span className={`hair hair-back hair-${hairStyleClass}`} />
      <span className="head">
        <span className="brow brow-left" />
        <span className="brow brow-right" />
        <span className="eye eye-left" />
        <span className="eye eye-right" />
        <span className="nose" />
        <span className="mouth" />
      </span>
      <span className={`hair hair-front hair-${hairStyleClass}`} />
      <span className="neck" />
      <span className="torso">
        <span className="collar" />
        <span className="lapel left" />
        <span className="lapel right" />
        <span className="gi-fold fold-a" />
        <span className="gi-fold fold-b" />
        <span className="gi-fold fold-c" />
        <span className="patch">
          <EmblemMark emblem={fighter.emblem} />
        </span>
      </span>
      <span className="arm arm-left" />
      <span className="arm arm-right" />
      <span className="hand hand-left" />
      <span className="hand hand-right" />
      <span className="belt">
        {Array.from({ length: beltStatus.stripes ?? 0 }).map((_, index) => (
          <i key={index} />
        ))}
      </span>
      <span className="leg leg-left" />
      <span className="leg leg-right" />
      <span className="foot foot-left" />
      <span className="foot foot-right" />
      <span className="avatar-shadow" />
    </div>
  );
}

function MiniPortrait({ fighter, beltStatus }) {
  return (
    <span
      className="mini-portrait"
      style={{ "--portrait-aura": auraColors[fighter.aura] ?? "#8a5cff" }}
      aria-label={`${fighter.name} portrait`}
    >
      <FighterArt
        fighter={fighter}
        beltStatus={beltStatus}
        pose="profile"
        className="mini-portrait-fighter"
        showAura={false}
        showPatches={false}
      />
    </span>
  );
}

function Belt({ belt, stripes = 0 }) {
  return (
    <span className={`belt-rank belt-${belt}`}>
      <span className="belt-wrap" style={{ background: beltColors[belt] }}>
        <i />
        {Array.from({ length: stripes }).map((_, index) => (
          <b key={index} />
        ))}
      </span>
    </span>
  );
}

function TechniqueThumbnail({ move, fighter }) {
  return (
    <span className={`tech-thumb ${move.category}`} style={{ "--aura": auraColors[fighter.aura] ?? "#8a5cff" }}>
      {move.isSubmission ? <Swords size={18} /> : move.category === "escape" ? <Shield size={18} /> : <Dumbbell size={18} />}
    </span>
  );
}

function TechniqueSnapshot({ move, fighter, opponent, compact = false, fighterBeltStatus, opponentBeltStatus, arenaKey = "studio" }) {
  const rival = opponent ?? {
    name: "Training Rival",
    skinTone: "#a86b4d",
    hairColor: "#11131c",
    giTop: "#112a58",
    giPants: "#112a58",
    aura: "red surge",
    stance: "wrestling stance",
    emblem: "star",
  };
  const attackerStatus = fighterBeltStatus ?? { belt: fighter.belt ?? "white", stripes: fighter.stripes ?? 0 };
  const rivalStatus = opponentBeltStatus ?? { belt: rival.belt ?? "white", stripes: rival.stripes ?? 0 };
  const artwork = techniqueArtworkForMove(move);
  return (
    <div className={`technique-snapshot ${compact ? "compact" : ""} ${move.category} technique-${move.id}`}>
      {artwork ? (
        <TechniqueArtworkScene artwork={artwork} move={move} compact={compact} />
      ) : (
        <GrapplePositionScene
          move={move}
          position={move.endsIn}
          fighter={fighter}
          opponent={rival}
          fighterBeltStatus={attackerStatus}
          opponentBeltStatus={rivalStatus}
          compact={compact}
          arenaKey={arenaKey}
        />
      )}
      <p>{move.isSubmission ? `${move.name} finish: rival is forced to tap.` : `${move.name} changes the position to ${positionLabels[move.endsIn] ?? move.endsIn}.`}</p>
    </div>
  );
}

function TechniqueArtworkScene({ artwork, move, compact = false }) {
  return (
    <div className={`technique-art-scene ${compact ? "compact" : ""}`}>
      <img src={artwork.src} alt={`${move.name} - ${artwork.label}`} />
      <span className="technique-art-badge">
        <strong>{move.category}</strong>
        <small>{artwork.label}</small>
      </span>
    </div>
  );
}

function RearChokeScene({ move, fighter, opponent, fighterBeltStatus, opponentBeltStatus, compact = false, arenaKey = "studio" }) {
  return (
    <div
      className={`rear-choke-scene arena-${arenaKey} ${compact ? "compact" : ""}`}
      style={{ "--attacker-skin": fighter.skinTone ?? "#d99b71" }}
    >
      <FighterArt
        fighter={fighter}
        beltStatus={fighterBeltStatus}
        pose="profile"
        className="rear-choke-fighter rear-choke-attacker"
        showPatches={false}
        showPatchCovers={false}
      />
      <FighterArt
        fighter={opponent}
        beltStatus={opponentBeltStatus}
        pose="profile"
        className="rear-choke-fighter rear-choke-defender"
        showPatches={false}
        showPatchCovers={false}
      />
      <span className="rear-choke-arm choking-arm" />
      <span className="rear-choke-arm support-arm" />
      <div className="impact-ring rear-choke-ring">
        <strong>{move.category}</strong>
        <span>Rear Choke</span>
      </div>
      <span className="tap-out">Tap</span>
    </div>
  );
}

function GrapplePositionScene({ move, position, fighter, opponent, fighterBeltStatus, opponentBeltStatus, compact = false, arenaKey = "studio" }) {
  const positionKey = position ?? move?.endsIn ?? "standing";
  const isStanceScene = positionKey === "standing" || positionKey === "kneeling" || positionKey === "clinch" || positionKey === "scramble";
  const attackerPose = isStanceScene ? getFighterPose(fighter) : "sambo";
  const defenderPose = isStanceScene ? getFighterPose(opponent) : "profile";

  return (
    <div className={`grapple-scene arena-${arenaKey} position-${positionKey} ${compact ? "compact" : ""}`}>
      <FighterArt
        fighter={fighter}
        beltStatus={fighterBeltStatus}
        pose={attackerPose}
        className="grapple-fighter attacker"
        facing="right"
        showPatches={false}
        showPatchCovers={false}
      />
      <div className="impact-ring">
        <strong>{move.category}</strong>
        <span>{positionLabels[positionKey] ?? positionKey}</span>
      </div>
      <FighterArt
        fighter={opponent}
        beltStatus={opponentBeltStatus}
        pose={defenderPose}
        className="grapple-fighter defender"
        facing="left"
        showPatches={false}
        showPatchCovers={false}
      />
      {move.isSubmission ? <span className="tap-out">Tap</span> : null}
    </div>
  );
}

function FighterCard({ fighter, beltStatus, reverse = false }) {
  return (
    <div className={`fighter-card ${reverse ? "reverse" : ""}`}>
      <MiniPortrait fighter={fighter} beltStatus={beltStatus} />
      <span>
        <strong>{fighter.name}</strong>
        <small>
          {beltLabels[beltStatus.belt]} {beltStatus.stripes ? `- ${beltStatus.stripes} stripe` : ""}
        </small>
      </span>
    </div>
  );
}

function BottomNav({ view, setView }) {
  return (
    <nav className="bottom-nav">
      {navItems.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          aria-current={view === id ? "page" : undefined}
          aria-label={label}
          className={view === id ? "active" : ""}
          onClick={() => setView(id)}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function ProgressBar({ value, label, mini = false }) {
  return (
    <div className={`progress-bar ${mini ? "mini" : ""}`}>
      {label ? <span>{label}</span> : null}
      <i>
        <b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </i>
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="stat">
      <Icon size={19} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Segmented({ label = "Options", value, options, onChange }) {
  return (
    <span className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-label={`${label}: ${option}`}
          aria-pressed={value === option}
          className={value === option ? "active" : ""}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </span>
  );
}

function ImageSelect({ value, options, onChange, getImage, renderPreview, getLabel, getMeta, compact = false }) {
  const [open, setOpen] = useState(false);
  const previewFor = (option) => renderPreview?.(option) ?? <img src={getImage(option)} alt="" />;
  return (
    <span
      className={`image-select ${open ? "open" : ""} ${compact ? "compact" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="image-select-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        {previewFor(value)}
        <span>
          <strong>{getLabel(value)}</strong>
          {getMeta ? <small>{getMeta(value)}</small> : null}
        </span>
        <ChevronDown size={18} />
      </button>
      {open ? (
        <span className="image-select-menu" role="listbox">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              className={option === value ? "active" : ""}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {previewFor(option)}
              <span>
                <strong>{getLabel(option)}</strong>
                {getMeta ? <small>{getMeta(option)}</small> : null}
              </span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function Swatches({ label, value, options, onChange }) {
  return (
    <div className="swatch-row">
      <span>{label}</span>
      <div>
        {options.map((option) => {
          const friendlyLabel = label === "Skin Tone" ? skinToneLabels[option] ?? option : option;
          return (
            <button
              key={option}
              type="button"
              className={`${value === option ? "active " : ""}swatch-color-${option.replace("#", "")}`.trim()}
              style={{ background: option }}
              onClick={() => onChange(option)}
              aria-label={`${label}: ${friendlyLabel}`}
              aria-pressed={value === option}
            />
          );
        })}
      </div>
    </div>
  );
}

function SwatchInput({ value, onChange, options = customizationOptions.giColors, label = "Set color" }) {
  return (
    <span className="tiny-swatches">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? "active" : ""}
          style={{ background: option }}
          onClick={() => onChange(option)}
          aria-label={`${label} ${option}`}
        />
      ))}
    </span>
  );
}

function Modal({ title, children, onClose }) {
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <button className="icon-button close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default App;
