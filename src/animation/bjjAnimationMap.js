export const bjjAnimationCatalog = {
  standing_stance: {
    label: "Standing Stance",
    asset: "/animations/bjj/standing_stance.glb",
    duration: 1.8,
    controlState: "standing",
  },
  grip_fighting: {
    label: "Grip Fighting",
    asset: "/animations/bjj/grip_fighting.glb",
    duration: 2.2,
    controlState: "clinch",
  },
  single_leg: {
    label: "Single-Leg Takedown",
    asset: "/animations/bjj/single_leg.glb",
    duration: 2.5,
    controlState: "guard-top",
  },
  double_leg: {
    label: "Double-Leg Takedown",
    asset: "/animations/bjj/double_leg.glb",
    duration: 2.5,
    controlState: "guard-top",
  },
  guard_pull: {
    label: "Guard Pull",
    asset: "/animations/bjj/guard_pull.glb",
    duration: 2.2,
    controlState: "guard-bottom",
  },
  closed_guard: {
    label: "Closed Guard",
    asset: "/animations/bjj/closed_guard.glb",
    duration: 2.2,
    controlState: "guard-bottom",
  },
  guard_pass: {
    label: "Guard Pass",
    asset: "/animations/bjj/guard_pass.glb",
    duration: 2.6,
    controlState: "side-top",
  },
  side_control: {
    label: "Side Control",
    asset: "/animations/bjj/side_control.glb",
    duration: 2.2,
    controlState: "side-top",
  },
  mount: {
    label: "Mount",
    asset: "/animations/bjj/mount.glb",
    duration: 2.2,
    controlState: "mount-top",
  },
  back_control: {
    label: "Back Control",
    asset: "/animations/bjj/back_control.glb",
    duration: 2.3,
    controlState: "back-control",
  },
  armbar: {
    label: "Armbar",
    asset: "/animations/bjj/armbar.glb",
    duration: 2.6,
    controlState: "armbar-finish",
  },
  triangle_choke: {
    label: "Triangle Choke",
    asset: "/animations/bjj/triangle_choke.glb",
    duration: 2.7,
    controlState: "triangle-finish",
  },
  rear_naked_choke: {
    label: "Rear Naked Choke",
    asset: "/animations/bjj/rear_naked_choke.glb",
    duration: 2.7,
    controlState: "back-control",
  },
  tap_out: {
    label: "Tap Out",
    asset: "/animations/bjj/tap_out.glb",
    duration: 1.6,
    controlState: "submission-finish",
  },
  reset_neutral: {
    label: "Reset to Neutral",
    asset: "/animations/bjj/reset_neutral.glb",
    duration: 1.5,
    controlState: "standing",
  },
};

export const BJJ_ANIMATION_KEYS = Object.keys(bjjAnimationCatalog);

const moveAnimationOverrides = {
  "basic-punch": "grip_fighting",
  "basic-kick": "standing_stance",
  "basic-tackle": "double_leg",
  "trap-roll-escape": "mount",
  "elbow-escape-mount": "closed_guard",
  "mount-positional-control": "mount",
  "take-the-back-mount": "back_control",
  "headlock-counters": "side_control",
  "americana-armlock": "armbar",
  "rear-naked-choke": "rear_naked_choke",
  "straight-armlock-mount": "armbar",
  "twisting-arm-control": "mount",
  "punch-block-series": "closed_guard",
  "triangle-choke": "triangle_choke",
  "straight-armlock-guard": "armbar",
  "kimura-guard": "armbar",
  "take-the-back-guard": "back_control",
  "elevator-sweep": "mount",
  "double-ankle-sweep": "closed_guard",
  "hook-sweep": "mount",
  "double-underhook-guard-pass": "guard_pass",
  "side-positional-control": "side_control",
  "shrimp-escape-side": "closed_guard",
  "headlock-escape-1": "side_control",
  "headlock-escape-2": "mount",
  "elbow-escape-side": "closed_guard",
  "establish-clinch": "grip_fighting",
  "haymaker-defense": "grip_fighting",
  "leg-hook-takedown": "single_leg",
  "body-fold-takedown": "double_leg",
  "double-leg-takedown": "double_leg",
  "pull-guard": "guard_pull",
  "rear-takedown": "back_control",
  "guillotine-choke": "guard_pull",
  "standing-armlock": "armbar",
  "standing-headlock-defense": "grip_fighting",
  "guillotine-defense": "guard_pass",
  "purple-omoplata": "armbar",
  "purple-darce": "side_control",
  "purple-x-guard-sweep": "closed_guard",
  "brown-pressure-pass": "guard_pass",
  "brown-knee-cut": "guard_pass",
  "brown-crucifix": "back_control",
  "black-berimbolo": "back_control",
  "black-leg-drag": "guard_pass",
  "black-bow-arrow": "rear_naked_choke",
};

export function normalizeBjjAnimationKey(key) {
  if (!key) return "standing_stance";
  const normalized = key.replaceAll("-", "_");
  return bjjAnimationCatalog[normalized] ? normalized : "standing_stance";
}

export function getBjjAnimationKeyForMove(move) {
  if (!move) return "standing_stance";
  if (moveAnimationOverrides[move.id]) return moveAnimationOverrides[move.id];

  const text = `${move.id} ${move.name} ${move.category} ${move.phase}`.toLowerCase();
  const positions = [...(move.starts ?? []), ...(move.good ?? []), move.endsIn ?? ""].join(" ").toLowerCase();

  if (text.includes("rear naked") || text.includes("bow and arrow")) return "rear_naked_choke";
  if (text.includes("triangle")) return "triangle_choke";
  if (text.includes("arm") || text.includes("kimura") || text.includes("omoplata")) return "armbar";
  if (text.includes("double leg") || text.includes("body fold") || text.includes("takedown")) return "double_leg";
  if (text.includes("single") || text.includes("leg hook")) return "single_leg";
  if (text.includes("pull guard")) return "guard_pull";
  if (text.includes("pass") || positions.includes("side-top")) return "guard_pass";
  if (positions.includes("back-control")) return "back_control";
  if (positions.includes("mount")) return "mount";
  if (positions.includes("guard")) return "closed_guard";
  if (positions.includes("headlock") || positions.includes("clinch")) return "grip_fighting";
  return "standing_stance";
}

export function getBjjAnimationForMove(move) {
  const key = getBjjAnimationKeyForMove(move);
  return { key, ...bjjAnimationCatalog[key] };
}
