import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STANCE, STANDARD_STANCE_MOVE, UNREAL_STANCES, findStance, stanceCopy, stanceEntry, stanceLoop } from '../src/unreal/stances.js';
import { createFighter, customizationOptions, defaultNpcs } from '../src/storage.js';
import { findUnrealClip } from '../src/unreal/techniqueClips.js';

const source = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
// A stand-in for the published clip list: these clips exist, nothing else does.
const rendered = (...names) => (moveId, performerSide = 'fighter', camera = 'side') =>
  (names.includes(`${moveId}/${performerSide}`) ? { moveId, performerSide, camera } : null);

test('every stance a player can pick has an id, a picture, a line of copy and clip names', () => {
  assert.deepEqual(UNREAL_STANCES.map((stance) => stance.stance), customizationOptions.stances);
  assert.equal(new Set(UNREAL_STANCES.map((stance) => stance.id)).size, UNREAL_STANCES.length);
  for (const stance of UNREAL_STANCES) {
    // The importer accepts only lower-case letters and underscores in a clip's move name.
    assert.match(stance.id, /^[a-z][a-z_]*$/, stance.stance);
    assert.match(stance.label, /^[A-Z][A-Za-z]*( [A-Z][A-Za-z]*)+$/, stance.stance);
    assert.equal(stance.label.toLowerCase(), stance.stance);
    assert.equal(stance.copy, stanceCopy[stance.stance]);
    assert.ok(stance.copy.length > 8, `${stance.stance} says what it is for`);
    assert.match(stance.picture, /^\/assets\/unreal-stances\/[a-z-]+\.webp$/);
    assert.deepEqual([stance.width, stance.height], [480, 600]);
    assert.throws(() => { stance.id = 'changed'; }, TypeError);
  }
  assert.throws(() => { UNREAL_STANCES.push({}); }, TypeError);
  assert.deepEqual(Object.keys(stanceCopy), customizationOptions.stances);
});

test('the wrestling stance is the standard one; every other stance has its own loop and entry clip names', () => {
  assert.equal(DEFAULT_STANCE, 'wrestling stance');
  assert.equal(STANDARD_STANCE_MOVE, 'standing_stance');
  assert.equal(createFighter().stance, DEFAULT_STANCE, 'a new fighter starts in the standard stance');
  const names = Object.fromEntries(UNREAL_STANCES.map((stance) => [stance.stance, [stance.loopMoveId, stance.entryMoveId]]));
  assert.deepEqual(names, {
    'wrestling stance': ['standing_stance', null],
    'sumo base': ['stance_sumo', 'enter_sumo'],
    'boxer shell': ['stance_boxing', 'enter_boxing'],
    'karate stance': ['stance_karate', 'enter_karate'],
    'muay thai guard': ['stance_muay_thai', 'enter_muay_thai'],
    'sambo crouch': ['stance_sambo', 'enter_sambo'],
    'capoeira rhythm': ['stance_capoeira', 'enter_capoeira'],
  });
});

test('a stance nobody offers is read as the standard one', () => {
  for (const stance of [undefined, null, '', 'judo base', 'Karate Stance', '__proto__', 42]) {
    assert.equal(findStance(stance).stance, DEFAULT_STANCE, String(stance));
  }
  assert.equal(findStance('karate stance').id, 'karate');
});

