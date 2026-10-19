// Arena positions are always stored from the player's ("fighter") perspective.
// A technique's endsIn, however, is written from its performer's perspective.
// Keeping these separate prevents an NPC takedown from making the player top.
const SIDES = new Set(["fighter", "opponent"]);
const NEUTRAL = new Set(["standing", "kneeling", "clinch", "scramble"]);
const DOMINANT = new Set(["side", "mount", "back", "turtle", "headlock"]);

export function otherArenaSide(side) {
  return side === "fighter" ? "opponent" : side === "opponent" ? "fighter" : null;
}

function parsePosition(position) {
  if (typeof position !== "string") return null;
  const token = position.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replaceAll("_", "-");
  if (NEUTRAL.has(token)) return { family: token, role: null };
  const aliases = {
    guard: ["guard", "top"], "closed-guard": ["guard", "bottom"],
    "guard-top": ["guard", "top"], "guard-bottom": ["guard", "bottom"],
    "half-guard": ["half-guard", "top"], "half-guard-top": ["half-guard", "top"],
    "half-guard-bottom": ["half-guard", "bottom"],
    "side-control": ["side", "top"], "side-top": ["side", "top"],
    "side-control-top": ["side", "top"], "side-bottom": ["side", "bottom"],
    "side-control-bottom": ["side", "bottom"],
    mount: ["mount", "top"], "mount-top": ["mount", "top"], "mount-bottom": ["mount", "bottom"],
    back: ["back", "top"], "back-control": ["back", "top"], "back-defending": ["back", "bottom"],
    "back-top": ["back", "top"], "back-bottom": ["back", "bottom"],
    turtle: ["turtle", "bottom"], "turtle-top": ["turtle", "top"], "turtle-bottom": ["turtle", "bottom"],
    headlock: ["headlock", "bottom"], "headlock-top": ["headlock", "top"],
  };
  const match = Object.hasOwn(aliases, token) ? aliases[token] : null;
  return match ? { family: match[0], role: match[1] } : null;
}

function stateFromRoles(family, topSide, controlSide) {
  if (NEUTRAL.has(family)) return { position: family, topSide: null, controlSide: null };
  const leadSide = family === "back" ? controlSide : topSide;
  const role = leadSide === "opponent" ? "bottom" : "top";
  let position = `${family}-${role}`;
  if (family === "back") position = role === "top" ? "back-control" : "back-defending";
  if (family === "headlock") position = role === "top" ? "headlock-top" : "headlock";
  return {
    position,
    topSide: family === "back" ? null : leadSide,
    controlSide: DOMINANT.has(family) ? leadSide : null,
  };
}

/** Create a position using a technique actor's perspective; defaults to the player. */
export function createArenaState(position = "standing", actorSide = "fighter") {
  const parsed = parsePosition(position);
  if (!parsed || !SIDES.has(actorSide)) return stateFromRoles("standing", null, null);
  const leadSide = parsed.role === "bottom" ? otherArenaSide(actorSide) : actorSide;
  return stateFromRoles(parsed.family, leadSide, leadSide);
}

/** Accepts legacy position strings and existing combat objects without mutating either. */
export function normalizeArenaState(current = "standing") {
  const source = typeof current === "string" ? { position: current } : current ?? {};
  const parsed = parsePosition(source.position);
  if (!parsed) return createArenaState();
  const inferred = createArenaState(source.position);
  const topSide = SIDES.has(source.topSide) ? source.topSide : inferred.topSide;
  const controlSide = SIDES.has(source.controlSide) ? source.controlSide : topSide ?? inferred.controlSide;
  return stateFromRoles(parsed.family, topSide, controlSide);
}

/** The curriculum position to use when choosing/scoring moves for the given side. */
export function getPositionForSide(current, side = "fighter") {
  const state = normalizeArenaState(current);
  if (side !== "opponent") return state.position;
  const parsed = parsePosition(state.position);
  return stateFromRoles(parsed.family, otherArenaSide(state.topSide), otherArenaSide(state.controlSide)).position;
}

