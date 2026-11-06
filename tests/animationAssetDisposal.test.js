import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { MoveAnimationManager } from '../src/animation/MoveAnimationManager.js';

function managerWithoutRenderer() {
  const manager = Object.create(MoveAnimationManager.prototype);
  manager.assetCache = new Map();
  manager.disposedAssetScenes = new WeakSet();
  manager.disposedAssetResources = {
    geometries: new WeakSet(), materials: new WeakSet(), textures: new WeakSet(), images: new WeakSet(),
  };
  manager.attacker = { root: new THREE.Group() };
  manager.defender = { root: new THREE.Group() };
  manager.mocapAuras = [];
  return manager;
}

function disposalCount(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => { count += 1; });
  return () => count;
}

function sourceScene(material, geometry = new THREE.BufferGeometry()) {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry, material));
  return { gltf: { scene } };
}

test('source teardown deduplicates shared maps, extension maps, geometry and owned ImageBitmap backing', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ImageBitmap');
  class OwnedBitmap {
    closes = 0;
    close() { this.closes += 1; }
  }
  Object.defineProperty(globalThis, 'ImageBitmap', { value: OwnedBitmap, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'ImageBitmap', original);
    else delete globalThis.ImageBitmap;
  });

  const bitmap = new OwnedBitmap();
  const base = new THREE.Texture(bitmap);
  const variant = base.clone(); // Real GLTFLoader clones can share Texture.source.
  const clearcoat = new THREE.Texture(bitmap);
  const textureCounts = [base, variant, clearcoat].map(disposalCount);
  const first = new THREE.MeshPhysicalMaterial({ map: base, normalMap: base, roughnessMap: variant, clearcoatMap: clearcoat });
  const second = new THREE.MeshStandardMaterial({ map: base, aoMap: variant });
  const materialCounts = [first, second].map(disposalCount);
  const geometry = new THREE.BufferGeometry();
  const geometryCount = disposalCount(geometry);
  const asset = sourceScene(first, geometry);
  asset.gltf.scene.add(new THREE.Mesh(geometry, [first, second]));
  const anotherAsset = sourceScene(second, geometry);
  const manager = managerWithoutRenderer();
  manager._disposeCachedAnimationAsset(asset);
  manager._disposeCachedAnimationAsset(anotherAsset);
  manager._disposeCachedAnimationAsset(asset);

  assert.deepEqual(textureCounts.map(count => count()), [1, 1, 1]);
  assert.deepEqual(materialCounts.map(count => count()), [1, 1]);
  assert.equal(geometryCount(), 1);
  assert.equal(bitmap.closes, 1);
});

test('switching a live clone disposes only clone materials and leaves borrowed source textures usable', () => {
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
  const geometry = new THREE.BufferGeometry();
  const asset = sourceScene(material, geometry);
  const textureCount = disposalCount(texture);
  const sourceMaterialCount = disposalCount(material);
  const geometryCount = disposalCount(geometry);
  const manager = managerWithoutRenderer();

  for (let switchNumber = 0; switchNumber < 2; switchNumber++) {
    const root = manager._cloneMocapScene(asset.gltf.scene);
    const cloneMaterial = root.children[0].material;
    const cloneCount = disposalCount(cloneMaterial);
    assert.notEqual(cloneMaterial, material);
    assert.equal(cloneMaterial.map, texture);
    manager.mocap = { root, mixer: { stopAllAction() {}, uncacheRoot() {} } };
    manager._deactivateMocap();
    assert.equal(cloneCount(), 1);
    assert.equal(textureCount(), 0);
    assert.equal(sourceMaterialCount(), 0);
    assert.equal(geometryCount(), 0);
  }

  manager._disposeCachedAnimationAsset(asset);
  assert.equal(textureCount(), 1);
  assert.equal(sourceMaterialCount(), 1);
  assert.equal(geometryCount(), 1);
});

test('an asset that finishes loading after cache teardown still releases its owned maps exactly once', async () => {
  const manager = managerWithoutRenderer();
  let finishLoad;
  const request = new Promise(resolve => { finishLoad = resolve; });
  const texture = new THREE.Texture();
  const textureCount = disposalCount(texture);
  const asset = sourceScene(new THREE.MeshStandardMaterial({ map: texture }));
  manager.assetCache.set('standing_stance', request);
  manager._disposeCachedAnimationAssets();
  assert.equal(manager.assetCache.size, 0);
  assert.equal(textureCount(), 0);
  finishLoad(asset);
  await request;
  await Promise.resolve();
  assert.equal(textureCount(), 1);
  manager._disposeCachedAnimationAssets();
  manager._disposeCachedAnimationAsset(asset);
  assert.equal(textureCount(), 1);
});

test('ordinary image/data sources and unrelated textures are not closed by source-cache cleanup', () => {
  let ordinaryClose = 0;
  const ordinaryImage = { width: 2, height: 2, close() { ordinaryClose += 1; } };
  const owned = new THREE.Texture(ordinaryImage);
  const unrelated = new THREE.Texture();
  const ownedCount = disposalCount(owned);
  const unrelatedCount = disposalCount(unrelated);
  const manager = managerWithoutRenderer();
  manager._disposeCachedAnimationAsset(sourceScene(new THREE.MeshStandardMaterial({ map: owned })));
  assert.equal(ownedCount(), 1);
  assert.equal(unrelatedCount(), 0);
  assert.equal(ordinaryClose, 0);
});
