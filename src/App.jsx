import { useEffect, useMemo, useRef, useState } from "react";
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
  defaultNpcs,
  getBeltStatus,
  getTrainingTotals,
  isMoveUnlocked,
  loadState,
  MAX_FIGHTERS,
  saveState,
} from "./storage";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "profile", label: "Fighter", icon: User },
  { id: "training", label: "Skill Development", icon: BookOpen },
  { id: "combat", label: "Ground Combat", icon: Swords },
  { id: "progress", label: "Progress", icon: Trophy },
];

const auraColors = {
  "void violet": "#8a5cff",
  "mat gold": "#f7c852",
  "blue flame": "#4aa3ff",
  "red surge": "#ff4f55",
  "emerald focus": "#3ee0a0",
};

const stanceCopy = {
  "wrestling stance": "low hips, forward pressure",
  "sumo base": "wide base, heavy center",
  "boxer shell": "hands high, sharp angle",
  "karate stance": "long range, quick entry",
  "muay thai guard": "upright clinch threat",
  "combat base": "one knee ready, mat aware",
  "sambo crouch": "low hooks, takedown chain",
  "capoeira rhythm": "mobile feints, spinning lane",
};

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

function correctRatio(order, steps) {
  const correct = order.filter((step, index) => step === steps[index]).length;
  return correct / steps.length;
}

