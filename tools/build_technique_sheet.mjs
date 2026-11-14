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
import { CAMERAS, PERFORMERS } from './import_unreal_clips.mjs';

export const SHEET_MARKDOWN = 'TECHNIQUE-SHEET.md';
export const SHEET_JSON = 'TECHNIQUE-SHEET.json';
// The name the importer takes a clip file under (tools/import_unreal_clips.mjs).
export const CLIP_FILE_PATTERN = '<clipId>/<performer>-<camera>.mp4';
const TOOL = 'tools/build_technique_sheet.mjs';
// What the sheet is made from: the curriculum, the game's rules for where an
// exchange leaves the athletes, the Unity move table, the clip id rule, the
// published clip list, the importer's performers and cameras, and this tool.
// The sheet says so when any of them differs from its commit.
const SOURCES = ['src/data', 'src/arena/outcome.js', 'src/unity/bridge.js', 'src/unreal/techniqueIds.js', 'src/unreal/techniqueClips.data.js', 'tools/import_unreal_clips.mjs', TOOL];
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

const fail = (message) => { throw new Error(message); };
const code = (text) => `\`${text}\``;
const yesNo = (value) => (value ? 'yes' : 'no');

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
    unrealClipsToday: Object.fromEntries(PERFORMERS.map((performer) => [performer,
      CAMERAS.filter((camera) => clips.some((clip) => clip.moveId === clipId && clip.performerSide === performer && clip.camera === camera))])),
    clipFileNames: PERFORMERS.flatMap((performer) => CAMERAS.map((camera) => `${clipId}/${performer}-${camera}.mp4`)),
    // After any other start the site shows the position picture instead.
    renderFrom: start === null ? null : position(start),
    otherStarts: move.starts.slice(1).map(position),
    gameContinuesFrom: Object.fromEntries(PERFORMERS.map((performer) => {
      const place = start === null ? null : continuesFrom(move, start, performer, game);
      return [performer, place === null ? null : position(place)];
    })),
  };
}

const hasClip = (technique, performer) => technique.unrealClipsToday[performer].length > 0;
const clipsText = (technique) => (PERFORMERS.some((performer) => hasClip(technique, performer))
  ? PERFORMERS.map((performer) => `${performer}: ${technique.unrealClipsToday[performer].join(', ') || 'none'}`).join('; ')
  : 'none');
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

  const lines = [
    '# JiuQuest technique sheet',
    '',
    `Generated by ${code(TOOL)} from the JiuQuest site's curriculum (${code('src/data')}) at ${made}. Do not edit this file: run the tool again.`,
    '',
    "The name, lesson, scenario and steps of every technique are the owner's approved wording, copied character for character. They must not be changed. Nothing is corrected here: where the wording looks like a slip, that is how the curriculum has it.",
    '',
    `${code(SHEET_JSON)}, beside this file, holds the same techniques for programs.`,
    '',
    `Techniques: ${techniques.length}. Steps: ${stepCount}. Animated by Unity today: ${techniques.filter((technique) => technique.unityAnimationToday).length}. With an Unreal clip for both performers today: ${techniques.filter((technique) => PERFORMERS.every((performer) => hasClip(technique, performer))).length}.`,
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
    'Each technique is rendered from one position, its "Render from" position: the first position it starts in. Every clip of the technique starts there, for both performers and both cameras. Training shows the technique in that position, and the Arena plays its clip only after an exchange that started there. Where the game also offers a technique from other positions, the site shows the position picture after those, not the clip.',
    '',
    'A clip must end in the position the game continues from. That is the technique\'s "Ends in" position ("none": its "Render from" position), unless its section says "In the game the next exchange starts from", which then names it.',
    '',
    `The sheet works that position out with the game's own rules (${code('src/arena/outcome.js')}): each performer wins with the technique from its "Render from" position${neutral ? ` while the other athlete plays ${neutral.name} (${code(unrealClipMoveId(neutral.id))})` : ''}. The other athlete's technique matters only to a counter, which the game lets win only against the attack it answers, so a counter is worked out against that attack.`,
    '',
    "The site shows a technique's Unreal clips once both performers have at least one published view.",
    '',
    '## Index',
    '',
    'Every technique, in curriculum order. "#" is the number of its section below. "Starts in" and "Ends in" are the game\'s positions, named for where the athlete who performs the technique is; "none" means the technique leaves the position as it was. "Unity today" says whether the site plays a Unity animation of the technique. "Unreal clips today" lists the published views of each performer.',
    '',
    '| # | Clip id | Name | Belt | Starts in | Ends in | Steps | Unity today | Unreal clips today |',
    '| ---: | --- | --- | --- | --- | --- | ---: | --- | --- |',
    ...techniques.map((technique) => `| ${[
      technique.number, code(technique.clipId), technique.name, technique.belt, startsText(technique),
      technique.endsIn ? technique.endsIn.label ?? code(technique.endsIn.id) : 'none',
      technique.steps.length, yesNo(technique.unityAnimationToday), clipsText(technique),
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
      `- Unity today: ${yesNo(technique.unityAnimationToday)}; Unreal clips today: ${clipsText(technique)}`,
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
    notice: "Generated file: do not edit it, run the tool again. The name, lesson, scenario and steps of every technique are the owner's approved wording, copied character for character from the curriculum (src/data). They must not be changed.",
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
