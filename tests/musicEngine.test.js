import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMusicPack, encodeMusicPack, isMusicPack } from '../src/audio/musicPack.js';
import {
  isSelectableMusic,
  licensedDefaultPatch,
  licensedTracksFrom,
  musicTrackKey,
  pageMusic,
  pageMusicLevel,
  playerTrackList,
  pulseLevel,
  repairedSelection,
  resolveMusic,
  SOUNDTRACK_ID,
  soundtrackMusic,
} from '../src/audio/musicLibrary.js';
import { createMusicEngine, MUSIC_FADE_SECONDS, MUSIC_MAX_RETRIES, MUSIC_RETRY_SECONDS, musicTrackKind, SONG_FADE_IN_SECONDS, SONG_FADE_OUT_SECONDS } from '../src/audio/musicEngine.js';
import licensedMusic, { LICENSED_MUSIC_DIR, readLicensedMusic } from '../tools/vite_licensed_music.mjs';
import { defaultMusicTracks } from '../src/storage.js';

const repoPath = (file) => fileURLToPath(new URL(`../${file}`, import.meta.url));
const settle = async () => { for (let turn = 0; turn < 16; turn += 1) await Promise.resolve(); };

// ---- The pack container ----

test('a music pack unpacks to the bytes that went in, and is not those bytes on disk', () => {
  const audio = Uint8Array.from({ length: 5000 }, (_, index) => (index * 37 + 11) % 256);
  const pack = encodeMusicPack(audio, 0x1234abcd);
  assert.equal(pack.length, audio.length + 8);
  assert.equal(String.fromCharCode(...pack.slice(0, 4)), 'JQM1');
  assert.ok(isMusicPack(pack));
  assert.deepEqual(decodeMusicPack(pack), audio);
  const same = pack.slice(8).filter((byte, index) => byte === audio[index]).length;
  assert.ok(same < audio.length * 0.05, 'the stored bytes are scrambled, not the audio itself');
  assert.notDeepEqual(encodeMusicPack(audio, 1).slice(8), encodeMusicPack(audio, 2).slice(8), 'the seed changes the scramble');
  // A view into a larger buffer unpacks the same way (how fetched data can arrive).
  const padded = new Uint8Array(pack.length + 6);
  padded.set(pack, 3);
  assert.deepEqual(decodeMusicPack(padded.subarray(3, 3 + pack.length)), audio);
});

test('anything that is not a pack is refused', () => {
  assert.equal(isMusicPack(Uint8Array.from([1, 2, 3])), false);
  assert.throws(() => decodeMusicPack(Uint8Array.from({ length: 64 }, () => 0x49)), /Not a JiuQuest music pack/);
});

// ---- Which tracks a build offers ----

const entry = (patch = {}) => {
  const id = patch.id ?? 'fist-fight';
  return {
    id,
    title: 'Fist Fight',
    credit: 'Ovani Sound',
    collection: 'Hyper Action Music Pack Vol. 2',
    mood: 'Ovani Sound: Hyper Action',
    bpm: 128,
    loopSeconds: 90,
    prerollSeconds: 0.5,
    files: { 1: `${id}.1.aaaaaaaa.jqm`, 2: `${id}.2.bbbbbbbb.jqm`, 3: `${id}.3.cccccccc.jqm` },
    ...patch,
  };
};
// The four songs the soundtrack names, as a build would carry them.
const SOUNDTRACK_SONGS = [
  entry(),
  entry({ id: 'in-the-storm', title: 'In The Storm', loopSeconds: 82 }),
  entry({ id: 'sneak-attack', title: 'Sneak Attack', loopSeconds: 82 }),
  entry({ id: 'binder', title: 'Binder', loopSeconds: 89.6 }),
];
const soundtrack = () => licensedTracksFrom({ tracks: SOUNDTRACK_SONGS });

test('a licensed index becomes tracks the player can pick', () => {
  const [track, ...rest] = licensedTracksFrom({ version: 1, tracks: [entry()] });
  assert.equal(rest.length, 0);
  assert.deepEqual(track, {
    id: 'licensed-fist-fight',
    song: 'fist-fight',
    title: 'Fist Fight',
    bpm: 128,
    mood: 'Ovani Sound: Hyper Action',
    credit: 'Ovani Sound',
    collection: 'Hyper Action Music Pack Vol. 2',
    licensed: true,
    playerEnabled: true,
    url: '',
    loopSeconds: 90,
    prerollSeconds: 0.5,
    files: {
      1: '/assets/audio/licensed/fist-fight.1.aaaaaaaa.jqm',
      2: '/assets/audio/licensed/fist-fight.2.bbbbbbbb.jqm',
      3: '/assets/audio/licensed/fist-fight.3.cccccccc.jqm',
    },
  });
  assert.equal(musicTrackKind(track), 'licensed');
});

test('a build without licensed music offers none, and broken entries are left out', () => {
  assert.deepEqual(licensedTracksFrom(null), []);
  assert.deepEqual(licensedTracksFrom({ tracks: 'no' }), []);
  const bad = [
    null,
    entry({ id: '../up' }),
    entry({ id: 'Fist Fight' }),
    entry({ title: ' ' }),
    entry({ loopSeconds: 0 }),
    entry({ loopSeconds: 'x' }),
    entry({ prerollSeconds: 9 }),
    entry({ files: { 1: 'a.jqm', 2: 'b.jqm' } }),
    entry({ files: { 1: '../a.jqm', 2: 'b.jqm', 3: 'c.jqm' } }),
    entry({ files: { 1: 'https://elsewhere.example/a.jqm', 2: 'b.jqm', 3: 'c.jqm' } }),
    entry({ files: { 1: 'a.mp3', 2: 'b.jqm', 3: 'c.jqm' } }),
  ];
  assert.deepEqual(licensedTracksFrom({ tracks: bad }), []);
  // The same song listed twice is offered once.
  assert.equal(licensedTracksFrom({ tracks: [entry(), entry({ title: 'Again' })] }).length, 1);
  // Packs are only ever fetched from a folder of this site.
  for (const base of ['//elsewhere.example/packs/', 'https://elsewhere.example/', 'packs/', '/packs']) {
    assert.equal(licensedTracksFrom({ base, tracks: [entry()] })[0].files[1], '/assets/audio/licensed/fist-fight.1.aaaaaaaa.jqm', `${base} is not accepted as the pack folder`);
  }
  assert.equal(licensedTracksFrom({ base: '/assets/audio/licensed-test/', tracks: [entry()] })[0].files[1], '/assets/audio/licensed-test/fist-fight.1.aaaaaaaa.jqm');
});

