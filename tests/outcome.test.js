import assert from "node:assert/strict";
import test from "node:test";
import { allMoves, positions } from "../src/data/curriculum.js";
import {
  createArenaState,
  getArenaPositionLabel,
  getArenaSnapshot,
  getPositionForSide,
  isArenaCounterApplicable,
  normalizeArenaState,
  resolveArenaOutcome,
} from "../src/arena/outcome.js";

const move = (id) => {
  const found = allMoves.find((item) => item.id === id);
  assert.ok(found, `Curriculum move ${id} exists`);
  return found;
};

test("a takedown-versus-takedown exchange shows the winning side on top", () => {
  for (const actorSide of ["fighter", "opponent"]) {
    const state = resolveArenaOutcome(createArenaState(), move("double-leg-takedown"), actorSide);
    assert.equal(state.topSide, actorSide);
    assert.equal(state.position, actorSide === "fighter" ? "guard-top" : "guard-bottom");
    assert.equal(getArenaSnapshot(state).leadSide, actorSide);
    assert.equal(getArenaSnapshot(state).key, "guard");
    assert.equal(getPositionForSide(state, actorSide), "guard-top");
  }
});

test("an NPC mount takedown makes the player defend mount and NPC choose top moves", () => {
  const state = resolveArenaOutcome("standing", move("leg-hook-takedown"), "opponent");
  assert.deepEqual(state, { position: "mount-bottom", topSide: "opponent", controlSide: "opponent" });
  assert.equal(getPositionForSide(state, "opponent"), "mount-top");
  assert.equal(getArenaPositionLabel(state), "Under mount");
  assert.equal(getArenaPositionLabel(state, "opponent"), "Top mount");
});

test("a sweep reverses the previous top side and persists through the next selection", () => {
  const before = createArenaState("guard-bottom");
  const after = resolveArenaOutcome(before, move("elevator-sweep"), "fighter");
  assert.equal(before.topSide, "opponent");
  assert.deepEqual(after, { position: "mount-top", topSide: "fighter", controlSide: "fighter" });
  assert.deepEqual(resolveArenaOutcome(after, null, "opponent"), after);
  assert.equal(getArenaSnapshot(after).key, "mount");
});

test("an NPC sweep from bottom puts the NPC on top", () => {
  const state = resolveArenaOutcome("open-guard-top", move("double-ankle-sweep"), "opponent");
  assert.equal(state.topSide, "opponent");
  assert.equal(getPositionForSide(state, "fighter"), "mount-bottom");
  assert.equal(getPositionForSide(state, "opponent"), "mount-top");
});

test("elbow escapes recover bottom guard without making the winner top", () => {
  for (const [start, technique] of [["mount-bottom", "elbow-escape-mount"], ["side-bottom", "elbow-escape-side"]]) {
    for (const actorSide of ["fighter", "opponent"]) {
      const before = createArenaState(start, actorSide);
      const after = resolveArenaOutcome(before, move(technique), actorSide);
      assert.equal(after.topSide, before.topSide);
      assert.equal(getPositionForSide(after, actorSide), "guard-bottom");
      assert.equal(after.controlSide, null);
    }
  }
});

test("trap and roll is an escape that does put its performer on top", () => {
  const state = resolveArenaOutcome("mount-bottom", move("trap-roll-escape"), "fighter");
  assert.equal(state.topSide, "fighter");
  assert.equal(state.position, "guard-top");
});

test("pulling guard deliberately places the successful actor on bottom", () => {
  for (const actorSide of ["fighter", "opponent"]) {
    const state = resolveArenaOutcome("standing", move("pull-guard"), actorSide);
    assert.notEqual(state.topSide, actorSide);
    assert.equal(getPositionForSide(state, actorSide), "guard-bottom");
    assert.equal(getArenaSnapshot(state).leadSide, state.topSide);
  }
});

test("a side-to-mount transition preserves the actor's top role", () => {
  const before = createArenaState("side-top", "opponent");
  const after = resolveArenaOutcome(before, move("side-mount-to-full-mount"), "opponent");
  assert.equal(after.topSide, "opponent");
  assert.equal(after.position, "mount-bottom");
  assert.equal(getArenaSnapshot(after).key, "mount");
});

test("strikes and failed attacks do not teleport grounded players or reverse control", () => {
  const before = createArenaState("mount-bottom");
  assert.deepEqual(resolveArenaOutcome(before, move("basic-punch"), "fighter"), before);
  assert.deepEqual(resolveArenaOutcome(before, move("basic-kick"), "opponent"), before);
  assert.deepEqual(resolveArenaOutcome(before, move("trap-roll-escape"), "fighter", { successful: false }), before);
});

