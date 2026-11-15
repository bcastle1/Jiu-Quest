// Plays the background music and keeps it playing while the player moves around the app.
//
// Three kinds of track:
//   licensed   a looped song shipped as three packs of the same length, one per intensity.
//              The engine loops the level it is asked for with a Web Audio buffer source.
//              Another level of the same song crossfades in at the same place in the loop;
//              another song crossfades in at the place it would have reached had it been
//              playing all along, so coming back to a screen picks its song up, not restarts it.
//   hosted     one audio file at a URL, looped by an <audio> element.
//   procedural no file: a synth pulse.
//
// A licensed pack holds [last moment of the loop][the loop][first moment of the loop]. The loop
// region starts `prerollSeconds` in. Because the sound on both sides of each loop point is the
// same periodic signal, the loop stays seamless whatever delay a browser's decoder adds.
import { decodeMusicPack } from "./musicPack.js";
import { musicTrackKey } from "./musicLibrary.js";

export const MUSIC_FADE_SECONDS = 1.6;
export const SONG_FADE_OUT_SECONDS = 1.2;
export const SONG_FADE_IN_SECONDS = 0.8;
export const MUSIC_RETRY_SECONDS = 4;
export const MUSIC_MAX_RETRIES = 5;
const STOP_FADE_SECONDS = 0.3;
const START_FADE_SECONDS = 0.03;
const SCHEDULE_AHEAD_SECONDS = 0.06;
const FETCH_TIMEOUT_SECONDS = 45;
const REST_AFTER_STOP_SECONDS = 1;
// Decoded audio is large (about 35 MB for a 90 second song), fetched packs are small (about 2 MB).
const MAX_DECODED_LEVELS = 2;
const MAX_KEPT_PACKS = 12;

const COULD_NOT_PLAY = "Music could not play. Check your connection and try again.";
const UNAVAILABLE = "Audio is unavailable in this browser.";
const BLOCKED = "Audio playback was blocked. Try enabling music again.";

const clampLevel = (level) => (level === 3 ? 3 : level === 2 ? 2 : 1);
const clampVolume = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const levelKey = (track, level) => `${track.id}:${level}`;

export function musicTrackKind(track) {
  if (track?.licensed && track.files) return "licensed";
  return track?.url?.trim() ? "hosted" : "procedural";
}

