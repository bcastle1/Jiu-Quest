import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { MoveAnimationManager } from '../src/animation/MoveAnimationManager.js';
import { pairedMaterialSlot, tintPairedMaterial } from '../src/animation/pairedMaterials.js';

function colorNear(actual, expected) {
  for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(actual[channel] - expected[channel]) < 1e-10, `${channel}: ${actual[channel]} != ${expected[channel]}`);
}

function surface(name, texture = true) {
  const material = new THREE.MeshStandardMaterial({
    color: '#faf0e5', roughness: 0.68, metalness: 0.03, opacity: 0.84,
    alphaTest: 0.43, side: THREE.DoubleSide,
  });
  material.name = name;
  if (texture) {
    material.map = new THREE.Texture();
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.repeat.set(2, 3); material.map.offset.set(0.1, 0.2);
    material.normalMap = new THREE.Texture(); material.normalScale.set(0.6, 0.4);
    material.roughnessMap = new THREE.Texture(); material.metalnessMap = new THREE.Texture();
    material.aoMap = new THREE.Texture(); material.aoMapIntensity = 0.8;
  }
  return material;
}

test('textured skin recolors relative to its linear reference without losing PBR or alpha', () => {
  const material = surface('JQ_Attacker_Skin_Ref_E9B28D');
  const original = material.clone();
  const reference = new THREE.Color('#E9B28D');
  tintPairedMaterial(material, reference, '#E9B28D');
  colorNear(material.color, original.color); // The reference choice preserves the authored appearance.

  const desired = new THREE.Color('#6f432f');
  tintPairedMaterial(material, desired, '#E9B28D');
  const expected = new THREE.Color().setRGB(original.color.r * desired.r / reference.r, original.color.g * desired.g / reference.g, original.color.b * desired.b / reference.b);
  colorNear(material.color, expected);
  tintPairedMaterial(material, new THREE.Color('#f2cfb8'), '#E9B28D');
  tintPairedMaterial(material, desired, '#E9B28D');
  colorNear(material.color, expected); // Changing roles/kits cannot multiply the previous tint.
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) assert.equal(material[key], original[key]);
  for (const key of ['roughness', 'metalness', 'opacity', 'alphaTest', 'side', 'aoMapIntensity']) assert.equal(material[key], original[key]);
  assert.deepEqual(material.normalScale, original.normalScale);
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  assert.deepEqual(material.map.repeat.toArray(), [2, 3]);
  assert.deepEqual(material.map.offset.toArray(), [0.1, 0.2]);
});

test('hair references use the same denominator floor and unbounded linear scaling as Unity', () => {
  const material = surface('JQ_Attacker_Hair_Ref_000000');
  material.color.set('#ffffff');
  const desired = new THREE.Color('#b2824a');
  tintPairedMaterial(material, desired, '#000000');
  colorNear(material.color, new THREE.Color().setRGB(desired.r / 0.001, desired.g / 0.001, desired.b / 0.001));
  assert.ok(material.color.r > 1, 'a dark reference may legitimately require a factor greater than one');
});

test('legacy untextured slots retain direct replacement and neutral textured slots preserve authored shading', () => {
  const desired = new THREE.Color('#1646a1');
  const untextured = surface('JQ_Attacker_Skin', false);
  tintPairedMaterial(untextured, desired, '#E9B28D');
  colorNear(untextured.color, desired);
  assert.equal(untextured.opacity, 0.84);
  const neutral = surface('JQ_Attacker_GiTop');
  const original = neutral.color.clone();
  tintPairedMaterial(neutral, desired);
  colorNear(neutral.color, original.multiply(desired));
});

function pairedScene() {
  const scene = new THREE.Group();
  for (const role of ['Attacker', 'Defender']) {
    const actor = new THREE.Group(); actor.name = `JQ_${role}`; scene.add(actor);
    const parts = {
      Body: 'Skin_Ref_E9B28D', GiJacket: 'GiTop', GiPantsMesh: 'GiPants', Belt: 'Belt',
      BeltStripe_1: 'BeltStripe', HairCrew: 'Hair_Ref_4B3C31', HairLong: 'Hair_Ref_543727',
      Brows: 'Brows_Ref_0D0605', Eyes: 'Eyes', SkinEyeDetail: 'Skin_EyeDetail', HairAccessory: 'Hair_Ref_222323',
    };
    for (const [nodeName, slot] of Object.entries(parts)) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), surface(`JQ_${role}_${slot}`));
      mesh.name = `JQ_${role}_${nodeName}`; actor.add(mesh);
    }
  }
  return scene;
}