function App() {
  const [store, setStore] = useState(loadState);
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

  useEffect(() => saveState(store), [store]);

  useEffect(() => {
    if (!trainingOrder.length || selectedMove.steps.some((step) => !trainingOrder.includes(step))) {
      setTrainingOrder(shuffle(selectedMove.steps));
      setTrainingResult(null);
    }
  }, [selectedMove, trainingOrder.length]);

  useEffect(() => {
    if (!musicOn) {
      stopAudio(audioRef);
      return;
    }
    startAudio(audioRef, view, store.adminSettings.music.volume);
    return () => stopAudio(audioRef);
  }, [musicOn, view, store.adminSettings.music.volume]);

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
    if (store.fighters.length >= MAX_FIGHTERS) return;
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
    }
  };

  const startCombat = (npc = combat.npc, startPosition = fighter.startPose) => {
    setCombat({
      ...createCombatState(npc),
      active: true,
      position: startPosition,
      log: [`Gate opened from ${positionLabels[startPosition]}. Choose your first action.`],
    });
  };

  const chooseCombatMove = (move) => {
    setCombat((current) => ({
      ...current,
      selectedMoveId: move.id,
      order: shuffle(move.steps),
      secondsLeft: 10,
      phase: "ordering",
      result: null,
      log: [`${move.name} selected. Put the incantation in order before the clock burns out.`, ...current.log].slice(0, 8),
    }));
  };

  const resolveCombatTurn = () => {
    setCombat((current) => {
      if (!current.active || !current.selectedMoveId) return current;
      const move = allMoves.find((item) => item.id === current.selectedMoveId);
      const npcMove = chooseNpcMove(current.npc, current.position);
      const playerScore = scoreMove({
        move,
        fighter,
        position: current.position,
        order: current.order,
        settings: store.adminSettings,
        belt: beltStatus.belt,
      });
      const npcScore = scoreNpc({ npc: current.npc, move: npcMove, position: current.position, settings: store.adminSettings });
      const playerWins = playerScore.total >= npcScore.total;
      const winnerMove = playerWins ? move : npcMove;
      const nextPosition = winnerMove.endsIn ?? current.position;
      const submission = winnerMove.isSubmission && Math.max(playerScore.total, npcScore.total) >= 52;
      const finished = submission || current.round >= 8;
      const didWin = playerWins && finished;
      const didLose = !playerWins && finished;
      const result = {
        playerWins,
        finished,
        move: winnerMove,
        playerScore,
        npcScore,
        line: playerWins
          ? `${move.name} lands at ${formatPercent(playerScore.total)}. ${current.npc.name}'s ${npcMove.name} fades at ${formatPercent(npcScore.total)}.`
          : `${current.npc.name} answers with ${npcMove.name} at ${formatPercent(npcScore.total)}. Your ${move.name} scored ${formatPercent(playerScore.total)}.`,
      };

      if (finished) {
        recordCombatResult(didWin, didLose);
      }

      return {
        ...current,
        phase: finished ? "finished" : "result",
        active: !finished,
        round: current.round + 1,
        position: nextPosition,
        selectedMoveId: null,
        secondsLeft: 10,
        result,
        log: [
          submission
            ? `${winnerMove.name} becomes the finishing seal. ${playerWins ? current.npc.name : fighter.name} taps.`
            : current.round >= 8
              ? "The timer ends. Decision goes to the cleaner chain."
              : "Prepare for next action.",
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

  const resetProgress = () => {
    const confirmed = window.confirm(`Clear all progress for ${fighter.name}? Customization will stay.`);
    if (!confirmed) return;
    updateFighter({
      progress: allMoves.reduce((acc, move) => ({ ...acc, [move.id]: 0 }), {}),
      matches: 0,
      wins: 0,
      losses: 0,
    });
  };

  return (
    <div className={`app-shell view-${view}`}>
      <div className="energy-field" aria-hidden="true" />
      <Header
        fighter={fighter}
        fighters={store.fighters}
        selectedId={store.selectedFighterId}
        setStore={setStore}
        beltStatus={beltStatus}
        musicOn={musicOn}
        setMusicOn={setMusicOn}
        openAdmin={openAdmin}
      />

      <main>
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

      <BottomNav view={view} setView={setView} />

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

function Header({ fighter, fighters, selectedId, setStore, beltStatus, musicOn, setMusicOn, openAdmin }) {
  return (
    <header className="topbar">
      <button className="brand-lockup" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
        <span className="brand-sigil">△</span>
        <span>JiuQuest</span>
      </button>
      <label className="fighter-select">
        <MiniPortrait fighter={fighter} />
        <span>
          <strong>{fighter.name}</strong>
          <small>{beltLabels[beltStatus.belt]}</small>
        </span>
        <select
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
      <button className={`music-toggle ${musicOn ? "active" : ""}`} onClick={() => setMusicOn((value) => !value)}>
        <Music size={19} />
        <span>Music</span>
        <span className="toggle-dot" />
        <Volume2 size={17} />
      </button>
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
        <h2>My Fighters</h2>
        <div className="fighter-slots">
          {fighters.map((item) => (
            <button
              key={item.id}
              className={`fighter-slot ${item.id === fighter.id ? "selected" : ""}`}
              onClick={() => setStore((current) => ({ ...current, selectedFighterId: item.id }))}
            >
              <MiniPortrait fighter={item} />
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
                <strong>Create Fighter</strong>
                <small>{MAX_FIGHTERS - fighters.length} slot{MAX_FIGHTERS - fighters.length === 1 ? "" : "s"} open</small>
              </span>
            </button>
          )}
        </div>
        <button className="primary-button full" onClick={createNewFighter} disabled={fighters.length >= MAX_FIGHTERS}>
          <BadgePlus size={18} />
          Create Fighter
        </button>
        <button className="secondary-button full" onClick={() => setView("profile")}>
          <User size={18} />
          Edit Fighter
        </button>
      </aside>

      <section className="hero-stage">
        <div className="dojo-backdrop" />
        <Avatar fighter={fighter} beltStatus={beltStatus} size="hero" />
        <div className="mode-cards">
          <button className="mode-card skill" onClick={() => setView("training")}>
            <span className="mode-mark">△</span>
            <span>
              <strong>Skill Development</strong>
              <small>Build your technique</small>
            </span>
            <ChevronRight size={28} />
          </button>
          <button className="mode-card combat" onClick={() => setView("combat")}>
            <span className="mode-mark fist">◆</span>
            <span>
              <strong>Ground Combat</strong>
              <small>Test your skills</small>
            </span>
            <ChevronRight size={28} />
          </button>
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
          <h2>Training Quests</h2>
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
            View All Quests
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="panel combat-card">
          <h2>Combat Arena</h2>
          <div className="versus-preview">
            <Avatar fighter={fighter} beltStatus={beltStatus} size="duel" facing="right" />
            <span>VS</span>
            <Avatar fighter={npcs[0]} beltStatus={{ belt: npcs[0].belt, stripes: npcs[0].stripes }} size="duel" facing="left" />
          </div>
          <button
            className="danger-button full"
            onClick={() => {
              startCombat(npcs[0], fighter.startPose);
              setView("combat");
            }}
          >
            <Swords size={20} />
            Ground Combat
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

function ProfileBuilder({ fighter, beltStatus, updateFighter, createNewFighter, canCreate, resetProgress }) {
  return (
    <section className="profile-grid">
      <div className="profile-stage panel">
        <Avatar fighter={fighter} beltStatus={beltStatus} size="profile" />
        <div className="profile-rank">
          <Belt belt={beltStatus.belt} stripes={beltStatus.stripes} />
          <div>
            <h1>{fighter.name || "Unnamed Fighter"}</h1>
            <p>{fighter.country} · {fighter.stance}</p>
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
              value={fighter.gender}
              options={customizationOptions.genders}
              onChange={(gender) => updateFighter({ gender })}
            />
          </Field>
          <Field label="Start Position">
            <Segmented
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
            <select value={fighter.stance} onChange={(event) => updateFighter({ stance: event.target.value })}>
              {customizationOptions.stances.map((stance) => (
                <option key={stance}>{stance}</option>
              ))}
            </select>
            <small>{stanceCopy[fighter.stance]}</small>
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
            <select value={fighter.emblem} onChange={(event) => updateFighter({ emblem: event.target.value })}>
              {customizationOptions.emblems.map((emblem) => (
                <option key={emblem}>{emblem}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="button-row">
          <button className="primary-button">
            <Save size={18} />
            Saved Automatically
          </button>
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
                  <small>{move.category} · {move.phase}</small>
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
        <TechniqueSnapshot move={selectedMove} fighter={fighter} opponent={null} />
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
          <Avatar fighter={fighter} beltStatus={beltStatus} size="mini" />
          <Belt belt={beltStatus.belt} stripes={beltStatus.stripes} />
        </div>
      </div>
    </section>
  );
}

function CombatArena({ fighter, beltStatus, combat, setCombat, npcs, unlockedMoves, chooseCombatMove, resolveCombatTurn, startCombat }) {
  const selectedMove = combat.selectedMoveId ? allMoves.find((move) => move.id === combat.selectedMoveId) : null;
  const grouped = unlockedMoves.reduce((acc, move) => {
    acc[move.belt] = [...(acc[move.belt] ?? []), move];
    return acc;
  }, {});

  return (
    <section className="combat-grid">
      <div className="panel arena-panel">
        <div className="arena-top">
          <FighterCard fighter={fighter} beltStatus={beltStatus} />
          <div className="round-core">
            <span>Round {combat.round}</span>
            <strong>{combat.phase === "ordering" ? combat.secondsLeft : "VS"}</strong>
            <small>{positionLabels[combat.position]}</small>
          </div>
          <FighterCard fighter={combat.npc} beltStatus={{ belt: combat.npc.belt, stripes: combat.npc.stripes }} reverse />
        </div>

        <div className="mat-window">
          <Avatar fighter={fighter} beltStatus={beltStatus} size="combat" facing="right" />
          <div className="mat-center">
            {combat.result ? (
              <TechniqueSnapshot move={combat.result.move} fighter={combat.result.playerWins ? fighter : combat.npc} opponent={combat.result.playerWins ? combat.npc : fighter} compact />
            ) : (
              <span className="versus-burst">VS</span>
            )}
          </div>
          <Avatar fighter={combat.npc} beltStatus={{ belt: combat.npc.belt, stripes: combat.npc.stripes }} size="combat" facing="left" />
        </div>

        <div className="combat-actions">
          {!combat.active && combat.phase !== "ordering" ? (
            <>
              <select
                value={combat.npc.id}
                onChange={(event) => {
                  const nextNpc = npcs.find((npc) => npc.id === event.target.value) ?? npcs[0];
                  setCombat(createCombatState(nextNpc));
                }}
              >
                {npcs.map((npc) => (
                  <option key={npc.id} value={npc.id}>
                    {npc.name} · {beltLabels[npc.belt]} {npc.stripes ? `${npc.stripes} stripe` : ""}
                  </option>
                ))}
              </select>
              <button className="primary-button" onClick={() => startCombat(combat.npc, "standing")}>
                Standing Start
              </button>
              <button className="secondary-button" onClick={() => startCombat(combat.npc, "kneeling")}>
                Kneeling Start
              </button>
            </>
          ) : combat.phase === "ordering" ? (
            <>
              <button className="danger-button" onClick={resolveCombatTurn}>
                Execute Technique
              </button>
              <span className="clock-pill">{combat.secondsLeft}s remaining</span>
            </>
          ) : (
            <button
              className="primary-button"
              onClick={() =>
                setCombat((current) => ({
                  ...current,
                  active: true,
                  phase: "selecting",
                  result: null,
                  log: ["Prepare for next action.", ...current.log].slice(0, 8),
                }))
              }
            >
              Prepare Next Action
            </button>
          )}
        </div>
      </div>

      <div className="panel move-command">
        <div className="section-heading">
          <span>
            <h1>Combat Deck</h1>
            <p>Only learned techniques appear here. Basic strikes stay available but score lower.</p>
          </span>
          <Swords size={28} />
        </div>
        <div className="combat-moves">
          {["white", "blue", "purple", "brown", "black"].map((belt) =>
            grouped[belt]?.length ? (
              <div key={belt} className="combat-group">
                <h3>{beltLabels[belt]}</h3>
                {grouped[belt].map((move) => (
                  <button
                    key={move.id}
                    className={combat.selectedMoveId === move.id ? "selected" : ""}
                    onClick={() => chooseCombatMove(move)}
                    disabled={combat.phase === "ordering"}
                  >
                    <span>{move.name}</span>
                    <small>{move.category} · {move.steps.length} steps</small>
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </div>
      </div>

      <div className="panel sequence-panel">
        {selectedMove ? (
          <>
            <div className="section-heading">
              <span>
                <h2>{selectedMove.name}</h2>
                <p>Reorder fast. The arena accepts whatever sequence is showing when the timer ends.</p>
              </span>
            </div>
            <div className="order-stack">
              {combat.order.map((step, index) => (
                <div key={`${step}-${index}`} className="order-card">
                  <span>{index + 1}</span>
                  <p>{step}</p>
                  <div>
                    <button onClick={() => setCombat((current) => ({ ...current, order: moveItem(current.order, index, index - 1) }))}>
                      <ChevronLeft size={16} />
                    </button>
                    <button onClick={() => setCombat((current) => ({ ...current, order: moveItem(current.order, index, index + 1) }))}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Swords size={42} />
            <h2>Select a move</h2>
            <p>Pick an unlocked technique from the combat deck to start the 10-second order test.</p>
          </div>
        )}

        <div className="combat-log">
          <h3>Fight Log</h3>
          {combat.log.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
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
        <Avatar fighter={fighter} beltStatus={beltStatus} size="profile" />
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
                <small>{beltLabels[move.belt]} · {move.category}</small>
              </span>
              <ProgressBar value={(count / 50) * 100} label={`${count}/50`} />
            </div>
          );
        })}
      </div>
      <div className="panel combat-bonus">
        <h2>Combat Instinct</h2>
        <p>Every match adds a tiny permanent arena-read bonus, capped at 10% after 1,000 matches.</p>
        <ProgressBar value={Math.min(100, fighter.matches / 10)} label={`${fighter.matches}/1000 matches · ${Math.min(10, fighter.matches / 100).toFixed(2)}% bonus`} />
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

  return (
    <section className="admin-grid">
      <div className="panel admin-hero">
        <div>
          <h1>Admin Console</h1>
          <p>Tune rivals, music, move weighting, and scenario math without touching the code.</p>
        </div>
        <button className="secondary-button" onClick={() => setView("dashboard")}>
          <Home size={18} />
          Back to App
        </button>
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
            <Avatar fighter={npc} beltStatus={{ belt: npc.belt, stripes: npc.stripes }} size="mini" />
            <input value={npc.name} onChange={(event) => updateNpc(npc.id, { name: event.target.value })} />
            <select value={npc.belt} onChange={(event) => updateNpc(npc.id, { belt: event.target.value })}>
              {BELTS.map((belt) => (
                <option key={belt} value={belt}>
                  {beltLabels[belt]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              max="4"
              value={npc.stripes}
              onChange={(event) => updateNpc(npc.id, { stripes: Number(event.target.value) })}
              aria-label="NPC stripes"
            />
            <input
              type="range"
              min="20"
              max="98"
              value={npc.difficulty}
              onChange={(event) => updateNpc(npc.id, { difficulty: Number(event.target.value) })}
              aria-label="NPC difficulty"
            />
            <SwatchInput value={npc.giTop} onChange={(giTop) => updateNpc(npc.id, { giTop })} />
            <SwatchInput value={npc.giPants} onChange={(giPants) => updateNpc(npc.id, { giPants })} />
            <button
              className="icon-button"
              onClick={() => setStore((current) => ({ ...current, npcs: current.npcs.filter((item) => item.id !== npc.id) }))}
              disabled={store.npcs.length <= 1}
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

function createCombatState(npc) {
  return {
    npc,
    active: false,
    phase: "idle",
    position: "standing",
    round: 1,
    selectedMoveId: null,
    order: [],
    secondsLeft: 10,
    result: null,
    log: ["Choose standing or kneeling start to open the gate."],
  };
}

function chooseNpcMove(npc, position) {
  const known = allMoves.filter((move) => {
    if (move.belt === "white") return true;
    const beltRank = BELTS.indexOf(move.belt);
    const npcRank = BELTS.indexOf(npc.belt);
    return beltRank <= Math.max(1, npcRank + 1) && !move.preview;
  });
  const fitting = known.filter((move) => move.starts.includes(position) || move.good.includes(position));
  return shuffle(fitting.length ? fitting : known)[0] ?? starterMoves[0];
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

function startAudio(audioRef, view, volume) {
  if (audioRef.current) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = volume;
  gain.connect(context.destination);
  const tempo = view === "combat" ? 0.18 : view === "training" ? 0.28 : 0.42;
  const oscillators = [110, 146.83, 220].map((frequency, index) => {
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
}

function stopAudio(audioRef) {
  if (!audioRef.current) return;
  const { context, oscillators, pulse } = audioRef.current;
  window.clearInterval(pulse);
  oscillators.forEach(({ osc }) => osc.stop());
  context.close();
  audioRef.current = null;
}

function Avatar({ fighter, beltStatus, size = "profile", facing = "front" }) {
  const aura = auraColors[fighter.aura] ?? "#8a5cff";
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
      <span className={`hair hair-${fighter.hairStyle?.replaceAll(" ", "-")}`} />
      <span className="head" />
      <span className="neck" />
      <span className="torso">
        <span className="lapel left" />
        <span className="lapel right" />
        <span className="patch">{fighter.emblem?.slice(0, 1)?.toUpperCase()}</span>
      </span>
      <span className="arm arm-left" />
      <span className="arm arm-right" />
      <span className="belt">
        {Array.from({ length: beltStatus.stripes ?? 0 }).map((_, index) => (
          <i key={index} />
        ))}
      </span>
      <span className="leg leg-left" />
      <span className="leg leg-right" />
    </div>
  );
}

function MiniPortrait({ fighter }) {
  return (
    <span className="mini-portrait" style={{ "--skin": fighter.skinTone, "--hair": fighter.hairColor, "--gi-top": fighter.giTop }}>
      <span />
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

function TechniqueSnapshot({ move, fighter, opponent, compact = false }) {
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
  return (
    <div className={`technique-snapshot ${compact ? "compact" : ""} ${move.category}`}>
      <div className="snapshot-mat">
        <Avatar fighter={fighter} beltStatus={{ belt: fighter.belt ?? "white", stripes: fighter.stripes ?? 0 }} size="snapshot" facing="right" />
        <div className="impact-ring">
          <strong>{move.category}</strong>
          <span>{move.phase}</span>
        </div>
        <Avatar fighter={rival} beltStatus={{ belt: rival.belt ?? "white", stripes: rival.stripes ?? 0 }} size="snapshot" facing="left" />
      </div>
      <p>{move.isSubmission ? `${move.name} finish: rival is forced to tap.` : `${move.name} changes the position to ${positionLabels[move.endsIn] ?? move.endsIn}.`}</p>
    </div>
  );
}

function FighterCard({ fighter, beltStatus, reverse = false }) {
  return (
    <div className={`fighter-card ${reverse ? "reverse" : ""}`}>
      <MiniPortrait fighter={fighter} />
      <span>
        <strong>{fighter.name}</strong>
        <small>
          {beltLabels[beltStatus.belt]} {beltStatus.stripes ? `· ${beltStatus.stripes} stripe` : ""}
        </small>
      </span>
    </div>
  );
}

function BottomNav({ view, setView }) {
  return (
    <nav className="bottom-nav">
      {navItems.map(({ id, label, icon: Icon }) => (
        <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
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

function Segmented({ value, options, onChange }) {
  return (
    <span className="segmented">
      {options.map((option) => (
        <button key={option} type="button" className={value === option ? "active" : ""} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </span>
  );
}

function Swatches({ label, value, options, onChange }) {
  return (
    <div className="swatch-row">
      <span>{label}</span>
      <div>
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
      </div>
    </div>
  );
}

function SwatchInput({ value, onChange }) {
  return (
    <span className="tiny-swatches">
      {customizationOptions.giColors.map((option) => (
        <button
          key={option}
          className={value === option ? "active" : ""}
          style={{ background: option }}
          onClick={() => onChange(option)}
          aria-label={`Set color ${option}`}
        />
      ))}
    </span>
  );
}

function Modal({ title, children, onClose }) {
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
