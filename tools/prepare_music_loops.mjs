// Turns an Ovani music pack into web-ready, seamlessly looping tracks.
//
//   node tools/prepare_music_loops.mjs --pack <extracted pack root> --out <output dir> --ffmpeg <ffmpeg bin dir> [--songs "Fist Fight,Binder"]
//
// Each song folder is named "<Song> (RT <seconds>)": the three intensity files share one
// length, a whole number of beats, and end with a reverb tail of about RT seconds that
// fades to silence. A seamless loop is the body with that tail mixed back onto its start.
//
// For every intensity this writes an MP3 that holds: [last 0.5 s of the loop][the loop]
// [first 0.5 s of the loop]. A player loops the region [0.5 s, 0.5 s + loop length]; because
// the audio around both loop points is the same periodic signal, the loop stays seamless
// whatever delay a browser's MP3 decoder adds.
//
// The output is licensed audio: write it outside this repository. tools/pack_licensed_music.mjs
// then packs the songs the site should carry. See docs/music.md.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1] ?? ""]);
    return pairs;
  }, []),
);
for (const key of ["pack", "out", "ffmpeg"]) {
  if (!args[key]) {
    console.error(`missing --${key}`);
    process.exit(2);
  }
}
const EXE = process.platform === "win32" ? ".exe" : "";
const FFMPEG = path.join(args.ffmpeg, `ffmpeg${EXE}`);
const FFPROBE = path.join(args.ffmpeg, `ffprobe${EXE}`);
const PREROLL_SECONDS = 0.5;
const HEADROOM_DB = -0.3;
const wanted = args.songs ? args.songs.split(",").map((name) => name.trim().toLowerCase()) : null;

const run = (exe, argv, options = {}) => {
  const result = spawnSync(exe, argv, { maxBuffer: 512 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    throw new Error(`${path.basename(exe)} failed (${result.status}): ${String(result.stderr).slice(-600)}`);
  }
  return result;
};
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function probe(file) {
  const out = run(FFPROBE, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels,bits_per_sample,duration_ts", "-of", "json", file]);
  const stream = JSON.parse(String(out.stdout)).streams[0];
  return { sampleRate: Number(stream.sample_rate), channels: stream.channels, bits: stream.bits_per_sample, samples: Number(stream.duration_ts) };
}

// Finds the tempo grid: the file is a whole number of beats and the tail is a few whole beats.
function tempoGrid(totalSamples, sampleRate, tailHintSeconds) {
  const candidates = [];
  for (let bpm = 80; bpm <= 200; bpm += 1) {
    const totalBeats = (totalSamples * bpm) / (60 * sampleRate);
    if (Math.abs(totalBeats - Math.round(totalBeats)) > 0.02) continue;
    for (const tailBeats of [8, 16, 4, 12, 10, 6, 2]) {
      const tailSeconds = (tailBeats * 60) / bpm;
      const error = Math.abs(tailSeconds - tailHintSeconds);
      if (error > 0.1) continue;
      const loopBeats = Math.round(totalBeats) - tailBeats;
      const tidy = loopBeats % 16 === 0 ? 0 : loopBeats % 4 === 0 ? 1 : 2;
      candidates.push({ bpm, totalBeats: Math.round(totalBeats), tailBeats, loopBeats, error, tidy });
    }
  }
  candidates.sort((a, b) => a.tidy - b.tidy || a.error - b.error || [8, 16, 4, 12, 10, 6, 2].indexOf(a.tailBeats) - [8, 16, 4, 12, 10, 6, 2].indexOf(b.tailBeats));
  return candidates[0] ?? null;
}

function peakDb(file) {
  const out = run(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "astats=measure_perchannel=none:measure_overall=Peak_level", "-f", "null", "-"]);
  const match = String(out.stderr).match(/Peak level dB:\s*(-?[\d.]+|-inf)/);
  return match && match[1] !== "-inf" ? Number(match[1]) : -120;
}

function decodeStereo(file, sampleRate) {
  const out = run(FFMPEG, ["-hide_banner", "-nostats", "-v", "error", "-i", file, "-f", "f32le", "-ac", "2", "-ar", String(sampleRate), "-"]);
  return new Float32Array(out.stdout.buffer, out.stdout.byteOffset, Math.floor(out.stdout.byteLength / 4));
}

// Onset strength at 100 Hz from the first minute, for checking that intensities stay in time.
function onsetCurve(file) {
  const rate = 8000;
  const out = run(FFMPEG, ["-hide_banner", "-nostats", "-v", "error", "-t", "60", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(rate), "-"]);
  const mono = new Float32Array(out.stdout.buffer, out.stdout.byteOffset, Math.floor(out.stdout.byteLength / 4));
  const hop = rate / 100;
  const frames = Math.floor(mono.length / hop);
  const envelope = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let i = 0; i < hop; i += 1) sum += Math.abs(mono[frame * hop + i]);
    envelope[frame] = sum / hop;
  }
  const onset = new Float64Array(frames);
  for (let frame = 1; frame < frames; frame += 1) onset[frame] = Math.max(0, envelope[frame] - envelope[frame - 1]);
  return onset;
}
function bestLagMs(reference, other, maxLag = 30) {
  let best = { lag: 0, score: -Infinity };
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = Math.max(0, -lag); i < Math.min(reference.length, other.length - lag); i += 1) score += reference[i] * other[i + lag];
    if (score > best.score) best = { lag, score };
  }
  return best.lag * 10;
}

