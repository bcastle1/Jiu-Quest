import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  bjjAnimationCatalog,
  getBjjAnimationKeyForMove,
  normalizeBjjAnimationKey,
} from "./bjjAnimationMap";

const defaultFighter = {
  skinTone: "#d99b71",
  hairColor: "#11131c",
  giTop: "#f8fbff",
  giPants: "#f8fbff",
  aura: "void violet",
};

const defaultOpponent = {
  skinTone: "#d8a37a",
  hairColor: "#d9b156",
  giTop: "#1b3f7a",
  giPants: "#1b3f7a",
  aura: "red surge",
};

const auraColors = {
  "void violet": "#8a5cff",
  "mat gold": "#f7c852",
  "blue flame": "#4aa3ff",
  "red surge": "#ff4f55",
  "emerald focus": "#3ee0a0",
};

function safeColor(value, fallback) {
  try {
    return new THREE.Color(value || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function ease(value) {
  return THREE.MathUtils.smoothstep(Math.max(0, Math.min(1, value)), 0, 1);
}

function wave(progress, cycles = 1) {
  return Math.sin(progress * Math.PI * 2 * cycles);
}

function setTransform(target, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1 }) {
  target.position.set(x, y, z);
  target.rotation.set(rx, ry, rz);
  target.scale.setScalar(scale);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

export class MoveAnimationManager {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.assetCache = new Map();
    this.loader = new GLTFLoader();
    this.lastFrameTime = performance.now();
    this.elapsedTime = 0;
    this.playing = false;
    this.active = null;
    this.idleKey = "standing_stance";
    this.controlState = "standing";
    this.disposed = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#050814");

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, 2.45, 5.6);
    this.camera.lookAt(0, 0.95, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this._buildScene();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    this.resize();
    this._render();
  }

  _buildScene() {
    const key = new THREE.HemisphereLight("#dce8ff", "#261532", 2.2);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight("#8a5cff", 3.2);
    rim.position.set(-3, 4, 2);
    rim.castShadow = true;
    this.scene.add(rim);

    const warm = new THREE.DirectionalLight("#f7c852", 1.6);
    warm.position.set(3, 2.5, 3);
    this.scene.add(warm);

    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(5.4, 0.08, 3.2),
      new THREE.MeshStandardMaterial({
        color: "#183d58",
        roughness: 0.8,
        metalness: 0.05,
      }),
    );
    mat.position.y = -0.04;
    mat.receiveShadow = true;
    this.scene.add(mat);

    const grid = new THREE.GridHelper(5.2, 10, "#62c5ff", "#315470");
    grid.position.y = 0.012;
    grid.material.opacity = 0.22;
    grid.material.transparent = true;
    this.scene.add(grid);

    this.attacker = this._createGrappler(defaultFighter);
    this.defender = this._createGrappler(defaultOpponent);
    this.scene.add(this.attacker.root, this.defender.root);
    this.setGrapplers(defaultFighter, defaultOpponent);
    this.setPreviewMove("standing_stance");
  }

  _createMaterial(color, roughness = 0.74) {
    return new THREE.MeshStandardMaterial({
      color: safeColor(color, "#ffffff"),
      roughness,
      metalness: 0.03,
    });
  }

  _createGrappler(fighter) {
    const root = new THREE.Group();
    const parts = {};

    parts.body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.78, 0.28), this._createMaterial(fighter.giTop));
    parts.body.position.y = 1.12;
    parts.body.castShadow = true;
    root.add(parts.body);

    parts.belt = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.1, 0.32), this._createMaterial("#11131c"));
    parts.belt.position.y = 0.79;
    parts.belt.castShadow = true;
    root.add(parts.belt);

    parts.head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 16), this._createMaterial(fighter.skinTone, 0.58));
    parts.head.position.y = 1.68;
    parts.head.castShadow = true;
    root.add(parts.head);

    parts.hair = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 10), this._createMaterial(fighter.hairColor, 0.65));
    parts.hair.position.set(0, 1.79, -0.02);
    parts.hair.scale.set(1.05, 0.62, 0.9);
    parts.hair.castShadow = true;
    root.add(parts.hair);

    parts.leftArm = this._createLimb(fighter.giTop, fighter.skinTone, "arm");
    parts.leftArm.position.set(-0.38, 1.36, 0);
    root.add(parts.leftArm);

    parts.rightArm = this._createLimb(fighter.giTop, fighter.skinTone, "arm");
    parts.rightArm.position.set(0.38, 1.36, 0);
    root.add(parts.rightArm);

    parts.leftLeg = this._createLimb(fighter.giPants, fighter.skinTone, "leg");
    parts.leftLeg.position.set(-0.18, 0.74, 0);
    root.add(parts.leftLeg);

    parts.rightLeg = this._createLimb(fighter.giPants, fighter.skinTone, "leg");
    parts.rightLeg.position.set(0.18, 0.74, 0);
    root.add(parts.rightLeg);

    const aura = new THREE.Mesh(
      new THREE.RingGeometry(0.76, 0.84, 64),
      new THREE.MeshBasicMaterial({
        color: safeColor(auraColors[fighter.aura], "#8a5cff"),
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
      }),
    );
    aura.position.y = 0.92;
    aura.rotation.x = Math.PI / 2;
    root.add(aura);
    parts.aura = aura;

    return { root, parts };
  }

  _createLimb(clothColor, skinColor, type) {
    const root = new THREE.Group();
    const length = type === "leg" ? 0.72 : 0.56;
    const radius = type === "leg" ? 0.07 : 0.055;
    const limb = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, length, 6, 12),
      this._createMaterial(clothColor),
    );
    limb.position.y = -length / 2;
    limb.castShadow = true;
    root.add(limb);

    const end = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.2, 16, 10), this._createMaterial(skinColor, 0.58));
    end.position.y = -length - radius * 2.3;
    end.scale.set(type === "leg" ? 1.8 : 1.15, 0.8, type === "leg" ? 0.9 : 1.15);
    end.castShadow = true;
    root.add(end);
    root.userData.limb = limb;
    root.userData.end = end;
    return root;
  }

  setGrapplers(fighter = defaultFighter, opponent = defaultOpponent) {
    this._applyPalette(this.attacker, { ...defaultFighter, ...fighter });
    this._applyPalette(this.defender, { ...defaultOpponent, ...opponent });
  }

  _applyPalette(grappler, fighter) {
    const top = safeColor(fighter.giTop, "#f8fbff");
    const pants = safeColor(fighter.giPants, "#f8fbff");
    const skin = safeColor(fighter.skinTone, "#d99b71");
    const hair = safeColor(fighter.hairColor, "#11131c");
    const aura = safeColor(auraColors[fighter.aura], "#8a5cff");
    grappler.parts.body.material.color.copy(top);
    grappler.parts.leftArm.userData.limb.material.color.copy(top);
    grappler.parts.rightArm.userData.limb.material.color.copy(top);
    grappler.parts.leftLeg.userData.limb.material.color.copy(pants);
    grappler.parts.rightLeg.userData.limb.material.color.copy(pants);
    grappler.parts.head.material.color.copy(skin);
    grappler.parts.leftArm.userData.end.material.color.copy(skin);
    grappler.parts.rightArm.userData.end.material.color.copy(skin);
    grappler.parts.leftLeg.userData.end.material.color.copy(skin);
    grappler.parts.rightLeg.userData.end.material.color.copy(skin);
    grappler.parts.hair.material.color.copy(hair);
    grappler.parts.aura.material.color.copy(aura);
  }

  resize() {
    if (!this.container || !this.renderer) return;
    const width = Math.max(320, this.container.clientWidth || 640);
    const height = Math.max(220, this.container.clientHeight || 360);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async loadAnimationAssets(keys = Object.keys(bjjAnimationCatalog)) {
    return Promise.all(keys.map((key) => this.loadAnimationAsset(key)));
  }

  loadAnimationAsset(key) {
    const normalized = normalizeBjjAnimationKey(key);
    if (this.assetCache.has(normalized)) return this.assetCache.get(normalized);
    const config = bjjAnimationCatalog[normalized];
    const request = new Promise((resolve) => {
      this.loader.load(
        config.asset,
        (gltf) => resolve({ key: normalized, config, gltf, loaded: true }),
        undefined,
        () => resolve({ key: normalized, config, gltf: null, loaded: false }),
      );
    });
    this.assetCache.set(normalized, request);
    return request;
  }

  setPreviewMove(moveOrKey) {
    if (this.playing) return;
    const key = typeof moveOrKey === "string" ? normalizeBjjAnimationKey(moveOrKey) : getBjjAnimationKeyForMove(moveOrKey);
    this.idleKey = key;
    this.controlState = bjjAnimationCatalog[key]?.controlState ?? "standing";
    this._applyMovePose(key, 0.18, 0);
    this.options.onStateChange?.({
      locked: false,
      moveKey: key,
      label: bjjAnimationCatalog[key]?.label,
      controlState: this.controlState,
      assetPath: bjjAnimationCatalog[key]?.asset,
    });
  }

  async playMove(moveOrKey, options = {}) {
    if (this.playing) return false;
    const key = typeof moveOrKey === "string" ? normalizeBjjAnimationKey(moveOrKey) : getBjjAnimationKeyForMove(moveOrKey);
    const config = bjjAnimationCatalog[key] ?? bjjAnimationCatalog.standing_stance;
    this.playing = true;
    this.active = {
      key,
      config,
      elapsed: 0,
      duration: options.duration ?? config.duration,
      move: options.move,
      resolve: null,
    };
    this.options.onLockChange?.(true);
    this.options.onStateChange?.({ locked: true, moveKey: key, label: config.label, controlState: this.controlState, assetPath: config.asset });
    await this.loadAnimationAsset(key);

    return new Promise((resolve) => {
      if (!this.active || this.active.key !== key) {
        resolve(false);
        return;
      }
      this.active.resolve = resolve;
    });
  }

  playStandingStance() {
    return this.playMove("standing_stance");
  }

  playGripFighting() {
    return this.playMove("grip_fighting");
  }

  playDoubleLeg() {
    return this.playMove("double_leg");
  }

  playGuardPass() {
    return this.playMove("guard_pass");
  }

  playArmbar() {
    return this.playMove("armbar");
  }

  playTapOut() {
    return this.playMove("tap_out");
  }

  resetToNeutral() {
    return this.playMove("reset_neutral");
  }

  _render = () => {
    if (this.disposed) return;
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    this.elapsedTime += delta;
    if (this.playing && this.active) {
      this.active.elapsed += delta;
      const progress = Math.min(1, this.active.elapsed / this.active.duration);
      this._applyMovePose(this.active.key, progress, this.active.elapsed);
      if (progress >= 1) this._finishAnimation();
    } else {
      this._applyIdleMotion(this.idleKey, this.elapsedTime);
    }
    this.renderer.render(this.scene, this.camera);
    this.frameId = window.requestAnimationFrame(this._render);
  };

  _finishAnimation() {
    const active = this.active;
    if (!active) return;
    this._applyMovePose(active.key, 1, active.duration);
    this.playing = false;
    this.idleKey = active.key === "reset_neutral" ? "standing_stance" : active.key;
    this.controlState = active.config.controlState;
    this.active = null;
    this.options.onLockChange?.(false);
    const payload = {
      locked: false,
      moveKey: active.key,
      label: active.config.label,
      controlState: this.controlState,
      assetPath: active.config.asset,
    };
    this.options.onStateChange?.(payload);
    this.options.onComplete?.(payload);
    active.resolve?.(payload);
  }

  _applyIdleMotion(key, elapsed) {
    const bob = Math.sin(elapsed * 2.1) * 0.025;
    this._applyMovePose(key, 1, elapsed);
    this.attacker.root.position.y += bob;
    this.defender.root.position.y += bob * 0.8;
    this.attacker.parts.aura.rotation.z += 0.01;
    this.defender.parts.aura.rotation.z -= 0.008;
  }

  _stand(grappler, x, z, face = 1, crouch = 0) {
    setTransform(grappler.root, {
      x,
      y: -0.02 - crouch * 0.18,
      z,
      ry: face > 0 ? -0.28 : 0.28,
      rx: crouch * 0.15,
      scale: 1 - crouch * 0.08,
    });
    const { leftArm, rightArm, leftLeg, rightLeg } = grappler.parts;
    leftArm.rotation.set(0.35 + crouch * 0.35, 0, 0.3);
    rightArm.rotation.set(0.35 + crouch * 0.35, 0, -0.3);
    leftLeg.rotation.set(0.08, 0, 0.08 + crouch * 0.16);
    rightLeg.rotation.set(0.08, 0, -0.08 - crouch * 0.16);
  }

  _ground(grappler, x, z, angle = 0, face = 1, scale = 1) {
    setTransform(grappler.root, {
      x,
      y: 0.18,
      z,
      rx: Math.PI / 2,
      ry: 0,
      rz: angle,
      scale,
    });
    const { leftArm, rightArm, leftLeg, rightLeg } = grappler.parts;
    leftArm.rotation.set(0.35, 0.2, 0.45 * face);
    rightArm.rotation.set(0.4, -0.2, -0.45 * face);
    leftLeg.rotation.set(0.4, 0, 0.36 * face);
    rightLeg.rotation.set(0.4, 0, -0.36 * face);
  }

  _kneel(grappler, x, z, face = 1, lean = 0) {
    setTransform(grappler.root, {
      x,
      y: -0.28,
      z,
      rx: 0.1 + lean,
      ry: face > 0 ? -0.42 : 0.42,
      scale: 0.86,
    });
    const { leftArm, rightArm, leftLeg, rightLeg } = grappler.parts;
    leftArm.rotation.set(0.85, 0, 0.35);
    rightArm.rotation.set(0.85, 0, -0.35);
    leftLeg.rotation.set(0.55, 0, 0.28);
    rightLeg.rotation.set(0.55, 0, -0.28);
  }

  _applyMovePose(key, progress, elapsed = 0) {
    const p = ease(progress);
    const pulse = wave(progress, 2) * 0.04;
    this.attacker.parts.aura.visible = true;
    this.defender.parts.aura.visible = true;

    switch (key) {
      case "grip_fighting": {
        this._stand(this.attacker, THREE.MathUtils.lerp(-0.95, -0.42, p), 0.04, 1, 0.25 * p);
        this._stand(this.defender, THREE.MathUtils.lerp(0.95, 0.42, p), 0.02, -1, 0.2 * p);
        this.attacker.parts.rightArm.rotation.set(1.05 + pulse, 0, -0.7);
        this.defender.parts.leftArm.rotation.set(1.0 - pulse, 0, 0.7);
        break;
      }
      case "single_leg": {
        this._stand(this.attacker, THREE.MathUtils.lerp(-1.05, -0.1, p), 0.1, 1, 0.7 * p);
        this._stand(this.defender, THREE.MathUtils.lerp(0.85, 0.28, p), -0.05, -1, 0.15);
        this.attacker.root.rotation.z = -0.45 * p;
        this.defender.root.rotation.z = 0.55 * p;
        this.defender.parts.leftLeg.rotation.z = 0.85 * p;
        break;
      }
      case "double_leg": {
        this._stand(this.attacker, THREE.MathUtils.lerp(-1.08, 0.02, p), 0.08, 1, 0.85 * p);
        this._stand(this.defender, THREE.MathUtils.lerp(0.88, 0.38, p), -0.04, -1, 0.2);
        this.attacker.root.rotation.z = -0.6 * p;
        this.defender.root.rotation.z = 1.35 * p;
        this.defender.root.position.y -= 0.2 * p;
        break;
      }
      case "guard_pull": {
        this._ground(this.attacker, THREE.MathUtils.lerp(-0.82, -0.08, p), 0.18, -0.15, 1, 0.96);
        this._kneel(this.defender, THREE.MathUtils.lerp(0.72, 0.34, p), -0.08, -1, 0.15 * p);
        this.attacker.parts.leftLeg.rotation.z = 0.95;
        this.attacker.parts.rightLeg.rotation.z = -0.95;
        break;
      }
      case "closed_guard": {
        this._ground(this.attacker, -0.05, 0.18, -0.05 + pulse, 1, 0.98);
        this._kneel(this.defender, 0.18, -0.02, -1, 0.28);
        this.attacker.parts.leftLeg.rotation.z = 1.12;
        this.attacker.parts.rightLeg.rotation.z = -1.12;
        this.defender.root.position.y -= 0.08;
        break;
      }
      case "guard_pass": {
        this._kneel(this.attacker, THREE.MathUtils.lerp(-0.2, -0.54, p), -0.06, 1, 0.35);
        this._ground(this.defender, THREE.MathUtils.lerp(0.12, 0.36, p), 0.18, 0.28 * p, -1, 0.95);
        this.attacker.root.rotation.z = -0.42 * p;
        break;
      }
      case "side_control": {
        this._ground(this.defender, 0.16, 0.12, 0, -1, 0.96);
        this._ground(this.attacker, -0.05, -0.05, Math.PI / 2 + pulse, 1, 0.92);
        this.attacker.root.position.y += 0.22;
        break;
      }
      case "mount": {
        this._ground(this.defender, 0.05, 0.1, 0, -1, 0.96);
        this._kneel(this.attacker, 0.02, -0.08, 1, 0.22);
        this.attacker.root.position.y += 0.05;
        this.attacker.parts.leftArm.rotation.x = 1.15;
        this.attacker.parts.rightArm.rotation.x = 1.15;
        break;
      }
      case "back_control": {
        this._kneel(this.defender, 0.18, 0.04, -1, 0.08);
        this._kneel(this.attacker, -0.18, 0.08, 1, 0.12);
        this.attacker.root.rotation.y = -0.02;
        this.defender.root.rotation.y = -0.02;
        this.attacker.parts.rightArm.rotation.set(1.25, 0, -0.95);
        this.attacker.parts.leftArm.rotation.set(1.2, 0, 0.65);
        break;
      }
      case "armbar": {
        this._ground(this.defender, 0.18, 0.06, 0, -1, 0.95);
        this._ground(this.attacker, -0.12, -0.08, Math.PI / 2, 1, 0.92);
        this.attacker.root.position.y += 0.08;
        this.defender.parts.rightArm.rotation.set(1.25, 0, -1.05);
        break;
      }
      case "triangle_choke": {
        this._ground(this.attacker, -0.08, 0.16, -0.12, 1, 0.96);
        this._kneel(this.defender, 0.22, -0.04, -1, 0.45);
        this.attacker.parts.leftLeg.rotation.z = 1.35;
        this.attacker.parts.rightLeg.rotation.z = -1.28;
        this.defender.root.position.y -= 0.14 * p;
        break;
      }
      case "rear_naked_choke": {
        this._kneel(this.defender, 0.16, 0.02, -1, 0.08);
        this._kneel(this.attacker, -0.13, 0.08, 1, 0.08);
        this.attacker.root.rotation.y = -0.08;
        this.defender.root.rotation.y = -0.08;
        this.attacker.parts.rightArm.rotation.set(1.35, 0, -1.25);
        this.attacker.parts.leftArm.rotation.set(1.25, 0, 0.95);
        this.defender.parts.rightArm.rotation.set(0.85 + 0.25 * p, 0, -0.45);
        break;
      }
      case "tap_out": {
        this._kneel(this.attacker, -0.2, 0.06, 1, 0.05);
        this._kneel(this.defender, 0.18, 0.02, -1, 0.12);
        this.defender.parts.rightArm.rotation.set(1.25 + Math.abs(wave(progress, 4)) * 0.55, 0, -0.95);
        break;
      }
      case "reset_neutral":
      case "standing_stance":
      default: {
        this._stand(this.attacker, -0.82, 0.08, 1, 0.1 * Math.abs(wave(elapsed * 0.12 || progress, 1)));
        this._stand(this.defender, 0.82, 0.04, -1, 0.1 * Math.abs(wave(elapsed * 0.12 || progress, 1)));
        break;
      }
    }
  }

  dispose() {
    this.disposed = true;
    if (this.frameId) window.cancelAnimationFrame(this.frameId);
    this._resizeObserver?.disconnect();
    disposeObject(this.scene);
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}

export default MoveAnimationManager;
