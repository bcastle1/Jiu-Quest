// Verifies the background music in the built site in a real browser: every
// screen plays the song and intensity the soundtrack gives it, the music
// crossfades from one to the next without stopping, a song the player comes
// back to has kept its place, a song the player picks either stays on every
// screen or lasts until the screen changes, the choices are kept, and a pack
// that cannot be fetched turns the music off with a message.
//
// Licensed music is not in the repository, so the checks play small test tones
// packed the same way and served by this script. When the build under test
// does carry licensed music, its own songs are also loaded and checked.
// Sound is muted. Nothing here runs Unity, Unreal or any stream.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { encodeMusicPack } from '../src/audio/musicPack.js';
import { MUSIC_FADE_SECONDS, SONG_FADE_OUT_SECONDS } from '../src/audio/musicEngine.js';
import { licensedTracksFrom, pageMusic, SOUNDTRACK_TITLE } from '../src/audio/musicLibrary.js';
import { defaultMusicTracks } from '../src/storage.js';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'music-engine');
await mkdir(artifacts, { recursive: true });
const checks = [], errors = [], consoleErrors = [], failedResponses = [], measurements = [];
// --disable-audio-output gives the browser a stand-in sound device, so the audio clock runs on
// a build server that has no sound hardware, and nothing is heard on a computer that has.
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader', '--mute-audio', '--disable-audio-output'],...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.jqm': 'application/octet-stream' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'Background music in desktop Chromium at 1440 pixels, and the track menu also at a 390 pixel phone size with touch emulation; muted, with test tones in place of licensed songs. No physical device, no other browser, and nobody listened.' };
const DESKTOP = { name: 'desktop', touch: false, options: { viewport: { width: 1440, height: 900 } } };
const PHONE = { name: 'phone', touch: true, options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } };
const SAVED_TRACKS = defaultMusicTracks.filter((track) => track.playerEnabled !== false).map((track) => track.title);
const TEST_BASE = '/assets/audio/licensed-test/';
const PREROLL = 0.5;
let browser, server, page, base;

// ---- Test songs: a steady tone per level, whole cycles per loop, so each loop is seamless.
// They carry the ids the soundtrack names, so each screen finds its song. ----

function toneLoop(hz, loopSeconds) {
  const rate = 8000;
  const total = Math.round((loopSeconds + 2 * PREROLL) * rate);
  const wav = Buffer.alloc(44 + total * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + total * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(total * 2, 40);
  for (let index = 0; index < total; index += 1) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * ((index / rate) - PREROLL)) * 12000), 44 + index * 2);
  return new Uint8Array(wav);
}
const SONGS = {
  'fist-fight': { id: 'fist-fight', title: 'Fist Fight', loopSeconds: 2, tones: { 1: 220, 2: 330, 3: 440 } },
  'in-the-storm': { id: 'in-the-storm', title: 'In The Storm', loopSeconds: 3, tones: { 1: 200, 2: 300, 3: 400 } },
  'sneak-attack': { id: 'sneak-attack', title: 'Sneak Attack', loopSeconds: 2.5, tones: { 1: 240, 2: 360, 3: 480 } },
  binder: { id: 'binder', title: 'Binder', loopSeconds: 4, tones: { 1: 250, 2: 375, 3: 500 } },
};
const SONG_LIST = Object.values(SONGS);
const SONG_TITLES = SONG_LIST.map((song) => song.title);
const packs = new Map();
const testIndex = (songs, missing = []) => ({
  version: 1,
  base: TEST_BASE,
  tracks: songs.map((song) => ({
    id: song.id, title: song.title, credit: 'Test tones', mood: 'Test tones', bpm: 120, loopSeconds: song.loopSeconds, prerollSeconds: PREROLL,
    files: Object.fromEntries([1, 2, 3].map((level) => [level, `${song.id}.${level}${missing.includes(`${song.id}.${level}`) ? '.missing' : ''}.jqm`])),
  })),
});
for (const song of SONG_LIST) for (const level of [1, 2, 3]) packs.set(`${song.id}.${level}.jqm`, encodeMusicPack(toneLoop(song.tones[level], song.loopSeconds), 1000 + level));