test('licensed tracks lead the player list; hidden saved tracks stay hidden', () => {
  const licensed = licensedTracksFrom({ tracks: [entry(), entry({ id: 'hot-pursuit', title: 'Hot Pursuit' })] });
  const saved = [
    { id: 'ascension-gate', title: 'Ascension Gate', playerEnabled: true },
    { id: 'power-clash', title: 'Power Clash', playerEnabled: false },
    { id: 'licensed-fist-fight', title: 'A saved track that took a licensed id' },
  ];
  assert.deepEqual(playerTrackList(licensed, saved).map((track) => track.title), ['Fist Fight', 'Hot Pursuit', 'Ascension Gate']);
  // Without licensed music the list is what it was before: the saved tracks the admin shows.
  assert.deepEqual(playerTrackList([], defaultMusicTracks).map((track) => track.id), defaultMusicTracks.filter((track) => track.playerEnabled !== false).map((track) => track.id));
});

// ---- The soundtrack: a song and an intensity for each screen ----

test('each screen has its song and intensity', () => {
  const licensed = soundtrack();
  const on = (view) => { const music = pageMusic(view, licensed); return [music.track.title, music.level]; };
  assert.deepEqual(on('dashboard'), ['Fist Fight', 2], 'home: Fist Fight, medium');
  assert.deepEqual(on('profile'), ['In The Storm', 3], 'profile and fighter creation: In The Storm, full');
  assert.deepEqual(on('training'), ['Sneak Attack', 1], 'training: Sneak Attack, low');
  assert.deepEqual(on('grappling'), ['Sneak Attack', 1], 'the Lab is part of training');
  assert.deepEqual(on('combat'), ['Binder', 3], 'the Arena: Binder, full');
  // Screens the soundtrack does not name play what home plays.
  assert.deepEqual(on('progress'), ['Fist Fight', 2]);
  assert.deepEqual(on('admin'), ['Fist Fight', 2]);
  assert.deepEqual(['dashboard', 'profile', 'training', 'grappling', 'combat', 'progress'].map(pageMusicLevel), [2, 3, 1, 1, 3, 2]);
  // What to fetch ahead: each song and level once.
  assert.deepEqual(soundtrackMusic(licensed).map((music) => `${music.track.song}:${music.level}`), ['fist-fight:2', 'in-the-storm:3', 'sneak-attack:1', 'binder:3']);
});

test('a build that lacks one of the soundtrack songs plays its first song there; a build with none has no soundtrack', () => {
  const partial = licensedTracksFrom({ tracks: [entry(), entry({ id: 'binder', title: 'Binder' })] });
  assert.equal(pageMusic('profile', partial).track.title, 'Fist Fight');
  assert.equal(pageMusic('profile', partial).level, 3);
  assert.equal(pageMusic('combat', partial).track.title, 'Binder');
  assert.equal(pageMusic('dashboard', []), null);
  assert.deepEqual(soundtrackMusic([]), []);
});

test('the soundtrack plays unless the player picked a song, for every screen or for this one', () => {
  const licensed = soundtrack();
  const playerTracks = playerTrackList(licensed, defaultMusicTracks);
  const playing = (settings) => { const music = resolveMusic({ licensedTracks: licensed, playerTracks, ...settings }); return [music.mode, music.track.title, music.level]; };
  // The soundtrack is selected: each screen plays its own song.
  assert.deepEqual(playing({ view: 'dashboard', selectedId: SOUNDTRACK_ID, pagePickId: null }), ['soundtrack', 'Fist Fight', 2]);
  assert.deepEqual(playing({ view: 'combat', selectedId: SOUNDTRACK_ID, pagePickId: null }), ['soundtrack', 'Binder', 3]);
  // A song kept for every screen plays everywhere, at each screen's own intensity.
  assert.deepEqual(playing({ view: 'dashboard', selectedId: 'licensed-binder', pagePickId: null }), ['song', 'Binder', 2]);
  assert.deepEqual(playing({ view: 'training', selectedId: 'licensed-binder', pagePickId: null }), ['song', 'Binder', 1]);
  // One of the game's own tracks keeps the levels it always had: full in the Arena, medium
  // in Training, low everywhere else (they set the tempo of the synth pulse).
  assert.deepEqual(playing({ view: 'combat', selectedId: 'ascension-gate', pagePickId: null }), ['song', 'Ascension Gate', 3]);
  assert.deepEqual(playing({ view: 'training', selectedId: 'dojo-pulse', pagePickId: null }), ['song', 'Dojo Pulse', 2]);
  assert.deepEqual(playing({ view: 'profile', selectedId: 'dojo-pulse', pagePickId: null }), ['song', 'Dojo Pulse', 1]);
  assert.deepEqual(['dashboard', 'profile', 'training', 'grappling', 'combat', 'progress', 'admin'].map(pulseLevel), [1, 1, 2, 1, 3, 1, 1]);
  // A song picked for this screen wins over the soundtrack while it lasts.
  assert.deepEqual(playing({ view: 'profile', selectedId: SOUNDTRACK_ID, pagePickId: 'licensed-sneak-attack' }), ['song', 'Sneak Attack', 3]);
  // A pick that no longer exists falls back to the soundtrack.
  assert.deepEqual(playing({ view: 'profile', selectedId: 'gone', pagePickId: null }), ['soundtrack', 'In The Storm', 3]);
});

