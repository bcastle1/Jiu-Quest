// Build the technique sheet: what the Unreal renderer animates from.
//
// Writes two files into a folder:
//
//   TECHNIQUE-SHEET.md    how clip files are named, an index of every technique,
//                         the techniques by starting position, then one section
//                         per technique with its numbered steps
//   TECHNIQUE-SHEET.json  the same techniques for programs
//
// Every curriculum technique is listed under its Unreal clip id, the folder its
// clips go in (src/unreal/techniqueIds.js). Names, lessons, scenarios and steps
// are the owner's approved wording. They are copied from src/data character for
// character: never trimmed, re-quoted, re-punctuated or corrected, and never
// escaped for Markdown, so the markdown file reads exactly as text.
//
// Each technique is rendered from one position, the first it starts in: its
// "Render from" position. The sheet also works out, with the game's own rules
// (src/arena/outcome.js), where the next exchange starts after each performer
// wins with it from there, and says so wherever that is not its "Ends in".
//
// Each technique also says whose clips it needs: both performers, or the
// fighter alone for a technique the rival never performs from its Render from
// position (techniqueClipPerformers in src/unreal/techniquePicture.js), and why,
// and which view the site opens it on (TECHNIQUE_OPENING_CAMERA there). The
// "Clip files" section says how a clip ends, what the importer
// (tools/import_unreal_clips.mjs) requires of every delivered clip, and that a
// delivered entry that is not a draft and fails any of those checks but the
// acceptance line stops the whole import.
//
// Usage:
//   node tools/build_technique_sheet.mjs <output dir>
//
// The folder is created if it is missing. Node only, no Python. Needs git, for
// the commit the sheet is made from.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createArenaState, getPositionForSide, isArenaCounterApplicable, resolveArenaOutcome } from '../src/arena/outcome.js';
import { resolveUnityMove } from '../src/unity/bridge.js';
import { unrealClipMoveId, unrealClipStart } from '../src/unreal/techniqueIds.js';
import { TECHNIQUE_OPENING_CAMERA, techniqueClipPerformers, techniqueClipReady } from '../src/unreal/techniquePicture.js';
import { CAMERAS, PERFORMERS } from './import_unreal_clips.mjs';

export const SHEET_MARKDOWN = 'TECHNIQUE-SHEET.md';
export const SHEET_JSON = 'TECHNIQUE-SHEET.json';
// The name the importer takes a clip file under (tools/import_unreal_clips.mjs).
export const CLIP_FILE_PATTERN = '<clipId>/<performer>-<camera>.mp4';
const TOOL = 'tools/build_technique_sheet.mjs';
// What the sheet is made from: the curriculum, the game's rules for where an
// exchange leaves the athletes, the Unity move table, the clip id rule, the rule
// for whose clips a technique needs, the published clip list, the importer's
// performers and cameras, and this tool. The sheet says so when any of them
// differs from its commit.
const SOURCES = ['src/data', 'src/arena/outcome.js', 'src/unity/bridge.js', 'src/unreal/techniqueIds.js', 'src/unreal/techniquePicture.js', 'src/unreal/techniqueClips.data.js', 'tools/import_unreal_clips.mjs', TOOL];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The game's own rules for where an exchange leaves the athletes.
const ARENA = Object.freeze({ createArenaState, getPositionForSide, isArenaCounterApplicable, resolveArenaOutcome });
// What the other athlete is taken to play while a technique wins: the rival's
// fallback, which the game offers in every position. The other athlete's
// technique matters only to a counter, which wins only against the attack it
// answers, so a counter is worked out against that attack instead.
const NEUTRAL_MOVE = 'protect-position';
// The technique whose file names the sheet spells out: the first one rendered.
const EXAMPLE = 'rear_naked_choke';
// The belt of the starters. Training does not list them: its belt tabs are
// BELTS.slice(1), each listing the curriculum's `moves` of that belt (src/App.jsx),
// so their clips play only in the Arena. The rival knows every technique of
// this belt, preview or not (chooseNpcMove in src/App.jsx).
const STARTER_BELT = 'white';
// Why a technique needs the fighter's clips only. The rival never uses a preview
// technique above the starters' belt (chooseNpcMove in src/App.jsx, which
// tests/unrealRivalReach.test.js runs as written). Any other technique the rival
// never performs from its Render from position starts where the rival never is
// (tests/techniqueSheet.test.js checks that in the game).
const PREVIEW_REASON = 'The rival never uses preview techniques';
// Where the site takes delivered clips in, and the list it takes them by.
const IMPORTER = 'tools/import_unreal_clips.mjs';
const ACCEPTANCE = 'tools/unreal_clip_acceptance.json';

