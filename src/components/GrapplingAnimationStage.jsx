import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { beltColors } from "../data/curriculum";
import {
  bjjAnimationCatalog,
  getBjjAnimationForMove,
  normalizeBjjAnimationKey,
} from "../animation/bjjAnimationMap";

const fallbackOpponent = {
  name: "Training Rival",
  skinTone: "#d8a37a",
  hairColor: "#d9b156",
  giTop: "#1b3f7a",
  giPants: "#1b3f7a",
  aura: "red surge",
  emblem: "lion",
  belt: "white",
  stripes: 2,
  stance: "judo base",
};

const ceremonyAuraColors = {
  "void violet": "#8a5cff",
  "mat gold": "#f7c852",
  "blue flame": "#4aa3ff",
  "red surge": "#ff4f55",
  "emerald focus": "#3ee0a0",
};

const decisionProfileArt = {
  bald: ["/assets/characters/profile-realistic-v2-bald.webp", "v2/profile-bald"],
  "crew cut": ["/assets/characters/profile-realistic-v2-crew-cut.webp", "v2/profile-crew-cut"],
  mohawk: ["/assets/characters/profile-realistic-v2-mohawk.webp", "v2/profile-mohawk"],
  "long hair": ["/assets/characters/profile-realistic-v2-long-hair.webp", "v2/profile-long-hair"],
  "slicked back": ["/assets/characters/profile-realistic-v2-slicked-back.webp", "v2/profile-slicked-back"],
};

function ceremonyStyle(fighter) {
  const belt = fighter?.belt ?? "white";
  return {
    "--decision-skin": fighter?.skinTone ?? "#d99b71",
    "--decision-hair": fighter?.hairColor ?? "#11131c",
    "--decision-gi-top": fighter?.giTop ?? "#f8fbff",
    "--decision-gi-pants": fighter?.giPants ?? "#f8fbff",
    "--decision-belt": beltColors[belt] ?? beltColors.white,
    "--decision-belt-stripe": belt === "white" ? "#182030" : "#f8fbff",
    "--decision-aura": ceremonyAuraColors[fighter?.aura] ?? ceremonyAuraColors["void violet"],
  };
}

function DecisionIdentityPortrait({ fighter }) {
  const [source, mask] = decisionProfileArt[String(fighter?.hairStyle ?? "").trim().toLowerCase()]
    ?? ["/assets/characters/profile-realistic-v2.webp", "v2/profile"];
  const maskBase = `/assets/characters/masks/${mask}`;
  const style = {
    ...ceremonyStyle(fighter),
    "--decision-profile-src": `url("${source}")`,
    "--decision-profile-skin": `url("${maskBase}-skin.png")`,
    "--decision-profile-hair": `url("${maskBase}-hair.png")`,
    "--decision-profile-jacket": `url("${maskBase}-jacket.png")`,
  };
  return (
    <span className="decision-identity-portrait" style={style}>
      <i className="decision-portrait-base" />
      <i className="decision-portrait-skin" />
      <i className="decision-portrait-hair" />
      <i className="decision-portrait-jacket" />
    </span>
  );
}

function winnerSideFor(value, fighter, opponent) {
  if (value === opponent) return "opponent";
  if (value === fighter) return "fighter";

  const token = String(value ?? "fighter").trim().toLowerCase();
  const opponentTokens = ["opponent", "defender", "rival", opponent?.id, opponent?.name]
    .filter(Boolean)
    .map((item) => String(item).trim().toLowerCase());
  return opponentTokens.includes(token) ? "opponent" : "fighter";
}

function normalizeDecision(request, fighter, opponent, fallbackTechnique) {
  if (!request) return null;
  const config = typeof request === "object" ? request : {};
  if (config.active === false) return null;

  const requestedWinner = typeof request === "string"
    ? request
    : config.winner ?? config.winnerSide ?? "fighter";
  const winnerSide = winnerSideFor(requestedWinner, fighter, opponent);
  const winner = winnerSide === "opponent" ? opponent : fighter;
  const loser = winnerSide === "opponent" ? fighter : opponent;

  return {
    headline: config.headline ?? "Official decision",
    technique: config.technique ?? config.method ?? config.moveName ?? fallbackTechnique ?? "Judges' decision",
    methodLabel: config.methodLabel ?? "Winner by",
    winner,
    winnerSide,
    loser,
  };
}