test('the actual Three manager accepts paired reference slots without requiring removed chest patches', () => {
  const manager = Object.create(MoveAnimationManager.prototype);
  const scene = pairedScene();
  const asset = { gltf: { scene }, clips: [{}] };
  assert.equal(manager._isUsablePairedAsset(asset), true);
  scene.getObjectByName('JQ_Defender_Body').material.name = 'JQ_Defender_Eyes';
  assert.equal(manager._isUsablePairedAsset(asset), false, 'missing skin still rejects an incomplete paired asset');
  assert.equal(pairedMaterialSlot('JQ_Attacker_Skin_Ref_e9b28d', 'Attacker').reference, '#e9b28d');
  for (const detail of ['Eyes', 'Skin_EyeDetail', 'Hair_Iris', 'Sclera', 'Logo', 'Skin_Ref_invalid']) {
    assert.equal(pairedMaterialSlot(`JQ_Attacker_${detail}`, 'Attacker'), null);
  }
  assert.equal(pairedMaterialSlot('JQ_Defender_Skin_Ref_E9B28D', 'Attacker'), null);
});

test('manager clones preserve authored surfaces, eyes and role isolation; bald hides scalp hair but retains tinted brows', () => {
  const manager = Object.create(MoveAnimationManager.prototype);
  const source = pairedScene();
  manager.mocap = { root: manager._cloneMocapScene(source) };
  manager.mocapAuras = [];
  manager._getEmblemTexture = () => null;
  const body = manager.mocap.root.getObjectByName('JQ_Attacker_Body');
  const sourceBody = source.getObjectByName('JQ_Attacker_Body');
  assert.notEqual(body.material, sourceBody.material);
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) assert.equal(body.material[key], sourceBody.material[key]);
  const originals = new Map();
  source.traverse((node) => { if (node.material) originals.set(node.name, node.material.color.clone()); });
  const appearance = { skinTone: '#6f432f', hairColor: '#b2824a', hairStyle: 'bald', giTop: '#ffffff', giPants: '#1646a1', belt: 'blue', stripes: 0, emblem: 'none' };
  manager._applyMocapFighterPalette('Attacker', appearance, 0);
  for (const name of ['JQ_Attacker_Eyes', 'JQ_Attacker_SkinEyeDetail', 'JQ_Defender_Body']) colorNear(manager.mocap.root.getObjectByName(name).material.color, originals.get(name));
  source.traverse((node) => { if (node.material) colorNear(node.material.color, originals.get(node.name)); });
  assert.equal(manager.mocap.root.getObjectByName('JQ_Attacker_HairCrew').visible, false);
  assert.equal(manager.mocap.root.getObjectByName('JQ_Attacker_HairLong').visible, false);
  const brows = manager.mocap.root.getObjectByName('JQ_Attacker_Brows');
  assert.equal(brows.visible, true);
  assert.notDeepEqual(brows.material.color, originals.get(brows.name));
  assert.equal(manager.mocap.root.getObjectByName('JQ_Attacker_HairAccessory').visible, true, 'unknown authored detail is not a selectable scalp hairstyle');
  assert.equal(manager.mocap.root.getObjectByName('JQ_Attacker_BeltStripe_1').visible, false);
  manager._applyMocapFighterPalette('Attacker', { ...appearance, hairStyle: 'long hair', stripes: 1 }, 0);
  assert.equal(manager.mocap.root.getObjectByName('JQ_Attacker_HairCrew').visible, false);
  assert.equal(manager.mocap.root.getObjectByName('JQ_Attacker_HairLong').visible, true);
  assert.equal(brows.visible, true);
  assert.equal(manager.mocap.root.getObjectByName('JQ_Attacker_BeltStripe_1').visible, true);
});