const fail = (message) => { throw new Error(message); };
const code = (text) => `\`${text}\``;
const yesNo = (value) => (value ? 'yes' : 'no');
// "a", "a and b", "a, b and c".
const andList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// Copied text sits on one line of the sheet, unchanged, and runs to the end of
// that line. A line break inside it would split the line, so it is refused
// rather than altered.
function copied(text, what) {
  if (typeof text !== 'string') fail(`${what} must be text`);
  if (/[\r\n]/.test(text)) fail(`${what} has a line break, which the sheet cannot show unchanged`);
  return text;
}
// Text the curriculum may leave out: null when it does.
const optional = (text, what) => (text === undefined || text === null ? null : copied(text, what));
// The cameras of a technique's published views for one performer, in the
// importer's camera order: what the site finds in the clip list.
const publishedViews = (clips, clipId, performer) => CAMERAS.filter((camera) => clips.some((clip) => clip.moveId === clipId && clip.performerSide === performer && clip.camera === camera));
// The names the importer takes a technique's clips under (CLIP_FILE_PATTERN),
// for the performers given, in the importer's order of performers and cameras.
const fileNames = (clipId, performers) => PERFORMERS.filter((performer) => performers.includes(performer))
  .flatMap((performer) => CAMERAS.map((camera) => `${clipId}/${performer}-${camera}.mp4`));

// The view the site opens a technique on, as soon as that view is published
// (chooseTechniquePicture in src/unreal/techniquePicture.js): the technique's
// own in TECHNIQUE_OPENING_CAMERA, otherwise the first camera, side. Until then
// it opens on the other one.
function openingCamera(clipId, where) {
  const camera = Object.hasOwn(TECHNIQUE_OPENING_CAMERA, clipId) ? TECHNIQUE_OPENING_CAMERA[clipId] : CAMERAS[0];
  if (!CAMERAS.includes(camera)) fail(`${where} opens on the ${camera} view, which the importer does not take`);
  return camera;
}

// The position the game starts the next exchange in, named from the performer's
// side, after the performer wins with `move` from its Render from position
// `from`: worked out by the game's own rules (`arena`). The other athlete plays
// the first technique in `against` the game lets `move` win against. Null when
// the game never starts that win: it never names the performer's position that
// way, or nothing in `against` is an attack the counter answers.
function continuesFrom(move, from, performer, { arena, against }) {
  const before = arena.createArenaState(from, performer);
  if (arena.getPositionForSide(before, performer) !== from) return null;
  const opposingMove = against.find((other) => arena.isArenaCounterApplicable(move, before, other, performer));
  if (opposingMove === undefined) return null;
  return arena.getPositionForSide(arena.resolveArenaOutcome(before, move, performer, { opposingMove }), performer);
}

// Why `move` needs the fighter's clips only, or null when it needs both
// performers'. `needed` is whose clips the site waits for before the technique
// plays clips (techniqueClipPerformers); `renderFrom` is where its clips start.
function fighterOnlyReason(move, needed, renderFrom, where) {
  if (needed.length === PERFORMERS.length && PERFORMERS.every((performer) => needed.includes(performer))) return null;
  if (needed.length !== 1 || needed[0] !== 'fighter') fail(`${where}: the sheet cannot say why it needs clips of ${needed.join(', ') || 'no performer'}`);
  if (move.preview && move.belt !== STARTER_BELT) return PREVIEW_REASON;
  if (renderFrom === null) fail(`${where} needs a fighter clip only, but has no Render from position the rival could never be in`);
  return `The rival is never in ${renderFrom.label ?? code(renderFrom.id)} in the game`;
}