export function createMusicEngine(options = {}) {
  const scope = typeof window !== "undefined" ? window : globalThis;
  const AudioContextClass = options.AudioContextClass ?? scope.AudioContext ?? scope.webkitAudioContext;
  const AudioElementClass = options.AudioElementClass ?? scope.Audio;
  const AbortControllerClass = options.AbortControllerClass ?? scope.AbortController;
  const fetchImpl = options.fetchImpl ?? ((url, init) => scope.fetch(url, init));
  const setIntervalImpl = options.setIntervalImpl ?? ((callback, milliseconds) => scope.setInterval(callback, milliseconds));
  const clearIntervalImpl = options.clearIntervalImpl ?? ((handle) => scope.clearInterval(handle));
  // Timers of the engine's own never keep a process alive (they matter only while a page is open).
  const setTimeoutImpl = options.setTimeoutImpl ?? ((callback, milliseconds) => {
    const handle = scope.setTimeout(callback, milliseconds);
    handle?.unref?.();
    return handle;
  });
  const clearTimeoutImpl = options.clearTimeoutImpl ?? ((handle) => scope.clearTimeout(handle));
  let onError = options.onError;
  let context = null;
  let master = null;
  let volume = 0.34;
  let intensity = 1;
  let session = null;
  let restTimer = null;
  // Fetched and unpacked, not yet decoded: a return visit to a song only has to decode it.
  const packs = new Map();

  function ensureContext() {
    if (context) return context;
    if (!AudioContextClass) return null;
    try {
      context = new AudioContextClass();
    } catch {
      context = null;
      return null;
    }
    // On an iPhone, Web Audio stays silent while the ring switch is off unless the page says it
    // plays media, the way an <audio> element does. Browsers without this setting ignore it.
    try {
      const audioSession = scope.navigator?.audioSession;
      if (audioSession) audioSession.type = "playback";
    } catch {
      // Not supported here.
    }
    master = context.createGain();
    master.gain.value = volume;
    master.connect(context.destination);
    return context;
  }

  // Gets a paused audio context going again: suspended by the browser or by this engine after
  // the music was turned off, or interrupted by a phone call.
  function wake(onBlocked) {
    if (restTimer != null) {
      clearTimeoutImpl(restTimer);
      restTimer = null;
    }
    if (context && context.state !== "running" && context.state !== "closed") context.resume()?.catch?.(() => onBlocked?.());
  }

  // With the music off there is nothing to render: let the audio context rest.
  function restWhenIdle() {
    if (!context || restTimer != null) return;
    restTimer = setTimeoutImpl(() => {
      restTimer = null;
      if (!session && context?.state === "running") context.suspend?.()?.catch?.(() => {});
    }, REST_AFTER_STOP_SECONDS * 1000);
  }

  // Browsers only let sound start from a press. Call this inside the press that turns music on.
  function prime() {
    if (ensureContext()) wake();
  }

  // A phone call or a locked screen can leave the audio context paused. When the player
  // comes back to the page with music on, pick it up again.
  function resumeIfPaused() {
    if (session) wake();
  }

  function fail(failed, message) {
    if (session !== failed) return;
    stop();
    onError?.(message);
  }

  const decodeAudio = (data) =>
    new Promise((resolve, reject) => {
      const decoding = context.decodeAudioData(data, resolve, reject);
      decoding?.then?.(resolve, reject);
    });

  // ---- Licensed songs ----

  function fetchPack(url) {
    if (!packs.has(url)) {
      // A request that never answers is given up on, so it cannot hold up what comes after it.
      const controller = AbortControllerClass ? new AbortControllerClass() : null;
      const giveUp = controller ? setTimeoutImpl(() => controller.abort(), FETCH_TIMEOUT_SECONDS * 1000) : null;
      const loading = Promise.resolve()
        .then(() => fetchImpl(url, controller ? { signal: controller.signal } : undefined))
        .then((response) => {
          if (!response.ok) throw new Error(`music pack answered ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => decodeMusicPack(new Uint8Array(data)))
        .finally(() => {
          if (giveUp != null) clearTimeoutImpl(giveUp);
        });
      packs.set(url, loading);
      loading.catch(() => {
        if (packs.get(url) === loading) packs.delete(url);
      });
      while (packs.size > MAX_KEPT_PACKS) packs.delete(packs.keys().next().value);
    }
    return packs.get(url);
  }

  // Keeps what is playing and `keepKey`, and drops other decoded levels beyond the limit.
  function trimDecoded(playing, keepKey) {
    const limit = playing.decoded.has(keepKey) ? MAX_DECODED_LEVELS : MAX_DECODED_LEVELS - 1;
    for (const cached of [...playing.decoded.keys()]) {
      if (playing.decoded.size <= limit) break;
      if (cached !== playing.currentKey && cached !== keepKey) playing.decoded.delete(cached);
    }
  }

  function loadLevel(playing, track, level) {
    const key = levelKey(track, level);
    if (!playing.decoded.has(key)) {
      // decodeAudioData takes the buffer it is given, so it gets a copy.
      const loading = fetchPack(track.files[level]).then((audio) => decodeAudio(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)));
      playing.decoded.set(key, loading);
      loading.catch(() => {
        if (playing.decoded.get(key) === loading) playing.decoded.delete(key);
      });
    }
    return playing.decoded.get(key);
  }

  // Where in its loop a song is at context time `when`. A song's clock starts the first time
  // it is heard and then runs on, played or not, until the music is turned off.
  function loopPosition(playing, track, when) {
    const length = track.loopSeconds;
    return (((when - playing.clocks.get(track.id)) % length) + length) % length;
  }

  function startVoice(playing, track, buffer, when, fadeSeconds) {
    const { prerollSeconds, loopSeconds } = track;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = prerollSeconds;
    source.loopEnd = prerollSeconds + loopSeconds;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + fadeSeconds);
    source.connect(gain);
    gain.connect(master);
    source.start(when, prerollSeconds + loopPosition(playing, track, when));
    return { source, gain, fadeFrom: when, fadeUntil: when + fadeSeconds, out: null };
  }

  // How loud a voice is at `when`, worked out from its own fades. Reading the gain back from
  // the browser is not reliable while a fade is running.
  function voiceLevelAt(voice, when) {
    if (voice.out && when >= voice.out.from) {
      const span = voice.out.until - voice.out.from;
      return span <= 0 ? 0 : voice.out.level * Math.max(0, 1 - (when - voice.out.from) / span);
    }
    if (when >= voice.fadeUntil) return 1;
    if (when <= voice.fadeFrom) return 0;
    return (when - voice.fadeFrom) / (voice.fadeUntil - voice.fadeFrom);
  }

  // Fades a voice out from wherever it is. Cancelling what was scheduled also removes the
  // fade it was in the middle of, so that fade is put back up to `when` first: without it the
  // voice would drop to its last fixed value and jump.
  function retireVoice(playing, voice, when, fadeSeconds) {
    const until = when + fadeSeconds;
    if (voice.out && voice.out.until <= until) return; // already on its way out at least as fast
    const from = voiceLevelAt(voice, when);
    const level = voice.gain.gain;
    level.cancelScheduledValues(when);
    level.linearRampToValueAtTime(from, when);
    level.linearRampToValueAtTime(0, until);
    voice.source.stop(until + 0.05);
    voice.out = { from: when, until, level: from };
    if (!playing.fading.includes(voice)) playing.fading.push(voice);
  }

  async function showMusic(playing, track, level) {
    const key = levelKey(track, level);
    playing.wanted = { track, level, key };
    if (playing.retryTimer != null) {
      clearTimeoutImpl(playing.retryTimer);
      playing.retryTimer = null;
    }
    trimDecoded(playing, key);
    let buffer;
    try {
      buffer = await loadLevel(playing, track, level);
    } catch {
      if (session !== playing || playing.wanted.key !== key) return;
      // Nothing playing yet: say so and turn the music off.
      if (playing.voices.length === 0) {
        fail(playing, COULD_NOT_PLAY);
        return;
      }
      // Otherwise keep what is playing and try again in a moment, a few times.
      const tries = (playing.retries.get(key) ?? 0) + 1;
      playing.retries.set(key, tries);
      if (tries <= MUSIC_MAX_RETRIES) {
        playing.retryTimer = setTimeoutImpl(() => {
          playing.retryTimer = null;
          if (session === playing && playing.wanted.key === key) showMusic(playing, track, level);
        }, MUSIC_RETRY_SECONDS * 1000);
      }
      return;
    }
    // Stopped, replaced, asked for something else since, or already there.
    if (session !== playing || playing.wanted.key !== key || playing.currentKey === key) return;
    playing.retries.delete(key);
    const when = context.currentTime + SCHEDULE_AHEAD_SECONDS;
    const first = playing.voices.length === 0;
    const sameSong = playing.currentTrackId === track.id;
    if (!playing.clocks.has(track.id)) playing.clocks.set(track.id, when);
    playing.fading = playing.fading.filter((voice) => voice.out.until + 0.05 > context.currentTime);
    playing.voices.forEach((voice) => retireVoice(playing, voice, when, sameSong ? MUSIC_FADE_SECONDS : SONG_FADE_OUT_SECONDS));
    playing.voices = [startVoice(playing, track, buffer, when, first ? START_FADE_SECONDS : sameSong ? MUSIC_FADE_SECONDS : SONG_FADE_IN_SECONDS)];
    playing.currentKey = key;
    playing.currentTrackId = track.id;
    playing.currentLevel = level;
    trimDecoded(playing, playing.wanted.key);
  }

  function playLicensed(track) {
    if (session?.kind !== "licensed") {
      stop();
      const audioContext = ensureContext();
      const playing = { kind: "licensed", voices: [], fading: [], decoded: new Map(), clocks: new Map(), retries: new Map(), retryTimer: null, wanted: null, currentKey: null, currentTrackId: null, currentLevel: 0 };
      session = playing;
      if (!audioContext) {
        fail(playing, UNAVAILABLE);
        return;
      }
      wake(() => fail(playing, BLOCKED));
    }
    showMusic(session, track, intensity);
  }

  // ---- A hosted file ----

  function startHosted(playing) {
    if (!AudioElementClass) {
      fail(playing, UNAVAILABLE);
      return;
    }
    const audio = new AudioElementClass(playing.track.url.trim());
    audio.loop = true;
    audio.volume = volume;
    playing.audio = audio;
    const report = () => fail(playing, COULD_NOT_PLAY);
    audio.onerror = report;
    audio.play()?.catch?.(report);
  }

  // ---- The synth pulse ----

  function schedulePulse(playing) {
    if (playing.pulse != null) clearIntervalImpl(playing.pulse);
    const tempo = intensity === 3 ? playing.beatSeconds / 2 : intensity === 2 ? playing.beatSeconds : playing.beatSeconds * 1.5;
    playing.pulse = setIntervalImpl(() => {
      const now = context.currentTime;
      const level = playing.gain.gain;
      level.cancelScheduledValues(now);
      level.setValueAtTime(volume * 0.55, now);
      level.linearRampToValueAtTime(volume, now + 0.03);
      level.linearRampToValueAtTime(volume * 0.48, now + 0.22);
    }, tempo * 1000);
  }

  function startProcedural(playing) {
    const audioContext = ensureContext();
    if (!audioContext) {
      fail(playing, UNAVAILABLE);
      return;
    }
    const gain = audioContext.createGain();
    gain.gain.value = volume;
    gain.connect(audioContext.destination);
    const bpm = Math.max(90, Math.min(180, Number(playing.track?.bpm) || 132));
    const root = playing.track?.id === "paradise-circuit" ? 123.47 : playing.track?.id === "power-clash" ? 98 : 110;
    playing.beatSeconds = 60 / bpm;
    playing.gain = gain;
    playing.oscillators = [root, root * 1.334, root * 2].map((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const oscillatorGain = audioContext.createGain();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillatorGain.gain.value = index === 0 ? 0.08 : 0.025;
      oscillator.connect(oscillatorGain);
      oscillatorGain.connect(gain);
      oscillator.start();
      return oscillator;
    });
    schedulePulse(playing);
    wake(() => fail(playing, BLOCKED));
  }

  // ---- What the app calls ----

  // Makes `track` the music, at this intensity. Safe to call again with the same track: what
  // is already playing keeps playing, and only what differs changes.
  function play(track, settings = {}) {
    if (settings.volume != null) setVolume(settings.volume);
    if (settings.intensity != null) intensity = clampLevel(settings.intensity);
    const kind = musicTrackKind(track);
    if (kind === "licensed") {
      playLicensed(track);
      return;
    }
    const key = musicTrackKey(track);
    if (session && session.kind === kind && session.key === key) {
      if (kind === "procedural" && session.gain) schedulePulse(session);
      return;
    }
    stop();
    const playing = { track, kind, key };
    session = playing;
    if (kind === "hosted") startHosted(playing);
    else startProcedural(playing);
  }

  function stop() {
    const stopped = session;
    if (!stopped) return;
    session = null;
    if (stopped.kind === "licensed") {
      if (stopped.retryTimer != null) clearTimeoutImpl(stopped.retryTimer);
      // Every voice still sounding goes, the ones already fading out included.
      if (context) [...stopped.voices, ...stopped.fading].forEach((voice) => retireVoice(stopped, voice, context.currentTime, STOP_FADE_SECONDS));
      stopped.voices = [];
      stopped.decoded.clear();
    } else if (stopped.kind === "hosted") {
      if (stopped.audio) {
        stopped.audio.onerror = null;
        stopped.audio.pause();
        stopped.audio.currentTime = 0;
      }
    } else {
      if (stopped.pulse != null) clearIntervalImpl(stopped.pulse);
      (stopped.oscillators ?? []).forEach((oscillator) => oscillator.stop());
      stopped.gain?.disconnect();
    }
    restWhenIdle();
  }

  function setIntensity(level) {
    intensity = clampLevel(level);
    if (!session) return;
    if (session.kind === "licensed" && session.wanted) showMusic(session, session.wanted.track, intensity);
    else if (session.kind === "procedural" && session.gain) schedulePulse(session);
  }

  function setVolume(value) {
    volume = clampVolume(value);
    if (master) master.gain.value = volume;
    if (session?.audio) session.audio.volume = volume;
  }

  // Fetches packs ahead of need, one after another, so a change of screen only has to decode.
  function preload(items) {
    let chain = Promise.resolve();
    for (const item of items ?? []) {
      if (musicTrackKind(item?.track) !== "licensed" || !item.track.files[item.level]) continue;
      chain = chain.then(() => fetchPack(item.track.files[item.level])).then(
        () => {},
        () => {},
      );
    }
    return chain;
  }

  function dispose() {
    stop();
    if (restTimer != null) clearTimeoutImpl(restTimer);
    restTimer = null;
    packs.clear();
    context?.close?.()?.catch?.(() => {});
    context = null;
    master = null;
  }

  return {
    prime,
    play,
    stop,
    setIntensity,
    setVolume,
    preload,
    resumeIfPaused,
    dispose,
    setErrorHandler(handler) {
      onError = handler;
    },
    // For checks: what the engine is doing right now.
    snapshot() {
      const licensed = session?.kind === "licensed";
      return {
        kind: session?.kind ?? null,
        trackId: licensed ? session.currentTrackId : session?.track?.id ?? null,
        level: licensed ? session.currentLevel : 0,
        wanted: licensed ? session.wanted?.key ?? null : null,
        voices: session?.voices?.length ?? 0,
        decodedLevels: licensed ? session.decoded.size : 0,
        intensity,
        volume,
        contextState: context?.state ?? null,
      };
    },
  };
}
