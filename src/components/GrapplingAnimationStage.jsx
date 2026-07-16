import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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

function paletteSignature(fighter) {
  return [
    fighter?.name,
    fighter?.skinTone,
    fighter?.hairColor,
    fighter?.giTop,
    fighter?.giPants,
    fighter?.aura,
    fighter?.emblem,
    fighter?.belt,
    fighter?.stripes,
    fighter?.stance,
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
      playMove: (keyOrMove = resolvedAnimation.key, options = {}) =>
        managerRef.current?.playMove(keyOrMove, { move, ...options }),
      resetToNeutral: () => managerRef.current?.resetToNeutral(),
      loadAnimationAssets: (keys) => managerRef.current?.loadAnimationAssets(keys),
      isLocked: () => locked,
    }),
    [locked, move, resolvedAnimation.key],
  );

  return (
    <div
      className={`grappling-animation-stage ${compact ? "compact" : ""}`}
      data-animation-key={status.moveKey}
      data-motion-phase={status.phase?.toLowerCase().replaceAll(" ", "-")}
    >
      <div className="animation-canvas" ref={containerRef} role="img" aria-label={`${status.label} cinematic animation`} />
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
    </div>
  );
});

export default GrapplingAnimationStage;