test('without licensed music the selected saved track plays, as before', () => {
  const playerTracks = playerTrackList([], defaultMusicTracks);
  const music = resolveMusic({ view: 'combat', licensedTracks: [], playerTracks, selectedId: 'power-clash', pagePickId: null });
  assert.deepEqual([music.mode, music.track.id, music.level], ['song', 'power-clash', 3]);
  // A selection the build cannot honour plays the first track until the app corrects it.
  assert.equal(resolveMusic({ view: 'dashboard', licensedTracks: [], playerTracks, selectedId: SOUNDTRACK_ID, pagePickId: null }).track.id, playerTracks[0].id);
  assert.equal(isSelectableMusic(SOUNDTRACK_ID, [], playerTracks), false);
  assert.equal(isSelectableMusic(SOUNDTRACK_ID, soundtrack(), playerTracks), true);
  assert.equal(isSelectableMusic('power-clash', [], playerTracks), true);
  assert.equal(isSelectableMusic('gone', soundtrack(), playerTracks), false);
  // The synth pulse keeps its old tempo on every screen of a build without licensed music.
  const pulse = (view) => resolveMusic({ view, licensedTracks: [], playerTracks, selectedId: 'dojo-pulse', pagePickId: null }).level;
  assert.deepEqual(['dashboard', 'profile', 'training', 'grappling', 'combat'].map(pulse), [1, 1, 2, 1, 3]);
});

test('a selection the build cannot honour is replaced, but a build without music leaves the soundtrack choice alone', () => {
  const licensed = soundtrack();
  const own = playerTrackList([], defaultMusicTracks);
  const all = playerTrackList(licensed, defaultMusicTracks);
  // Nothing to repair.
  assert.equal(repairedSelection(SOUNDTRACK_ID, licensed, all), null);
  assert.equal(repairedSelection('licensed-binder', licensed, all), null);
  assert.equal(repairedSelection('power-clash', [], own), null);
  // A track that was removed: back to the soundtrack, or to the first own track without one.
  assert.equal(repairedSelection('gone', licensed, all), SOUNDTRACK_ID);
  assert.equal(repairedSelection('licensed-hot-pursuit', licensed, all), SOUNDTRACK_ID, 'a licensed song the store no longer carries');
  assert.equal(repairedSelection('gone', [], own), own[0].id);
  // A build without licensed music (a rollback, a fork, a missing key): the saved choice stays,
  // so the soundtrack is still selected when the music is back.
  assert.equal(repairedSelection(SOUNDTRACK_ID, [], own), null);
  assert.equal(repairedSelection('licensed-binder', [], own), null);
});

test('the soundtrack becomes the selection once, then the player decides', () => {
  const licensed = soundtrack();
  assert.equal(licensedDefaultPatch({ activeTrackId: 'ascension-gate' }, []), null);
  assert.deepEqual(licensedDefaultPatch({ activeTrackId: 'ascension-gate' }, licensed), { activeTrackId: SOUNDTRACK_ID, licensedDefaultApplied: true });
  assert.equal(licensedDefaultPatch({ activeTrackId: 'power-clash', licensedDefaultApplied: true }, licensed), null);
});

test('a track restarts only when what would be played changes', () => {
  const hosted = { id: 'a', url: '/assets/audio/a.wav', bpm: 140, notes: 'one' };
  assert.equal(musicTrackKey(hosted), musicTrackKey({ ...hosted, notes: 'two', title: 'Renamed', mood: 'x' }));
  assert.notEqual(musicTrackKey(hosted), musicTrackKey({ ...hosted, url: '/assets/audio/b.wav' }));
  assert.notEqual(musicTrackKey(hosted), musicTrackKey({ ...hosted, bpm: 150 }));
  const [licensed] = licensedTracksFrom({ tracks: [entry()] });
  assert.notEqual(musicTrackKey(licensed), musicTrackKey({ ...licensed, files: { ...licensed.files, 3: '/assets/audio/licensed/other.jqm' } }));
  assert.equal(musicTrackKey(null), '');
});

// ---- The build plugin and the deploy ----

test('the build lists only licensed tracks whose three packs are present', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'jq-music-'));
  try {
    assert.deepEqual(readLicensedMusic(root), { version: 1, tracks: [] });
    const dir = path.join(root, LICENSED_MUSIC_DIR);
    mkdirSync(dir, { recursive: true });
    const complete = entry();
    const missingOne = entry({ id: 'hot-pursuit', files: { 1: 'hp.1.jqm', 2: 'hp.2.jqm', 3: 'hp.3.jqm' } });
    const outside = entry({ id: 'binder', files: { 1: '../binder.1.jqm', 2: 'b.2.jqm', 3: 'b.3.jqm' } });
    writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ version: 1, tracks: [complete, missingOne, outside] }));
    for (const name of [...Object.values(complete.files), 'hp.1.jqm', 'hp.2.jqm', 'b.2.jqm', 'b.3.jqm']) writeFileSync(path.join(dir, name), 'x');
    writeFileSync(path.join(root, 'public', 'assets', 'audio', 'binder.1.jqm'), 'x');
    assert.deepEqual(readLicensedMusic(root).tracks.map((track) => track.id), ['fist-fight']);
    const config = licensedMusic().config({ root });
    assert.deepEqual(JSON.parse(config.define.__JQ_LICENSED_MUSIC__).tracks.map((track) => track.id), ['fist-fight']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('licensed music is not committed, and the build plugin is switched on', () => {
  const ignore = readFileSync(repoPath('.gitignore'), 'utf8');
  assert.match(ignore, /^\/public\/assets\/audio\/licensed\/$/m, 'the folder a build reads packs from is ignored');
  assert.match(ignore, /^\*\.jqm$/m, 'and so is a pack anywhere else');
  // What git actually tracks, when this is a git checkout: no pack, and nothing in that folder.
  const tracked = spawnSync('git', ['ls-files', '--', '*.jqm', 'public/assets/audio/licensed'], { cwd: repoPath('.'), encoding: 'utf8' });
  if (tracked.status === 0) assert.equal(tracked.stdout.trim(), '', 'no licensed audio is tracked by git');
  const config = readFileSync(repoPath('vite.config.js'), 'utf8');
  assert.match(config, /import licensedMusic from "\.\/tools\/vite_licensed_music\.mjs";/);
  assert.match(config, /plugins: \[[^\]]*licensedMusic\(\)[^\]]*\]/);
});