// The prepared loops are licensed audio and this repository is public: never write them into it.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.resolve(args.out);
if (outRoot === REPO || outRoot.startsWith(REPO + path.sep)) {
  console.error(`Refusing to write prepared music to ${outRoot}: it is inside this repository. Choose a folder outside it.`);
  process.exit(2);
}

const packRoot = args.pack;
const songDirs = readdirSync(packRoot).filter((name) => /\(RT [\d.]+\)$/.test(name) && statSync(path.join(packRoot, name)).isDirectory());
if (wanted) {
  const titles = songDirs.map((name) => name.replace(/ \(RT [\d.]+\)$/, "").toLowerCase());
  const unknown = wanted.filter((name) => !titles.includes(name));
  if (unknown.length) {
    console.error(`No song named ${unknown.map((name) => `"${name}"`).join(", ")} in ${packRoot}. The pack has: ${titles.join(", ")}.`);
    process.exit(1);
  }
}
const report = [];
mkdirSync(args.out, { recursive: true });
const scratch = path.join(args.out, "_scratch");
mkdirSync(scratch, { recursive: true });
// The scratch files are full-size audio: remove them however the run ends.
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

for (const dirName of songDirs.sort()) {
  const [, title, tailText] = dirName.match(/^(.*) \(RT ([\d.]+)\)$/);
  if (wanted && !wanted.includes(title.toLowerCase())) continue;
  const tailHint = Number(tailText);
  const dir = path.join(packRoot, dirName);
  const files = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".wav"));
  const levels = [
    { level: 1, name: files.find((name) => / Intensity 1\.wav$/i.test(name)) },
    { level: 2, name: files.find((name) => / Intensity 2\.wav$/i.test(name)) },
    { level: 3, name: files.find((name) => / Main\.wav$/i.test(name)) },
  ];
  if (levels.some((entry) => !entry.name)) {
    report.push({ title, error: "missing an intensity file" });
    continue;
  }
  const info = levels.map((entry) => probe(path.join(dir, entry.name)));
  const { sampleRate, samples } = info[0];
  if (info.some((item) => item.samples !== samples || item.sampleRate !== sampleRate)) {
    report.push({ title, error: "intensity files differ in length or sample rate" });
    continue;
  }
  const grid = tempoGrid(samples, sampleRate, tailHint);
  const loopSamples = grid ? Math.round((grid.loopBeats * 60 * sampleRate) / grid.bpm) : Math.round(samples - tailHint * sampleRate);
  const prerollSamples = Math.round(PREROLL_SECONDS * sampleRate);
  const id = slug(title);
  const outDir = path.join(args.out, id);
  mkdirSync(outDir, { recursive: true });

  // Pass 1: bake the tail onto the start of the loop, in float so nothing clips yet.
  const baked = levels.map((entry) => {
    const target = path.join(scratch, `${id}-i${entry.level}.wav`);
    const graph = `[0:a]asplit=2[a][b];[a]atrim=end_sample=${loopSamples},asetpts=N/SR/TB[body];[b]atrim=start_sample=${loopSamples},asetpts=N/SR/TB[tail];[body][tail]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`;
    run(FFMPEG, ["-hide_banner", "-nostats", "-v", "error", "-y", "-i", path.join(dir, entry.name), "-filter_complex", graph, "-map", "[mix]", "-c:a", "pcm_f32le", target]);
    return { ...entry, baked: target, peak: peakDb(target) };
  });
  // One gain for the whole song, so the three intensities keep their relative loudness.
  const worstPeak = Math.max(...baked.map((entry) => entry.peak));
  const gainDb = Math.min(0, HEADROOM_DB - worstPeak);
  const gain = 10 ** (gainDb / 20);

  // Pass 2: add the half-second of loop on either side and encode.
  const outputs = baked.map((entry) => {
    const target = path.join(outDir, `i${entry.level}.mp3`);
    const graph = `[0:a]asplit=3[x][y][z];[x]atrim=start_sample=${loopSamples - prerollSamples},asetpts=N/SR/TB[pre];[y]asetpts=N/SR/TB[body];[z]atrim=end_sample=${prerollSamples},asetpts=N/SR/TB[post];[pre][body][post]concat=n=3:v=0:a=1,volume=${gain.toFixed(6)}[out]`;
    run(FFMPEG, ["-hide_banner", "-nostats", "-v", "error", "-y", "-i", entry.baked, "-filter_complex", graph, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "2", "-ar", String(sampleRate), "-map_metadata", "-1", target]);

    // Check the splice: the audio right after the loop start must match the audio right after
    // the loop end (the post-roll), and likewise just before both points.
    const decoded = decodeStereo(target, sampleRate);
    const frame = (index) => index * 2;
    const window = 4096;
    const snr = (startA, startB) => {
      let signal = 0;
      let noise = 0;
      for (let i = 0; i < window * 2; i += 1) {
        const a = decoded[frame(startA) + i];
        const b = decoded[frame(startB) + i];
        signal += b * b;
        noise += (a - b) * (a - b);
      }
      return noise === 0 ? 120 : 10 * Math.log10(signal / noise);
    };
    const afterDb = snr(prerollSamples, prerollSamples + loopSamples);
    const beforeDb = snr(prerollSamples - window, prerollSamples + loopSamples - window);
    // Click test: the jump the splice makes, measured against ordinary sample-to-sample movement nearby.
    let movement = 0;
    for (let i = frame(prerollSamples + loopSamples - 2048); i < frame(prerollSamples + loopSamples); i += 1) movement += (decoded[i + 2] - decoded[i]) ** 2;
    const typicalStep = Math.sqrt(movement / (2048 * 2)) || 1e-9;
    const spliceJump = Math.max(
      Math.abs(decoded[frame(prerollSamples)] - decoded[frame(prerollSamples + loopSamples)]),
      Math.abs(decoded[frame(prerollSamples) + 1] - decoded[frame(prerollSamples + loopSamples) + 1]),
    );
    return {
      level: entry.level,
      file: `i${entry.level}.mp3`,
      bytes: statSync(target).size,
      sha256: sha256(target),
      source: entry.name,
      decodedSeconds: decoded.length / 2 / sampleRate,
      spliceSnrAfterDb: Number(afterDb.toFixed(1)),
      spliceSnrBeforeDb: Number(beforeDb.toFixed(1)),
      spliceJumpVsTypicalStep: Number((spliceJump / typicalStep).toFixed(3)),
    };
  });

  // Do the intensities stay in time with each other?
  const reference = onsetCurve(path.join(dir, levels[2].name));
  const lagMs = levels.slice(0, 2).map((entry) => bestLagMs(reference, onsetCurve(path.join(dir, entry.name))));

  const manifest = {
    id,
    title,
    pack: path.basename(packRoot),
    sampleRate,
    bpm: grid?.bpm ?? null,
    loopBeats: grid?.loopBeats ?? null,
    tailBeats: grid?.tailBeats ?? null,
    loopSamples,
    loopSeconds: loopSamples / sampleRate,
    prerollSeconds: PREROLL_SECONDS,
    gainDb: Number(gainDb.toFixed(2)),
    intensities: outputs,
    intensityLagMsVersusMain: lagMs,
  };
  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const entry of baked) rmSync(entry.baked, { force: true });
  report.push(manifest);
  console.log(
    [
      title.padEnd(15),
      `${grid ? `${grid.bpm} bpm` : "no grid"}`.padEnd(8),
      `loop ${(loopSamples / sampleRate).toFixed(4)} s`,
      `tail ${((samples - loopSamples) / sampleRate).toFixed(3)} s (name says ${tailHint})`,
      `gain ${gainDb.toFixed(2)} dB`,
      `MB ${outputs.map((o) => (o.bytes / 1048576).toFixed(2)).join("/")}`,
      `splice SNR ${outputs.map((o) => `${o.spliceSnrBeforeDb}|${o.spliceSnrAfterDb}`).join(" ")}`,
      `jump ${outputs.map((o) => o.spliceJumpVsTypicalStep).join("/")}`,
      `lag ${lagMs.join("/")} ms`,
    ].join("  "),
  );
}
writeFileSync(path.join(args.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const failed = report.filter((item) => item.error);
// A loop point whose jump is several ordinary steps would click.
const clicking = report.filter((item) => !item.error && item.intensities.some((level) => level.spliceJumpVsTypicalStep > 3));
if (failed.length) console.error(`PROBLEMS: ${failed.map((item) => `${item.title}: ${item.error}`).join("; ")}`);
if (clicking.length) console.error(`LOOP POINTS TO CHECK: ${clicking.map((item) => item.title).join(", ")}`);
if (failed.length || clicking.length) process.exitCode = 1;
console.log(`songs written: ${report.length - failed.length}`);