test("a submission from bottom is not rendered as top control by its winner", () => {
  const before = createArenaState("guard-bottom");
  const after = resolveArenaOutcome(before, move("triangle-choke"), "fighter");
  assert.deepEqual(after, before);
  assert.equal(getArenaSnapshot(after).leadSide, "opponent");
});

test("a submission from side control does not silently advance to mount", () => {
  const before = createArenaState("side-top");
  assert.deepEqual(resolveArenaOutcome(before, move("americana-armlock"), "fighter"), before);
});

test("the guide standing guillotine stays standing without an invented guard pull", () => {
  const state = resolveArenaOutcome("clinch", move("guillotine-choke"), "opponent");
  assert.deepEqual(state, createArenaState("clinch"));
});

test("back control uses controller identity, not an invented vertical top position", () => {
  const state = resolveArenaOutcome("guard-side-top", move("take-back-guard-final-getup"), "opponent");
  assert.deepEqual(state, { position: "back-defending", topSide: null, controlSide: "opponent" });
  assert.equal(getPositionForSide(state, "opponent"), "back-control");
  assert.equal(getArenaSnapshot(state).leadSide, "opponent");
  assert.equal(getArenaPositionLabel(state), "Defending back control");
  assert.deepEqual(resolveArenaOutcome(state, move("rear-naked-choke"), "opponent"), state);
});

test("standing, kneeling and clinch clear previous top/control identities", () => {
  for (const position of ["standing", "kneeling", "clinch", "scramble"]) {
    const state = normalizeArenaState({ position, topSide: "opponent", controlSide: "opponent" });
    assert.equal(state.topSide, null);
    assert.equal(state.controlSide, null);
    assert.equal(getPositionForSide(state, "opponent"), position);
  }
  assert.equal(getArenaSnapshot("standing").key, "standing");
  assert.equal(getArenaSnapshot("kneeling").key, "kneeling");
});

test("half guard and turtle retain explicit identities and correct viewer labels", () => {
  const halfGuard = createArenaState("halfGuard", "opponent");
  assert.equal(halfGuard.position, "half-guard-bottom");
  assert.equal(getArenaSnapshot(halfGuard).key, "half-guard");
  assert.equal(getArenaPositionLabel(halfGuard), "Bottom half guard");
  const turtle = createArenaState("turtle", "fighter");
  assert.equal(turtle.topSide, "opponent");
  assert.equal(getPositionForSide(turtle, "opponent"), "turtle-top");
  assert.equal(getArenaSnapshot(turtle).key, "turtle");
});

test("unmapped moves, selection changes, and invalid actor data retain the settled snapshot", () => {
  const before = createArenaState("side-top", "opponent");
  for (const winnerMove of [null, {}, { name: "Future move", endsIn: "unmapped-position" }]) {
    assert.deepEqual(resolveArenaOutcome(before, winnerMove, "fighter"), before);
    assert.deepEqual(getArenaSnapshot(resolveArenaOutcome(before, winnerMove)), getArenaSnapshot(before));
  }
  assert.deepEqual(resolveArenaOutcome(before, move("basic-tackle"), "unmapped"), before);
});

test("malformed saved position names cannot become inherited object properties", () => {
  for (const position of ["constructor", "prototype", "hasOwnProperty", null, 123]) {
    assert.deepEqual(normalizeArenaState({ position }), createArenaState("standing"));
    assert.equal(getArenaSnapshot({ position }).key, "standing");
  }
  const before = createArenaState("mount-bottom");
  assert.deepEqual(resolveArenaOutcome(before, { category: "transition", endsIn: "constructor" }), before);
});

test("explicit top/controller identities override stale actor-relative position labels", () => {
  const topState = normalizeArenaState({ position: "mount-top", topSide: "opponent", controlSide: "fighter" });
  assert.deepEqual(topState, { position: "mount-bottom", topSide: "opponent", controlSide: "opponent" });
  const backState = normalizeArenaState({ position: "back-control", controlSide: "opponent" });
  assert.deepEqual(backState, { position: "back-defending", topSide: null, controlSide: "opponent" });
  assert.equal(getArenaSnapshot(backState).leadSide, "opponent");
});

