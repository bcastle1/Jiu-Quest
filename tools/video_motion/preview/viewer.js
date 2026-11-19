// Deterministic preview of a JiuQuest paired choreography GLB.
//
// tools/video_motion/render_preview.mjs opens index.html in headless Chromium
// and drives this module through window.jqPreview:
//
//   await jqPreview.load(config)    -> key times, athletes found, camera, warnings
//   jqPreview.renderFrame(i, opts)  -> PNG data URL of animation key i, plus the
//                                      image rectangle each athlete covers (and,
//                                      with opts.joints, every joint's position)
//
// Frame i is the pose at times[i], the i-th key time of the GLB's first
// animation: the sorted union of the input times of all its samplers, read from
// the GLB itself. The pose is set with AnimationMixer.setTime and the page never
// reads a clock, so the same GLB and options give the same pixels.
//
// Cosmetics follow the site (_applyMocapFighterPalette in
// src/animation/MoveAnimationManager.js): materials named after a cosmetic slot
// are recolored with src/animation/pairedMaterials.js, exactly one authored
// hairstyle mesh is shown per athlete, belt stripes are shown up to the
// athlete's stripe count and the empty chest patch is hidden. One addition:
// the gi and belt sheen is tinted with the cloth color (see tintSheen).
//
// Coordinates are the GLB's scene space (JQ_Pair space): glTF Y-up, metres.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { pairedMaterialSlot, tintPairedMaterial } from '/src/animation/pairedMaterials.js';

const ROLES = ['JQ_Attacker', 'JQ_Defender'];
const UP = new THREE.Vector3(0, 1, 0);

// Site colors: belt colors from MoveAnimationManager.js, gi/skin/hair swatches
// from the palette in src/storage.js (the navy gi is the preview's own).
const BELT_COLORS = { white: '#f8fbff', blue: '#1646a1', purple: '#5f2a8d', brown: '#673a25', black: '#11131c' };
export const DEFAULT_APPEARANCE = {
  JQ_Attacker: { giTop: '#f8fbff', giPants: '#f8fbff', skinTone: '#a86b4d', hairColor: '#11131c', hairStyle: 'crew', belt: 'blue', stripes: 0 },
  JQ_Defender: { giTop: '#1f2a44', giPants: '#1f2a44', skinTone: '#d99b71', hairColor: '#3b251b', hairStyle: 'slick', belt: 'blue', stripes: 0 },
};

export const VIEW = {
  fovDeg: 35,             // vertical field of view of the computed cameras
  elevationDeg: 10,       // side, front and orbit cameras look slightly down, so the mat shows
  topElevationDeg: 60,    // top: overhead oblique ...
  topYawDeg: 30,          // ... from the side direction turned 30 degrees toward the front view
  margin: 0.05,           // fraction of the image kept clear on every side
  jointRadius: 0.13,      // skin and gi extend past the joint centres
  headRadius: 0.27,       // the Head joint is the base of the skull; this covers skull and hair
};

const COLORS = {
  background: '#a9b1b8',
  mat: ['#78846f', '#727e6a'],   // muted tatami green-grey, alternate 1 m squares
  seam: '#596452',
  outline: '#0d1013',
  // [centre bones, athlete's left (_l), athlete's right (_r)]
  skeleton: { JQ_Attacker: ['#ff8a1c', '#ffbe70', '#d25a00'], JQ_Defender: ['#14d2ee', '#8cf0ff', '#0090aa'] },
};

const state = { loaded: false };

