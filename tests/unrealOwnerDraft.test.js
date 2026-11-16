import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OWNER_PUBLISHED_DRAFT, isOwnerPublishedDraft, chooseTechniquePicture, techniqueClipReady } from '../src/unreal/techniquePicture.js';
import { UNREAL_CLIPS, unrealClipViews } from '../src/unreal/techniqueClips.js';
import { draftPublicationRow } from '../tools/publish_unreal_clip_draft.mjs';
import { selectEntries } from '../tools/import_unreal_clips.mjs';

const row = UNREAL_CLIPS.find(clip => clip.moveId === 'double_leg');
const entry = clip => ({ ...clip, file: `${clip.moveId}/${clip.performerSide}-${clip.camera}.mp4`, poster: `${clip.moveId}/${clip.performerSide}-${clip.camera}.webp` });
const viewsOf = clips => (move, side) => clips.filter(clip => clip.moveId === move && clip.performerSide === side);
const picture = (views, extra = {}) => chooseTechniquePicture({ moveId: 'double_leg', engine: 'unity', views, ...extra });

test('the one owner-approved draft keeps exact canonical files and never enters the acceptance list', () => {
  assert.ok(isOwnerPublishedDraft(row));
  assert.deepEqual(UNREAL_CLIPS.filter(clip => clip.draft), [row]);
  const video = readFileSync(new URL(`../public${row.video}`, import.meta.url));
  const poster = readFileSync(new URL(`../public${row.poster}`, import.meta.url));
  assert.deepEqual(draftPublicationRow(entry(row), video, poster), { ...row });
  assert.equal(row.choreographyReviewed, false);
  assert.equal(row.posterFrame, 63, 'the owner approved the exact canonical native mid-clip poster');
  // Publication is not acceptance: no acceptance line names this file or these bytes. Lines for
  // other clips are none of this test's business, so accepting another clip does not fail it.
  const acceptance = JSON.parse(readFileSync(new URL('../tools/unreal_clip_acceptance.json', import.meta.url)));
  assert.deepEqual(acceptance.filter(line => line.file === entry(row).file || line.sha256 === row.sha256), [], 'the draft has no acceptance line');
  const standard = selectEntries([entry(row)], [{ file: entry(row).file, sha256: row.sha256, acceptedOn: '2026-11-16' }]);
  assert.deepEqual(standard.selected, []);
  assert.deepEqual(standard.draftsLeftOut, ['double_leg/fighter-side.mp4']);
  assert.equal(techniqueClipReady('double_leg', unrealClipViews), false, 'publication is not bilateral technique readiness');
});

test('the exact fighter draft plays in Training and player wins only; old cameras and the rival are not borrowed', () => {
  assert.deepEqual(picture(unrealClipViews), { kind: 'clip', moveId: 'double_leg', performerSide: 'fighter', camera: 'side' });
  assert.deepEqual(picture(unrealClipViews, { performerSide: 'opponent' }), { kind: 'engine' });
  assert.deepEqual(unrealClipViews('double_leg').map(clip => clip.camera), ['side']);
  assert.deepEqual(unrealClipViews('double_leg', 'opponent'), []);
  for (const extra of [{ engine: 'unreal' }, { search: '?engine=unity' }, { search: '?engine=snapshot' }, { clipMoveId: null }, { performerSide: 'referee' }]) {
    assert.deepEqual(picture(unrealClipViews, extra), { kind: 'engine' });
  }
  const oldFront = { ...row, camera: 'front', sha256: '2c40431a41612bbefd14b287e3c6221b8c0c9644ac2c1130d9ebacb0c63d25f4' };
  const oldOpponent = { ...row, performerSide: 'opponent', sha256: 'c7ae687a643c293baf7b625b7e70d863c2a7c33d21428370d1e5869b5c11a2f8' };
  assert.deepEqual(picture(viewsOf([oldFront, oldOpponent])), { kind: 'engine' });
  assert.deepEqual(picture(viewsOf([row, oldOpponent]), { performerSide: 'opponent' }), { kind: 'engine' });
});

test('changing a pinned field cannot inherit the owner publication exception', () => {
  for (const change of [{ sha256: 'a'.repeat(64) }, { posterSha256: 'b'.repeat(64) }, { camera: 'front' }, { performerSide: 'opponent' }, { moveId: 'triangle_choke' }, { ownerDraftPublishedOn: '2026-11-15' }, { draft: false }, { choreographyReviewed: true }, { draftNotice: '' }]) {
    assert.equal(isOwnerPublishedDraft({ ...row, ...change }), false, JSON.stringify(change));
  }
  const video = readFileSync(new URL(`../public${row.video}`, import.meta.url));
  const poster = readFileSync(new URL(`../public${row.poster}`, import.meta.url));
  for (const change of [{ sha256: 'a'.repeat(64) }, { draft: false }, { choreographyReviewed: true }, { frames: 120 }, { loops: true }, { camera: 'front' }]) {
    assert.throws(() => draftPublicationRow(entry({ ...row, ...change }), video, poster));
  }
  assert.throws(() => draftPublicationRow(entry(row), Buffer.from('changed video'), poster));
  assert.throws(() => draftPublicationRow(entry(row), video, Buffer.from('changed poster')));
  assert.ok(Object.isFrozen(OWNER_PUBLISHED_DRAFT));
});

test('a draft is never a view a technique switches over with, and no draft but the pinned one is shown', () => {
  // The hook sweep needs the fighter's clips only, so one fighter view is all it waits for.
  // By the rule before this publication (any published view counts) a draft of it would have switched it over.
  const draft = { ...row, moveId: 'hook_sweep', video: '/assets/unreal-clips/hook_sweep/fighter-side.mp4', poster: '/assets/unreal-clips/hook_sweep/fighter-side.webp' };
  assert.equal(isOwnerPublishedDraft(draft), false, 'another technique does not inherit the exception');
  const pictureOf = clips => chooseTechniquePicture({ moveId: null, clipMoveId: 'hook_sweep', engine: 'unity', views: viewsOf(clips) });
  assert.equal(techniqueClipReady('hook_sweep', viewsOf([draft])), false, 'a draft alone does not switch a technique over');
  assert.deepEqual(pictureOf([draft]), { kind: 'engine' }, 'and a draft that is not the pinned one is not shown');
  // The same take, accepted, does.
  const accepted = { ...draft, draft: false };
  assert.equal(techniqueClipReady('hook_sweep', viewsOf([accepted])), true);
  assert.deepEqual(pictureOf([accepted]), { kind: 'clip', moveId: 'hook_sweep', performerSide: 'fighter', camera: 'side' });
  // An accepted view beside a draft: the technique plays, and opens on the accepted view, not the draft.
  const front = { ...accepted, camera: 'front' };
  assert.equal(techniqueClipReady('hook_sweep', viewsOf([draft, front])), true);
  assert.deepEqual(pictureOf([draft, front]), { kind: 'clip', moveId: 'hook_sweep', performerSide: 'fighter', camera: 'front' });
});