async function staticSite() {
  await stat(resolve(root, 'index.html'));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.startsWith(TEST_BASE)) {
        const pack = packs.get(pathname.slice(TEST_BASE.length));
        if (!pack) { response.writeHead(404); response.end('Not found'); return; }
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(Buffer.from(pack));
        return;
      }
      const file = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end(); return; }
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return `http://127.0.0.1:${server.address().port}`;
}

// Runs in the page before the app: records what the music engine asks Web Audio and
// <audio> to do. `licensed` is the index the app should believe this build carries;
// undefined leaves the build's own.
function watchAudio(licensed) {
  if (licensed !== undefined) window.__jqLicensedMusicForTests = licensed;
  const seen = { sources: [], contexts: 0, elements: [], reachSpeakers: 0 };
  window.__music = seen;
  // Whether anything is wired to the speakers at all: sound nobody can hear would pass every other check.
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function connectWatched(target, ...rest) {
    if (target instanceof AudioDestinationNode) seen.reachSpeakers += 1;
    return connect.call(this, target, ...rest);
  };
  const NativeContext = window.AudioContext;
  window.AudioContext = class extends NativeContext {
    constructor(...settings) { super(...settings); seen.contexts += 1; seen.context = this; }
  };
  const createSource = BaseAudioContext.prototype.createBufferSource;
  BaseAudioContext.prototype.createBufferSource = function createWatchedSource() {
    const node = createSource.call(this);
    const record = {};
    seen.sources.push(record);
    const start = node.start.bind(node);
    const stop = node.stop.bind(node);
    node.start = (when, offset) => {
      // A test tone's pitch says which song and level this is: count zero crossings over one second.
      const data = node.buffer.getChannelData(0);
      const rate = node.buffer.sampleRate;
      let crossings = 0;
      for (let index = Math.round(rate * 0.6) + 1; index < Math.round(rate * 1.6) && index < data.length; index += 1) if ((data[index - 1] < 0) !== (data[index] < 0)) crossings += 1;
      record.start = { when, offset, loop: node.loop, loopStart: node.loopStart, loopEnd: node.loopEnd, seconds: node.buffer.duration, hz: Math.round(crossings / 2) };
      return start(when, offset);
    };
    node.stop = (when) => { record.stop = when; return stop(when); };
    return node;
  };
  const NativeAudio = window.Audio;
  window.Audio = function WatchedAudio(source) {
    const element = new NativeAudio(source);
    const record = { source, plays: 0, pauses: 0, element };
    seen.elements.push(record);
    const play = element.play.bind(element);
    const pause = element.pause.bind(element);
    element.play = () => { record.plays += 1; return play(); };
    element.pause = () => { record.pauses += 1; return pause(); };
    return element;
  };
}

async function open(licensed, { expectMissing = [], size = DESKTOP } = {}) {
  const context = await browser.newContext({ deviceScaleFactor: 1, ...size.options });
  await context.addInitScript(watchAudio, licensed);
  page = await context.newPage();
  const expected = (url) => expectMissing.some((name) => url.includes(name));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !expected(message.location().url || '')) consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('response', (response) => { if (response.status() >= 400 && !expected(response.url())) failedResponses.push({ url: response.url(), status: response.status() }); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await navButton('Overview').waitFor();
  return context;
}
const reload = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await navButton('Overview').waitFor(); };

