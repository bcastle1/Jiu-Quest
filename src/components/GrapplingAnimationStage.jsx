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
};

function paletteSignature(fighter) {
  return [
    fighter?.skinTone,
    fighter?.hairColor,
    fighter?.giTop,
    fighter?.giPants,
    fighter?.aura,
  ].join("|");
}

const GrapplingAnimationStage = forwardRef(function GrapplingAnimationStage(
  {
    move,
    animationKey,
    fighter,
    opponent = fallbackOpponent,
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
    const animation = move ? getBjjAnimationForMove(move) : bjjAnimationCatalog[normalizeBjjAnimationKey(animationKey)];
    return {
      moveKey: animation?.key ?? normalizeBjjAnimationKey(animationKey),
      label: animation?.label ?? "Standing Stance",
      controlState: animation?.controlState ?? "standing",
      assetPath: animation?.asset ?? bjjAnimationCatalog.standing_stance.asset,
      locked: false,
    };
  });

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
      manager.setGrapplers(fighter, opponent);
      manager.setPreviewMove(resolvedAnimation.key);
      manager.loadAnimationAssets();
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
    managerRef.current?.setGrapplers(fighter, opponent);
  }, [fighter?.id, opponent?.id, paletteSignature(fighter), paletteSignature(opponent)]);

  useEffect(() => {
    managerRef.current?.setPreviewMove(resolvedAnimation.key);
  }, [resolvedAnimation.key]);

  useEffect(() => {
    if (!autoPlaySignal) return;
    pendingAutoPlayRef.current = autoPlaySignal;
    if (managerRef.current) {
      pendingAutoPlayRef.current = null;
      managerRef.current.playMove(resolvedAnimation.key, { move });
    }
  }, [autoPlaySignal, move, resolvedAnimation.key]);

  useImperativeHandle(ref, () => ({
    playMove: (keyOrMove = resolvedAnimation.key, options = {}) =>
      managerRef.current?.playMove(keyOrMove, { move, ...options }),
    resetToNeutral: () => managerRef.current?.resetToNeutral(),
    loadAnimationAssets: (keys) => managerRef.current?.loadAnimationAssets(keys),
    isLocked: () => locked,
  }), [locked, move, resolvedAnimation.key]);

  return (
    <div className={`grappling-animation-stage ${compact ? "compact" : ""}`} data-animation-key={status.moveKey}>
      <div className="animation-canvas" ref={containerRef} aria-label={`${status.label} animation`} />
      <div className="animation-overlay">
        <span>
          <strong>{title}</strong>
          <small>{status.label}</small>
        </span>
        <span className={locked ? "animation-state locked" : "animation-state"}>
          {locked ? "Syncing grapplers" : "Ready"}
        </span>
      </div>
      <div className="animation-meta">
        <span>Control: {status.controlState}</span>
        <span>{status.assetPath}</span>
      </div>
    </div>
  );
});

export default GrapplingAnimationStage;