test('the deploy fetches licensed music before it builds, and only when the key is configured', () => {
  const workflow = readFileSync(repoPath('.github/workflows/deploy-pages.yml'), 'utf8');
  const steps = ['Verify combat, persistence and release safety', 'Check for the licensed music key', 'Fetch licensed music', 'Place licensed music', 'Build release candidate'];
  const order = steps.map((name) => workflow.indexOf(`- name: ${name}`));
  assert.ok(order.every((at) => at > 0), 'every step is there');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in this order');
  assert.equal(workflow.match(/if: steps\.music\.outputs\.available == 'true'/g).length, 2, 'fetching and placing both wait for the key');
  assert.match(workflow, /ssh-key: \$\{\{ secrets\.MUSIC_DEPLOY_KEY \}\}/);
  assert.match(workflow, /node tools\/check_licensed_music\.mjs/);
  // A release of the site itself stops when the key is missing, instead of shipping without music.
  const keyCheck = workflow.slice(order[1], order[2]);
  assert.match(keyCheck, /elif \[ "\$GITHUB_REPOSITORY" = "bcastle1\/Jiu-Quest" \] && \[ "\$GITHUB_EVENT_NAME" != "pull_request" \]; then\s+echo "::error::[^"]*MUSIC_DEPLOY_KEY[^"]*"\s+exit 1/);
  const scripts = JSON.parse(readFileSync(repoPath('package.json'), 'utf8')).scripts;
  assert.match(scripts['test:browser'], /node tools\/test_music_engine\.mjs/, 'the browser check for music runs with the others');
});

// ---- The engine, against a stand-in for Web Audio ----

// Timers a test turns by hand.
function fakeTimers() {
  const pending = [];
  let next = 1;
  return {
    pending,
    setTimeoutImpl: (callback, milliseconds) => { const handle = next++; pending.push({ handle, callback, milliseconds }); return handle; },
    clearTimeoutImpl: (handle) => { const at = pending.findIndex((timer) => timer.handle === handle); if (at >= 0) pending.splice(at, 1); },
    // Runs the timers due after `milliseconds`, oldest first.
    run(milliseconds) { const due = pending.filter((timer) => timer.milliseconds === milliseconds); for (const timer of due) { pending.splice(pending.indexOf(timer), 1); timer.callback(); } return due.length; },
  };
}

function fakeAudio() {
  const log = { sources: [], gains: [], oscillators: [], closed: false, resumes: 0, suspends: 0 };
  const param = (value = 1) => {
    const events = [];
    return {
      value,
      events,
      setValueAtTime(v, t) { events.push(['set', v, t]); this.value = v; },
      linearRampToValueAtTime(v, t) { events.push(['ramp', v, t]); this.value = v; },
      cancelScheduledValues(t) { events.push(['cancel', t]); },
    };
  };
  class Context {
    constructor() { this.currentTime = 100; this.state = 'running'; this.destination = { name: 'speakers' }; log.context = this; }
    createGain() { const node = { gain: param(1), connections: [], connect(to) { this.connections.push(to); }, disconnect() { this.disconnected = true; } }; log.gains.push(node); return node; }
    createBufferSource() {
      const node = { loop: false, loopStart: 0, loopEnd: 0, buffer: null, started: null, stopped: null, connect(to) { this.to = to; }, start(when, offset) { this.started = { when, offset }; }, stop(when) { this.stopped = when; } };
      log.sources.push(node);
      return node;
    }
    createOscillator() { const node = { type: '', frequency: { value: 0 }, started: false, stopped: false, connect() {}, start() { this.started = true; }, stop() { this.stopped = true; } }; log.oscillators.push(node); return node; }
    // The decoded "buffer" remembers what was decoded: [song number, level].
    decodeAudioData(data) { const bytes = new Uint8Array(data); return Promise.resolve({ song: bytes[0], level: bytes[1], decodedBytes: data.byteLength }); }
    resume() { log.resumes += 1; this.state = 'running'; return Promise.resolve(); }
    suspend() { log.suspends += 1; this.state = 'suspended'; return Promise.resolve(); }
    close() { log.closed = true; return Promise.resolve(); }
  }
  return { log, Context };
}

const SONG_NUMBER = { 'fist-fight': 1, 'in-the-storm': 2, 'sneak-attack': 3, binder: 4 };
const song = (id) => soundtrack().find((track) => track.song === id);
// Each pack unpacks to [song number, level, ...], so a test can tell what was decoded.
function packServer({ failing = [], held = [] } = {}) {
  const requests = [];
  const releases = new Map();
  const fetchImpl = (url) => {
    const [, id, levelText] = url.match(/\/([a-z-]+)\.(\d)\.[a-z]+\.jqm$/);
    const name = `${id}.${levelText}`;
    requests.push(name);
    const answer = () => (failing.includes(name)
      ? { ok: false, status: 404 }
      : { ok: true, status: 200, arrayBuffer: async () => encodeMusicPack(Uint8Array.from([SONG_NUMBER[id], Number(levelText), 9, 9]), 77).buffer });
    if (!held.includes(name)) return Promise.resolve(answer());
    return new Promise((resolve) => { releases.set(name, () => resolve(answer())); });
  };
  return { fetchImpl, requests, release: (name) => releases.get(name)() };
}
const decoded = (log) => log.sources.map((source) => `${source.buffer.song}.${source.buffer.level}`);