function BeltStripes({ count = 0 }) {
  return Array.from({ length: Math.min(4, Math.max(0, Number(count) || 0)) }).map((_, index) => (
    <rect
      className="decision-belt-stripe"
      key={index}
      x={116 + index * 7}
      y="264"
      width="4"
      height="18"
      rx="1"
    />
  ));
}

function DecisionHair({ fighter }) {
  const style = String(fighter?.hairStyle ?? "shadow spikes").trim().toLowerCase();
  if (style === "bald") return <path className="decision-scalp-highlight" d="M58 62 Q90 35 123 63" />;
  if (["crew cut", "short fade"].includes(style)) {
    return <path className="decision-hair decision-hair-crew" d="M52 85 Q50 47 90 42 Q131 47 129 86 Q112 65 91 65 Q69 65 52 85 Z" />;
  }
  if (style === "mohawk") {
    return <path className="decision-hair decision-hair-mohawk" d="M71 59 L78 33 L85 47 L91 20 L98 47 L105 31 L112 61 Q91 50 71 59 Z" />;
  }
  if (["long hair", "storm tail", "braided top"].includes(style)) {
    return (
      <>
        <path className="decision-hair decision-hair-long-back" d="M50 77 Q43 35 89 30 Q140 35 132 92 L139 153 Q118 139 108 109 L72 109 Q60 140 42 154 Z" />
        <path className="decision-hair decision-hair-long" d="M49 91 Q45 35 90 31 Q137 35 132 94 L115 66 L104 82 L91 61 L77 83 L63 64 Z" />
      </>
    );
  }
  if (["slicked back", "wave cut"].includes(style)) {
    return <path className="decision-hair decision-hair-slick" d="M51 88 Q48 49 78 39 Q111 26 132 58 L128 91 Q114 63 93 61 Q70 62 51 88 Z" />;
  }
  return <path className="decision-hair" d="M50 91 Q46 37 90 34 Q136 37 131 93 L117 70 L106 82 L94 65 L78 82 L66 68 Z" />;
}

function DecisionFighterFigure({ fighter, role, x }) {
  const isWinner = role === "winner";
  return (
    <g
      className={`decision-figure decision-${role}`}
      transform={`translate(${x} 0)`}
      style={ceremonyStyle(fighter)}
    >
      {isWinner ? <ellipse className="decision-winner-aura" cx="90" cy="286" rx="114" ry="168" /> : null}
      <ellipse className="decision-figure-shadow" cx="90" cy="438" rx="79" ry="13" />

      <g className="decision-legs">
        <path className="decision-pants" d="M37 273 L87 273 L80 421 L33 421 Z" />
        <path className="decision-pants" d="M93 273 L143 273 L147 421 L100 421 Z" />
        <path className="decision-pants-detail" d="M61 282 L58 411 M119 282 L123 411" />
        <path className="decision-foot" d="M31 410 Q56 404 82 414 L84 432 L24 432 Q18 423 31 410 Z" />
        <path className="decision-foot" d="M99 414 Q126 404 150 414 L157 432 L97 432 Z" />
      </g>

      {isWinner ? (
        <>
          <path className="decision-sleeve" d="M45 151 Q16 205 22 261" />
          <path className="decision-skin-limb" d="M22 248 Q20 285 25 318" />
          <circle className="decision-hand" cx="25" cy="322" r="13" />
        </>
      ) : (
        <>
          <path className="decision-sleeve" d="M136 151 Q163 204 158 260" />
          <path className="decision-skin-limb" d="M158 247 Q160 286 151 318" />
          <circle className="decision-hand" cx="150" cy="322" r="13" />
        </>
      )}

      <path className="decision-torso" d="M44 137 Q90 116 136 137 L151 280 Q91 302 29 280 Z" />
      <path className="decision-fabric-texture" d="M44 137 Q90 116 136 137 L151 280 Q91 302 29 280 Z" />
      <path className="decision-gi-lapel" d="M62 132 L91 190 L119 132 M91 190 L91 260" />
      <path className="decision-gi-seam" d="M42 230 Q91 246 139 230" />
      <rect className="decision-belt" x="31" y="264" width="119" height="19" rx="6" />
      <path className="decision-belt-knot" d="M85 263 L97 263 L105 280 L91 292 L77 280 Z" />
      <BeltStripes count={fighter?.stripes} />

      <circle className="decision-ear" cx="52" cy="92" r="10" />
      <circle className="decision-ear" cx="128" cy="92" r="10" />
      <ellipse className="decision-head" cx="90" cy="90" rx="39" ry="46" />
      <DecisionHair fighter={fighter} />
      <path className="decision-face" d="M70 92 L81 90 M99 90 L110 92 M84 113 Q91 117 98 113" />

      {isWinner ? (
        <>
          <path className="decision-sleeve" d="M134 150 Q178 130 204 106" />
          <path className="decision-skin-limb" d="M202 106 Q224 77 250 57" />
          <circle className="decision-hand decision-raised-hand" cx="251" cy="56" r="14" />
        </>
      ) : (
        <>
          <path className="decision-sleeve" d="M45 151 Q10 204 -4 258" />
          <path className="decision-skin-limb" d="M-4 247 Q-20 287 -35 322" />
          <circle className="decision-hand decision-lowered-hand" cx="-35" cy="325" r="14" />
        </>
      )}
    </g>
  );
}