test("the universal defensive fallback is legal for every normalized role without moving either player", () => {
  const protect = move("protect-position");
  for (const position of [...positions, "half-guard", "turtle"]) {
    for (const actorSide of ["fighter", "opponent"]) {
      const state = createArenaState(position, actorSide);
      for (const side of ["fighter", "opponent"]) {
        assert.ok(protect.starts.includes(getPositionForSide(state, side)), `${side} can defend from ${getPositionForSide(state, side)}`);
        assert.deepEqual(resolveArenaOutcome(state, protect, side), state);
      }
    }
  }
});

test("counter-specific defenses cannot teleport either grappler when the opponent only protects", () => {
  for (const actorSide of ["fighter", "opponent"]) {
    for (const id of ["guillotine-defense", "haymaker-defense", "standing-headlock-defense"]) {
      const before = createArenaState("standing", actorSide);
      assert.equal(isArenaCounterApplicable(move(id), before, move("protect-position"), actorSide), false);
      assert.deepEqual(resolveArenaOutcome(before, move(id), actorSide, { opposingMove: move("protect-position") }), before);
      assert.deepEqual(resolveArenaOutcome(before, move(id), actorSide), before);
    }
  }
});

test("a real opposing guillotine allows the defender to earn side control for either side", () => {
  for (const actorSide of ["fighter", "opponent"]) {
    for (const position of ["standing", "clinch"]) {
      const before = createArenaState(position, actorSide);
      const counter = move("guillotine-defense");
      const threat = move("guillotine-choke");
      assert.equal(isArenaCounterApplicable(counter, before, threat, actorSide), true);
      const after = resolveArenaOutcome(before, counter, actorSide, { opposingMove: threat });
      assert.equal(after.topSide, actorSide);
      assert.equal(getPositionForSide(after, actorSide), "side-top");
    }
  }
});

test("punch defense reacts to a legal punch, not a kick, takedown, or ground-only attack", () => {
  const counter = move("haymaker-defense");
  for (const actorSide of ["fighter", "opponent"]) {
    const before = createArenaState("standing");
    assert.equal(isArenaCounterApplicable(counter, before, move("basic-punch"), actorSide), true);
    const rearClinch = resolveArenaOutcome(before, counter, actorSide, { opposingMove: move("basic-punch") });
    assert.equal(getPositionForSide(rearClinch, actorSide), "rear-clinch");
    assert.equal(rearClinch.controlSide, actorSide);
    for (const id of ["basic-kick", "double-leg-takedown", "triangle-choke"]) {
      assert.equal(isArenaCounterApplicable(counter, before, move(id), actorSide), false);
    }
    assert.equal(isArenaCounterApplicable(move("guillotine-defense"), before, { ...move("guillotine-choke"), starts: ["guard-bottom"] }, actorSide), false);
  }
});

test("an existing headlock is sufficient context, while another headlock defense is not an attack", () => {
  const counter = move("standing-headlock-defense");
  for (const actorSide of ["fighter", "opponent"]) {
    const trapped = createArenaState("standing-headlock", actorSide);
    assert.equal(isArenaCounterApplicable(counter, trapped, move("protect-position"), actorSide), true);
    assert.equal(getPositionForSide(resolveArenaOutcome(trapped, counter, actorSide, { opposingMove: move("protect-position") }), actorSide), "mount-top");
    assert.equal(isArenaCounterApplicable(counter, "standing", counter, actorSide), false);
    assert.equal(isArenaCounterApplicable(counter, "standing", { category: "control", endsIn: "standing-headlock-top", starts: ["standing"] }, actorSide), true);
  }
});

test("normalization supports every legacy curriculum position without confusing opposite sides", () => {
  for (const position of positions) {
    const state = normalizeArenaState(position);
    assert.equal(state.position, position);
    assert.ok(getArenaSnapshot(state).key);
    assert.ok(getArenaPositionLabel(state));
    const opponentPosition = getPositionForSide(state, "opponent");
    assert.equal(getPositionForSide(createArenaState(opponentPosition), "opponent"), position);
  }
});

test("all curriculum move outcomes resolve without undefined snapshots or mutating inputs", () => {
  for (const technique of allMoves) {
    for (const actorSide of ["fighter", "opponent"]) {
      const initial = Object.freeze(createArenaState(technique.starts[0], actorSide));
      const result = resolveArenaOutcome(initial, technique, actorSide);
      const snapshot = getArenaSnapshot(result);
      assert.ok(snapshot.key, `${technique.id} has a settled snapshot`);
      assert.ok(snapshot.src.endsWith(".png"));
      if (technique.category === "takedown" || technique.category === "sweep") {
        assert.equal(result.topSide ?? result.controlSide, actorSide, `${technique.id} preserves winner identity`);
      }
    }
  }
});