const soon = (waiting, message) => waiting.catch((error) => assert.fail(`${message}: that did not happen (${error.name})`));
const navButton = (name) => page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('button', { name, exact: true });
const goTo = async (name) => { await navButton(name).click(); await soon(page.waitForFunction((label) => document.querySelector('nav[aria-label="Main"] [aria-current="page"]')?.getAttribute('aria-label') === label, name), `${name} opens`); };
const musicToggle = () => page.locator('.music-toggle');
const trackButton = () => page.locator('.player-track-trigger');
const trackShown = async () => (await trackButton().locator('span').textContent()).trim();
const shows = (title, what) => soon(page.waitForFunction((expected) => document.querySelector('.player-track-trigger span')?.textContent.trim() === expected, title), `${what}: the music button names ${title}`);
const openMenu = async () => { if (!(await page.locator('.player-track-menu').count())) await trackButton().click(); await page.locator('.player-track-menu').waitFor(); };
const closeMenu = async () => { if (await page.locator('.player-track-menu').count()) await page.keyboard.press('Escape'); await page.locator('.player-track-menu').waitFor({ state: 'detached' }); };
// The menu as a player reads it: every entry, with a star on the selected one.
const menuEntries = async () => { await openMenu(); const entries = await page.locator('.player-track-menu button').evaluateAll((buttons) => buttons.map((button) => `${button.getAttribute('aria-pressed') === 'true' ? '*' : ''}${button.querySelector('span').textContent.trim()}`)); await closeMenu(); return entries; };
const chooseTrack = async (title) => { await openMenu(); await page.locator('.player-track-menu button').filter({ has: page.locator('span', { hasText: new RegExp(`^${title}$`) }) }).click(); await page.locator('.player-track-menu').waitFor({ state: 'detached' }); };
const keepOption = () => page.locator('.player-track-keep input');
const setKeep = async (keep) => { await openMenu(); if (keep) await keepOption().check(); else await keepOption().uncheck(); await closeMenu(); };
const sources = () => page.evaluate(() => window.__music.sources.map((source) => ({ start: source.start ?? null, stop: source.stop ?? null })));
const started = async (count, what) => { await soon(page.waitForFunction((n) => window.__music.sources.filter((source) => source.start).length >= n, count), what); return sources(); };
const audioState = () => page.evaluate(() => ({ contexts: window.__music.contexts, state: window.__music.context?.state ?? null, reachSpeakers: window.__music.reachSpeakers }));
const elements = () => page.evaluate(() => window.__music.elements.map((entry) => ({ source: entry.source, plays: entry.plays, pauses: entry.pauses, paused: entry.element.paused, loop: entry.element.loop, time: entry.element.currentTime })));
const savedMusic = () => page.evaluate(() => { for (const key of Object.keys(localStorage)) { try { const music = JSON.parse(localStorage.getItem(key))?.adminSettings?.music; if (music) return { selected: music.activeTrackId, keep: music.keepSongAcrossPages }; } catch { /* not the saved game */ } } return null; });
const close = (a, b, slack = 1e-6) => Math.abs(a - b) <= slack;
const turnMusicOn = async () => { await musicToggle().click(); assert.equal(await musicToggle().getAttribute('aria-pressed'), 'true'); };

// Each song has its own clock, started the first time it is heard: a voice of that song must
// start at the place the clock has reached.
const loopPosition = (when, songStart, loopSeconds) => (((when - songStart) % loopSeconds) + loopSeconds) % loopSeconds;
function assertVoice(voice, song, level, clocks, what) {
  assert.ok(voice?.start, `${what}: a voice was started`);
  assert.equal(voice.start.hz, song.tones[level], `${what}: it is ${song.title} at level ${level}`);
  assert.equal(voice.start.loop, true, `${what}: it loops`);
  assert.ok(close(voice.start.loopStart, PREROLL) && close(voice.start.loopEnd, PREROLL + song.loopSeconds), `${what}: it loops the loop region`);
  assert.ok(close(voice.start.seconds, song.loopSeconds + 2 * PREROLL, 0.01), `${what}: the whole pack was decoded`);
  if (!clocks.has(song.id)) clocks.set(song.id, voice.start.when);
  const position = loopPosition(voice.start.when, clocks.get(song.id), song.loopSeconds);
  assert.ok(close(voice.start.offset, PREROLL + position), `${what}: it starts where the song is (${voice.start.offset} against ${PREROLL + position})`);
}