function DecisionReferee() {
  return (
    <g className="decision-referee" transform="translate(360 0)">
      <ellipse className="decision-figure-shadow" cx="90" cy="438" rx="76" ry="13" />
      <path className="decision-referee-pants" d="M38 270 L86 270 L80 421 L34 421 Z" />
      <path className="decision-referee-pants" d="M94 270 L142 270 L146 421 L100 421 Z" />
      <path className="decision-referee-shoe" d="M31 411 L82 411 L85 432 L24 432 Q20 421 31 411 Z" />
      <path className="decision-referee-shoe" d="M99 411 L149 411 L157 432 L97 432 Z" />

      <path className="decision-referee-sleeve" d="M46 151 Q19 113 -21 69" />
      <path className="decision-referee-arm" d="M-18 72 Q-25 64 -30 58" />
      <circle className="decision-referee-hand" cx="-30" cy="56" r="15" />

      <path className="decision-referee-torso" d="M44 136 Q90 116 136 136 L145 274 Q90 292 35 274 Z" />
      <path className="decision-referee-stripe" d="M58 130 L58 278 M78 123 L78 284 M100 123 L100 284 M122 130 L122 278" />
      <path className="decision-referee-collar" d="M68 126 L90 158 L112 126" />
      <circle className="decision-referee-badge" cx="116" cy="169" r="9" />

      <ellipse className="decision-referee-head" cx="90" cy="89" rx="37" ry="44" />
      <path className="decision-referee-hair" d="M54 86 Q50 42 89 39 Q130 42 127 86 L113 64 L96 72 L78 61 L65 76 Z" />
      <path className="decision-referee-face" d="M72 90 L81 89 M99 89 L108 90 M84 111 Q90 114 97 111" />

      <path className="decision-referee-sleeve" d="M134 151 Q171 204 190 255" />
      <path className="decision-referee-arm" d="M190 251 Q208 287 224 320" />
      <circle className="decision-referee-hand" cx="225" cy="325" r="15" />
      <circle className="decision-grip decision-grip-raised" cx="-30" cy="56" r="23" />
      <circle className="decision-grip decision-grip-lowered" cx="225" cy="325" r="23" />
    </g>
  );
}