test('a licensed song loops its loop region and starts at the top of the loop', async () => {
  const { log, Context } = fakeAudio();
  const server = packServer();
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: server.fetchImpl });
  engine.play(song('fist-fight'), { volume: 0.4, intensity: 2 });
  await settle();
  assert.deepEqual(server.requests, ['fist-fight.2']);
  assert.equal(log.sources.length, 1);
  const [source] = log.sources;
  assert.deepEqual([source.buffer.song, source.buffer.level, source.buffer.decodedBytes], [1, 2, 4], 'the pack was unpacked before decoding');
  assert.equal(source.loop, true);
  assert.equal(source.loopStart, 0.5);
  assert.equal(source.loopEnd, 90.5);
  assert.ok(Math.abs(source.started.offset - 0.5) < 1e-9, 'the first pass starts where the loop starts');
  assert.ok(source.started.when > 100 && source.started.when < 100.2);
  assert.equal(log.gains[0].gain.value, 0.4, 'the volume is on the master gain');
  // The sound has a path to the speakers: voice, then its own gain, then the master gain.
  const [master, voiceGain] = log.gains;
  assert.equal(source.to, voiceGain, 'the voice feeds its gain');
  assert.deepEqual(voiceGain.connections, [master], 'which feeds the master gain');
  assert.deepEqual(master.connections, [log.context.destination], 'which feeds the speakers');
  assert.deepEqual(engine.snapshot(), { kind: 'licensed', trackId: 'licensed-fist-fight', level: 2, wanted: 'licensed-fist-fight:2', voices: 1, decodedLevels: 1, intensity: 2, volume: 0.4, contextState: 'running' });

  // Asking again for what is playing changes nothing.
  engine.play(song('fist-fight'), { volume: 0.4, intensity: 2 });
  await settle();
  assert.equal(log.sources.length, 1);
  assert.deepEqual(server.requests, ['fist-fight.2']);
});

test('another level of the same song crossfades in at the same place in the loop', async () => {
  const { log, Context } = fakeAudio();
  const server = packServer();
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: server.fetchImpl });
  engine.play(song('fist-fight'), { volume: 0.4, intensity: 1 });
  await settle();
  const startedAt = log.sources[0].started.when;
  // 200 seconds later the song is 20 seconds into its third pass.
  log.context.currentTime = startedAt + 200;
  engine.play(song('fist-fight'), { intensity: 3 });
  await settle();
  assert.deepEqual(decoded(log), ['1.1', '1.3']);
  const [low, full] = log.sources;
  const expectedPosition = (full.started.when - startedAt) % 90;
  assert.ok(Math.abs(expectedPosition - 20.06) < 1e-6);
  assert.ok(Math.abs(full.started.offset - (0.5 + expectedPosition)) < 1e-9, 'the new level starts where the song is');
  assert.deepEqual([full.loopStart, full.loopEnd], [0.5, 90.5]);
  assert.ok(Math.abs(low.stopped - (full.started.when + MUSIC_FADE_SECONDS + 0.05)) < 1e-9, 'the old level stops after its fade');
  // The old voice fades to nothing, the new one from nothing, over the same stretch.
  assert.deepEqual(log.gains[1].gain.events.at(-1), ['ramp', 0, full.started.when + MUSIC_FADE_SECONDS]);
  assert.deepEqual(log.gains[2].gain.events, [['set', 0, full.started.when], ['ramp', 1, full.started.when + MUSIC_FADE_SECONDS]]);
  assert.equal(engine.snapshot().level, 3);
  assert.equal(engine.snapshot().voices, 1);

  // setIntensity is the same change by another door.
  engine.setIntensity(3);
  await settle();
  assert.equal(log.sources.length, 2, 'the level that is playing is left alone');
  engine.setIntensity(2);
  await settle();
  assert.deepEqual(decoded(log), ['1.1', '1.3', '1.2']);
});

test('another song crossfades in from its beginning, and a song the player comes back to has moved on', async () => {
  const { log, Context } = fakeAudio();
  const server = packServer();
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: server.fetchImpl });
  engine.play(song('fist-fight'), { intensity: 2 }); // home
  await settle();
  const homeStartedAt = log.sources[0].started.when;
  log.context.currentTime = 130;
  engine.play(song('in-the-storm'), { intensity: 3 }); // profile
  await settle();
  const [home, profile] = log.sources;
  assert.deepEqual(decoded(log), ['1.2', '2.3']);
  assert.ok(Math.abs(profile.started.offset - 0.5) < 1e-9, 'a song heard for the first time starts at the top of its loop');
  assert.deepEqual([profile.loopStart, profile.loopEnd], [0.5, 82.5], 'with its own loop length');
  assert.ok(Math.abs(home.stopped - (profile.started.when + SONG_FADE_OUT_SECONDS + 0.05)) < 1e-9);
  assert.deepEqual(log.gains[1].gain.events.at(-1), ['ramp', 0, profile.started.when + SONG_FADE_OUT_SECONDS], 'the old song fades out');
  assert.deepEqual(log.gains[2].gain.events, [['set', 0, profile.started.when], ['ramp', 1, profile.started.when + SONG_FADE_IN_SECONDS]], 'the new song fades in');
  assert.equal(engine.snapshot().trackId, 'licensed-in-the-storm');

  // Back home 300 seconds after the first song began: it is where it would have been.
  log.context.currentTime = homeStartedAt + 300 - 0.06;
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  const homeAgain = log.sources[2];
  assert.deepEqual([homeAgain.buffer.song, homeAgain.buffer.level], [1, 2]);
  assert.ok(Math.abs(homeAgain.started.offset - (0.5 + (300 % 90))) < 1e-6, 'thirty seconds into its fourth pass');
  assert.deepEqual(server.requests, ['fist-fight.2', 'in-the-storm.3'], 'a pack that was fetched once is not fetched again');
});

test('a level that is still fading in fades out from where it had got to', async () => {
  const { log, Context } = fakeAudio();
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: packServer().fetchImpl });
  engine.play(song('fist-fight'), { intensity: 1 });
  await settle();
  log.context.currentTime = 110;
  engine.setIntensity(3);
  await settle();
  const fadeInFrom = log.sources[1].started.when;
  // Halfway through that crossfade the player leaves again.
  log.context.currentTime = fadeInFrom + MUSIC_FADE_SECONDS / 2 - 0.06;
  engine.setIntensity(1);
  await settle();
  const leaveAt = log.sources[2].started.when;
  assert.ok(Math.abs(leaveAt - (fadeInFrom + MUSIC_FADE_SECONDS / 2)) < 1e-9);
  const fullGain = log.gains[2].gain.events;
  // Cancelling removes the fade-in it was in the middle of. That fade is put back as a ramp up
  // to this moment (a fixed value here would leave it silent until now, then jump), then it fades out.
  assert.deepEqual(fullGain.slice(-3).map(([kind]) => kind), ['cancel', 'ramp', 'ramp']);
  assert.deepEqual(fullGain.at(-3), ['cancel', leaveAt]);
  assert.ok(Math.abs(fullGain.at(-2)[1] - 0.5) < 1e-9 && fullGain.at(-2)[2] === leaveAt, 'it reaches half, where its fade-in had got to, at this moment');
  assert.deepEqual(fullGain.at(-1), ['ramp', 0, leaveAt + MUSIC_FADE_SECONDS]);
});