// ---- A build without licensed music: the saved tracks, and no restart between screens ----
async function savedTrackKeepsPlaying() {
  const context = await open({ version: 1, tracks: [] });
  assert.equal(await trackShown(), SAVED_TRACKS[0]);
  assert.deepEqual(await menuEntries(), [`*${SAVED_TRACKS[0]}`, ...SAVED_TRACKS.slice(1)], 'only the saved tracks are offered, the first one selected');
  await openMenu();
  assert.equal(await keepOption().count(), 0, 'with no soundtrack there is no option about going back to it');
  await closeMenu();
  await turnMusicOn();
  await soon(page.waitForFunction(() => window.__music.elements.length === 1 && !window.__music.elements[0].element.paused && window.__music.elements[0].element.currentTime > 0.2), 'the track starts playing');
  for (const view of ['Arena', 'Training', 'Lab', 'Profile', 'Overview']) await goTo(view);
  await page.waitForTimeout(400);
  const [playing, ...others] = await elements();
  assert.equal(others.length, 0, 'moving between screens does not start another player');
  assert.deepEqual([playing.plays, playing.pauses, playing.paused, playing.loop], [1, 0, false, true], 'the same track is still playing, started once');
  assert.ok(playing.time > 0.5, 'and it kept its place instead of starting over');
  assert.equal(playing.source, defaultMusicTracks[0].url);
  assert.deepEqual(await sources(), [], 'a single hosted file needs no buffer sources');
  measurements.push({ check: 'saved track across screens', secondsPlayed: Number(playing.time.toFixed(2)) });
  await musicToggle().click();
  assert.equal(await musicToggle().getAttribute('aria-pressed'), 'false');
  const [stopped] = await elements();
  assert.deepEqual([stopped.paused, stopped.time], [true, 0], 'turning music off stops it');
  await context.close();
}