// One technique as the JSON file lists it. Pure.
function describe(move, index, positionLabels, clips, game) {
  const where = `technique ${JSON.stringify(move?.id)}`;
  const clipId = unrealClipMoveId(move?.id);
  if (clipId === null) fail(`${where} has no clip id`);
  if (!Array.isArray(move.starts) || !Array.isArray(move.steps)) fail(`${where} needs starts and steps`);
  const position = (id) => ({ id, label: Object.hasOwn(positionLabels, id) ? positionLabels[id] : null });
  // Where its clips start: the first position it starts in, by the rule the
  // Arena plays clips by.
  const start = unrealClipStart(move);
  const renderFrom = start === null ? null : position(start);
  // Whose clips the site waits for, by its own rule.
  const clipsNeeded = [...techniqueClipPerformers(clipId)];
  const name = copied(move.name, `${where}: name`);
  // The index is a table, and a table cell ends at a bar.
  if (name.includes('|')) fail(`${where}: name has a "|", which the index table cannot show unchanged`);
  return {
    number: index + 1,
    clipId,
    curriculumId: move.id,
    name,
    belt: move.belt,
    lesson: optional(move.lesson, `${where}: lesson`),
    // The heading the approved guide files a technique under: where the athlete
    // who performs it starts. The site shows it where a lesson name would be.
    guideStartingPosition: optional(move.startingPosition, `${where}: starting position`),
    category: move.category,
    scenario: optional(move.scenario, `${where}: scenario`),
    starts: move.starts.map(position),
    endsIn: move.endsIn === undefined || move.endsIn === null ? null : position(move.endsIn),
    isSubmission: move.isSubmission === true,
    steps: move.steps.map((step, at) => copied(step, `${where}: step ${at + 1}`)),
    unityAnimationToday: resolveUnityMove(move.id) !== null,
    unrealClipsToday: Object.fromEntries(PERFORMERS.map((performer) => [performer, publishedViews(clips, clipId, performer)])),
    // Every name the importer takes a clip of the technique under.
    clipFileNames: fileNames(clipId, PERFORMERS),
    // After any other start the site shows the position picture instead.
    renderFrom,
    otherStarts: move.starts.slice(1).map(position),
    gameContinuesFrom: Object.fromEntries(PERFORMERS.map((performer) => {
      const place = start === null ? null : continuesFrom(move, start, performer, game);
      return [performer, place === null ? null : position(place)];
    })),
    clipsNeeded,
    fighterOnlyReason: fighterOnlyReason(move, clipsNeeded, renderFrom, where),
    // The names of the clips it needs: those of the performers in clipsNeeded.
    clipFilesNeeded: fileNames(clipId, clipsNeeded),
    opensOn: openingCamera(clipId, where),
  };
}

const hasClip = (technique, performer) => technique.unrealClipsToday[performer].length > 0;
const clipsText = (technique) => (PERFORMERS.some((performer) => hasClip(technique, performer))
  ? PERFORMERS.map((performer) => `${performer}: ${technique.unrealClipsToday[performer].join(', ') || 'none'}`).join('; ')
  : 'none');
// Whose clips a technique needs, in the index and in its section.
const needsBoth = (technique) => technique.fighterOnlyReason === null;
const neededCell = (technique) => (needsBoth(technique) ? 'fighter and opponent' : 'fighter only');
const neededLine = (technique) => `- Clips needed: ${needsBoth(technique)
  ? 'fighter and opponent.'
  : `fighter only. ${technique.fighterOnlyReason}, so an opponent clip would never be shown.`}`;
// The view the site opens the technique on: its opening view once one is
// published, the other until then. A technique with no opening view of its own
// in TECHNIQUE_OPENING_CAMERA opens on the side view, or on the front view
// where that is the only one.
const opensOnLine = ({ clipId, opensOn }) => `- The site opens on: the ${opensOn} view once one is published; the ${CAMERAS.find((camera) => camera !== opensOn)} view ${Object.hasOwn(TECHNIQUE_OPENING_CAMERA, clipId) ? 'until then' : 'if it is the only one'}.`;
// Whether Unity has an animation of the technique: a fact about Unity. The
// site plays it until the technique's Unreal clips switch on.
const unityLine = (technique) => `- Unity animation: ${technique.unityAnimationToday ? "yes. The site plays it until this technique's Unreal clips switch on." : 'no'}`;
const positionText = ({ id, label }) => (label === null ? `${code(id)} (no label)` : `${label} (${code(id)})`);
// What the markdown shows where the curriculum has no text. In brackets, so it
// never reads as the curriculum's own wording.
const orNone = (text) => (text === null || text === '' ? '(the curriculum gives none)' : text);
// Where the curriculum has a technique end: its Ends in position, or the
// position it is rendered from when it gives none.
const endsAt = (technique) => technique.endsIn ?? technique.renderFrom;
// Whether the game starts the next exchange anywhere else, for either performer.
const continuesElsewhere = (technique) => technique.renderFrom !== null
  && PERFORMERS.some((performer) => technique.gameContinuesFrom[performer]?.id !== endsAt(technique).id);