test('turning music off during a crossfade silences the voice that was already fading out too', async () => {
  const { log, Context } = fakeAudio();
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: packServer().fetchImpl });
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  log.context.currentTime = 120;
  engine.play(song('binder'), { intensity: 3 });
  await settle();
  const [home, arena] = log.sources;
  const crossfadeAt = arena.started.when;
  assert.ok(Math.abs(home.stopped - (crossfadeAt + SONG_FADE_OUT_SECONDS + 0.05)) < 1e-9);
  // A quarter of a second into that crossfade the player turns the music off.
  log.context.currentTime = crossfadeAt + 0.25;
  engine.stop();
  const offAt = crossfadeAt + 0.25;
  assert.ok(Math.abs(home.stopped - (offAt + 0.3 + 0.05)) < 1e-9, 'the old song is cut short, not left to finish its longer fade');
  assert.ok(Math.abs(arena.stopped - (offAt + 0.3 + 0.05)) < 1e-9);
  const homeGain = log.gains[1].gain.events;
  assert.deepEqual(homeGain.at(-1), ['ramp', 0, offAt + 0.3]);
  assert.ok(Math.abs(homeGain.at(-2)[1] - (1 - 0.25 / SONG_FADE_OUT_SECONDS)) < 1e-9, 'from where its fade-out had got to');
});

test('only the last music asked for is started when requests overlap', async () => {
  const { log, Context } = fakeAudio();
  const server = packServer({ held: ['in-the-storm.3'] });
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: server.fetchImpl });
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  engine.play(song('in-the-storm'), { intensity: 3 }); // still downloading...
  await settle();
  engine.play(song('binder'), { intensity: 3 }); // ...when the player moves on
  await settle();
  assert.deepEqual(decoded(log), ['1.2', '4.3']);
  server.release('in-the-storm.3');
  await settle();
  assert.deepEqual(decoded(log), ['1.2', '4.3'], 'the song that arrived late is not started');
  assert.equal(engine.snapshot().trackId, 'licensed-binder');
});

test('music that was turned off while loading never starts', async () => {
  const { log, Context } = fakeAudio();
  const server = packServer({ held: ['fist-fight.1'] });
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: server.fetchImpl });
  engine.play(song('fist-fight'), { intensity: 1 });
  await settle(); // the download is under way...
  assert.equal(server.requests.length, 1);
  engine.stop(); // ...when the player turns the music off
  server.release('fist-fight.1');
  await settle();
  assert.equal(log.sources.length, 0);
  assert.equal(engine.snapshot().kind, null);
});

test('stopping fades the song out; turning music on again starts songs from the top', async () => {
  const { log, Context } = fakeAudio();
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: packServer().fetchImpl });
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  log.context.currentTime = 130;
  engine.stop();
  assert.ok(Math.abs(log.sources[0].stopped - (130 + 0.3 + 0.05)) < 1e-9);
  assert.deepEqual(log.gains[1].gain.events.at(-1), ['ramp', 0, 130.3]);
  assert.equal(engine.snapshot().kind, null);
  log.context.currentTime = 150;
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  assert.ok(Math.abs(log.sources[1].started.offset - 0.5) < 1e-9, 'the song clock starts over');
  engine.dispose();
  assert.equal(log.closed, true);
});

test('a first song that cannot be fetched turns the music off with a message', async () => {
  const { log, Context } = fakeAudio();
  const messages = [];
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: packServer({ failing: ['fist-fight.2'] }).fetchImpl, onError: (message) => messages.push(message) });
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  assert.deepEqual(messages, ['Music could not play. Check your connection and try again.']);
  assert.equal(log.sources.length, 0);
  assert.equal(engine.snapshot().kind, null);
});

test('a next song that cannot be fetched leaves the current one playing, and is tried again later', async () => {
  const { log, Context } = fakeAudio();
  const messages = [];
  const failing = ['binder.3'];
  const server = packServer({ failing });
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: server.fetchImpl, onError: (message) => messages.push(message) });
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  engine.play(song('binder'), { intensity: 3 });
  await settle();
  assert.deepEqual(messages, [], 'no message: music is still playing');
  assert.deepEqual(decoded(log), ['1.2']);
  assert.equal(log.sources[0].stopped, null);
  assert.equal(engine.snapshot().trackId, 'licensed-fist-fight');
  failing.length = 0; // the connection is back
  engine.play(song('binder'), { intensity: 3 });
  await settle();
  assert.deepEqual(decoded(log), ['1.2', '4.3']);
  assert.deepEqual(server.requests, ['fist-fight.2', 'binder.3', 'binder.3']);
});

test('songs fetched ahead are not fetched again when their screen opens', async () => {
  const { log, Context } = fakeAudio();
  const server = packServer({ failing: ['sneak-attack.1'] });
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: server.fetchImpl });
  engine.play(song('fist-fight'), { intensity: 2 });
  await engine.preload(soundtrackMusic(soundtrack()));
  await settle();
  assert.deepEqual(server.requests, ['fist-fight.2', 'in-the-storm.3', 'sneak-attack.1', 'binder.3'], 'one after another, and a failure does not stop the rest');
  assert.deepEqual(decoded(log), ['1.2'], 'fetching ahead decodes and plays nothing');
  engine.play(song('binder'), { intensity: 3 });
  await settle();
  assert.deepEqual(decoded(log), ['1.2', '4.3']);
  assert.equal(server.requests.length, 4);
});