// ---- The soundtrack: a song and an intensity for each screen ----
async function soundtrackFollowsTheScreens() {
  const context = await open(testIndex(SONG_LIST));
  const clocks = new Map();
  // A new player's first screen selects the soundtrack a moment after it is drawn.
  await shows('Fist Fight', 'on the home screen');
  assert.deepEqual(await menuEntries(), [`*${SOUNDTRACK_TITLE}`, ...SONG_TITLES, ...SAVED_TRACKS], 'the soundtrack leads the menu and is selected, then the songs, then the saved tracks');
  await openMenu();
  assert.equal(await keepOption().isChecked(), true, 'a picked song is kept on every screen unless the player says otherwise');
  await closeMenu();

  await turnMusicOn();
  let voices = await started(1, 'the home song starts');
  assertVoice(voices[0], SONGS['fist-fight'], 2, clocks, 'home: Fist Fight, medium');

  await goTo('Profile');
  voices = await started(2, 'the profile song starts');
  assertVoice(voices[1], SONGS['in-the-storm'], 3, clocks, 'profile: In The Storm, full');
  assert.ok(close(voices[0].stop, voices[1].start.when + SONG_FADE_OUT_SECONDS + 0.05), 'the song before it stops when its fade-out is over');
  await shows('In The Storm', 'profile');

  await goTo('Training');
  voices = await started(3, 'the training song starts');
  assertVoice(voices[2], SONGS['sneak-attack'], 1, clocks, 'training: Sneak Attack, low');
  await goTo('Lab');
  await page.waitForTimeout(350);
  assert.equal((await sources()).length, 3, 'the Lab is part of training: the song carries on untouched');

  await goTo('Arena');
  voices = await started(4, 'the Arena song starts');
  assertVoice(voices[3], SONGS.binder, 3, clocks, 'Arena: Binder, full');
  await page.getByRole('button', { name: 'Standing Start', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal((await sources()).length, 4, 'starting a match does not touch the Arena song');

  // Home again, after the home song has had time to go round at least once: Fist Fight is
  // where it would have been had it played all along.
  await soon(page.waitForFunction(([startedAt, loopSeconds]) => window.__music.context.currentTime - startedAt > loopSeconds + 0.3, [clocks.get('fist-fight'), SONGS['fist-fight'].loopSeconds]), 'the home song has had time to go round');
  await goTo('Overview');
  voices = await started(5, 'the home song comes back');
  assertVoice(voices[4], SONGS['fist-fight'], 2, clocks, 'home again');
  assert.ok(voices[4].start.when - clocks.get('fist-fight') > SONGS['fist-fight'].loopSeconds, 'by now the home song has gone round at least once');
  await shows('Fist Fight', 'home again');
  await goTo('Insights');
  await page.waitForTimeout(350);
  assert.equal((await sources()).length, 5, 'a screen the soundtrack does not name plays the home song: nothing changes');
  const audio = await audioState();
  assert.deepEqual([audio.contexts, audio.state], [1, 'running'], 'one audio context carried all of it');
  assert.equal(audio.reachSpeakers, 1, 'and it is wired to the speakers, once: through the master volume');
  assert.deepEqual(await elements(), [], 'licensed songs use no <audio> element');
  measurements.push({ check: 'soundtrack', voices: voices.map((voice) => ({ hz: voice.start.hz, when: Number(voice.start.when.toFixed(3)), offset: Number(voice.start.offset.toFixed(3)) })) });

  await musicToggle().click();
  assert.equal(await musicToggle().getAttribute('aria-pressed'), 'false');
  voices = await sources();
  assert.ok(voices.every((voice) => voice.stop != null), 'turning music off stops every voice');
  await context.close();
}

// ---- A song the player picks: kept on every screen, or until the screen changes ----
async function pickedSongFollowsTheOption() {
  const context = await open(testIndex(SONG_LIST));
  let clocks = new Map();
  await turnMusicOn();
  let voices = await started(1, 'the home song starts');
  assertVoice(voices[0], SONGS['fist-fight'], 2, clocks, 'home');

  // Kept on every screen (the option as it comes).
  await chooseTrack('Binder');
  voices = await started(2, 'the picked song starts');
  assertVoice(voices[1], SONGS.binder, 2, clocks, 'a picked song plays at the screen\'s own level: medium at home');
  await shows('Binder', 'picked');
  assert.deepEqual(await savedMusic(), { selected: 'licensed-binder', keep: undefined });
  await goTo('Training');
  voices = await started(3, 'the picked song changes level');
  assertVoice(voices[2], SONGS.binder, 1, clocks, 'the same song in training, low');
  assert.ok(close(voices[1].stop, voices[2].start.when + MUSIC_FADE_SECONDS + 0.05), 'two levels of one song crossfade over the level fade');
  await goTo('Arena');
  voices = await started(4, 'the picked song changes level again');
  assertVoice(voices[3], SONGS.binder, 3, clocks, 'the same song in the Arena, full');
  assert.deepEqual((await menuEntries()).filter((entry) => entry.startsWith('*')), ['*Binder'], 'the menu marks the picked song');

  // It is still the choice after a reload.
  await reload();
  assert.equal(await trackShown(), 'Binder', 'the picked song is still selected after a reload');
  clocks = new Map();
  await turnMusicOn();
  voices = await started(1, 'the picked song starts after a reload');
  assertVoice(voices[0], SONGS.binder, 2, clocks, 'after a reload');

  // Switching the option off: the song stays for this screen, and the soundtrack is back on the next.
  await setKeep(false);
  await page.waitForTimeout(300);
  assert.equal((await sources()).length, 1, 'switching the option does not interrupt the song');
  assert.equal(await trackShown(), 'Binder');
  assert.deepEqual(await savedMusic(), { selected: 'soundtrack', keep: false });
  await goTo('Profile');
  voices = await started(2, 'the soundtrack comes back on the next screen');
  assertVoice(voices[1], SONGS['in-the-storm'], 3, clocks, 'profile, back on the soundtrack');
  assert.deepEqual((await menuEntries()).filter((entry) => entry.startsWith('*')), [`*${SOUNDTRACK_TITLE}`]);

  // With the option off, a pick lasts until the screen changes, and is not saved as the choice.
  await chooseTrack('Sneak Attack');
  voices = await started(3, 'a song picked for this screen starts');
  assertVoice(voices[2], SONGS['sneak-attack'], 3, clocks, 'picked on the profile screen, full');
  assert.deepEqual(await savedMusic(), { selected: 'soundtrack', keep: false });
  assert.deepEqual((await menuEntries()).filter((entry) => entry.startsWith('*')), ['*Sneak Attack']);
  await goTo('Arena');
  voices = await started(4, 'the Arena song takes over');
  assertVoice(voices[3], SONGS.binder, 3, clocks, 'the Arena, back on the soundtrack');
  // Coming back to the screen where the pick was made does not bring it back.
  await goTo('Profile');
  voices = await started(5, 'the profile song plays');
  assertVoice(voices[4], SONGS['in-the-storm'], 3, clocks, 'profile again: its own song, not the earlier pick');

  // Switching the option on while a pick is playing makes that song the choice everywhere.
  await chooseTrack('Fist Fight');
  voices = await started(6, 'another pick starts');
  assertVoice(voices[5], SONGS['fist-fight'], 3, clocks, 'another pick on the profile screen, full');
  await setKeep(true);
  assert.deepEqual(await savedMusic(), { selected: 'licensed-fist-fight', keep: true });
  await goTo('Training');
  voices = await started(7, 'the kept song changes level');
  assertVoice(voices[6], SONGS['fist-fight'], 1, clocks, 'the kept song in training');

  // The soundtrack entry puts the game back in charge.
  await chooseTrack(SOUNDTRACK_TITLE);
  voices = await started(8, 'the soundtrack is chosen again');
  assertVoice(voices[7], SONGS['sneak-attack'], 1, clocks, 'training on the soundtrack');
  assert.deepEqual(await savedMusic(), { selected: 'soundtrack', keep: true });

  // A saved track can be the kept song too: it replaces the licensed voices, and survives a reload.
  await chooseTrack(SAVED_TRACKS[0]);
  await soon(page.waitForFunction(() => window.__music.elements.length === 1 && !window.__music.elements[0].element.paused), 'the saved track starts');
  voices = await sources();
  assert.ok(voices.every((voice) => voice.stop != null), 'every licensed voice was stopped');
  await goTo('Arena');
  await page.waitForTimeout(300);
  assert.deepEqual((await elements()).map((entry) => [entry.plays, entry.paused]), [[1, false]], 'it keeps playing in the Arena');
  await reload();
  assert.equal(await trackShown(), SAVED_TRACKS[0], 'a saved track the player chose stays chosen');
  await context.close();
}

// ---- The track menu a build with licensed music has: nine rows and the option, by keyboard and by touch ----
async function soundtrackMenuWorks(size) {
  const context = await open(testIndex(SONG_LIST), { size });
  await shows('Fist Fight', 'on the home screen');
  const rows = [SOUNDTRACK_TITLE, ...SONG_TITLES, ...SAVED_TRACKS];
  const press = (locator) => (size.touch ? locator.tap() : locator.click());
  const focused = () => page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return 'the page body';
    if (element.matches('.player-track-trigger')) return 'the music button';
    if (element.matches('.player-track-keep input')) return 'the keep option';
    if (element.closest('.player-track-menu')) return `row: ${element.querySelector('span')?.textContent.trim()}`;
    return element.tagName.toLowerCase();
  });
  // Where the menu and the option are on screen, and what part of the option the menu shows.
  const layout = () => page.evaluate(() => {
    const box = (element) => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }; };
    const menu = document.querySelector('.player-track-menu');
    return { menu: box(menu), keep: box(document.querySelector('.player-track-keep')), scrolls: menu.scrollHeight > menu.clientHeight + 1, viewport: { width: window.innerWidth, height: window.innerHeight } };
  });
  const optionInView = async (what) => {
    const { menu, keep, viewport } = await layout();
    assert.ok(menu.left >= 0 && menu.right <= viewport.width + 0.5 && menu.bottom <= viewport.height + 0.5, `${what}: the menu is inside the screen`);
    assert.ok(keep.top >= menu.top - 0.5 && keep.bottom <= menu.bottom + 0.5, `${what}: the keep option is in view inside the menu, not below its fold`);
  };

  if (size.touch) {
    await press(trackButton());
    await page.locator('.player-track-menu').waitFor();
    await optionInView('opened by touch');
    assert.deepEqual(await page.locator('.player-track-menu button span').allTextContents(), rows);
    // The option is switched by a tap, and the menu stays open for the pick that follows.
    await press(keepOption());
    assert.equal(await keepOption().isChecked(), false);
    assert.equal(await page.locator('.player-track-menu').count(), 1, 'switching the option leaves the menu open');
    assert.match(await page.locator('.player-track-keep').innerText(), /until you change pages/);
    await press(keepOption());
    assert.equal(await keepOption().isChecked(), true);
    assert.match(await page.locator('.player-track-keep').innerText(), /plays everywhere/);
    // A tap on the last row picks it, closes the menu and names it on the button.
    const last = page.locator('.player-track-menu button').last();
    await last.scrollIntoViewIfNeeded();
    await optionInView('scrolled to the last row');
    await press(last);
    await page.locator('.player-track-menu').waitFor({ state: 'detached' });
    await shows(rows.at(-1), 'picked by touch');
  } else {
    await trackButton().focus();
    await page.keyboard.press('Enter');
    await page.locator('.player-track-menu').waitFor();
    await optionInView('opened by keyboard');
    // Tab walks every row in order, then reaches the option.
    const walked = [];
    for (let index = 0; index < rows.length + 1; index += 1) { await page.keyboard.press('Tab'); walked.push(await focused()); }
    assert.deepEqual(walked, [...rows.map((title) => `row: ${title}`), 'the keep option']);
    await optionInView('with focus on the option');
    // Space switches the option; the menu stays open and focus stays on it.
    await page.keyboard.press('Space');
    assert.equal(await keepOption().isChecked(), false);
    assert.equal(await focused(), 'the keep option');
    await page.keyboard.press('Space');
    assert.equal(await keepOption().isChecked(), true);
    // Escape from the option closes the menu and puts focus back on the button, not on the page.
    await page.keyboard.press('Escape');
    await page.locator('.player-track-menu').waitFor({ state: 'detached' });
    assert.equal(await focused(), 'the music button');
    // A row chosen with Enter closes the menu, names the song on the button and keeps focus there.
    await page.keyboard.press('Enter');
    await page.locator('.player-track-menu').waitFor();
    for (let index = 0; index < 5; index += 1) await page.keyboard.press('Tab');
    assert.equal(await focused(), 'row: Binder');
    await page.keyboard.press('Enter');
    await page.locator('.player-track-menu').waitFor({ state: 'detached' });
    await shows('Binder', 'picked by keyboard');
    assert.equal(await focused(), 'the music button');
  }
  measurements.push({ check: 'track menu with the soundtrack', size: size.name, rows: rows.length });
  await context.close();
}