const continuesText = (place) => (place === null ? 'nowhere, because the game never lets it win from its Render from position' : positionText(place));
// One position for both performers, or each performer's own.
function continuesLine(technique) {
  const places = PERFORMERS.map((performer) => technique.gameContinuesFrom[performer]);
  const same = places.every((place) => place?.id === places[0]?.id);
  return `- In the game the next exchange starts from: ${same
    ? continuesText(places[0])
    : PERFORMERS.map((performer, at) => `${continuesText(places[at])} when ${code(performer)} performs it`).join('; ')}`;
}

// Pure: the text of both files, from the curriculum (`moves`, `positionLabels`),
// the published clip list (`clips`) and the commit they were read at.
// `uncommitted` says the files the sheet is made from held changes that commit
// does not have. `arena` is the game's rules for where an exchange leaves the
// athletes (src/arena/outcome.js); only a test gives other rules. Returns
// { markdown, json }: what is written to TECHNIQUE-SHEET.md and
// TECHNIQUE-SHEET.json, with "\n" line ends.
export function buildTechniqueSheet({ moves, positionLabels, clips, commit, uncommitted = false, arena = ARENA }) {
  if (!Array.isArray(moves) || !Array.isArray(clips) || positionLabels === null || typeof positionLabels !== 'object') {
    fail('the technique sheet needs moves (a list), positionLabels (an object) and clips (a list)');
  }
  if (typeof commit !== 'string' || commit === '') fail('the technique sheet needs the commit it is made from');
  if (Object.keys(ARENA).some((rule) => typeof arena?.[rule] !== 'function')) fail(`the technique sheet needs the game's rules: ${Object.keys(ARENA).join(', ')}`);

  // The other athlete plays the neutral technique, or none where the moves do
  // not have it; a counter plays against the first technique it answers.
  const neutral = moves.find((move) => move?.id === NEUTRAL_MOVE) ?? null;
  const game = { arena, against: [neutral, ...moves] };
  const techniques = moves.map((move, index) => describe(move, index, positionLabels, clips, game));
  const seen = new Map();
  for (const technique of techniques) {
    if (seen.has(technique.clipId)) fail(`${technique.curriculumId} and ${seen.get(technique.clipId)} share the clip id ${technique.clipId}`);
    seen.set(technique.clipId, technique.curriculumId);
  }

  // A technique that starts in every position the game names is listed once,
  // as starting anywhere, instead of under every position.
  const named = Object.keys(positionLabels);
  const anywhere = (technique) => named.length > 0 && named.every((id) => technique.starts.some((start) => start.id === id));
  const startsText = (technique) => (anywhere(technique) ? 'Every position' : technique.starts.map((start) => start.label ?? code(start.id)).join(', ') || 'none');

  const stepCount = techniques.reduce((count, technique) => count + technique.steps.length, 0);
  const made = `commit ${code(commit)}${uncommitted ? ', plus uncommitted changes to the files it is made from' : ''}`;
  const example = techniques.some((technique) => technique.clipId === EXAMPLE) ? EXAMPLE : techniques[0]?.clipId ?? 'clip_id';
  // The techniques that play their Unreal clips today, by the site's own rule
  // on the published clip list.
  const playing = techniques.filter((technique) => techniqueClipReady(technique.clipId, (clipId, performer) => publishedViews(clips, clipId, performer)));
  const fighterOnly = techniques.filter((technique) => !needsBoth(technique));
  const starters = techniques.filter((technique) => technique.belt === STARTER_BELT);

  const lines = [
    '# JiuQuest technique sheet',
    '',
    `Generated by ${code(TOOL)} from the JiuQuest site's curriculum (${code('src/data')}) at ${made}. Do not edit this file: run the tool again.`,
    '',
    "The name, lesson, scenario and steps of every technique are the owner's approved wording, copied character for character. They must not be changed. Nothing is corrected here: where the wording looks like a slip, that is how the curriculum has it.",
    '',
    `${code(SHEET_JSON)}, beside this file, holds the same techniques for programs.`,
    '',
    `Techniques: ${techniques.length}. Steps: ${stepCount}. With a Unity animation: ${techniques.filter((technique) => technique.unityAnimationToday).length}. Playing Unreal clips today: ${playing.length}. Needing fighter and opponent clips: ${techniques.length - fighterOnly.length}. Needing fighter clips only: ${fighterOnly.length}.`,
    '',
    '## Clip files',
    '',
    `A technique's clips are named ${code(CLIP_FILE_PATTERN)}.`,
    '',
    `- ${code('<clipId>')} is the technique's clip id: the id in its heading below and in the "Clip id" column of the index. It is also the ${code('moveId')} its clips carry in the render pack's clip list. It is not the curriculum id.`,
    `- ${code('<performer>')} is who performs the technique: ${code('fighter')} when the player's athlete performs it on the rival, ${code('opponent')} when the rival performs it on the player's athlete.`,
    `- ${code('<camera>')} is ${CAMERAS.map(code).join(' or ')}.`,
    '',
    `For example, ${code(example)} can have these clips:`,
    '',
    ...PERFORMERS.flatMap((performer) => CAMERAS.map((camera) => `    ${example}/${performer}-${camera}.mp4`)),
    '',
    `The steps and scenarios speak to the performer: "you" is the athlete who performs the technique and "the opponent" is the other athlete. So in an ${code('opponent')} clip, "you" is the rival.`,
    '',
    `Each technique is rendered from one position, its "Render from" position: the first position it starts in. Every clip of the technique starts there, for both performers and both cameras. Training shows the technique in that position${starters.length
      ? `, except the ${STARTER_BELT}-belt starters (${andList(starters.map((technique) => code(technique.clipId)))}): Training does not list them, so their clips play only in the Arena`
      : ''}. The Arena plays a technique's clip only after an exchange that started in its "Render from" position. Where the game also offers a technique from other positions, the site shows the position picture after those, not the clip.`,
    '',
    'Every clip ends on the finish its approved steps describe. For a technique that is not a submission, that finish is its "Ends in" position ("none": its "Render from" position), and the game continues from there. Where the game would continue from another position, the technique\'s section says so in a line "In the game the next exchange starts from".',
    '',
    `A submission does not move the athletes in the game (${code('src/arena/outcome.js')}): when it does not end the match, the next exchange starts again from its "Render from" position. Its clip still ends on the approved finish, also where the steps leave the start position.`,
    '',
    `The sheet works out where the game continues with the game's own rules (${code('src/arena/outcome.js')}): each performer wins with the technique from its "Render from" position${neutral ? ` while the other athlete plays ${neutral.name} (${code(unrealClipMoveId(neutral.id))})` : ''}. The other athlete's technique matters only to a counter, which the game lets win only against the attack it answers, so a counter is worked out against that attack.`,
    '',
    `Training plays only the ${code('fighter')} clip of a technique. An ${code('opponent')} clip shows only in the Arena, after the rival wins with the technique in an exchange that started in its "Render from" position. The rival never does that with a preview technique, because it never uses preview techniques, nor with a technique whose "Render from" position it is never in. An ${code('opponent')} clip of such a technique would never be shown, so it needs ${code('fighter')} clips only, and its section says "Clips needed: fighter only." and why. Every other technique needs clips of both performers: "Clips needed: fighter and opponent."`,
    '',
    `The site switches a technique to its Unreal clips once every performer it needs has at least one published view: both performers, or the ${code('fighter')} alone for a technique that needs ${code('fighter')} clips only. Until then the site plays the technique's Unity animation where Unity has one ("Unity animation: yes"), and otherwise shows the position picture.`,
    '',
    `Each technique's "The site opens on" line gives the view its clips open on until the viewer picks the other one with the Side and Front buttons. That pick then carries over to every later technique clip on the same screen, in Training or in the Arena, wherever that view is published.`,
    '',
    `What the site's importer (${code(IMPORTER)}) requires of every delivered technique clip. It publishes a clip only when all of these hold:`,
    '',
    `- An entry for the clip in the render pack's ${code('clips/technique-clips.json')}, with its ${andList(['moveId', 'performerSide', 'camera', 'file', 'poster', 'bytes', 'sha256', 'width', 'height', 'fps', 'frames', 'durationSeconds'].map(code))}. Its ${code('moveId')} is the clip id, and the file's size and SHA-256 are the entry's. There is one entry per clip that is not a draft: a new take replaces the old entry, or the old entry is marked ${code('"draft": true')}.`,
    `- ${code('"loops": false')} and ${code('"draft": false')}. An entry marked ${code('"draft": true')} is left out.`,
    `- A poster of the same name beside each ${code('.mp4')}, ${code('<clipId>/<performer>-<camera>.webp')}, with the same pixel size as the video. For a technique clip the site cuts its own poster from frame 0 of the video, but the pack's poster must exist.`,
    `- H.264, High profile, ${code('yuv420p')}, one video stream and nothing else (no sound), the index before the media (fast start), and the picture size, frame rate and frame count its entry gives.`,
    `- ${code('frames')} and ${code('fps')} that match ${code('durationSeconds')}: frames divided by fps is the duration, to a thousandth of a second.`,
    `- The same frame count for every view of one performer: a technique's ${code('fighter-side')} and ${code('fighter-front')} clips are the same length, and so are its two ${code('opponent')} clips.`,
    `- An acceptance line for that exact file and SHA-256 in the site's ${code(ACCEPTANCE)}, which Claude writes after reviewing the clip. Until then the importer leaves the clip out.`,
    '',
    `A delivered entry that is not a draft and fails any of these checks, other than a missing acceptance line, stops the whole import, so no clip in the pack is published until it is fixed or marked ${code('"draft": true')}. The importer checks every entry that is not a draft as it reads ${code('clips/technique-clips.json')}, and a clip's own files (the video, with its size and SHA-256, and the poster) once the clip has its acceptance line. Deliver a take that is not ready with ${code('"draft": true')}.`,
    '',
    '## Index',
    '',
    `Every technique, in curriculum order. "#" is the number of its section below. "Starts in" and "Ends in" are the game's positions, named for where the athlete who performs the technique is; "none" means the technique leaves the position as it was. "Unity animation" says whether Unity has an animation of the technique, which the site plays until the technique's Unreal clips switch on. "Clips needed" says whose clips the technique needs: "fighter and opponent" for ${techniques.length - fighterOnly.length} of them and "fighter only" for ${fighterOnly.length}, as "Clip files" explains. "Unreal clips today" lists the published views of each performer.`,
    '',
    '| # | Clip id | Name | Belt | Starts in | Ends in | Steps | Unity animation | Clips needed | Unreal clips today |',
    '| ---: | --- | --- | --- | --- | --- | ---: | --- | --- | --- |',
    ...techniques.map((technique) => `| ${[
      technique.number, code(technique.clipId), technique.name, technique.belt, startsText(technique),
      technique.endsIn ? technique.endsIn.label ?? code(technique.endsIn.id) : 'none',
      technique.steps.length, yesNo(technique.unityAnimationToday), neededCell(technique), clipsText(technique),
    ].join(' | ')} |`),
    '',
    '## By starting position',
    '',
    `Techniques that start in the same position can share a starting pose. A technique is listed under every position the game offers it from, but its clips start only in its "Render from" position, the first of them. The game's positions are broad: before two techniques share a pose, compare their scenarios and, where they have one, their starting positions in the approved guide.`,
    '',
  ];

  const order = [...named];
  for (const technique of techniques) for (const start of technique.starts) if (!order.includes(start.id)) order.push(start.id);
  for (const id of order) {
    const here = techniques.filter((technique) => !anywhere(technique) && technique.starts.some((start) => start.id === id));
    if (here.length) lines.push(`- ${positionText({ id, label: Object.hasOwn(positionLabels, id) ? positionLabels[id] : null })}: ${here.map((technique) => code(technique.clipId)).join(', ')}`);
  }
  const everywhere = techniques.filter(anywhere);
  if (everywhere.length) lines.push(`- Every position: ${everywhere.map((technique) => code(technique.clipId)).join(', ')}`);

  lines.push('', '## Techniques', '');
  for (const [index, technique] of techniques.entries()) {
    lines.push(
      `### ${technique.number}. ${code(technique.clipId)}: ${technique.name}`,
      '',
      `- Clip files: ${code(`${technique.clipId}/<performer>-<camera>.mp4`)}`,
      neededLine(technique),
      opensOnLine(technique),
      ...(technique.belt === STARTER_BELT ? [`- Training does not list it (a ${STARTER_BELT}-belt starter), so its clips play only in the Arena.`] : []),
      `- Curriculum id (not used in file names): ${code(technique.curriculumId)}`,
      `- Belt: ${technique.belt}; category: ${technique.category}; is a submission: ${yesNo(technique.isSubmission)}`,
    );
    // A technique from the approved guide has no lesson name: the guide files it
    // under the position its performer starts in.
    if (technique.lesson !== null || technique.guideStartingPosition === null) lines.push(`- Lesson: ${orNone(technique.lesson)}`);
    if (technique.guideStartingPosition !== null) lines.push(`- Starting position in the approved guide: ${orNone(technique.guideStartingPosition)}`);
    lines.push(
      `- Starts in: ${anywhere(technique) ? `every position (${technique.starts.length}): ` : ''}${technique.starts.map(positionText).join(', ') || 'none'}`,
      `- Render from: ${technique.renderFrom ? positionText(technique.renderFrom) : 'none'}`,
      ...(technique.otherStarts.length
        ? [`- The game also offers it from: ${technique.otherStarts.map((start) => start.label ?? code(start.id)).join(', ')}. After those starts the site shows its position picture, not this clip.`]
        : []),
      `- Ends in: ${technique.endsIn ? positionText(technique.endsIn) : 'none (the position stays as it was)'}`,
      ...(continuesElsewhere(technique) ? [continuesLine(technique)] : []),
      unityLine(technique),
      `- Unreal clips today: ${clipsText(technique)}`,
      `- Scenario: ${orNone(technique.scenario)}`,
      '',
      'Steps:',
      '',
      ...technique.steps.map((step, at) => `${at + 1}. ${step}`),
    );
    // The approved guide numbers its own steps, and not always 1, 2, 3.
    const labels = moves[index].stepDetails?.map((step) => step?.label);
    if (labels?.some((label, at) => label !== `${at + 1}.`)) lines.push('', `Step numbers in the approved guide: ${labels.join(' ')}`);
    lines.push('');
  }

  const data = {
    generatedBy: TOOL,
    commit,
    uncommittedChanges: Boolean(uncommitted),
    notice: "Generated file: do not edit it, run the tool again. In each technique, clipFileNames lists every file name the site's importer (tools/import_unreal_clips.mjs) accepts for its clips, and clipFilesNeeded only the names for the performers in clipsNeeded, the only clips of that technique the site ever shows. The site switches a technique to its clips once each performer in clipsNeeded has at least one of these views published: side views first, front views can follow. The name, lesson, scenario and steps of every technique are the owner's approved wording, copied character for character from the curriculum (src/data). They must not be changed.",
    clipFilePattern: CLIP_FILE_PATTERN,
    performers: [...PERFORMERS],
    cameras: [...CAMERAS],
    techniques,
  };
  return { markdown: lines.join('\n'), json: `${JSON.stringify(data, null, 2)}\n` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('-')) {
    console.error('usage: node tools/build_technique_sheet.mjs <output dir>');
    process.exit(2);
  }
  const out = path.resolve(args[0]);
  const git = (...command) => execFileSync('git', command, { cwd: ROOT, encoding: 'utf8' }).trim();
  const [{ allMoves, positionLabels }, { default: clips }] = await Promise.all([
    import('../src/data/curriculum.js'), import('../src/unreal/techniqueClips.data.js'),
  ]);
  const commit = git('rev-parse', '--short', 'HEAD');
  const uncommitted = git('status', '--porcelain', '--', ...SOURCES) !== '';
  const { markdown, json } = buildTechniqueSheet({ moves: allMoves, positionLabels, clips, commit, uncommitted });
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, SHEET_MARKDOWN), markdown);
  writeFileSync(path.join(out, SHEET_JSON), json);
  console.log(JSON.stringify({
    markdown: path.join(out, SHEET_MARKDOWN), json: path.join(out, SHEET_JSON),
    techniques: allMoves.length, steps: allMoves.reduce((count, move) => count + move.steps.length, 0),
    markdownLines: markdown.split('\n').length - 1, commit, uncommittedChanges: uncommitted,
  }, null, 2));
}