function color(value, fallback) {
  try {
    return new THREE.Color(value || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

// ---------------------------------------------------------------- the GLB

// The key times of the first animation: every sampler's input, merged.
async function keyTimes(gltf) {
  const animation = gltf.parser.json.animations?.[0];
  if (!animation) throw new Error('the GLB has no animation');
  const values = [];
  for (const input of new Set(animation.samplers.map((sampler) => sampler.input))) {
    const attribute = await gltf.parser.getDependency('accessor', input);
    for (let k = 0; k < attribute.count; k += 1) values.push(attribute.getX(k));
  }
  values.sort((a, b) => a - b);
  const times = [];
  for (const t of values) if (!times.length || t - times[times.length - 1] > 1e-6) times.push(t);
  return times;
}

function isUnder(object, ancestor) {
  for (let node = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
}

function isShown(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

// One athlete: its JQ_<Role> node, the skinned meshes bound to its joints, and
// its joints in skin order. GLTFLoader renames repeated node names (the
// defender's "pelvis" becomes "pelvis_1"), so joints are named by the original
// glTF name it keeps in userData.name.
function findAthlete(root, role) {
  const node = root.getObjectByName(role);
  if (!node) return null;
  const meshes = [];
  root.traverse((object) => {
    if (object.isSkinnedMesh && object.skeleton.bones.length && isUnder(object.skeleton.bones[0], node)) meshes.push(object);
  });
  const body = meshes.find((mesh) => mesh.name === `${role}_Body`) ?? meshes[0];
  const bones = body ? body.skeleton.bones : [];
  const names = bones.map((bone) => bone.userData.name ?? bone.name);
  const bone = (name) => bones[names.indexOf(name)] ?? null;
  return { role, node, meshes, bones, names, pelvis: bone('pelvis') };
}

// The site's hairstyle names (src/storage.js) and the manifest's (Crew, Long,
// Slick, Mohawk, Spikes, Bald) -> the authored hair mesh to show.
function hairStyleKey(style) {
  const name = String(style || 'shadow spikes').trim().toLowerCase();
  if (name === 'bald') return 'bald';
  if (name === 'mohawk') return 'mohawk';
  if (['long', 'long hair', 'storm tail', 'braided top', 'curly guard'].includes(name)) return 'long';
  if (['slick', 'slicked back', 'wave cut'].includes(name)) return 'slick';
  if (['crew', 'crew cut', 'short fade'].includes(name)) return 'crew';
  return 'spikes';
}

// The gi and belt materials carry an authored white sheen (KHR_materials_sheen,
// color 1, 1, 1). The site recolors only their base color, which is right for
// a white gi, but on a dark gi the white sheen reads as silver wherever the
// cloth is seen at a grazing angle (the top camera shows most of it). The
// preview tints the sheen like the base color, so a navy gi reads navy; a white
// gi is unchanged.
const DYED_SLOTS = new Set(['gitop', 'gipants', 'belt']);
const authoredSheen = new WeakMap();

function tintSheen(material, selected, reference) {
  if (!material.sheenColor) return;
  if (!authoredSheen.has(material)) authoredSheen.set(material, material.sheenColor.clone());
  const authored = authoredSheen.get(material);
  const swatch = new THREE.Color(reference);
  material.sheenColor.setRGB(
    authored.r * selected.r / Math.max(swatch.r, 0.001),
    authored.g * selected.g / Math.max(swatch.g, 0.001),
    authored.b * selected.b / Math.max(swatch.b, 0.001),
  );
}

function applyAppearance(root, role, look, warnings) {
  const slotRole = role.replace(/^JQ_/, '');
  const prefix = `${role}_`;
  const colors = {
    gitop: color(look.giTop, '#f8fbff'),
    gipants: color(look.giPants, '#f8fbff'),
    skin: color(look.skinTone, '#d99b71'),
    hair: color(look.hairColor, '#11131c'),
    brows: color(look.hairColor, '#11131c'),
    belt: color(BELT_COLORS[look.belt] ?? look.belt, '#f8fbff'),
    beltstripe: color(look.belt === 'white' ? '#182030' : '#f8fbff', '#f8fbff'),
  };
  const style = hairStyleKey(look.hairStyle);
  const stripes = Math.max(0, Math.min(4, Number(look.stripes) || 0));
  const tinted = new Set();
  const hairShown = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      const semantic = pairedMaterialSlot(material?.name, slotRole);
      const selected = colors[semantic?.slot];
      if (!selected) continue;
      tintPairedMaterial(material, selected, semantic.reference);
      if (DYED_SLOTS.has(semantic.slot)) tintSheen(material, selected, semantic.reference);
      tinted.add(semantic.slot);
    }
    const name = node.name.startsWith(prefix) ? node.name.slice(prefix.length) : '';
    const hair = /^Hair(Spikes|Crew|Mohawk|Long|Slick)(?:_|$)/i.exec(name);
    if (hair && materials.some((material) => pairedMaterialSlot(material?.name, slotRole)?.slot === 'hair')) {
      node.visible = style === hair[1].toLowerCase();
      if (node.visible) hairShown.push(node.name);
    }
    if (name.startsWith('BeltStripe_')) node.visible = Number(name.slice(name.lastIndexOf('_') + 1)) <= stripes;
    if (name === 'ChestPatch') node.visible = false;   // the site shows it only with an emblem
  });
  for (const slot of ['gitop', 'gipants', 'skin', 'hair', 'belt']) {
    if (!tinted.has(slot)) warnings.push(`${role}: no material for cosmetic slot "${slot}"`);
  }
  if (style !== 'bald' && !hairShown.length) warnings.push(`${role}: no hair mesh for style "${style}"`);
  return { ...look, hairMesh: hairShown, stripes };
}

// ---------------------------------------------------------------- pose

function setPose(time) {
  // LoopOnce + clamp, reset before every jump: a repeating action would wrap
  // the last key time (== clip duration) back to 0, and a clamped action
  // pauses at the end and would ignore the next setTime.
  state.action.reset();
  state.mixer.setTime(time);
  state.scene.updateMatrixWorld(true);
}

// World positions of every joint of both athletes at every key, with a framing
// radius per joint (root, which sits on the mat under the pelvis, is skipped).
function clipPointCloud() {
  const points = [];
  const radii = [];
  for (const time of state.times) {
    setPose(time);
    for (const athlete of Object.values(state.athletes)) {
      athlete.bones.forEach((bone, index) => {
        const name = athlete.names[index];
        if (name === 'root') return;
        points.push(new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld));
        radii.push(name === 'Head' ? VIEW.headRadius : VIEW.jointRadius);
      });
    }
  }
  return { points, radii };
}

// ---------------------------------------------------------------- cameras

// The attacker's own direction on the mat at the current pose: where its torso
// faces when upright, or its pelvis-to-neck axis when lying down, whichever is
// flatter. Measured on the joints, so it holds however the clip is oriented.
function bodyDirection(athlete) {
  const at = (name) => {
    const index = athlete.names.indexOf(name);
    return index < 0 ? null : new THREE.Vector3().setFromMatrixPosition(athlete.bones[index].matrixWorld);
  };
  const pelvis = at('pelvis');
  const neck = at('neck_01') ?? at('Head');
  const left = at('thigh_l');
  const right = at('thigh_r');
  if (!pelvis || !neck || !left || !right) return null;
  const up = neck.sub(pelvis).normalize();
  const facing = new THREE.Vector3().crossVectors(left.sub(right), up).normalize();  // left x up = forward
  const flatFacing = new THREE.Vector3(facing.x, 0, facing.z);
  const flatAxis = new THREE.Vector3(up.x, 0, up.z);
  if (Math.max(flatFacing.length(), flatAxis.length()) < 0.2) return null;
  return flatFacing.length() >= flatAxis.length()
    ? { source: 'attacker torso facing', direction: flatFacing.normalize() }
    : { source: 'attacker pelvis-to-neck axis', direction: flatAxis.normalize() };
}

// The horizontal line from the attacker's pelvis to the defender's at key 0.
// When the pelvises are stacked (less than 10 cm apart on the mat) the
// attacker's body direction stands in for it.
function pelvisLine() {
  setPose(state.times[0]);
  const attacker = state.athletes.JQ_Attacker;
  const defender = state.athletes.JQ_Defender;
  const result = { source: 'default -Z', direction: new THREE.Vector3(0, 0, -1) };
  if (attacker?.pelvis && defender?.pelvis) {
    const a = new THREE.Vector3().setFromMatrixPosition(attacker.pelvis.matrixWorld);
    const d = new THREE.Vector3().setFromMatrixPosition(defender.pelvis.matrixWorld);
    result.attacker_pelvis = a.toArray();
    result.defender_pelvis = d.toArray();
    const line = new THREE.Vector3(d.x - a.x, 0, d.z - a.z);
    if (line.length() >= 0.1) return { ...result, source: 'pelvis line', direction: line.normalize() };
  }
  const body = attacker ? bodyDirection(attacker) : null;
  return body ? { ...result, ...body } : result;
}

function turnAboutUp(vector, degrees) {
  return vector.clone().applyAxisAngle(UP, THREE.MathUtils.degToRad(degrees));
}

function elevate(horizontal, degrees) {
  const angle = THREE.MathUtils.degToRad(degrees);
  return horizontal.clone().normalize().multiplyScalar(Math.cos(angle)).addScaledVector(UP, Math.sin(angle));
}

// The closest camera on the ray `toCamera` that keeps every point's sphere
// inside the image with VIEW.margin to spare, re-centred on the points. Exact
// for a symmetric perspective frustum: each side plane gives a linear bound on
// distance and lateral shift, solved in closed form.
function fitView(cloud, toCamera, fovDeg, aspect) {
  const z = toCamera.clone().normalize();
  const x = new THREE.Vector3().crossVectors(UP, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const box = new THREE.Box3().setFromPoints(cloud.points);
  const center = box.getCenter(new THREE.Vector3());
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * (1 - 2 * VIEW.margin);
  const tanH = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * aspect * (1 - 2 * VIEW.margin);
  const kV = Math.hypot(1, tanV);
  const kH = Math.hypot(1, tanH);
  let right = -Infinity;
  let left = -Infinity;
  let top = -Infinity;
  let bottom = -Infinity;
  const offset = new THREE.Vector3();
  cloud.points.forEach((point, index) => {
    offset.subVectors(point, center);
    const px = offset.dot(x);
    const py = offset.dot(y);
    const pz = offset.dot(z);
    const r = cloud.radii[index];
    right = Math.max(right, pz * tanH + px + r * kH);
    left = Math.max(left, pz * tanH - px + r * kH);
    top = Math.max(top, pz * tanV + py + r * kV);
    bottom = Math.max(bottom, pz * tanV - py + r * kV);
  });
  const distance = Math.max((right + left) / (2 * tanH), (top + bottom) / (2 * tanV));
  const target = center.clone().addScaledVector(x, (right - left) / 2).addScaledVector(y, (top - bottom) / 2);
  const position = target.clone().addScaledVector(z, distance);
  return { position: position.toArray(), target: target.toArray(), fov_deg: fovDeg, up: [0, 1, 0] };
}

function fixedView(kind, degrees, line, cloud, fovDeg, aspect) {
  // Side: the camera on the athletes' left-to-right normal, so the attacker
  // stands on the left of the image and the defender on the right.
  const side = new THREE.Vector3().crossVectors(line.direction, UP).normalize();
  if (kind === 'side') return fitView(cloud, elevate(side, VIEW.elevationDeg), fovDeg, aspect);
  if (kind === 'front') return fitView(cloud, elevate(line.direction, VIEW.elevationDeg), fovDeg, aspect);
  if (kind === 'top') return fitView(cloud, elevate(turnAboutUp(side, VIEW.topYawDeg), VIEW.topElevationDeg), fovDeg, aspect);
  if (kind === 'orbit') return fitView(cloud, elevate(turnAboutUp(side, degrees), VIEW.elevationDeg), fovDeg, aspect);
  throw new Error(`unknown camera "${kind}"`);
}

// A camera file: {"position", "target", "fov_deg", "up"}, optionally with
// "frames": one entry per animation key (the last one holds), or sparse
// entries that each carry "frame" (linear in between, held outside). Entries
// may leave out fields; the top-level values fill them in.
function jsonView(spec, index) {
  const view = (entry) => {
    const merged = { ...spec, ...entry };
    return { position: merged.position, target: merged.target, fov_deg: merged.fov_deg ?? VIEW.fovDeg, up: merged.up ?? [0, 1, 0] };
  };
  const frames = Array.isArray(spec.frames) ? spec.frames : [];
  if (!frames.length) return view({});
  if (!frames.every((entry) => Number.isInteger(entry.frame))) return view(frames[Math.min(index, frames.length - 1)]);
  const keys = [...frames].sort((a, b) => a.frame - b.frame);
  if (index <= keys[0].frame) return view(keys[0]);
  if (index >= keys[keys.length - 1].frame) return view(keys[keys.length - 1]);
  let k = 0;
  while (keys[k + 1].frame <= index) k += 1;
  const a = view(keys[k]);
  const b = view(keys[k + 1]);
  const u = (index - keys[k].frame) / (keys[k + 1].frame - keys[k].frame);
  const mix = (p, q) => p.map((value, j) => value + (q[j] - value) * u);
  return { position: mix(a.position, b.position), target: mix(a.target, b.target), fov_deg: a.fov_deg + (b.fov_deg - a.fov_deg) * u, up: mix(a.up, b.up) };
}

function viewForFrame(index) {
  if (state.cameraSpec.kind === 'json') return jsonView(state.cameraSpec.spec, index);
  return state.fixedView;
}

function applyView(view) {
  const camera = state.camera;
  camera.fov = view.fov_deg;
  camera.position.fromArray(view.position);
  camera.up.fromArray(view.up).normalize();
  const distance = camera.position.distanceTo(new THREE.Vector3().fromArray(view.target));
  camera.near = Math.max(0.01, distance / 200);
  camera.far = distance * 20 + 50;
  camera.lookAt(new THREE.Vector3().fromArray(view.target));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

// ---------------------------------------------------------------- stage

function matTexture(renderer) {
  // A 2 m x 2 m tile of four 1 m squares in two shades, with dark seams, so
  // sliding feet and travel across the mat are easy to see.
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      g.fillStyle = COLORS.mat[(i + j) % 2];
      g.fillRect(i * 256, j * 256, 256, 256);
    }
  }
  g.strokeStyle = COLORS.seam;
  g.lineWidth = 3;
  for (const p of [0, 256, 512]) {
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(512, p); g.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function buildStage(config, cloudBox, azimuth, viewDistance) {
  const { scene, renderer } = state;
  const background = new THREE.Color(COLORS.background);
  scene.background = background;
  // The far mat fades into the background instead of ending at a hard edge.
  scene.fog = new THREE.Fog(background, viewDistance * 2.5, viewDistance * 7);

  const center = cloudBox.getCenter(new THREE.Vector3());
  const radius = cloudBox.getSize(new THREE.Vector3()).length() / 2;
  if (config.floor !== 'none') {
    const size = 60;
    const texture = matTexture(renderer);
    texture.repeat.set(size / 2, size / 2);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0 }),
    );
    // Whole tiles, so the 1 m grid stays on world metre lines.
    floor.position.set(Math.round(center.x / 2) * 2, 0, Math.round(center.z / 2) * 2);
    floor.receiveShadow = Boolean(config.shadows);
    floor.name = 'preview_floor';
    scene.add(floor);
  }

  // Soft studio light placed relative to the camera's azimuth: key from the
  // camera's left and above, a cool fill from the right, a rim from behind.
  scene.add(new THREE.HemisphereLight('#eef2f7', '#59604f', 1.15));
  const lightAt = (yaw, elevation, distance) => center.clone().addScaledVector(elevate(turnAboutUp(azimuth, yaw), elevation), distance);
  const key = new THREE.DirectionalLight('#fff4e4', 2.3);
  key.position.copy(lightAt(-40, 50, radius + 8));
  key.target.position.copy(center);
  const fill = new THREE.DirectionalLight('#dbe5ff', 0.75);
  fill.position.copy(lightAt(65, 20, radius + 8));
  fill.target.position.copy(center);
  const rim = new THREE.DirectionalLight('#ffffff', 0.9);
  rim.position.copy(lightAt(180, 35, radius + 8));
  rim.target.position.copy(center);
  scene.add(key, key.target, fill, fill.target, rim, rim.target);
  if (config.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const extent = radius + 0.75;
    Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 0.5, far: radius * 2 + 20 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    key.shadow.radius = 3;
  }
}