test('the standing clip follows the player\'s stance once Unreal has rendered it', () => {
  const nothing = rendered();
  assert.deepEqual(stanceLoop('wrestling stance', 'wrestling stance', nothing), { moveId: 'standing_stance', performerSide: 'fighter', stance: 'wrestling stance', exact: true });
  // Not rendered yet: the standard clip, and the page is told it is not the stance asked for.
  assert.deepEqual(stanceLoop('karate stance', 'sumo base', nothing), { moveId: 'standing_stance', performerSide: 'fighter', stance: 'karate stance', exact: false });
  // Rendered: the player's athlete holds it.
  assert.deepEqual(stanceLoop('karate stance', 'wrestling stance', rendered('stance_karate/fighter')), { moveId: 'stance_karate', performerSide: 'fighter', stance: 'karate stance', exact: true });
  // The player's own stance comes before a rival's.
  assert.deepEqual(stanceLoop('karate stance', 'sumo base', rendered('stance_karate/fighter', 'stance_sumo/opponent')).moveId, 'stance_karate');
  // A rival's stance shows only beside a player in the standard one, from the rival's own render.
  assert.deepEqual(stanceLoop('wrestling stance', 'sumo base', rendered('stance_sumo/opponent')), { moveId: 'stance_sumo', performerSide: 'opponent', stance: 'wrestling stance', exact: true });
  assert.equal(stanceLoop('wrestling stance', 'sumo base', rendered('stance_sumo/fighter')).moveId, 'standing_stance', 'the player\'s render is not borrowed for the rival');
  assert.deepEqual(stanceLoop('karate stance', 'sumo base', rendered('stance_sumo/opponent')), { moveId: 'standing_stance', performerSide: 'fighter', stance: 'karate stance', exact: false });
  // Unknown values never pick a clip of their own.
  assert.equal(stanceLoop('__proto__', undefined, rendered('stance___proto__/fighter')).moveId, 'standing_stance');
});

test('whatever stance is chosen, the clip it leads to is one that is published', () => {
  for (const mine of customizationOptions.stances) {
    for (const theirs of [DEFAULT_STANCE, ...defaultNpcs.map((npc) => npc.stance)]) {
      const choice = stanceLoop(mine, theirs);
      assert.ok(findUnrealClip(choice.moveId, choice.performerSide), `${mine} against ${theirs} leads to ${choice.moveId}/${choice.performerSide}`);
      assert.equal(choice.stance, mine);
    }
  }
});

test('an entry clip is offered only for a stance other than the standard one, and only when it exists', () => {
  const everything = (moveId, performerSide, camera) => ({ moveId, performerSide, camera });
  assert.equal(stanceEntry('wrestling stance', 'side', everything), null);
  assert.deepEqual(stanceEntry('karate stance', 'front', everything), { moveId: 'enter_karate', performerSide: 'fighter', camera: 'front' });
  assert.equal(stanceEntry('karate stance', 'side', rendered()), null);
  for (const stance of customizationOptions.stances) assert.equal(stanceEntry(stance), null, `${stance} has no entry clip published yet`);
});

test('the Arena offers the stance picker only while the stance is what shows', () => {
  const arena = source('src/components/CombatArenaView.jsx');
  assert.match(arena, /const idleStanding = !combat\.result && combat\.position === 'standing';/);
  assert.match(arena, /<GrapplingStage\s+idleStanding=\{idleStanding\}/);
  assert.match(arena, /\{idleStanding && onStanceChange && \(\s*<StancePicker\s+value=\{fighter\.stance\}/);
  // Choosing one changes the fighter's stance, the same field the Profile edits.
  assert.match(source('src/App.jsx'), /onStanceChange=\{\(stance\) => updateFighter\(\{ stance \}\)\}/);
  assert.match(source('src/App.jsx'), /onChange=\{\(stance\) => updateFighter\(\{ stance \}\)\}/);
  // The picker is pictures and radio buttons, with no clip, renderer or storage code of its own.
  const imports = [...source('src/components/StancePicker.jsx').matchAll(/^import (?:[^'"]* from )?['"]([^'"]+)['"];?$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ['react', '../unreal/stances.js', './StancePicker.css']);
  assert.deepEqual([...source('src/unreal/stances.js').matchAll(/^import (?:[^'"]* from )?['"]([^'"]+)['"];?$/gm)].map((match) => match[1]), ['./stancePictures.data.js', './techniqueClips.js']);
});

test('the importer leaves out a clip its maker marked as a draft', () => {
  const importer = source('tools/import_unreal_clips.py');
  assert.match(importer, /if entry\.get\("draft"\):\s+held\.append\(entry\["file"\]\)\s+continue/);
  assert.match(importer, /"draftsLeftOut": held/);
});
