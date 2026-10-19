import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Check, Play, RotateCcw, Shield, Swords, Trophy } from "lucide-react";
import { allMoves, beltLabels } from "../data/curriculum.js";
import { createArenaState, getArenaPositionLabel, getPositionForSide } from "../arena/outcome.js";
import GrapplingSnapshotStage from "./GrapplingSnapshotStage.jsx";

function startsFrom(move, position) {
  return move.id === "protect-position" || move.starts?.includes(position);
}

function requiredPosition(move) {
  const labels = [...new Set((move.starts ?? []).map((position) => getArenaPositionLabel(position)))];
  return labels.length ? `Requires ${labels.join(" or ").toLowerCase()}.` : "Unavailable in this position.";
}

function AthleteScore({ athlete, belt, stripes = 0, reverse = false }) {
  return (
    <div className={`fighter-card ${reverse ? "reverse" : ""}`}>
      <span className="snapshot-kit" aria-hidden="true">
        <i style={{ background: athlete.giTop }} />
        <i style={{ background: athlete.giPants }} />
      </span>
      <span>
        <strong>{athlete.name}</strong>
        <small>{beltLabels[belt] ?? belt}{stripes ? ` · ${stripes} stripe${stripes === 1 ? "" : "s"}` : ""}</small>
      </span>
    </div>
  );
}