// ---------------------------------------------------------------- skeleton overlay

function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = COLORS.outline;
  g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(32, 32, 21, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(canvas);
}

// Bones as thick screen-space lines drawn over everything (depthTest off):
// a dark outline, then the athlete's color, lighter on its left side and
// darker on its right so a left/right swap in a fit is visible. Fingers are
// thinner. Root (on the mat under the pelvis) is not drawn.
function buildSkeleton(athlete, width, height) {
  const palette = COLORS.skeleton[athlete.role] ?? ['#ffffff', '#ffffff', '#ffffff'];
  const segments = [];
  athlete.bones.forEach((bone, child) => {
    const parent = athlete.bones.indexOf(bone.parent);
    if (parent < 0 || athlete.names[parent] === 'root') return;
    const name = athlete.names[child];
    segments.push({
      parent,
      child,
      side: /_l$/.test(name) ? 1 : /_r$/.test(name) ? 2 : 0,
      finger: /^(thumb|index|middle|ring|pinky)_/.test(name),
    });
  });
  const groups = [false, true].map((finger) => {
    const segs = segments.filter((segment) => segment.finger === finger);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(new Float32Array(segs.length * 6));
    const colors = new Float32Array(segs.length * 6);
    segs.forEach((segment, k) => {
      const c = new THREE.Color(palette[segment.side]);
      colors.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
    });
    geometry.setColors(colors);
    const lines = [];
    for (const outline of [true, false]) {
      const material = new LineMaterial({
        color: outline ? COLORS.outline : 0xffffff,
        vertexColors: !outline,
        linewidth: (finger ? 2 : 5) + (outline ? 3 : 0),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      material.resolution.set(width, height);
      const line = new LineSegments2(geometry, material);
      line.frustumCulled = false;
      line.renderOrder = outline ? 1000 : 1001;
      lines.push(line);
    }
    return { segs, geometry, lines };
  });
  const joints = athlete.bones
    .map((bone, index) => index)
    .filter((index) => athlete.names[index] !== 'root' && !/^(thumb|index|middle|ring|pinky)_/.test(athlete.names[index]));
  const dotGeometry = new THREE.BufferGeometry();
  dotGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(joints.length * 3), 3));
  const dots = new THREE.Points(dotGeometry, new THREE.PointsMaterial({
    color: palette[0], size: 9, sizeAttenuation: false, map: dotTexture(), alphaTest: 0.5,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  dots.frustumCulled = false;
  dots.renderOrder = 1002;
  const group = new THREE.Group();
  group.name = `preview_skeleton_${athlete.role}`;
  for (const g of groups) group.add(...g.lines);
  group.add(dots);
  return { athlete, groups, joints, dots, group };
}

function updateSkeleton(overlay) {
  const world = overlay.athlete.bones.map((bone) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld));
  for (const g of overlay.groups) {
    const buffer = g.geometry.getAttribute('instanceStart').data;
    g.segs.forEach((segment, k) => {
      world[segment.parent].toArray(buffer.array, k * 6);
      world[segment.child].toArray(buffer.array, k * 6 + 3);
    });
    buffer.needsUpdate = true;
  }
  const positions = overlay.dots.geometry.getAttribute('position');
  overlay.joints.forEach((index, k) => world[index].toArray(positions.array, k * 3));
  positions.needsUpdate = true;
}

// ---------------------------------------------------------------- framing check

// The image rectangle an athlete's visible skinned meshes cover, skinned on the
// CPU (every third vertex), and whether it lies wholly inside the image.
function imageBounds(athlete, camera, width, height) {
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const vertex = new THREE.Vector3();
  const clip = new THREE.Vector4();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let behind = 0;
  for (const mesh of athlete.meshes) {
    if (!isShown(mesh)) continue;
    const count = mesh.geometry.getAttribute('position').count;
    for (let k = 0; k < count; k += 3) {
      mesh.getVertexPosition(k, vertex).applyMatrix4(mesh.matrixWorld);
      clip.set(vertex.x, vertex.y, vertex.z, 1).applyMatrix4(viewProjection);
      if (clip.w <= 1e-6) {
        behind += 1;
        continue;
      }
      const px = ((clip.x / clip.w + 1) / 2) * width;
      const py = ((1 - clip.y / clip.w) / 2) * height;
      x0 = Math.min(x0, px);
      y0 = Math.min(y0, py);
      x1 = Math.max(x1, px);
      y1 = Math.max(y1, py);
    }
  }
  if (!Number.isFinite(x0)) return { bbox_px: null, in_frame: false };
  const round = (v) => Math.round(v * 10) / 10;
  return {
    bbox_px: [round(x0), round(y0), round(x1), round(y1)],
    in_frame: behind === 0 && x0 >= 0 && y0 >= 0 && x1 <= width && y1 <= height,
  };
}

// Every joint's world position (scene space, metres) and image position
// (pixels from the top-left corner; null behind the camera), in skin order.
function jointPositions(camera, width, height) {
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const point = new THREE.Vector3();
  const clip = new THREE.Vector4();
  const round = (v, digits) => Number(v.toFixed(digits));
  const result = {};
  for (const [role, athlete] of Object.entries(state.athletes)) {
    const world = [];
    const pixel = [];
    for (const bone of athlete.bones) {
      point.setFromMatrixPosition(bone.matrixWorld);
      world.push([round(point.x, 6), round(point.y, 6), round(point.z, 6)]);
      clip.set(point.x, point.y, point.z, 1).applyMatrix4(viewProjection);
      pixel.push(clip.w > 1e-6
        ? [round(((clip.x / clip.w + 1) / 2) * width, 2), round(((1 - clip.y / clip.w) / 2) * height, 2)]
        : null);
    }
    result[role] = { world, pixel };
  }
  return result;
}

// ---------------------------------------------------------------- API

async function load(config) {
  if (state.loaded) throw new Error('load() was already called');
  state.loaded = true;
  const { width, height } = config;
  const warnings = [];

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral tone mapping keeps the gi swatches close to their sRGB values.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = Boolean(config.shadows);
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);

  const gltf = await new GLTFLoader().loadAsync(config.glbUrl);
  const clip = gltf.animations[0];
  if (!clip) throw new Error('the GLB has no animation');
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  Object.assign(state, { config, renderer, scene, gltf, mixer, action, width, height });
  state.times = await keyTimes(gltf);
  state.camera = new THREE.PerspectiveCamera(VIEW.fovDeg, width / height, 0.05, 100);

  state.athletes = {};
  const looks = {};
  for (const role of ROLES) {
    const athlete = findAthlete(gltf.scene, role);
    if (!athlete) {
      warnings.push(`${role} is not in the GLB`);
      continue;
    }
    if (!athlete.bones.length) warnings.push(`${role} has no skinned mesh`);
    if (!athlete.pelvis) warnings.push(`${role} has no pelvis joint`);
    state.athletes[role] = athlete;
    looks[role] = applyAppearance(gltf.scene, role, { ...DEFAULT_APPEARANCE[role], ...(config.appearance?.[role] ?? {}) }, warnings);
  }
  if (!Object.keys(state.athletes).length) throw new Error('neither JQ_Attacker nor JQ_Defender is in the GLB');
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    // A skinned mesh's bounding sphere is computed once, in its first pose;
    // the clip can carry the athletes well outside it.
    if (object.isSkinnedMesh) object.frustumCulled = false;
    object.castShadow = Boolean(config.shadows);
    object.receiveShadow = Boolean(config.shadows);
  });

  const cloud = clipPointCloud();
  if (!cloud.points.length) throw new Error('no joints to frame: neither athlete has a skinned mesh');
  const cloudBox = new THREE.Box3().setFromPoints(cloud.points);
  const line = pelvisLine();
  state.cameraSpec = config.camera;
  const aspect = width / height;
  const fovDeg = config.fovDeg ?? VIEW.fovDeg;
  let view0;
  if (config.camera.kind === 'json') {
    view0 = jsonView(config.camera.spec, 0);
  } else {
    state.fixedView = fixedView(config.camera.kind, config.camera.deg ?? 0, line, cloud, fovDeg, aspect);
    view0 = state.fixedView;
  }
  const toCamera = new THREE.Vector3().fromArray(view0.position).sub(new THREE.Vector3().fromArray(view0.target));
  const azimuth = new THREE.Vector3(toCamera.x, 0, toCamera.z);
  if (azimuth.lengthSq() < 1e-9) azimuth.set(1, 0, 0);
  buildStage(config, cloudBox, azimuth.normalize(), toCamera.length());

  state.overlays = [];
  if (config.skeleton) {
    for (const athlete of Object.values(state.athletes)) {
      const overlay = buildSkeleton(athlete, width, height);
      scene.add(overlay.group);
      state.overlays.push(overlay);
    }
  }

  // Warm-up: compile every shader now, so per-frame times are steady-state.
  // WebGL defers the work until something reads the result back.
  renderPose(0);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    three: THREE.REVISION,
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    animation: clip.name,
    animation_count: gltf.animations.length,
    key_count: state.times.length,
    times: state.times,
    duration: clip.duration,
    roles: Object.keys(state.athletes),
    joint_names: Object.fromEntries(Object.entries(state.athletes).map(([role, athlete]) => [role, athlete.names])),
    appearance: looks,
    pelvis_line: { source: line.source, direction: line.direction.toArray(), attacker_pelvis: line.attacker_pelvis, defender_pelvis: line.defender_pelvis },
    joint_bounds: { min: cloudBox.min.toArray(), max: cloudBox.max.toArray() },
    camera_frame0: view0,
    warnings,
  };
}

function renderPose(index) {
  const time = state.times[index];
  setPose(time);
  const view = viewForFrame(index);
  applyView(view);
  for (const overlay of state.overlays) updateSkeleton(overlay);
  state.renderer.render(state.scene, state.camera);
  return { time, view };
}

// options.joints adds every joint's world and image position to the result.
function renderFrame(index, options = {}) {
  if (!state.times) throw new Error('call load() first');
  if (!Number.isInteger(index) || index < 0 || index >= state.times.length) {
    throw new Error(`frame ${index} is outside 0..${state.times.length - 1}`);
  }
  const { time, view } = renderPose(index);
  const png = state.renderer.domElement.toDataURL('image/png');
  const athletes = {};
  for (const [role, athlete] of Object.entries(state.athletes)) {
    athletes[role] = imageBounds(athlete, state.camera, state.width, state.height);
  }
  const result = { index, time, png, camera: view, athletes };
  if (options.joints) result.joints = jointPositions(state.camera, state.width, state.height);
  return result;
}

window.jqPreview = { ready: true, load, renderFrame };