test('a next song that failed is tried again by itself, a few times, while it is still wanted', async () => {
  const { log, Context } = fakeAudio();
  const timers = fakeTimers();
  const failing = ['binder.3'];
  const server = packServer({ failing });
  const messages = [];
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: server.fetchImpl, onError: (message) => messages.push(message), setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl });
  const retryAfter = MUSIC_RETRY_SECONDS * 1000;
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  engine.play(song('binder'), { intensity: 3 }); // the player opens the Arena; the fetch fails
  await settle();
  assert.deepEqual(decoded(log), ['1.2'], 'the home song carries on');
  assert.equal(timers.run(retryAfter), 1, 'a retry was waiting');
  await settle();
  assert.deepEqual(server.requests.filter((name) => name === 'binder.3').length, 2, 'the pack was asked for again');
  failing.length = 0; // the connection comes back
  assert.equal(timers.run(retryAfter), 1);
  await settle();
  assert.deepEqual(decoded(log), ['1.2', '4.3'], 'the Arena song starts without the player doing anything');
  assert.equal(timers.run(retryAfter), 0, 'and nothing is left waiting');
  assert.deepEqual(messages, []);

  // It gives up after a few tries, and a song that is no longer wanted is not retried at all.
  failing.push('in-the-storm.3');
  engine.play(song('in-the-storm'), { intensity: 3 });
  await settle();
  let tries = 0;
  while (timers.run(retryAfter)) { tries += 1; await settle(); }
  assert.equal(tries, MUSIC_MAX_RETRIES);
  failing.push('sneak-attack.1');
  engine.play(song('sneak-attack'), { intensity: 1 });
  await settle();
  engine.play(song('binder'), { intensity: 3 }); // the player goes back to what is playing
  await settle();
  assert.equal(timers.run(retryAfter), 0, 'the retry for the abandoned song was cancelled');
  engine.stop();
  assert.equal(timers.pending.filter((timer) => timer.milliseconds === retryAfter).length, 0);
});

test('a fetch that never answers is given up on', async () => {
  const { Context } = fakeAudio();
  const timers = fakeTimers();
  let signal = null;
  const fetchImpl = (url, init) => new Promise((resolve, reject) => { signal = init.signal; signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const messages = [];
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl, onError: (message) => messages.push(message), setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl });
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  assert.equal(signal.aborted, false);
  assert.equal(timers.run(45000), 1, 'a time limit was set on the request');
  await settle();
  assert.equal(signal.aborted, true);
  assert.deepEqual(messages, ['Music could not play. Check your connection and try again.']);
});

test('decoded audio is kept to two levels however fast the player moves', async () => {
  const { Context } = fakeAudio();
  const server = packServer({ held: ['in-the-storm.3', 'sneak-attack.1', 'binder.3'] });
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: server.fetchImpl });
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  // Three screens in a row, each left before its song arrived.
  for (const [id, level] of [['in-the-storm', 3], ['sneak-attack', 1], ['binder', 3]]) {
    engine.play(song(id), { intensity: level });
    await settle();
    assert.ok(engine.snapshot().decodedLevels <= 2, `after asking for ${id}`);
  }
  engine.play(song('fist-fight'), { intensity: 2 }); // home again
  await settle();
  for (const name of ['in-the-storm.3', 'sneak-attack.1', 'binder.3']) server.release(name);
  await settle();
  assert.ok(engine.snapshot().decodedLevels <= 2);
  assert.equal(engine.snapshot().trackId, 'licensed-fist-fight');
});

test('with the music off the audio context rests, and the next press wakes it', async () => {
  const { log, Context } = fakeAudio();
  const timers = fakeTimers();
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: packServer().fetchImpl, setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl });
  engine.prime();
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  engine.stop();
  assert.equal(log.suspends, 0, 'not at once: the fade-out has to play');
  assert.equal(timers.run(1000), 1);
  assert.equal(log.suspends, 1, 'then the context is suspended');
  engine.prime(); // the press that turns music on again
  assert.equal(log.resumes, 1);
  engine.play(song('fist-fight'), { intensity: 2 });
  await settle();
  assert.equal(log.sources.length, 2);
  // Music turned off and straight on again never suspends in between.
  engine.stop();
  engine.prime();
  engine.play(song('fist-fight'), { intensity: 2 });
  assert.equal(timers.run(1000), 0, 'the rest that was waiting was called off');
  assert.equal(log.suspends, 1);
});

test('a context a phone call interrupted is resumed when music is turned on', async () => {
  const { log, Context } = fakeAudio();
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: packServer().fetchImpl });
  engine.prime();
  log.context.state = 'interrupted';
  engine.prime();
  assert.equal(log.resumes, 1, 'the press resumes it');
  log.context.state = 'interrupted';
  engine.play(song('fist-fight'), { intensity: 2 });
  assert.equal(log.resumes, 2, 'and so does starting a song');
  engine.stop();
  log.context.state = 'interrupted';
  engine.play({ id: 'dojo-pulse', url: '', bpm: 120 }, { intensity: 1 });
  assert.equal(log.resumes, 3, 'and the synth pulse');
  engine.stop();
});