/** Counter techniques need their actual threat, not merely a compatible stance. */
export function isArenaCounterApplicable(move, current, opposingMove, actorSide = "fighter") {
  const counter = move?.id;
  if (!["haymaker-defense", "guillotine-defense", "standing-headlock-defense"].includes(counter)) return true;
  if (!SIDES.has(actorSide)) return false;
  // An established headlock is already a threat even if its holder now defends.
  if (counter === "standing-headlock-defense" && getPositionForSide(current, actorSide) === "headlock") return true;
  if (!opposingMove) return false;
  const opposingPosition = getPositionForSide(current, otherArenaSide(actorSide));
  if (Array.isArray(opposingMove.starts) && !opposingMove.starts.includes(opposingPosition)) return false;
  if (counter === "haymaker-defense") return opposingMove.id === "basic-punch" && opposingMove.category === "strike";
  if (counter === "guillotine-defense") return opposingMove.id === "guillotine-choke" && opposingMove.isSubmission === true;
  // The current curriculum has no headlock-entry attack. This explicit endpoint
  // supports a future entry without treating a headlock escape as an attack.
  return opposingMove.endsIn === "headlock-top" && ["control", "takedown", "submission"].includes(opposingMove.category);
}

/**
 * Resolve the successful technique only, never the selected/losing technique.
 * Failed attempts and unknown endpoints keep the last settled scene. Strikes do
 * not stand grounded fighters up. A submission does not itself reverse top/bottom
 * or advance a pin; a standing guillotine may explicitly transition into guard.
 */
export function resolveArenaOutcome(current, winnerMove, actorSide = "fighter", { successful = true, opposingMove = null } = {}) {
  const before = normalizeArenaState(current);
  if (!successful || !winnerMove || !SIDES.has(actorSide)) return before;
  if (!isArenaCounterApplicable(winnerMove, before, opposingMove, actorSide)) return before;
  const destination = parsePosition(winnerMove.endsIn);
  if (!destination || winnerMove.category === "strike") return before;
  const from = parsePosition(before.position);
  if (winnerMove.isSubmission || winnerMove.category === "submission") {
    if (!NEUTRAL.has(from.family)) return before;
    // A listed standing-to-ground finish can bring the actor underneath, but a
    // generic submission label must not silently grant top position.
    if (destination.family === "guard" && destination.role === "bottom") {
      return createArenaState(winnerMove.endsIn, actorSide);
    }
    return NEUTRAL.has(destination.family) ? createArenaState(winnerMove.endsIn, actorSide) : before;
  }
  if (winnerMove.category === "takedown" || winnerMove.category === "sweep") {
    if (NEUTRAL.has(destination.family)) return before;
    return stateFromRoles(destination.family, actorSide, actorSide);
  }
  // Guard recovery remains bottom; a trap-and-roll explicitly ends on top.
  // Passes, transitions, and controls use the same actor-relative endpoint rule.
  return createArenaState(winnerMove.endsIn, actorSide);
}

const FAMILY_LABELS = {
  standing: ["Standing", "Standing"],
  kneeling: ["Kneeling start", "Kneeling start"],
  clinch: ["Clinch", "Clinch"],
  scramble: ["Scramble", "Scramble"],
  guard: ["Top in guard", "Guard from bottom"],
  "half-guard": ["Top half guard", "Bottom half guard"],
  side: ["Top side control", "Under side control"],
  mount: ["Top mount", "Under mount"],
  back: ["Back control", "Defending back control"],
  turtle: ["Turtle control", "Defending from turtle"],
  headlock: ["Headlock control", "Defending headlock"],
};

export function getArenaPositionLabel(current, viewerSide = "fighter") {
  const parsed = parsePosition(getPositionForSide(current, viewerSide));
  return FAMILY_LABELS[parsed.family][parsed.role === "bottom" ? 1 : 0];
}

/** Asset lead is the physical top player, or the controller in a back-control scene. */
export function getArenaSnapshot(current) {
  const state = normalizeArenaState(current);
  const { family } = parsePosition(state.position);
  const keys = {
    standing: "standing", clinch: "standing", kneeling: "kneeling",
    scramble: "kneeling", guard: "guard", "half-guard": "half-guard",
    side: "side-control", mount: "mount", back: "back-control", turtle: "turtle", headlock: "side-control",
  };
  const key = keys[family];
  return {
    key,
    src: `/assets/arena/${key}.png`,
    topSide: state.topSide,
    controlSide: state.controlSide,
    leadSide: state.controlSide ?? state.topSide ?? "fighter",
    label: getArenaPositionLabel(state),
    // The library depicts settled positional outcomes, not each individual technique.
    representative: true,
  };
}