function DecisionCeremony({ decision }) {
  const winnerName = decision.winner?.name || "Winner";
  const loserName = decision.loser?.name || "Opponent";
  return (
    <div
      className="decision-ceremony"
      aria-hidden="true"
    >
      <div className="decision-announcement">
        <small>{decision.headline}</small>
        <strong>{winnerName}</strong>
        <span>{decision.methodLabel} <b>{decision.technique}</b></span>
      </div>
      <div className="decision-ceremony-scene">
        <svg viewBox="0 0 900 470" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          <defs>
            <pattern id="decision-weave" width="7" height="7" patternUnits="userSpaceOnUse">
              <path d="M0 1 H7 M1 0 V7" stroke="rgba(255,255,255,0.3)" strokeWidth="0.65" />
              <path d="M0 6 H7 M6 0 V7" stroke="rgba(0,0,0,0.2)" strokeWidth="0.55" />
            </pattern>
          </defs>
          <DecisionFighterFigure fighter={decision.winner} role="winner" x={80} />
          <DecisionReferee />
          <DecisionFighterFigure fighter={decision.loser} role="loser" x={620} />
        </svg>
      </div>
      <div className="decision-corner decision-corner-winner">
        <DecisionIdentityPortrait fighter={decision.winner} />
        <span className="decision-corner-copy">
          <small>Winner</small>
          <span>{winnerName}</span>
        </span>
      </div>
      <div className="decision-corner decision-corner-loser">
        <span className="decision-corner-copy">
          <small>Opponent</small>
          <span>{loserName}</span>
        </span>
        <DecisionIdentityPortrait fighter={decision.loser} />
      </div>
    </div>
  );
}

function paletteSignature(fighter) {
  return [
    fighter?.name,
    fighter?.skinTone,
    fighter?.hairColor,
    fighter?.hairStyle,
    fighter?.giTop,
    fighter?.giPants,
    fighter?.aura,
    fighter?.emblem,
    fighter?.belt,
    fighter?.stripes,
    fighter?.stance,
    fighter?.gender,
  ].join("|");
}