test('a browser that refuses to open an audio context gets a message, and a hosted file still plays', async () => {
  class Refusing { constructor() { throw new Error('no audio hardware'); } }
  const made = [];
  class Element {
    constructor(url) { this.url = url; this.paused = true; this.currentTime = 0; made.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const messages = [];
  const engine = createMusicEngine({ AudioContextClass: Refusing, AudioElementClass: Element, fetchImpl: packServer().fetchImpl, onError: (message) => messages.push(message) });
  engine.prime(); // must not throw: it runs inside the press on the music switch
  engine.play(song('fist-fight'), { intensity: 2 });
  assert.deepEqual(messages, ['Audio is unavailable in this browser.']);
  engine.play({ id: 'ascension-gate', url: '/assets/audio/ascension-gate.wav' }, {});
  assert.equal(made[0].paused, false);
});

test('coming back to the page resumes music that the browser had paused', async () => {
  const { log, Context } = fakeAudio();
  const engine = createMusicEngine({ AudioContextClass: Context, fetchImpl: packServer().fetchImpl });
  engine.resumeIfPaused(); // nothing playing, no audio context yet: nothing to do
  engine.play(song('fist-fight'), { intensity: 1 });
  await settle();
  engine.resumeIfPaused(); // running: nothing to do
  assert.equal(log.resumes, 0);
  log.context.state = 'interrupted';
  engine.resumeIfPaused();
  assert.equal(log.resumes, 1);
  engine.stop();
  log.context.state = 'suspended';
  engine.resumeIfPaused(); // music is off: leave it paused
  assert.equal(log.resumes, 1);
});

test('a browser without Web Audio gets a message instead of an error', () => {
  const messages = [];
  const engine = createMusicEngine({ AudioContextClass: null, AudioElementClass: null, fetchImpl: () => assert.fail('nothing is fetched'), onError: (message) => messages.push(message) });
  engine.play(song('fist-fight'), { intensity: 1 });
  engine.play({ id: 'dojo-pulse', url: '', bpm: 132 }, {});
  engine.play({ id: 'ascension-gate', url: '/assets/audio/ascension-gate.wav' }, {});
  assert.deepEqual(messages, Array(3).fill('Audio is unavailable in this browser.'));
});

test('a hosted file is looped by an audio element, keeps playing across screens and follows the volume', async () => {
  const made = [];
  class Element {
    constructor(url) { this.url = url; this.loop = false; this.volume = 1; this.paused = true; this.currentTime = 5; made.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const { Context } = fakeAudio();
  const engine = createMusicEngine({ AudioContextClass: Context, AudioElementClass: Element });
  const track = { id: 'ascension-gate', url: ' /assets/audio/ascension-gate.wav ', bpm: 145 };
  assert.equal(musicTrackKind(track), 'hosted');
  engine.play(track, { volume: 0.34, intensity: 1 });
  assert.equal(made.length, 1);
  assert.deepEqual([made[0].url, made[0].loop, made[0].volume, made[0].paused], ['/assets/audio/ascension-gate.wav', true, 0.34, false]);
  // Another screen asks for the same track at another intensity. A single file has only one
  // level: it keeps playing, it is not started again.
  engine.play({ ...track, notes: 'edited' }, { volume: 0.34, intensity: 3 });
  engine.setIntensity(2);
  assert.equal(made.length, 1);
  assert.equal(made[0].paused, false);
  engine.setVolume(0.5);
  assert.equal(made[0].volume, 0.5);
  engine.stop();
  assert.deepEqual([made[0].paused, made[0].currentTime], [true, 0]);
});

test('a hosted file that fails to play turns the music off with a message', async () => {
  class Element {
    constructor() { this.paused = true; this.currentTime = 0; }
    play() { return Promise.reject(new Error('no')); }
    pause() { this.paused = true; }
  }
  const messages = [];
  const engine = createMusicEngine({ AudioContextClass: fakeAudio().Context, AudioElementClass: Element, onError: (message) => messages.push(message) });
  engine.play({ id: 'x', url: '/missing.wav' }, {});
  await settle();
  assert.deepEqual(messages, ['Music could not play. Check your connection and try again.']);
  assert.equal(engine.snapshot().kind, null);
});

test('the synth pulse speeds up with the intensity and stops cleanly', () => {
  const { log, Context } = fakeAudio();
  const timers = [];
  const cleared = [];
  const engine = createMusicEngine({
    AudioContextClass: Context,
    setIntervalImpl: (callback, milliseconds) => { timers.push({ callback, milliseconds }); return timers.length; },
    clearIntervalImpl: (handle) => cleared.push(handle),
  });
  const track = { id: 'dojo-pulse', url: '', bpm: 120 };
  assert.equal(musicTrackKind(track), 'procedural');
  engine.play(track, { volume: 0.34, intensity: 1 });
  assert.equal(log.oscillators.length, 3);
  assert.ok(log.oscillators.every((oscillator) => oscillator.started));
  assert.deepEqual(log.oscillators.map((oscillator) => oscillator.frequency.value), [110, 110 * 1.334, 220]);
  assert.equal(timers.at(-1).milliseconds, 750, 'at low intensity: one pulse every beat and a half');
  engine.play(track, { intensity: 2 });
  assert.equal(log.oscillators.length, 3, 'the same pulse keeps running');
  assert.equal(timers.at(-1).milliseconds, 500, 'on the beat at medium');
  engine.setIntensity(3);
  assert.equal(timers.at(-1).milliseconds, 250, 'twice a beat at full');
  assert.deepEqual(cleared, [1, 2], 'each change replaces the timer before it');
  // One pulse: the gain dips and comes back, around the chosen volume.
  timers.at(-1).callback();
  const pulseGain = log.gains.at(-4).gain.events;
  assert.deepEqual(pulseGain.slice(-3).map(([kind, value]) => [kind, Number(value.toFixed(4))]), [['set', 0.187], ['ramp', 0.34], ['ramp', 0.1632]]);
  engine.stop();
  assert.ok(log.oscillators.every((oscillator) => oscillator.stopped));
  assert.deepEqual(cleared, [1, 2, 3]);
});

test('a track of another kind replaces the one before it', async () => {
  const { log, Context } = fakeAudio();
  const made = [];
  class Element {
    constructor(url) { this.url = url; this.paused = true; this.currentTime = 0; made.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const engine = createMusicEngine({ AudioContextClass: Context, AudioElementClass: Element, fetchImpl: packServer().fetchImpl });
  engine.play({ id: 'a', url: '/a.wav' }, {});
  engine.play(song('fist-fight'), { intensity: 1 });
  await settle();
  assert.equal(made[0].paused, true);
  assert.equal(log.sources.length, 1);
  engine.play({ id: 'b', url: '/b.wav' }, {});
  assert.notEqual(log.sources[0].stopped, null, 'the licensed voice is retired');
  assert.equal(made[1].paused, false);
  assert.equal(engine.snapshot().kind, 'hosted');
  engine.play({ id: 'c', url: '/c.wav' }, {});
  assert.deepEqual([made[1].paused, made[2].paused], [true, false], 'another hosted file replaces the first');
});