// ---- A pack that cannot be fetched ----
async function missingPackTurnsMusicOff() {
  const context = await open(testIndex(SONG_LIST, ['fist-fight.2']), { expectMissing: ['.missing.jqm'] });
  // The failure can arrive before the switch is read, so only the press is made here.
  await musicToggle().click();
  const notice = page.locator('.app-feedback.error');
  await soon(notice.waitFor(), 'a message appears');
  assert.equal((await notice.locator('span').textContent()).trim(), 'Music could not play. Check your connection and try again.');
  assert.equal(await musicToggle().getAttribute('aria-pressed'), 'false', 'the music switch goes back to off');
  assert.deepEqual(await sources(), []);
  await context.close();
}

// ---- The licensed music this build really carries, when it carries any ----
async function shippedSongsLoad() {
  const indexFile = resolve(root, 'assets/audio/licensed/index.json');
  const shipped = existsSync(indexFile) ? licensedTracksFrom(JSON.parse(readFileSync(indexFile, 'utf8'))) : [];
  if (!shipped.length) return 'This build carries no licensed music, so only the test tones were played.';
  const context = await open(undefined);
  const home = pageMusic('dashboard', shipped);
  const arena = pageMusic('combat', shipped);
  await shows(home.track.title, 'on the home screen');
  assert.deepEqual(await menuEntries(), [`*${SOUNDTRACK_TITLE}`, ...shipped.map((track) => track.title), ...SAVED_TRACKS]);
  await turnMusicOn();
  const fits = (voice, track, what) => {
    assert.equal(voice.start.loop, true);
    assert.ok(close(voice.start.loopStart, track.prerollSeconds) && close(voice.start.loopEnd, track.prerollSeconds + track.loopSeconds), `${what}: it loops the loop region its index names`);
    assert.ok(close(voice.start.seconds, track.loopSeconds + 2 * track.prerollSeconds, 0.06), `${what}: the pack decodes to the loop plus its two margins`);
  };
  let voices = await started(1, `${home.track.title} starts`);
  fits(voices[0], home.track, home.track.title);
  assert.ok(close(voices[0].start.offset, home.track.prerollSeconds));
  await goTo('Arena');
  voices = await started(2, `${arena.track.title} starts`);
  fits(voices[1], arena.track, arena.track.title);
  await shows(arena.track.title, 'the Arena');
  measurements.push({ check: 'shipped songs', home: home.track.title, arena: arena.track.title, decodedSeconds: voices.map((voice) => Number(voice.start.seconds.toFixed(3))) });
  await musicToggle().click();
  await context.close();
  return `The licensed songs in this build load: ${home.track.title} on the home screen and ${arena.track.title} in the Arena each loop the region their index names.`;
}

