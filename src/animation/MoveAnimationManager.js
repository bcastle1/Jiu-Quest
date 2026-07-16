import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  bjjAnimationCatalog,
  getBjjAnimationKeyForMove,
  normalizeBjjAnimationKey,
} from "./bjjAnimationMap";

const defaultFighter = {
  name: "JiuQuest Fighter",
  skinTone: "#d99b71",
  hairColor: "#11131c",
  giTop: "#f8fbff",
  giPants: "#f8fbff",
  aura: "void violet",
  emblem: "triangle",
  belt: "white",
  stripes: 0,
  stance: "wrestling stance",
};

const defaultOpponent = {
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

const auraColors = {
  "void violet": "#8a5cff",
  "mat gold": "#f7c852",
  "blue flame": "#4aa3ff",
  "red surge": "#ff4f55",
  "emerald focus": "#3ee0a0",
};

const beltColors = {
  white: "#f8fbff",
  blue: "#1646a1",
  purple: "#5f2a8d",
  brown: "#673a25",
  black: "#11131c",
};

const impactMoments = {
  standing_stance: 0.72,
  grip_fighting: 0.62,
  single_leg: 0.66,
  double_leg: 0.66,
  guard_pull: 0.58,
  closed_guard: 0.62,
  guard_pass: 0.7,
  side_control: 0.62,
  mount: 0.65,
  back_control: 0.65,
  armbar: 0.72,
  triangle_choke: 0.74,
  rear_naked_choke: 0.74,
  tap_out: 0.55,
  reset_neutral: 0.58,
};

const phaseLabels = {
  standing_stance: ["Read range", "Set base", "Ready"],
  grip_fighting: ["Close distance", "Fight for grips", "Control secured"],
  single_leg: ["Level change", "Capture the leg", "Finish to control"],
  double_leg: ["Level change", "Drive through", "Finish to control"],
  guard_pull: ["Establish grips", "Pull to guard", "Guard connected"],
  closed_guard: ["Close distance", "Lock the guard", "Control established"],
  guard_pass: ["Create the angle", "Clear the legs", "Pass secured"],
  side_control: ["Break posture", "Cross-face pressure", "Side control"],
  mount: ["Clear the knees", "Set the hooks", "Mount stabilized"],
  back_control: ["Win the angle", "Set the hooks", "Back control"],
  armbar: ["Isolate the arm", "Control the line", "Submission finish"],
  triangle_choke: ["Control posture", "Lock the triangle", "Submission finish"],
  rear_naked_choke: ["Secure the seatbelt", "Hide the hand", "Submission finish"],
  tap_out: ["Control position", "Signal the finish", "Tap acknowledged"],
  reset_neutral: ["Release control", "Recover base", "Neutral reset"],
};

const cameraProfiles = {
  standing_stance: { entry: [0, 2.45, 5.9], control: [0, 2.28, 5.25], finish: [0, 2.42, 5.7], focus: [0, 0.95, 0] },
  grip_fighting: { entry: [0, 2.25, 5.2], control: [-0.35, 2.02, 4.45], finish: [0.3, 2.18, 4.95], focus: [0, 1.08, 0] },
  single_leg: { entry: [-0.15, 2.25, 5.1], control: [-1.1, 1.82, 4.25], finish: [0.3, 2.18, 4.45], focus: [0, 0.72, 0] },
  double_leg: { entry: [-0.2, 2.28, 5.15], control: [-1.2, 1.78, 4.05], finish: [0.55, 2.05, 4.42], focus: [0, 0.72, 0] },
  guard_pull: { entry: [0, 2.18, 5.05], control: [0.95, 1.85, 4.35], finish: [0.2, 2.1, 4.5], focus: [0, 0.62, 0] },
  closed_guard: { entry: [0, 2.2, 4.9], control: [1.0, 1.85, 4.25], finish: [0.45, 2.05, 4.45], focus: [0, 0.55, 0] },
  guard_pass: { entry: [-0.75, 2.08, 4.85], control: [-1.2, 1.8, 4.05], finish: [0.6, 2.02, 4.36], focus: [0, 0.58, 0] },
  side_control: { entry: [0.85, 2.1, 4.65], control: [1.35, 1.74, 3.92], finish: [0.58, 1.95, 4.22], focus: [0, 0.52, 0] },
  mount: { entry: [0.45, 2.15, 4.72], control: [1.18, 1.86, 4.0], finish: [0.15, 2.08, 4.3], focus: [0, 0.55, 0] },
  back_control: { entry: [-0.72, 2.1, 4.75], control: [-1.25, 1.84, 4.02], finish: [-0.34, 2.02, 4.2], focus: [0, 0.72, 0] },
  armbar: { entry: [0.8, 2.08, 4.7], control: [1.35, 1.74, 3.88], finish: [0.52, 1.9, 4.1], focus: [0, 0.5, 0] },
  triangle_choke: { entry: [-0.75, 2.1, 4.72], control: [-1.28, 1.75, 3.92], finish: [-0.48, 1.95, 4.18], focus: [0, 0.52, 0] },
  rear_naked_choke: { entry: [-0.85, 2.15, 4.8], control: [-1.3, 1.83, 3.98], finish: [-0.45, 1.98, 4.2], focus: [0, 0.7, 0] },
  tap_out: { entry: [0, 2.12, 4.8], control: [0.8, 1.88, 4.15], finish: [0, 2.18, 4.6], focus: [0, 0.64, 0] },
  reset_neutral: { entry: [0.5, 2.2, 4.92], control: [0, 2.24, 5.15], finish: [0, 2.45, 5.9], focus: [0, 0.9, 0] },
};

const hairAppearanceProfiles = {
  bald: { visible: false },
  cropped: {
    position: [0, -0.035, 0.012],
    rotation: [0.02, 0, 0],
    scale: [1, 0.56, 0.98],
  },
  mohawk: {
    position: [0, 0.075, -0.005],
    rotation: [-0.08, 0, 0],
    scale: [0.42, 1.42, 0.72],
  },
  long: {
    position: [0, -0.1, -0.035],
    rotation: [0.08, 0, 0],
    scale: [1.12, 1.62, 1.08],
  },
  swept: {
    position: [0, -0.018, -0.06],
    rotation: [-0.22, 0, 0],
    scale: [1.08, 0.76, 1.2],
  },
  default: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
};

function safeColor(value, fallback) {
  try {
    return new THREE.Color(value || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function ease(value) {
  return THREE.MathUtils.smoothstep(clamp(value), 0, 1);
}

function wave(progress, cycles = 1) {
  return Math.sin(progress * Math.PI * 2 * cycles);
}

function lerp(from, to, amount) {
  return THREE.MathUtils.lerp(from, to, amount);
}

function phaseForProgress(key, progress) {
  const labels = phaseLabels[key] || phaseLabels.standing_stance;
  if (progress < 0.3) return { index: 0, label: labels[0], progress: 16 };
  if (progress < 0.72) return { index: 1, label: labels[1], progress: 58 };
  return { index: 2, label: labels[2], progress: 92 };
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function copyVector(target, values) {
  target.set(values[0], values[1], values[2]);
}

function moveTowardsColor(target, color, darkness = 0) {
  target.copy(color);
  if (darkness) target.lerp(new THREE.Color("#050914"), darkness);
  return target;
}

function getHairAppearanceProfile(hairStyle) {
  const normalized = String(hairStyle || "shadow spikes").trim().toLowerCase();
  if (normalized === "bald") return hairAppearanceProfiles.bald;
  if (["crew cut", "short fade"].includes(normalized)) return hairAppearanceProfiles.cropped;
  if (normalized === "mohawk") return hairAppearanceProfiles.mohawk;
  if (["long hair", "storm tail", "braided top", "curly guard"].includes(normalized)) return hairAppearanceProfiles.long;
  if (["slicked back", "wave cut"].includes(normalized)) return hairAppearanceProfiles.swept;
  return hairAppearanceProfiles.default;
}

function applyHairAppearance(node, hairStyle) {
  if (!node) return;
  const normalized = String(hairStyle || "shadow spikes").trim().toLowerCase();
  const nodeName = String(node.name || "").toLowerCase();
  const authoredStyle = nodeName.includes("hairspikes")
    ? "spikes"
    : nodeName.includes("haircrew")
      ? "crew"
      : nodeName.includes("hairmohawk")
        ? "mohawk"
        : nodeName.includes("hairlong")
          ? "long"
          : nodeName.includes("hairslick")
            ? "slick"
            : null;
  const hairPart = nodeName.includes("haircrest")
    ? "crest"
    : nodeName.includes("hairtail")
      ? "tail"
      : nodeName.includes("haircap") || nodeName.includes("hairmesh")
        ? "cap"
        : "single";
  const baseKey = "jqHairBaseTransform";
  if (!node.userData[baseKey]) {
    node.userData[baseKey] = {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
      visible: node.visible,
    };
  }

  const base = node.userData[baseKey];
  const profile = getHairAppearanceProfile(hairStyle);
  node.position.copy(base.position);
  node.quaternion.copy(base.quaternion);
  node.scale.copy(base.scale);
  if (authoredStyle) {
    const requestedStyle = normalized === "bald"
      ? "bald"
      : normalized === "mohawk"
        ? "mohawk"
        : ["long hair", "storm tail", "braided top", "curly guard"].includes(normalized)
          ? "long"
          : ["slicked back", "wave cut"].includes(normalized)
            ? "slick"
            : ["crew cut", "short fade"].includes(normalized)
              ? "crew"
              : "spikes";
    node.visible = base.visible && requestedStyle === authoredStyle;
    return;
  }
  const modularVisible = hairPart === "single"
    || (hairPart === "crest" && normalized === "mohawk")
    || (hairPart === "tail" && ["long hair", "storm tail", "braided top", "curly guard"].includes(normalized))
    || (hairPart === "cap" && normalized !== "mohawk");
  node.visible = base.visible && profile.visible !== false && modularVisible;
  if (!node.visible) return;

  const useProfileTransform = hairPart === "single" || hairPart === "cap" || hairPart === "tail";
  const activeProfile = useProfileTransform ? profile : hairAppearanceProfiles.default;
  const position = activeProfile.position || hairAppearanceProfiles.default.position;
  const rotation = activeProfile.rotation || hairAppearanceProfiles.default.rotation;
  const scale = activeProfile.scale || hairAppearanceProfiles.default.scale;
  node.position.x += position[0];
  node.position.y += position[1];
  node.position.z += position[2];
  node.scale.set(
    base.scale.x * scale[0],
    base.scale.y * scale[1],
    base.scale.z * scale[2],
  );
  node.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])));
}

export class MoveAnimationManager {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.assetCache = new Map();
    this.disposedAssetScenes = new WeakSet();
    this.textureCache = new Map();
    this.failedEmblemAssets = new Set();
    this.loader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
    this.lastFrameTime = performance.now();
    this.elapsedTime = 0;
    this.playing = false;
    this.active = null;
    this.loadingMove = null;
    this.pendingPreviewKey = null;
    this.previewRequestId = 0;
    this.idleKey = "standing_stance";
    this.controlState = "standing";
    this.performerSide = "fighter";
    this.currentMotionSource = "Loading realistic fighter rig";
    this.mocap = null;
    this.mocapAuras = [];
    this.mocapWorldPosition = new THREE.Vector3();
    this.disposed = false;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    this.impactEnergy = 0;
    this.cameraFocus = new THREE.Vector3(0, 0.95, 0);
    this.cameraGoal = new THREE.Vector3(0, 2.45, 5.9);
    this.focusGoal = new THREE.Vector3(0, 0.95, 0);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#030712");
    this.scene.fog = new THREE.FogExp2("#030712", 0.07);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.copy(this.cameraGoal);
    this.camera.lookAt(this.cameraFocus);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth <= 700 ? 1.25 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor("#030712", 0);
    this.container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.26, 0.3, 0.96);
    this.composer.addPass(this.bloomPass);

    this._buildScene();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    this.resize();
    this._render();
  }

  _buildScene() {
    this._buildLighting();
    this._buildArena();
    this.attacker = this._createGrappler(defaultFighter);
    this.defender = this._createGrappler(defaultOpponent);
    this.scene.add(this.attacker.root, this.defender.root);
    this._buildMocapAuras();
    this.setGrapplers(defaultFighter, defaultOpponent);
    this.setPreviewMove("standing_stance");
  }

  _buildLighting() {
    const sky = new THREE.HemisphereLight("#dcecff", "#15111f", 1.45);
    this.scene.add(sky);

    const key = new THREE.DirectionalLight("#f2f7ff", 2.7);
    key.position.set(-3.4, 5.5, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -4;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight("#805cff", 1.45);
    rim.position.set(4.2, 3.5, -2.5);
    this.scene.add(rim);

    const warm = new THREE.SpotLight("#ffd77a", 5.6, 12, 0.52, 0.75, 1.35);
    warm.position.set(1.5, 5.1, 2.1);
    warm.target.position.set(0, 0.65, 0);
    warm.castShadow = true;
    warm.shadow.mapSize.set(1024, 1024);
    this.scene.add(warm, warm.target);

    const side = new THREE.SpotLight("#8cecff", 3.8, 10, 0.62, 0.86, 1.55);
    side.position.set(-4.8, 2.8, 1.8);
    side.target.position.set(0, 0.7, 0);
    this.scene.add(side, side.target);
    this.lightPulse = { warm, side, rim };
    this.shadowLights = [key, warm];
  }

  _buildArena() {
    const arena = new THREE.Group();
    this.scene.add(arena);
    this.arena = arena;
    this.arenaGlowMaterials = [];

    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 7),
      new THREE.MeshBasicMaterial({ color: "#071326", transparent: true, opacity: 0.78 }),
    );
    backdrop.position.set(0, 2.8, -2.75);
    arena.add(backdrop);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.3, 4.8, 96),
      new THREE.MeshBasicMaterial({
        color: "#3d2a7b",
        transparent: true,
        opacity: 0.11,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 0.005, -0.28);
    arena.add(halo);

    const mat = new THREE.Mesh(
      new THREE.CylinderGeometry(3.25, 3.42, 0.15, 96),
      new THREE.MeshPhysicalMaterial({
        color: "#102b46",
        roughness: 0.48,
        metalness: 0.2,
        clearcoat: 0.38,
        clearcoatRoughness: 0.28,
      }),
    );
    mat.position.y = -0.11;
    mat.receiveShadow = true;
    arena.add(mat);

    const matInset = new THREE.Mesh(
      new THREE.CircleGeometry(3.02, 96),
      new THREE.MeshStandardMaterial({
        color: "#123956",
        roughness: 0.58,
        metalness: 0.12,
      }),
    );
    matInset.rotation.x = -Math.PI / 2;
    matInset.position.y = -0.026;
    matInset.receiveShadow = true;
    arena.add(matInset);

    const centralMark = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.67, 64),
      new THREE.MeshBasicMaterial({
        color: "#f7c852",
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
      }),
    );
    centralMark.rotation.x = -Math.PI / 2;
    centralMark.position.y = -0.017;
    arena.add(centralMark);

    [1.35, 2.18, 2.83].forEach((radius, index) => {
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: index === 2 ? "#6cf3ff" : "#5477cc",
        transparent: true,
        opacity: index === 2 ? 0.42 : 0.24,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.024, 96), ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.013 + index * 0.001;
      arena.add(ring);
      this.arenaGlowMaterials.push(ringMaterial);
    });

    const matLines = new THREE.Group();
    const lineMaterial = new THREE.MeshBasicMaterial({ color: "#81d9ff", transparent: true, opacity: 0.22 });
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.006, 5.25), lineMaterial);
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(5.25, 0.006, 0.022), lineMaterial);
    vertical.position.y = -0.008;
    horizontal.position.y = -0.008;
    matLines.add(vertical, horizontal);
    arena.add(matLines);

    const rearDeck = new THREE.Mesh(
      new RoundedBoxGeometry(8.2, 0.42, 0.42, 4, 0.08),
      new THREE.MeshStandardMaterial({ color: "#07101e", roughness: 0.45, metalness: 0.38 }),
    );
    rearDeck.position.set(0, 0.18, -2.15);
    rearDeck.receiveShadow = true;
    arena.add(rearDeck);

    [-3.36, -1.68, 0, 1.68, 3.36].forEach((x, index) => {
      const pillar = new THREE.Mesh(
        new RoundedBoxGeometry(0.15, 2.85 - Math.abs(index - 2) * 0.22, 0.15, 4, 0.045),
        new THREE.MeshStandardMaterial({
          color: index % 2 ? "#102f55" : "#2b195d",
          roughness: 0.32,
          metalness: 0.58,
          emissive: index % 2 ? "#0b4d75" : "#261167",
          emissiveIntensity: 0.72,
        }),
      );
      pillar.position.set(x, 1.35, -2.26);
      arena.add(pillar);

      const stripMaterial = new THREE.MeshBasicMaterial({
        color: index % 2 ? "#3ce8ff" : "#a576ff",
        transparent: true,
        opacity: 0.72,
      });
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.9, 0.025), stripMaterial);
      strip.position.set(x, 1.32, -2.15);
      arena.add(strip);
      this.arenaGlowMaterials.push(stripMaterial);
    });

    [-1, 1].forEach((side) => {
      const rail = new THREE.Mesh(
        new THREE.TorusGeometry(3.22, 0.038, 8, 96, Math.PI * 0.52),
        new THREE.MeshBasicMaterial({ color: "#f7c852", transparent: true, opacity: 0.45 }),
      );
      rail.rotation.set(Math.PI / 2, 0, side > 0 ? 0.26 : Math.PI + 0.26);
      rail.position.y = 0.06;
      arena.add(rail);
    });

    const count = 140;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cyan = safeColor("#63e8ff", "#63e8ff");
    const violet = safeColor("#a576ff", "#a576ff");
    for (let index = 0; index < count; index += 1) {
      const radius = 2.6 + Math.random() * 3.2;
      const angle = Math.random() * Math.PI * 2;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = 0.2 + Math.random() * 3.7;
      positions[index * 3 + 2] = -1.7 + Math.sin(angle) * 1.8;
      const color = index % 2 ? cyan : violet;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        size: 0.026,
        transparent: true,
        opacity: 0.74,
        vertexColors: true,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    particles.position.z = -0.25;
    arena.add(particles);
    this.ambientParticles = particles;

    const impactMaterial = new THREE.MeshBasicMaterial({
      color: "#f7c852",
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.impactRing = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.25, 72), impactMaterial);
    this.impactRing.rotation.x = -Math.PI / 2;
    this.impactRing.position.set(0, 0.025, 0);
    this.impactRing.visible = false;
    arena.add(this.impactRing);

    this.impactNodes = Array.from({ length: 24 }, () => {
      const material = new THREE.MeshBasicMaterial({
        color: "#f7c852",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), material);
      node.visible = false;
      node.userData.velocity = new THREE.Vector3();
      arena.add(node);
      return node;
    });
  }

  _buildMocapAuras() {
    this.mocapAuras = [this._createMocapAura(), this._createMocapAura()];
  }

  _createMocapAura() {
    const group = new THREE.Group();
    const discMaterial = new THREE.MeshBasicMaterial({
      color: "#8a5cff",
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const lineMaterial = new THREE.MeshBasicMaterial({
      color: "#8a5cff",
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.6, 48), discMaterial);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.018;
    const line = new THREE.Mesh(new THREE.TorusGeometry(0.61, 0.012, 5, 48), lineMaterial);
    line.rotation.x = Math.PI / 2;
    line.position.y = 0.035;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.01, 5, 40, Math.PI * 1.15), lineMaterial);
    arc.rotation.set(Math.PI / 2, 0, 0.35);
    arc.position.y = 0.03;
    group.add(disc, line, arc);
    group.visible = false;
    this.scene.add(group);
    return { group, disc, line, arc, discMaterial, lineMaterial };
  }

  _createMaterial(color, options = {}) {
    return new THREE.MeshPhysicalMaterial({
      color: safeColor(color, "#ffffff"),
      roughness: options.roughness ?? 0.62,
      metalness: options.metalness ?? 0.04,
      clearcoat: options.clearcoat ?? 0.06,
      clearcoatRoughness: options.clearcoatRoughness ?? 0.56,
      sheen: options.sheen ?? 0,
      sheenRoughness: options.sheenRoughness ?? 0.78,
      sheenColor: safeColor(options.sheenColor, color || "#ffffff"),
    });
  }

  _createGrappler(fighter) {
    const root = new THREE.Group();
    root.name = fighter.name || "Grappler";
    root.rotation.order = "YXZ";

    const materials = {
      giTop: this._createMaterial(fighter.giTop, { roughness: 0.66, clearcoat: 0.025, sheen: 0.22 }),
      giLapel: this._createMaterial(fighter.giTop, { roughness: 0.7, sheen: 0.18 }),
      giPants: this._createMaterial(fighter.giPants, { roughness: 0.72, sheen: 0.16 }),
      skin: this._createMaterial(fighter.skinTone, { roughness: 0.5, clearcoat: 0.018, sheen: 0.08 }),
      hair: this._createMaterial(fighter.hairColor, { roughness: 0.78, metalness: 0.02 }),
      belt: this._createMaterial("#f8fbff", { roughness: 0.5, clearcoat: 0.1 }),
      beltStripe: this._createMaterial("#11131c", { roughness: 0.58 }),
      aura: new THREE.MeshBasicMaterial({
        color: safeColor(auraColors[fighter.aura], "#8a5cff"),
        transparent: true,
        opacity: 0.27,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      auraLine: new THREE.MeshBasicMaterial({
        color: safeColor(auraColors[fighter.aura], "#8a5cff"),
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      }),
      emblem: new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.94,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    };

    const parts = {};
    const hips = new THREE.Mesh(
      new RoundedBoxGeometry(0.5, 0.25, 0.3, 4, 0.045),
      materials.giPants,
    );
    hips.position.y = 0.84;
    hips.castShadow = true;
    root.add(hips);
    parts.hips = hips;

    const body = new THREE.Mesh(
      new RoundedBoxGeometry(0.66, 0.76, 0.36, 5, 0.065),
      materials.giTop,
    );
    body.position.y = 1.25;
    body.castShadow = true;
    root.add(body);
    parts.body = body;

    [-1, 1].forEach((side) => {
      const lapel = new THREE.Mesh(
        new RoundedBoxGeometry(0.1, 0.5, 0.042, 3, 0.012),
        materials.giLapel,
      );
      lapel.position.set(side * 0.13, 1.28, 0.204);
      lapel.rotation.z = side * 0.44;
      lapel.castShadow = true;
      root.add(lapel);
    });

    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.045, 7, 24), materials.belt);
    belt.position.y = 0.98;
    belt.rotation.x = Math.PI / 2;
    belt.castShadow = true;
    root.add(belt);
    parts.belt = belt;

    const beltKnot = new THREE.Mesh(
      new RoundedBoxGeometry(0.13, 0.085, 0.09, 3, 0.02),
      materials.belt,
    );
    beltKnot.position.set(0, 0.98, 0.22);
    beltKnot.castShadow = true;
    root.add(beltKnot);
    parts.beltKnot = beltKnot;

    parts.beltStripes = Array.from({ length: 4 }, (_, index) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.023, 0.055, 0.012), materials.beltStripe);
      stripe.position.set(0.08 + index * 0.028, 0.98, 0.266);
      stripe.visible = false;
      root.add(stripe);
      return stripe;
    });

    const headRig = new THREE.Group();
    headRig.position.y = 1.84;
    root.add(headRig);
    parts.headRig = headRig;

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.16, 12), materials.skin);
    neck.position.y = -0.14;
    neck.castShadow = true;
    headRig.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 18), materials.skin);
    head.scale.set(0.92, 1.08, 0.88);
    head.castShadow = true;
    headRig.add(head);
    parts.head = head;

    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.224, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), materials.hair);
    hairCap.name = "JQ_Procedural_HairCap";
    hairCap.position.set(0, 0.09, -0.015);
    hairCap.scale.set(0.97, 0.86, 0.93);
    hairCap.castShadow = true;
    const hairCrest = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.22, 6, 12), materials.hair);
    hairCrest.name = "JQ_Procedural_HairCrest";
    hairCrest.position.set(0, 0.27, -0.02);
    hairCrest.scale.set(0.72, 1, 1.35);
    hairCrest.castShadow = true;
    const hairTail = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.25, 6, 12), materials.hair);
    hairTail.name = "JQ_Procedural_HairTail";
    hairTail.position.set(0, -0.07, -0.19);
    hairTail.rotation.x = 0.12;
    hairTail.castShadow = true;
    headRig.add(hairCap, hairCrest, hairTail);
    parts.hair = [hairCap, hairCrest, hairTail];

    const face = new THREE.Group();
    face.position.z = 0.19;
    const eyeWhiteMaterial = new THREE.MeshPhysicalMaterial({ color: "#eef5f7", roughness: 0.42, clearcoat: 0.05 });
    const eyeMaterial = new THREE.MeshPhysicalMaterial({ color: "#07101c", roughness: 0.34, clearcoat: 0.18 });
    [-0.07, 0.07].forEach((x) => {
      const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), eyeWhiteMaterial);
      eyeWhite.scale.set(1.15, 0.7, 0.58);
      eyeWhite.position.set(x, 0.022, 0.006);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.01, 12, 8), eyeMaterial);
      pupil.position.set(x, 0.024, 0.019);
      face.add(eyeWhite, pupil);
    });
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), materials.skin);
    nose.position.set(0, -0.025, 0.035);
    nose.scale.set(0.72, 1, 1.12);
    face.add(nose);
    headRig.add(face);

    const emblem = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), materials.emblem);
    emblem.position.set(0, 1.3, 0.207);
    root.add(emblem);
    parts.emblem = emblem;

    parts.leftArm = this._createArm(-1, materials);
    parts.rightArm = this._createArm(1, materials);
    parts.leftLeg = this._createLeg(-1, materials);
    parts.rightLeg = this._createLeg(1, materials);
    root.add(parts.leftArm.shoulder, parts.rightArm.shoulder, parts.leftLeg.hip, parts.rightLeg.hip);

    const aura = new THREE.Group();
    const auraDisc = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.58, 72), materials.aura);
    auraDisc.rotation.x = -Math.PI / 2;
    auraDisc.position.y = 0.025;
    aura.add(auraDisc);
    const auraLine = new THREE.Mesh(new THREE.TorusGeometry(0.59, 0.014, 5, 56), materials.auraLine);
    auraLine.rotation.x = Math.PI / 2;
    auraLine.position.y = 0.04;
    aura.add(auraLine);
    const auraArc = new THREE.Mesh(new THREE.TorusGeometry(0.79, 0.012, 5, 48, Math.PI * 1.2), materials.auraLine);
    auraArc.rotation.set(Math.PI / 2, 0, 0.35);
    auraArc.position.y = 0.035;
    aura.add(auraArc);
    root.add(aura);
    parts.aura = aura;
    parts.auraDisc = auraDisc;
    parts.auraLine = auraLine;
    parts.auraArc = auraArc;

    return { root, parts, materials, fighter: { ...fighter } };
  }

  _createArm(side, materials) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.4, 1.48, 0);

    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.3, 5, 12), materials.giTop);
    sleeve.position.y = -0.2;
    sleeve.castShadow = true;
    shoulder.add(sleeve);

    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.016, 5, 16), materials.giLapel);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -0.41;
    shoulder.add(cuff);

    const elbow = new THREE.Group();
    elbow.position.y = -0.43;
    shoulder.add(elbow);

    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.245, 5, 14), materials.giTop);
    forearm.position.y = -0.16;
    forearm.castShadow = true;
    elbow.add(forearm);

    const wristCuff = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.012, 5, 18), materials.giLapel);
    wristCuff.rotation.x = Math.PI / 2;
    wristCuff.position.y = -0.32;
    elbow.add(wristCuff);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), materials.skin);
    hand.position.y = -0.39;
    hand.scale.set(0.86, 1.1, 0.72);
    hand.castShadow = true;
    elbow.add(hand);

    return { shoulder, elbow, sleeve, cuff, forearm, wristCuff, hand };
  }

  _createLeg(side, materials) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.19, 0.8, 0);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.35, 5, 12), materials.giPants);
    thigh.position.y = -0.23;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.49;
    hip.add(knee);

    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 5, 12), materials.giPants);
    shin.position.y = -0.23;
    shin.castShadow = true;
    knee.add(shin);

    const ankle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.09, 12), materials.skin);
    ankle.position.y = -0.44;
    ankle.castShadow = true;
    knee.add(ankle);

    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.108, 14, 10), materials.skin);
    foot.position.set(0, -0.49, 0.07);
    foot.scale.set(0.9, 0.55, 1.48);
    foot.castShadow = true;
    knee.add(foot);

    return { hip, knee, thigh, shin, ankle, foot };
  }

  setGrapplers(fighter = defaultFighter, opponent = defaultOpponent) {
    this._applyPalette(this.attacker, { ...defaultFighter, ...fighter });
    this._applyPalette(this.defender, { ...defaultOpponent, ...opponent });
    this._applyMocapPalette();
  }

  setPerformerSide(side = "fighter") {
    this.performerSide = side === "opponent" ? "opponent" : "fighter";
    if (this.mocap?.root) {
      this.mocap.root.scale.x = this.performerSide === "opponent"
        ? -Math.abs(this.mocap.root.scale.x || 1)
        : Math.abs(this.mocap.root.scale.x || 1);
    }
    this._applyMocapPalette();
  }

  _applyPalette(grappler, fighter) {
    if (!grappler) return;
    const top = safeColor(fighter.giTop, "#f8fbff");
    const pants = safeColor(fighter.giPants, "#f8fbff");
    const skin = safeColor(fighter.skinTone, "#d99b71");
    const hair = safeColor(fighter.hairColor, "#11131c");
    const aura = safeColor(auraColors[fighter.aura], "#8a5cff");
    const belt = safeColor(beltColors[fighter.belt] || beltColors.white, "#f8fbff");

    grappler.fighter = { ...grappler.fighter, ...fighter };
    grappler.root.name = fighter.name || "Grappler";
    grappler.materials.giTop.color.copy(top);
    moveTowardsColor(grappler.materials.giLapel.color, top, 0.32);
    grappler.materials.giPants.color.copy(pants);
    grappler.materials.skin.color.copy(skin);
    grappler.materials.hair.color.copy(hair);
    const hairParts = Array.isArray(grappler.parts.hair) ? grappler.parts.hair : [grappler.parts.hair];
    hairParts.forEach((part) => applyHairAppearance(part, fighter.hairStyle));
    grappler.materials.belt.color.copy(belt);
    grappler.materials.beltStripe.color.set(fighter.belt === "white" ? "#182030" : "#f8fbff");
    grappler.materials.aura.color.copy(aura);
    grappler.materials.auraLine.color.copy(aura);
    grappler.parts.beltStripes.forEach((stripe, index) => {
      stripe.visible = index < Math.min(4, Number(fighter.stripes) || 0);
    });
    this._setEmblem(grappler, fighter.emblem);
  }

  _setEmblem(grappler, emblem) {
    const patch = grappler.parts.emblem;
    const texture = this._getEmblemTexture(emblem);
    if (!texture) {
      patch.visible = false;
      return;
    }
    patch.material.map = texture;
    patch.material.needsUpdate = true;
    patch.visible = true;
  }

  _getEmblemTexture(emblem) {
    if (!emblem || emblem === "none") return null;
    const asset = "/assets/emblems/" + emblem + ".png";
    if (this.failedEmblemAssets.has(asset)) return null;
    let texture = this.textureCache.get(asset);
    if (!texture) {
      texture = this.textureLoader.load(
        asset,
        (loadedTexture) => {
          loadedTexture.colorSpace = THREE.SRGBColorSpace;
          loadedTexture.needsUpdate = true;
        },
        undefined,
        () => {
          this.failedEmblemAssets.add(asset);
          if (this.textureCache.get(asset) === texture) this.textureCache.delete(asset);
          texture?.dispose?.();
          this._refreshEmblems();
        },
      );
      this.textureCache.set(asset, texture);
    }
    return texture;
  }

  _refreshEmblems() {
    if (this.disposed) return;
    this._setEmblem(this.attacker, this.attacker?.fighter?.emblem);
    this._setEmblem(this.defender, this.defender?.fighter?.emblem);
    this._applyMocapPalette();
  }

  resize() {
    if (!this.container || !this.renderer) return;
    const width = Math.max(320, this.container.clientWidth || 640);
    const height = Math.max(220, this.container.clientHeight || 360);
    this.isCompactViewport = width <= 640;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.isCompactViewport ? 1.25 : 1.5));
    const shadowMapSize = this.isCompactViewport ? 512 : 1024;
    this.shadowLights?.forEach((light) => {
      if (light.shadow.mapSize.x !== shadowMapSize) light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    });
    if (this.bloomPass) this.bloomPass.enabled = !this.isCompactViewport;
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  _isUsablePairedAsset(asset) {
    const scene = asset?.gltf?.scene;
    if (!scene || !asset?.clips?.length) return false;
    const roles = ["Attacker", "Defender"];
    const cosmeticSlots = ["GiTop", "GiPants", "Skin", "Hair", "Belt", "BeltStripe", "Patch"];
    const materialNames = new Set();
    scene.traverse((node) => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material?.name && materialNames.add(material.name));
    });
    return roles.every((role) => (
      scene.getObjectByName("JQ_" + role)
      && cosmeticSlots.every((slot) => materialNames.has("JQ_" + role + "_" + slot))
    ));
  }

  _cloneMocapScene(scene) {
    const root = clone(scene);
    const materialCopies = new Map();
    const copyMaterial = (material) => {
      if (materialCopies.has(material)) return materialCopies.get(material);
      const copy = material.clone();
      materialCopies.set(material, copy);
      return copy;
    };
    root.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.material = Array.isArray(node.material)
        ? node.material.map(copyMaterial)
        : copyMaterial(node.material);
    });
    return root;
  }

  _activateMocap(asset, active) {
    if (!this._isUsablePairedAsset(asset) || !active) return false;
    this._deactivateMocap();

    const root = this._cloneMocapScene(asset.gltf.scene);
    const attacker = root.getObjectByName("JQ_Attacker");
    const defender = root.getObjectByName("JQ_Defender");
    if (!attacker || !defender) return false;
    root.scale.x = this.performerSide === "opponent" ? -Math.abs(root.scale.x || 1) : Math.abs(root.scale.x || 1);

    const mixer = new THREE.AnimationMixer(root);
    const actions = asset.clips.map((clip) => {
      const action = mixer.clipAction(clip);
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setDuration(Math.max(0.1, active.duration));
      action.play();
      return action;
    });

    this.scene.add(root);
    this.mocap = { root, mixer, actions, attacker, defender };
    this.attacker.root.visible = false;
    this.defender.root.visible = false;
    this._applyMocapPalette();
    this._syncMocapAuras(this.elapsedTime);
    return true;
  }

  _deactivateMocap() {
    const current = this.mocap;
    if (!current) return;
    current.mixer.stopAllAction();
    current.mixer.uncacheRoot(current.root);
    current.root.removeFromParent();
    current.root.traverse((node) => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material?.dispose?.());
    });
    this.mocap = null;
    this.mocapAuras?.forEach((aura) => {
      aura.group.visible = false;
    });
    this.attacker.root.visible = false;
    this.defender.root.visible = false;
  }

  _applyMocapPalette() {
    if (!this.mocap) return;
    const opponentPerforms = this.performerSide === "opponent";
    const performer = opponentPerforms
      ? this.defender.fighter || defaultOpponent
      : this.attacker.fighter || defaultFighter;
    const defender = opponentPerforms
      ? this.attacker.fighter || defaultFighter
      : this.defender.fighter || defaultOpponent;
    this._applyMocapFighterPalette("Attacker", performer, 0);
    this._applyMocapFighterPalette("Defender", defender, 1);
  }

  _applyMocapFighterPalette(role, fighter, auraIndex) {
    const prefix = "JQ_" + role + "_";
    const colors = {
      [prefix + "GiTop"]: safeColor(fighter.giTop, "#f8fbff"),
      [prefix + "GiPants"]: safeColor(fighter.giPants, "#f8fbff"),
      [prefix + "Skin"]: safeColor(fighter.skinTone, "#d99b71"),
      [prefix + "Hair"]: safeColor(fighter.hairColor, "#11131c"),
      [prefix + "Belt"]: safeColor(beltColors[fighter.belt] || beltColors.white, "#f8fbff"),
      [prefix + "BeltStripe"]: safeColor(fighter.belt === "white" ? "#182030" : "#f8fbff", "#f8fbff"),
    };
    const texture = this._getEmblemTexture(fighter.emblem);
    this.mocap.root.traverse((node) => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const isHairNode = node.name.startsWith(prefix)
        && node.name.toLowerCase().includes("hair")
        && materials.some((material) => material?.name === prefix + "Hair");
      materials.forEach((material) => {
        const color = colors[material.name];
        if (color && material.color) material.color.copy(color);
        if (material.name === prefix + "Patch") {
          material.map = texture;
          material.needsUpdate = true;
        }
      });
      if (isHairNode) applyHairAppearance(node, fighter.hairStyle);
      if (node.name.startsWith(prefix + "BeltStripe_")) {
        const stripe = Number(node.name.slice(node.name.lastIndexOf("_") + 1));
        node.visible = stripe <= Math.min(4, Number(fighter.stripes) || 0);
      }
      if (node.name === prefix + "ChestPatch") node.visible = Boolean(texture);
    });

    const aura = this.mocapAuras?.[auraIndex];
    if (!aura) return;
    const color = safeColor(auraColors[fighter.aura], "#8a5cff");
    aura.discMaterial.color.copy(color);
    aura.lineMaterial.color.copy(color);
  }

  _syncMocapAuras(elapsed = 0) {
    if (!this.mocap) return;
    this.mocap.root.updateMatrixWorld(true);
    [this.mocap.attacker, this.mocap.defender].forEach((actor, index) => {
      const aura = this.mocapAuras?.[index];
      if (!actor || !aura) return;
      actor.getWorldPosition(this.mocapWorldPosition);
      aura.group.visible = true;
      aura.group.position.set(this.mocapWorldPosition.x, 0.028, this.mocapWorldPosition.z);
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(elapsed * 2.2 + index) * 0.05 + this.impactEnergy * 0.12;
      aura.group.scale.setScalar(pulse);
      if (!this.reducedMotion) {
        aura.line.rotation.y += 0.014 * (index ? -1 : 1);
        aura.arc.rotation.z += 0.018 * (index ? -1 : 1);
      }
      aura.discMaterial.opacity = this.reducedMotion ? 0.14 : 0.14 + this.impactEnergy * 0.12;
      aura.lineMaterial.opacity = this.reducedMotion ? 0.42 : 0.42 + this.impactEnergy * 0.25;
    });
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
        (gltf) => {
          const clips = gltf?.animations?.filter((clip) => clip.tracks?.length) ?? [];
          const hasPairedMotion = Boolean(
            clips.length
            && gltf?.scene?.getObjectByName("JQ_Attacker")
            && gltf?.scene?.getObjectByName("JQ_Defender"),
          );
          resolve({ key: normalized, config, gltf, clips, loaded: true, hasPairedMotion });
        },
        undefined,
        () => {
          this.assetCache.delete(normalized);
          resolve({ key: normalized, config, gltf: null, clips: [], loaded: false, hasPairedMotion: false });
        },
      );
    });
    this.assetCache.set(normalized, request);
    return request;
  }

  _disposeCachedAnimationAsset(asset) {
    const scene = asset?.gltf?.scene;
    if (!scene || this.disposedAssetScenes.has(scene)) return;
    this.disposedAssetScenes.add(scene);
    disposeObject(scene);
  }

  _disposeCachedAnimationAssets() {
    const requests = [...this.assetCache.values()];
    this.assetCache.clear();
    requests.forEach((request) => {
      Promise.resolve(request).then((asset) => this._disposeCachedAnimationAsset(asset));
    });
  }

  setPreviewMove(moveOrKey) {
    const key = typeof moveOrKey === "string"
      ? normalizeBjjAnimationKey(moveOrKey)
      : getBjjAnimationKeyForMove(moveOrKey);
    if (this.playing || this.loadingMove) {
      this.pendingPreviewKey = key;
      return;
    }
    const requestId = ++this.previewRequestId;
    this._deactivateMocap();
    this.idleKey = key;
    const config = bjjAnimationCatalog[key] ?? bjjAnimationCatalog.standing_stance;
    this.controlState = config.controlState ?? "standing";
    this.currentMotionSource = "Loading realistic fighter rig";
    this.attacker.root.visible = false;
    this.defender.root.visible = false;
    this._emitState({
      locked: false,
      key,
      phase: "Loading realistic preview",
      progress: 92,
    });
    this.loadAnimationAsset(key).then((asset) => {
      if (this.disposed || this.playing || this.loadingMove || requestId !== this.previewRequestId) return;
      const activated = this._activateMocap(asset, { duration: config.duration });
      if (activated && this.mocap) {
        this.mocap.mixer.setTime(config.duration * 0.94);
        this.currentMotionSource = "Rigged realistic GLB preview";
        this._syncMocapAuras(this.elapsedTime);
      } else {
        this.attacker.root.visible = false;
        this.defender.root.visible = false;
        this.currentMotionSource = "Realistic fighter rig unavailable";
      }
      this._emitState({
        locked: false,
        key,
        phase: phaseForProgress(key, 0.94).label,
        progress: 100,
      });
    });
  }

  async playMove(moveOrKey, options = {}) {
    if (this.playing || this.loadingMove) return false;
    const key = typeof moveOrKey === "string"
      ? normalizeBjjAnimationKey(moveOrKey)
      : getBjjAnimationKeyForMove(moveOrKey);
    const config = bjjAnimationCatalog[key] ?? bjjAnimationCatalog.standing_stance;
    this.previewRequestId += 1;
    this.performerSide = options.performerSide === "opponent" ? "opponent" : "fighter";
    this.loadingMove = key;
    this._deactivateMocap();
    this.attacker.root.visible = false;
    this.defender.root.visible = false;
    this.playing = false;
    this.active = {
      key,
      config,
      elapsed: 0,
      duration: options.duration ?? config.duration,
      move: options.move,
      resolve: null,
      phaseIndex: -1,
      impactTriggered: false,
      asset: null,
      usingMocap: false,
    };
    this.options.onLockChange?.(true);
    this._emitState({ locked: true, key, phase: phaseForProgress(key, 0).label, progress: 4 });
    if (!this.reducedMotion) this._playMotionSfx(key);
    const asset = await this.loadAnimationAsset(key);

    if (this.disposed || !this.active || this.active.key !== key) {
      this.loadingMove = null;
      return false;
    }
    this.active.asset = asset;
    this.active.usingMocap = this._activateMocap(asset, this.active);
    if (!this.active.usingMocap) {
      this.attacker.root.visible = false;
      this.defender.root.visible = false;
    }
    this.currentMotionSource = this.active.usingMocap
      ? "Authored paired GLB"
      : "Realistic fighter rig unavailable";
    this._emitState({ locked: true, key, phase: phaseForProgress(key, 0).label, progress: 4 });

    return new Promise((resolve) => {
      if (!this.active || this.active.key !== key) {
        resolve(false);
        return;
      }
      this.active.resolve = resolve;
      this.loadingMove = null;
      this.playing = true;
      if (this.reducedMotion) {
        this.active.elapsed = this.active.duration;
        this.active.impactTriggered = true;
        if (this.active.usingMocap && this.mocap) {
          this.mocap.mixer.setTime(this.active.duration);
        } else {
          this._applyMovePose(key, 1, 0);
        }
      }
      this._emitState({ locked: true, key, phase: phaseForProgress(key, 0).label, progress: 4 });
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
      if (this.active.usingMocap && this.mocap) {
        this.mocap.mixer.update(delta);
        this._updateCamera(this.active.key, progress, this.active.elapsed);
        this._syncMocapAuras(this.active.elapsed);
      } else {
        this._applyMovePose(this.active.key, progress, this.active.elapsed);
      }
      this._updateActivePhase(progress);
      const impactAt = impactMoments[this.active.key] ?? 0.66;
      if (!this.active.impactTriggered && progress >= impactAt) {
        this.active.impactTriggered = true;
        this._triggerImpact(this.active.key);
      }
      if (progress >= 1) this._finishAnimation();
    } else if (this.mocap) {
      this._syncMocapAuras(this.elapsedTime);
    } else {
      if (this.reducedMotion) this._applyMovePose(this.idleKey, 0.96, 0);
      else this._applyIdleMotion(this.idleKey, this.elapsedTime);
    }

    this._updateEnvironment(delta);
    this.composer?.render();
    this.frameId = window.requestAnimationFrame(this._render);
  };

  _updateActivePhase(progress) {
    if (!this.active) return;
    const phase = phaseForProgress(this.active.key, progress);
    if (phase.index === this.active.phaseIndex) return;
    this.active.phaseIndex = phase.index;
    this._emitState({ locked: true, key: this.active.key, phase: phase.label, progress: phase.progress });
  }

  _finishAnimation() {
    const active = this.active;
    if (!active) return;
    if (!active.usingMocap) this._applyMovePose(active.key, 1, active.duration);
    this.playing = false;
    this.idleKey = active.key === "reset_neutral" ? "standing_stance" : active.key;
    this.controlState = active.config.controlState;
    this.active = null;
    this.options.onLockChange?.(false);
    const payload = this._statePayload({
      locked: false,
      key: active.key,
      phase: active.key === "reset_neutral" ? "Neutral reset" : "Replay ready",
      progress: 100,
    });
    this.options.onStateChange?.(payload);
    this.options.onComplete?.(payload);
    active.resolve?.(payload);
    const pendingKey = this.pendingPreviewKey;
    this.pendingPreviewKey = null;
    if (pendingKey && pendingKey !== this.idleKey) {
      this.setPreviewMove(pendingKey);
    }
  }

  _emitState({ locked, key, phase, progress }) {
    this.options.onStateChange?.(this._statePayload({ locked, key, phase, progress }));
  }

  _statePayload({ locked, key, phase, progress }) {
    const config = bjjAnimationCatalog[key] ?? bjjAnimationCatalog.standing_stance;
    return {
      locked,
      moveKey: key,
      label: config.label,
      controlState: config.controlState,
      assetPath: config.asset,
      phase,
      progress,
      motionSource: this.currentMotionSource || "Loading realistic fighter rig",
    };
  }

  _applyIdleMotion(key, elapsed) {
    const isGrounded = ["closed_guard", "guard_pass", "side_control", "mount", "back_control", "armbar", "triangle_choke", "rear_naked_choke"].includes(key);
    this._applyMovePose(key, 0.96, elapsed);
    if (!isGrounded) {
      const bob = Math.sin(elapsed * 2.1) * 0.018;
      this.attacker.root.position.y += bob;
      this.defender.root.position.y += bob * 0.78;
    }
  }

  _resetGrappler(grappler) {
    const { root, parts } = grappler;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
    parts.body.rotation.set(0, 0, 0);
    parts.headRig.rotation.set(0, 0, 0);
    [parts.leftArm, parts.rightArm].forEach((arm) => {
      arm.shoulder.rotation.set(0, 0, 0);
      arm.elbow.rotation.set(0, 0, 0);
    });
    [parts.leftLeg, parts.rightLeg].forEach((leg) => {
      leg.hip.rotation.set(0, 0, 0);
      leg.knee.rotation.set(0, 0, 0);
    });
    parts.aura.visible = true;
  }

  _setArm(arm, x, y, z, elbow = 0) {
    arm.shoulder.rotation.set(x, y, z);
    arm.elbow.rotation.set(elbow, 0, 0);
  }

  _setLeg(leg, x, y, z, knee = 0) {
    leg.hip.rotation.set(x, y, z);
    leg.knee.rotation.set(knee, 0, 0);
  }

  _stand(grappler, x, z, face = 1, crouch = 0, lean = 0, stride = 0) {
    const stance = grappler.fighter?.stance || "";
    const wrestling = stance.includes("wrestling");
    const wider = wrestling ? 0.13 : 0;
    grappler.root.position.set(x, -0.01 - crouch * 0.12, z);
    grappler.root.rotation.set(0, face > 0 ? Math.PI / 2 - 0.16 : -Math.PI / 2 + 0.16, lean * 0.28);
    grappler.root.scale.setScalar(1 - crouch * 0.06);
    grappler.parts.body.rotation.x = -crouch * 0.34;
    grappler.parts.headRig.rotation.x = crouch * 0.12;
    this._setArm(grappler.parts.leftArm, 0.64 + crouch * 0.48, 0.04, 0.34, 0.52);
    this._setArm(grappler.parts.rightArm, 0.64 + crouch * 0.48, -0.04, -0.34, 0.52);
    this._setLeg(grappler.parts.leftLeg, 0.08 + stride, 0, 0.1 + wider, 0.22 + crouch * 0.2);
    this._setLeg(grappler.parts.rightLeg, 0.08 - stride, 0, -0.1 - wider, 0.22 + crouch * 0.2);
  }

  _kneel(grappler, x, z, face = 1, lean = 0, angle = 0) {
    grappler.root.position.set(x, -0.27, z);
    grappler.root.rotation.set(0.05 + lean * 0.08, face > 0 ? Math.PI / 2 - 0.25 : -Math.PI / 2 + 0.25, angle);
    grappler.root.scale.setScalar(0.9);
    grappler.parts.body.rotation.x = 0.32 + lean;
    grappler.parts.headRig.rotation.x = -0.16;
    this._setArm(grappler.parts.leftArm, 0.95 + lean * 0.25, 0.1, 0.38, 0.68);
    this._setArm(grappler.parts.rightArm, 0.95 + lean * 0.25, -0.1, -0.38, 0.68);
    this._setLeg(grappler.parts.leftLeg, 1.12, 0, 0.22, 1.35);
    this._setLeg(grappler.parts.rightLeg, 1.12, 0, -0.22, 1.35);
  }

  _ground(grappler, x, z, angle = 0, face = 1, scale = 0.96) {
    grappler.root.position.set(x, 0.22, z);
    grappler.root.rotation.set(Math.PI / 2, face > 0 ? 0 : Math.PI, angle);
    grappler.root.scale.setScalar(scale);
    grappler.parts.body.rotation.x = 0.12;
    grappler.parts.headRig.rotation.x = -0.12;
    this._setArm(grappler.parts.leftArm, 0.55, 0.14, 0.58 * face, 0.78);
    this._setArm(grappler.parts.rightArm, 0.62, -0.14, -0.58 * face, 0.72);
    this._setLeg(grappler.parts.leftLeg, 0.72, 0, 0.38 * face, 0.9);
    this._setLeg(grappler.parts.rightLeg, 0.68, 0, -0.38 * face, 0.9);
  }

  _applyMovePose(key, progress, elapsed = 0) {
    const p = ease(progress);
    const pulse = wave(progress, 2) * 0.05;
    const opponentPerforms = this.performerSide === "opponent";
    if (opponentPerforms) {
      [this.attacker, this.defender] = [this.defender, this.attacker];
    }
    this._resetGrappler(this.attacker);
    this._resetGrappler(this.defender);

    switch (key) {
      case "grip_fighting": {
        this._stand(this.attacker, lerp(-1.12, -0.42, p), 0.09, 1, 0.22 * p, -0.12 * p, 0.06);
        this._stand(this.defender, lerp(1.12, 0.42, p), -0.02, -1, 0.2 * p, 0.12 * p, -0.06);
        this._setArm(this.attacker.parts.rightArm, 1.2 + pulse, -0.2, -0.72, 1.05);
        this._setArm(this.attacker.parts.leftArm, 0.96, 0.18, 0.48, 0.76);
        this._setArm(this.defender.parts.leftArm, 1.18 - pulse, 0.2, 0.72, 1.05);
        this._setArm(this.defender.parts.rightArm, 0.96, -0.18, -0.48, 0.76);
        break;
      }
      case "single_leg": {
        if (p < 0.64) {
          const q = ease(p / 0.64);
          this._stand(this.attacker, lerp(-1.16, -0.08, q), 0.12, 1, 0.78 * q, -0.22 * q, 0.18);
          this._stand(this.defender, lerp(1.08, 0.3, q), -0.04, -1, 0.14, 0.42 * q, -0.12);
          this._setArm(this.attacker.parts.leftArm, 1.55, 0.42, 0.28, 1.18);
          this._setArm(this.attacker.parts.rightArm, 1.36, -0.38, -0.4, 1.12);
          this._setLeg(this.defender.parts.leftLeg, 0.55, 0, 0.7, 0.35);
        } else {
          const q = ease((p - 0.64) / 0.36);
          this._kneel(this.attacker, lerp(-0.08, -0.28, q), 0.12, 1, 0.42, -0.15);
          this._ground(this.defender, lerp(0.3, 0.34, q), -0.02, 0.25 * q, -1, 0.94);
          this._setArm(this.attacker.parts.leftArm, 1.45, 0.32, 0.42, 1.1);
          this._setArm(this.attacker.parts.rightArm, 1.36, -0.28, -0.52, 1.05);
        }
        break;
      }
      case "double_leg": {
        if (p < 0.64) {
          const q = ease(p / 0.64);
          this._stand(this.attacker, lerp(-1.2, -0.08, q), 0.06, 1, 0.88 * q, -0.18 * q, 0.2);
          this._stand(this.defender, lerp(1.12, 0.24, q), -0.04, -1, 0.18, 0.56 * q, -0.1);
          this._setArm(this.attacker.parts.leftArm, 1.52, 0.25, 0.35, 1.2);
          this._setArm(this.attacker.parts.rightArm, 1.52, -0.25, -0.35, 1.2);
        } else {
          const q = ease((p - 0.64) / 0.36);
          this._kneel(this.attacker, lerp(-0.08, -0.22, q), 0.04, 1, 0.36, -0.08);
          this._ground(this.defender, lerp(0.24, 0.36, q), -0.02, 0.32 * q, -1, 0.95);
          this._setArm(this.attacker.parts.leftArm, 1.35, 0.22, 0.48, 1.15);
          this._setArm(this.attacker.parts.rightArm, 1.35, -0.22, -0.48, 1.15);
        }
        break;
      }
      case "guard_pull": {
        this._ground(this.attacker, lerp(-0.96, -0.08, p), 0.15, -0.12, 1, 0.98);
        this._kneel(this.defender, lerp(0.88, 0.3, p), -0.08, -1, 0.14 * p, 0.08);
        this._setLeg(this.attacker.parts.leftLeg, 1.26, 0, 1.12, 1.12);
        this._setLeg(this.attacker.parts.rightLeg, 1.22, 0, -1.12, 1.12);
        this._setArm(this.attacker.parts.leftArm, 1.08, 0.1, 0.62, 1.0);
        this._setArm(this.attacker.parts.rightArm, 1.1, -0.1, -0.62, 1.0);
        break;
      }
      case "closed_guard": {
        this._ground(this.attacker, -0.06, 0.16, -0.08 + pulse, 1, 0.99);
        this._kneel(this.defender, 0.2, -0.02, -1, 0.28, 0.03);
        this._setLeg(this.attacker.parts.leftLeg, 1.48, 0, 1.22, 1.22);
        this._setLeg(this.attacker.parts.rightLeg, 1.48, 0, -1.22, 1.22);
        this._setArm(this.defender.parts.leftArm, 1.18, 0.1, 0.34, 0.95);
        this._setArm(this.defender.parts.rightArm, 1.18, -0.1, -0.34, 0.95);
        break;
      }
      case "guard_pass": {
        this._kneel(this.attacker, lerp(-0.12, -0.52, p), -0.08, 1, 0.36, -0.18 * p);
        this._ground(this.defender, lerp(0.06, 0.38, p), 0.15, 0.26 * p, -1, 0.95);
        this._setArm(this.attacker.parts.leftArm, 1.28, 0.18, 0.56, 1.08);
        this._setArm(this.attacker.parts.rightArm, 1.48, -0.22, -0.54, 1.14);
        this._setLeg(this.attacker.parts.leftLeg, 1.34, 0, 0.28, 1.44);
        break;
      }
      case "side_control": {
        this._ground(this.defender, 0.15, 0.14, 0, -1, 0.96);
        this._ground(this.attacker, -0.1, -0.04, Math.PI / 2 + pulse, 1, 0.92);
        this.attacker.root.position.y += 0.22;
        this._setArm(this.attacker.parts.leftArm, 1.34, 0.22, 0.75, 1.1);
        this._setArm(this.attacker.parts.rightArm, 1.16, -0.28, -0.52, 1.02);
        break;
      }
      case "mount": {
        this._ground(this.defender, 0.05, 0.1, 0, -1, 0.96);
        this._kneel(this.attacker, 0.02, -0.08, 1, 0.22, 0);
        this.attacker.root.position.y += 0.06;
        this._setArm(this.attacker.parts.leftArm, 1.32, 0.1, 0.32, 1.02);
        this._setArm(this.attacker.parts.rightArm, 1.32, -0.1, -0.32, 1.02);
        this._setLeg(this.attacker.parts.leftLeg, 1.34, 0, 0.82, 1.36);
        this._setLeg(this.attacker.parts.rightLeg, 1.34, 0, -0.82, 1.36);
        break;
      }
      case "back_control": {
        this._kneel(this.defender, 0.18, 0.02, -1, 0.08, 0);
        this._kneel(this.attacker, -0.22, 0.08, 1, 0.1, 0);
        this.attacker.root.rotation.y = -0.02;
        this.defender.root.rotation.y = -0.02;
        this._setArm(this.attacker.parts.rightArm, 1.46, -0.12, -1.05, 1.16);
        this._setArm(this.attacker.parts.leftArm, 1.28, 0.15, 0.78, 1.08);
        this._setLeg(this.attacker.parts.leftLeg, 1.38, 0, 0.76, 1.42);
        this._setLeg(this.attacker.parts.rightLeg, 1.38, 0, -0.76, 1.42);
        break;
      }
      case "armbar": {
        this._ground(this.defender, 0.2, 0.05, 0, -1, 0.95);
        this._ground(this.attacker, -0.12, -0.08, Math.PI / 2, 1, 0.92);
        this.attacker.root.position.y += 0.08;
        this._setLeg(this.attacker.parts.leftLeg, 1.42, 0, 0.84, 1.32);
        this._setLeg(this.attacker.parts.rightLeg, 1.38, 0, -0.78, 1.32);
        this._setArm(this.defender.parts.rightArm, 1.46, -0.1, -1.08, 1.2);
        this._setArm(this.attacker.parts.leftArm, 1.34, 0.18, 0.72, 1.05);
        break;
      }
      case "triangle_choke": {
        this._ground(this.attacker, -0.08, 0.16, -0.12, 1, 0.97);
        this._kneel(this.defender, 0.22, -0.04, -1, 0.46, 0.04);
        this._setLeg(this.attacker.parts.leftLeg, 1.58, 0, 1.35, 1.38);
        this._setLeg(this.attacker.parts.rightLeg, 1.52, 0, -1.26, 1.38);
        this._setArm(this.attacker.parts.leftArm, 1.26, 0.18, 0.6, 1.05);
        this._setArm(this.attacker.parts.rightArm, 1.26, -0.18, -0.6, 1.05);
        this.defender.root.position.y -= 0.1 * p;
        break;
      }
      case "rear_naked_choke": {
        this._kneel(this.defender, 0.16, 0.02, -1, 0.1, 0);
        this._kneel(this.attacker, -0.16, 0.08, 1, 0.1, 0);
        this.attacker.root.rotation.y = -0.06;
        this.defender.root.rotation.y = -0.06;
        this._setArm(this.attacker.parts.rightArm, 1.58, -0.04, -1.22, 1.22);
        this._setArm(this.attacker.parts.leftArm, 1.34, 0.12, 0.96, 1.12);
        this._setArm(this.defender.parts.rightArm, 1.12 + 0.22 * p, -0.08, -0.45, 0.92);
        break;
      }
      case "tap_out": {
        this._kneel(this.attacker, -0.2, 0.06, 1, 0.05, 0);
        this._kneel(this.defender, 0.18, 0.02, -1, 0.12, 0);
        this._setArm(this.defender.parts.rightArm, 1.55 + Math.abs(wave(progress, 4)) * 0.28, -0.1, -0.96, 0.88);
        this._setArm(this.defender.parts.leftArm, 1.05, 0.1, 0.3, 0.8);
        break;
      }
      case "reset_neutral": {
        this._stand(this.attacker, lerp(-0.28, -0.9, p), 0.06, 1, 0.22 * (1 - p), 0, 0.06);
        this._stand(this.defender, lerp(0.28, 0.9, p), 0.02, -1, 0.2 * (1 - p), 0, -0.06);
        break;
      }
      case "standing_stance":
      default: {
        const idle = Math.abs(wave(elapsed * 0.12 || progress, 1));
        this._stand(this.attacker, -0.9, 0.08, 1, 0.1 * idle, -0.03, 0.05);
        this._stand(this.defender, 0.9, 0.04, -1, 0.1 * idle, 0.03, -0.05);
        break;
      }
    }

    if (opponentPerforms) {
      [this.attacker, this.defender].forEach((grappler) => {
        grappler.root.position.x *= -1;
        grappler.root.rotation.y *= -1;
      });
      [this.attacker, this.defender] = [this.defender, this.attacker];
    }

    this._updateCamera(key, p, elapsed);
    this._updateGrapplerAuras(elapsed);
  }

  _updateCamera(key, progress, elapsed) {
    const profile = cameraProfiles[key] || cameraProfiles.standing_stance;
    const from = progress < 0.54 ? profile.entry : profile.control;
    const to = progress < 0.54 ? profile.control : profile.finish;
    const local = progress < 0.54 ? ease(progress / 0.54) : ease((progress - 0.54) / 0.46);
    const orbit = this.reducedMotion || this.playing ? 0 : Math.sin(elapsed * 0.34) * 0.13;
    this.cameraGoal.set(
      lerp(from[0], to[0], local) + orbit,
      lerp(from[1], to[1], local),
      lerp(from[2], to[2], local),
    );
    copyVector(this.focusGoal, profile.focus);
    this.focusGoal.x += Math.sin(elapsed * 0.45) * (this.playing ? 0.025 : 0.055);
    if (!this.reducedMotion && this.impactEnergy > 0.08) {
      this.cameraGoal.x += (Math.random() - 0.5) * this.impactEnergy * 0.11;
      this.cameraGoal.y += (Math.random() - 0.5) * this.impactEnergy * 0.07;
    }
    this.camera.position.lerp(this.cameraGoal, this.reducedMotion ? 1 : 0.1);
    this.cameraFocus.lerp(this.focusGoal, this.reducedMotion ? 1 : 0.13);
    this.camera.lookAt(this.cameraFocus);
  }

  _updateGrapplerAuras(elapsed) {
    [this.attacker, this.defender].forEach((grappler, index) => {
      const { aura, auraDisc, auraLine, auraArc } = grappler.parts;
      const velocity = index === 0 ? 1 : -1;
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(elapsed * 2.2 + index) * 0.05 + this.impactEnergy * 0.12;
      aura.scale.setScalar(pulse);
      if (!this.reducedMotion) {
        aura.rotation.y += 0.014 * velocity;
        auraArc.rotation.z += 0.018 * velocity;
      }
      auraDisc.material.opacity = this.reducedMotion ? 0.17 : 0.17 + this.impactEnergy * 0.15;
      auraLine.material.opacity = this.reducedMotion ? 0.42 : 0.42 + this.impactEnergy * 0.3;
      auraArc.material.opacity = this.reducedMotion ? 0.34 : 0.34 + this.impactEnergy * 0.24;
    });
  }

  _triggerImpact(key) {
    this.impactEnergy = 1;
    const performer = this.performerSide === "opponent" ? this.defender : this.attacker;
    const color = performer.materials.aura.color;
    this.impactRing.visible = true;
    this.impactRing.position.set(0, 0.028, 0);
    this.impactRing.scale.setScalar(0.12);
    this.impactRing.material.color.copy(color);
    this.impactRing.material.opacity = 0.92;
    this.bloomPass.strength = this.isCompactViewport ? 0 : 0.82;
    this.impactNodes.forEach((node, index) => {
      const angle = (index / this.impactNodes.length) * Math.PI * 2 + Math.random() * 0.28;
      const speed = 1.1 + Math.random() * 1.6;
      node.position.set((Math.random() - 0.5) * 0.24, 0.32 + Math.random() * 0.55, (Math.random() - 0.5) * 0.28);
      node.scale.setScalar(0.55 + Math.random() * 1.2);
      node.material.color.copy(color);
      node.material.opacity = 0.96;
      node.userData.velocity.set(Math.cos(angle) * speed, 0.8 + Math.random() * 1.7, Math.sin(angle) * speed * 0.42);
      node.visible = true;
    });
    this._playImpactSfx(key);
  }

  _updateEnvironment(delta) {
    if (this.reducedMotion) {
      this.impactEnergy = 0;
      this.ambientParticles.rotation.y = 0;
      this.ambientParticles.position.y = 0;
      this.impactRing.visible = false;
      this.impactNodes.forEach((node) => { node.visible = false; });
      this.lightPulse.warm.intensity = 5.6;
      this.lightPulse.side.intensity = 3.8;
      this.lightPulse.rim.intensity = 1.45;
      this.bloomPass.strength = this.isCompactViewport ? 0 : 0.26;
      return;
    }
    this.impactEnergy = Math.max(0, this.impactEnergy - delta * 1.75);
    this.ambientParticles.rotation.y += delta * 0.05;
    this.ambientParticles.position.y = Math.sin(this.elapsedTime * 0.45) * 0.07;
    this.arenaGlowMaterials.forEach((material, index) => {
      material.opacity = clamp((material.opacity || 0.5) + Math.sin(this.elapsedTime * 1.15 + index) * delta * 0.12, 0.12, 0.82);
    });
    this.lightPulse.warm.intensity = 5.6 + this.impactEnergy * 7 + Math.sin(this.elapsedTime * 1.2) * 0.38;
    this.lightPulse.side.intensity = 3.8 + this.impactEnergy * 4.5;
    this.lightPulse.rim.intensity = 1.45 + this.impactEnergy * 0.7;
    this.bloomPass.strength = lerp(
      this.bloomPass.strength,
      this.isCompactViewport ? 0 : 0.26 + this.impactEnergy * 0.18,
      0.1,
    );

    if (this.impactRing.visible) {
      const scale = this.impactRing.scale.x + delta * 3.3;
      this.impactRing.scale.setScalar(scale);
      this.impactRing.material.opacity = Math.max(0, this.impactRing.material.opacity - delta * 1.8);
      if (this.impactRing.material.opacity <= 0.02) this.impactRing.visible = false;
    }

    this.impactNodes.forEach((node) => {
      if (!node.visible) return;
      node.position.addScaledVector(node.userData.velocity, delta);
      node.userData.velocity.y -= delta * 3.2;
      node.rotation.x += delta * 5.5;
      node.rotation.y += delta * 4.2;
      node.material.opacity = Math.max(0, node.material.opacity - delta * 1.25);
      if (node.material.opacity <= 0.03) node.visible = false;
    });
  }

  _playMotionSfx(key) {
    const context = this._getAudioContext();
    if (!context) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = key.includes("choke") || key === "armbar" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(180, now);
    oscillator.frequency.exponentialRampToValueAtTime(85, now + 0.2);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
  }

  _playImpactSfx(key) {
    const context = this._getAudioContext();
    if (!context) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = key === "tap_out" ? "square" : "sine";
    oscillator.frequency.setValueAtTime(key.includes("choke") ? 145 : 92, now);
    oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.075, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.22);
  }

  _getAudioContext() {
    if (typeof window === "undefined") return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    try {
      this.audioContext ??= new AudioContext();
      if (this.audioContext.state === "suspended") this.audioContext.resume();
      return this.audioContext;
    } catch {
      return null;
    }
  }

  dispose() {
    const active = this.active;
    const wasLocked = Boolean(active || this.loadingMove || this.playing);
    this.disposed = true;
    this.previewRequestId += 1;
    this.loadingMove = null;
    this.pendingPreviewKey = null;
    this.active = null;
    this.playing = false;
    active?.resolve?.(false);
    if (wasLocked) this.options.onLockChange?.(false);
    if (this.frameId) window.cancelAnimationFrame(this.frameId);
    this._resizeObserver?.disconnect();
    this._deactivateMocap();
    this._disposeCachedAnimationAssets();
    this.textureCache.forEach((texture) => texture.dispose());
    this.textureCache.clear();
    disposeObject(this.scene);
    this.composer?.dispose();
    this.renderer?.renderLists?.dispose();
    this.renderer?.dispose();
    this.audioContext?.close?.();
    if (this.renderer?.domElement?.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}

export default MoveAnimationManager;
