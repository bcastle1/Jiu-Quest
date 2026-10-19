import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { getStorageStatus, loadState, saveState } from "../src/storage.js";

const originalWindow = globalThis.window;
let values;
beforeEach(() => {
  values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  loadState();
});
afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

test("saved customization and training survive a reload", () => {
  const state = loadState();
  state.fighters[0].giTop = "#7d52ff";
  state.fighters[0].progress["double-leg-takedown"] = 11;
  assert.equal(saveState(state).ok, true);
  const reloaded = loadState();
  assert.equal(reloaded.fighters[0].giTop, "#7d52ff");
  assert.equal(reloaded.fighters[0].progress["double-leg-takedown"], 11);
});

test("quota errors return useful failure feedback without deleting stored progress", () => {
  const state = loadState();
  saveState(state);
  const before = values.get("jiuquest:v1");
  window.localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
  const result = saveState(state);
  assert.equal(result.ok, false);
  assert.match(result.message, /storage is full/i);
  assert.equal(values.get("jiuquest:v1"), before);
});

test("blocked storage reads and writes produce recoverable status rather than throwing", () => {
  Object.defineProperty(window, "localStorage", { get: () => { throw new DOMException("Denied", "SecurityError"); } });
  const state = loadState();
  assert.ok(state.fighters.length);
  assert.equal(getStorageStatus().ok, false);
  assert.equal(saveState(state).ok, false);
});

test("unreadable saved JSON is preserved exactly before new progress replaces it", () => {
  const damaged = '{"fighters": [broken-json';
  values.set("jiuquest:v1", damaged);
  const state = loadState();
  assert.equal(getStorageStatus().error, "invalid-data");
  const saved = saveState(state);
  assert.equal(saved.ok, true);
  assert.equal(saved.recovered, true);
  assert.equal(values.get("jiuquest:v1:recovery"), damaged);
  assert.doesNotThrow(() => JSON.parse(values.get("jiuquest:v1")));
});

test("failed recovery backup never overwrites the original unreadable data", () => {
  const damaged = '{"original":';
  values.set("jiuquest:v1", damaged);
  const state = loadState();
  window.localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
  assert.equal(saveState(state).ok, false);
  assert.equal(values.get("jiuquest:v1"), damaged);
});

test("malformed collection entries do not discard the valid fighter or progress", () => {
  values.set("jiuquest:v1", JSON.stringify({
    selectedFighterId: "existing",
    fighters: [null, { id: "existing", name: "Existing fighter", progress: { "basic-tackle": 9 } }],
    npcs: [null],
    adminSettings: { music: { tracks: [null, "Custom track"] } },
  }));
  const state = loadState();
  assert.equal(state.fighters[0].id, "existing");
  assert.equal(state.fighters[0].progress["basic-tackle"], 9);
  assert.ok(state.npcs.length);
  assert.ok(state.adminSettings.music.tracks.some((track) => track.title === "Custom track"));
  assert.equal(saveState(state).ok, true);
});