const GrapplingAnimationStage = forwardRef(function GrapplingAnimationStage(
  {
    move,
    animationKey,
    fighter,
    opponent = fallbackOpponent,
    fighterBelt,
    opponentBelt,
    autoPlaySignal,
    decision,
    compact = false,
    title = "Paired Grappling Animation",
    onLockChange,
    onComplete,
  },
  ref,
) {
  const containerRef = useRef(null);
  const managerRef = useRef(null);
  const pendingAutoPlayRef = useRef(null);
  const [locked, setLocked] = useState(false);
  const [imperativeDecision, setImperativeDecision] = useState(null);
  const [status, setStatus] = useState(() => {
    const animation = move
      ? getBjjAnimationForMove(move)
      : bjjAnimationCatalog[normalizeBjjAnimationKey(animationKey)];
    return {
      moveKey: animation?.key ?? normalizeBjjAnimationKey(animationKey),
      label: animation?.label ?? "Standing Stance",
      controlState: animation?.controlState ?? "standing",
      assetPath: animation?.asset ?? bjjAnimationCatalog.standing_stance.asset,
      locked: false,
      phase: "Ready",
      progress: 0,
      motionSource: "Cinematic procedural pair",
    };
  });

  const visualFighter = useMemo(
    () => ({
      ...fighter,
      belt: fighterBelt?.belt ?? fighter?.belt ?? "white",
      stripes: fighterBelt?.stripes ?? fighter?.stripes ?? 0,
    }),
    [fighter, fighterBelt?.belt, fighterBelt?.stripes],
  );

  const visualOpponent = useMemo(
    () => ({
      ...opponent,
      belt: opponentBelt?.belt ?? opponent?.belt ?? "white",
      stripes: opponentBelt?.stripes ?? opponent?.stripes ?? 0,
    }),
    [opponent, opponentBelt?.belt, opponentBelt?.stripes],
  );

  const resolvedAnimation = useMemo(() => {
    if (animationKey) {
      const key = normalizeBjjAnimationKey(animationKey);
      return { key, ...bjjAnimationCatalog[key] };
    }
    return getBjjAnimationForMove(move);
  }, [animationKey, move]);

  const decisionAnimationRequested = String(animationKey ?? "").replaceAll("-", "_") === "decision";
  const decisionRequest = decision !== undefined
    ? decision
    : imperativeDecision ?? move?.decision ?? (decisionAnimationRequested ? true : null);
  const activeDecision = useMemo(
    () => normalizeDecision(
      decisionRequest,
      visualFighter,
      visualOpponent,
      move?.name ?? (decisionAnimationRequested ? "Judges' decision" : resolvedAnimation.label),
    ),
    [decisionAnimationRequested, decisionRequest, move?.name, resolvedAnimation.label, visualFighter, visualOpponent],
  );

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disposed = false;
    import("../animation/MoveAnimationManager").then(({ default: MoveAnimationManager }) => {
      if (disposed || !containerRef.current) return;
      const manager = new MoveAnimationManager(containerRef.current, {
        onLockChange: (isLocked) => {
          setLocked(isLocked);
          onLockChange?.(isLocked);
        },
        onStateChange: (nextStatus) => setStatus((current) => ({ ...current, ...nextStatus })),
        onComplete,
      });
      managerRef.current = manager;
      manager.setGrapplers(visualFighter, visualOpponent);
      manager.setPreviewMove(resolvedAnimation.key);
      manager.loadAnimationAssets(["standing_stance", resolvedAnimation.key]);
      if (pendingAutoPlayRef.current || autoPlaySignal) {
        pendingAutoPlayRef.current = null;
        manager.playMove(resolvedAnimation.key, { move });
      }
    });
    return () => {
      disposed = true;
      managerRef.current?.dispose();
      managerRef.current = null;
    };
  }, [onComplete, onLockChange]);

  useEffect(() => {
    managerRef.current?.setGrapplers(visualFighter, visualOpponent);
  }, [visualFighter, visualOpponent, paletteSignature(visualFighter), paletteSignature(visualOpponent)]);

  useEffect(() => {
    managerRef.current?.setPreviewMove(resolvedAnimation.key);
    managerRef.current?.loadAnimationAsset(resolvedAnimation.key);
  }, [resolvedAnimation.key]);

  useEffect(() => {
    if (!autoPlaySignal) return;
    pendingAutoPlayRef.current = autoPlaySignal;
    if (managerRef.current) {
      pendingAutoPlayRef.current = null;
      managerRef.current.playMove(resolvedAnimation.key, { move });
    }
  }, [autoPlaySignal, move, resolvedAnimation.key]);

  useImperativeHandle(
    ref,
    () => ({
      playMove: (keyOrMove = resolvedAnimation.key, options = {}) => {
        setImperativeDecision(null);
        if (options.decision) setImperativeDecision(options.decision);
        return managerRef.current?.playMove(keyOrMove, { move, ...options });
      },
      resetToNeutral: () => {
        setImperativeDecision(null);
        return managerRef.current?.resetToNeutral();
      },
      loadAnimationAssets: (keys) => managerRef.current?.loadAnimationAssets(keys),
      showDecision: (nextDecision = true) => setImperativeDecision(nextDecision),
      clearDecision: () => setImperativeDecision(null),
      isLocked: () => locked,
    }),
    [locked, move, resolvedAnimation.key],
  );

  return (
    <div
      className={`grappling-animation-stage ${compact ? "compact" : ""} ${activeDecision ? "decision-active" : ""}`}
      data-animation-key={status.moveKey}
      data-motion-phase={status.phase?.toLowerCase().replaceAll(" ", "-")}
      data-visual-state={activeDecision ? "decision" : "playback"}
    >
      <div
        className="animation-canvas"
        ref={containerRef}
        role="img"
        aria-hidden={Boolean(activeDecision)}
        aria-label={`${status.label} cinematic animation`}
      />
      {activeDecision ? (
        <DecisionCeremony decision={activeDecision} />
      ) : (
        <>
          <div className="animation-overlay">
            <div className="animation-title-card">
              <small>Cinematic pair choreography</small>
              <strong>{title}</strong>
              <em>{status.label}</em>
            </div>
            <div className={locked ? "animation-state locked" : "animation-state"}>
              <span className="animation-state-led" aria-hidden="true" />
              <strong>{locked ? status.phase || "Syncing grapplers" : "Replay ready"}</strong>
              <small>{locked ? "Input protected during the sequence" : "Choose a move to run the clip"}</small>
            </div>
          </div>
          <div className="animation-meta">
            <span>Control / {status.controlState}</span>
            <span>{status.motionSource || "Cinematic procedural pair"}</span>
          </div>
          <div className="animation-progress" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, status.progress ?? 0))}%` }} />
          </div>
        </>
      )}
    </div>
  );
});

export default GrapplingAnimationStage;