try {
  base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch(browserOptions);
  report.browserVersion = browser.version();

  await savedTrackKeepsPlaying();
  checks.push('Without licensed music the player is offered the saved tracks; the chosen one keeps playing, from where it was, across Arena, Training, Lab, Profile and Overview, and stops when music is turned off.');

  await soundtrackFollowsTheScreens();
  checks.push('With licensed music the soundtrack is selected: home plays Fist Fight at medium, the profile In The Storm at full, Training and the Lab Sneak Attack at low and the Arena Binder at full, each crossfading in on one audio context; a song the player comes back to starts at the place it would have reached.');

  await pickedSongFollowsTheOption();
  checks.push('A picked song plays on every screen at that screen\'s level and survives a reload; with the option switched off it lasts until the screen changes and is not saved; switching the option carries the playing song over; the soundtrack entry and a saved track can be chosen too.');

  for (const size of [DESKTOP, PHONE]) await soundtrackMenuWorks(size);
  checks.push('The track menu with the soundtrack lists every row and keeps the keep-my-song option in view; by keyboard Tab walks the rows then the option, Space switches it without closing the menu, Escape returns focus to the music button and Enter picks a row; at 390 pixels by touch the menu stays inside the screen, a tap switches the option and a tap on the last row picks it.');

  await missingPackTurnsMusicOff();
  checks.push('A first song that cannot be fetched shows a message and turns the music switch off.');

  checks.push(await shippedSongsLoad());

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every file the pages ask for must load');
  report.status = 'passed';
  console.log(JSON.stringify({ checks, measurements, artifacts }, null, 2));
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  Object.assign(report, { checkedAtUtc: new Date().toISOString(), checks, measurements, pageErrors: errors, consoleErrors, failedResponses });
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
}