export default function CombatArenaView({
  fighter,
  beltStatus,
  combat,
  setCombat,
  npcs,
  unlockedMoves,
  chooseCombatMove,
  resolveCombatTurn,
  startCombat,
  notify,
  onTrain,
}) {
  const [announcement, setAnnouncement] = useState("");
  const nextActionRef = useRef(null);
  const orderRef = useRef(null);
  const opponent = combat.npc;
  const position = getPositionForSide(combat, "fighter");
  const positionLabel = getArenaPositionLabel(combat);
  const selectedMove = allMoves.find((move) => move.id === combat.selectedMoveId);
  const protectPosition = allMoves.find((move) => move.id === "protect-position");
  const learnedMoves = [...new Map([...unlockedMoves, ...(protectPosition ? [protectPosition] : [])].map((move) => [move.id, move])).values()];
  const fittingMoves = learnedMoves.filter((move) => startsFrom(move, position));
  const unavailableMoves = learnedMoves.filter((move) => !startsFrom(move, position));
  const isOrdering = combat.active && combat.phase === "ordering";
  const canChoose = combat.active && combat.phase === "selecting";
  const isFinished = combat.phase === "finished" || combat.result?.finished === true;
  const canStart = !combat.active || isFinished;
  const selectedOrder = combat.order ?? [];

  const announce = (message, tone = "info") => {
    setAnnouncement(message);
    notify?.(message, tone);
  };

  useEffect(() => {
    if (combat.phase === "result") nextActionRef.current?.focus({ preventScroll: true });
    if (combat.phase === "ordering") {
      orderRef.current?.focus({ preventScroll: true });
      orderRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }, [combat.phase]);

  const begin = (startPosition) => {
    startCombat(opponent, startPosition);
    announce(`Match started against ${opponent.name} from ${startPosition}. Choose your first technique.`, "success");
  };

  const changeOpponent = (event) => {
    const nextNpc = npcs.find((npc) => npc.id === event.target.value);
    if (!nextNpc) return;
    setCombat((current) => ({
      ...current,
      ...createArenaState("standing"),
      npc: nextNpc,
      active: false,
      phase: "idle",
      round: 1,
      startPosition: "standing",
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
      log: [`${nextNpc.name} selected. Choose a standing or kneeling start.`],
    }));
    announce(`${nextNpc.name} selected. Ready for a new match.`);
  };

  const prepareNextAction = () => {
    setCombat((current) => ({
      ...current,
      active: true,
      phase: "selecting",
      selectedMoveId: null,
      order: [],
      log: [`Ready for exchange ${current.round}. ${getArenaPositionLabel(current)}.`, ...(current.log ?? [])].slice(0, 8),
      // Retain result and resolved top/control ownership until another exchange settles.
    }));
    announce(`Ready for exchange ${combat.round}. Choose a technique from ${positionLabel.toLowerCase()}.`);
  };

  const restart = () => {
    if (combat.active && !window.confirm("Restart this match? Current exchange scores will be reset.")) {
      announce("Restart cancelled. Your current match is unchanged.");
      return;
    }
    const startPosition = combat.startPosition === "kneeling" ? "kneeling" : "standing";
    startCombat(opponent, startPosition);
    announce(`Match restarted against ${opponent.name} from ${startPosition}.`, "success");
  };

  const moveStep = (index, direction) => {
    const target = index + direction;
    if (!isOrdering || target < 0 || target >= selectedOrder.length) return;
    setCombat((current) => {
      if (current.phase !== "ordering" || !current.active) return current;
      const order = [...current.order];
      const [step] = order.splice(index, 1);
      order.splice(target, 0, step);
      return { ...current, order };
    });
    announce(`Step ${index + 1} moved to position ${target + 1}.`);
  };

  const renderTechnique = (move, available) => (
    <button
      type="button"
      key={move.id}
      className={`${combat.selectedMoveId === move.id ? "selected" : ""} ${available ? "" : "unavailable"}`.trim()}
      disabled={!available || !canChoose}
      aria-pressed={combat.selectedMoveId === move.id}
      onClick={() => {
        chooseCombatMove(move);
        announce(`${move.name} selected. Put the ${move.steps.length} steps in order before the timer ends.`);
      }}
    >
      <span>{move.name}</span>
      <small>{available ? `${move.category} · ${move.steps.length} steps` : requiredPosition(move)}</small>
    </button>
  );

  return (
    <>
      <div className="arena-page-heading">
        <div>
          <h1>Grappling arena</h1>
          <p>Choose your technique. See who earns control.</p>
        </div>
        <button type="button" className="ghost-button" title="Restart match" onClick={restart}>
          <RotateCcw size={16} />Restart match
        </button>
      </div>

      <section className="combat-grid" aria-label="Grappling match">
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

        <div className="panel arena-panel">
          <div className="arena-top" aria-label="Match scoreboard">
            <AthleteScore athlete={fighter} belt={beltStatus.belt} stripes={beltStatus.stripes} />
            <div className="round-core">
              <span>{isFinished ? "Final score" : `Round ${combat.round} of 8`}</span>
              <strong aria-label={`${fighter.name}: ${combat.playerExchanges ?? 0} exchanges. ${opponent.name}: ${combat.npcExchanges ?? 0} exchanges.`}>
                {combat.playerExchanges ?? 0}<span aria-hidden="true"> : </span>{combat.npcExchanges ?? 0}
              </strong>
              <small>Exchanges won</small>
            </div>
            <AthleteScore athlete={opponent} belt={opponent.belt} stripes={opponent.stripes} reverse />
          </div>

          <div className={`mat-window cinematic-mode ${combat.result ? "result-mode" : ""}`}>
            <GrapplingSnapshotStage
              state={combat}
              fighter={fighter}
              fighterBelt={beltStatus}
              opponent={opponent}
              result={combat.result}
              onReplay={() => announce(`Reviewing the settled position: ${positionLabel.toLowerCase()}.`)}
            />
          </div>

          {combat.result && (
            <div
              className={`arena-outcome ${combat.result.playerWins ? "success" : "is-opponent"}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={isFinished ? "Match result" : "Settled exchange"}
            >
              <span>{isFinished && <Trophy size={16} aria-hidden="true" />} {combat.result.headline}</span>
              <small>{combat.result.line}</small>
              <small>Current position: {positionLabel.toLowerCase()}.</small>
            </div>
          )}

          <div className="combat-actions">
            {canStart ? (
              <>
                <select aria-label="Choose opponent" value={opponent.id} onChange={changeOpponent}>
                  {npcs.map((npc) => <option key={npc.id} value={npc.id}>{npc.name} · {beltLabels[npc.belt] ?? npc.belt}</option>)}
                </select>
                <button type="button" className="primary-button" onClick={() => begin("standing")}><Play size={15} />Standing Start</button>
                <button type="button" className="secondary-button" onClick={() => begin("kneeling")}>Kneeling Start</button>
              </>
            ) : isOrdering ? (
              <>
                <button type="button" className="primary-button" onClick={resolveCombatTurn} disabled={!selectedMove}><Check size={16} />Execute Technique</button>
                <span className="clock-pill" role="timer" aria-live="off">{combat.secondsLeft}s remaining · the displayed order submits when time ends</span>
              </>
            ) : combat.phase === "result" ? (
              <button type="button" ref={nextActionRef} className="primary-button" onClick={prepareNextAction}><Play size={16} />Prepare Next Action</button>
            ) : (
              <span className="clock-pill">Choose a technique for {positionLabel.toLowerCase()}.</span>
            )}
          </div>
        </div>

        <aside className="panel move-command" aria-label="Technique selection">
          <div className="section-heading">
            <div>
              <h2>Choose a technique</h2>
              <p>{canStart ? "Start your match, then choose a move for the current position." : isOrdering ? "Arrange the selected technique below, then execute." : combat.phase === "result" ? "Prepare your next action to continue from the settled position." : `Select your response from ${positionLabel.toLowerCase()}.`}</p>
            </div>
            <Swords size={22} />
          </div>
          <div className="combat-moves">
            <div className="combat-group">
              <h3>Available from this position · {fittingMoves.length}</h3>
              {fittingMoves.map((move) => renderTechnique(move, true))}
              {!fittingMoves.length && <p className="arena-help">No learned techniques start from this position. Train more responses to expand your options.</p>}
            </div>
            {unavailableMoves.length > 0 && <details className="unavailable-techniques">
              <summary>Other positions · {unavailableMoves.length}</summary>
              <div className="combat-group">{unavailableMoves.map((move) => renderTechnique(move, false))}</div>
            </details>}
          </div>
          {onTrain && <div className="arena-help">
            <span>{isOrdering ? "Finish this sequence before opening training." : "Learn more techniques to build your options."}</span>
            <button type="button" className="secondary-button full" disabled={isOrdering} onClick={() => { announce("Opening training. Your current match stays available."); onTrain(); }}><BookOpen size={16} />Open training</button>
          </div>}
        </aside>

        <div className="panel sequence-panel" aria-label="Technique sequence and exchange history">
          {selectedMove && isOrdering ? (
            <>
              <div className="section-heading" ref={orderRef} tabIndex={-1}>
                <div>
                  <h2>{selectedMove.name}</h2>
                  <p>Put the steps in order. Use the arrows, then execute before the timer ends.</p>
                </div>
              </div>
              <div className="order-stack" role="list" aria-label={`${selectedMove.name} step order`}>
                {selectedOrder.map((step, index) => (
                  <div key={step} className="order-card" role="listitem">
                    <span aria-label={`Step ${index + 1}`}>{index + 1}</span>
                    <p>{step}</p>
                    <div>
                      <button type="button" aria-label={`Move step ${index + 1} up: ${step}`} disabled={index === 0 || !isOrdering} onClick={() => moveStep(index, -1)}><ArrowUp size={16} /></button>
                      <button type="button" aria-label={`Move step ${index + 1} down: ${step}`} disabled={index === selectedOrder.length - 1 || !isOrdering} onClick={() => moveStep(index, 1)}><ArrowDown size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="sequence-actions">
                <button type="button" className="primary-button" onClick={resolveCombatTurn}><Check size={16} />Submit sequence</button>
                <span className="clock-pill" role="timer" aria-live="off">{combat.secondsLeft}s remaining</span>
              </div>
            </>
          ) : combat.result ? (
            <div className={`result-card ${combat.result.playerWins ? "success" : "danger"}`}>
              <h2>{isFinished ? "Match complete" : "Exchange settled"}</h2>
              <p>{combat.result.headline}</p>
              <p>{isFinished ? "Start a new match when you are ready." : "The next exchange begins from the position shown above."}</p>
            </div>
          ) : (
            <div className="empty-state">
              <Shield size={28} aria-hidden="true" />
              <h2>Your next move</h2>
              <p>Choose a technique to begin its 10-second sequence. The outcome determines who holds the next position.</p>
            </div>
          )}

          <div className="combat-log" role="log" aria-label="Exchange history" aria-live="polite" aria-relevant="additions">
            <h3>Exchange history</h3>
            {(combat.log ?? []).map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
            {!combat.log?.length && <p>Your exchanges will appear here when the match begins.</p>}
          </div>
        </div>
      </section>
    </>
  );
}
