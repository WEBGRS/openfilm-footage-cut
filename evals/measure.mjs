#!/usr/bin/env node
// The same measure for any finished film, read from film.html and the sound of its files.
//   node evals/measure.mjs <film.html> [--script script.txt] [--clips <their clips folder>] [--audio <out.wav>] [--json]
//   node evals/measure.mjs --render-only --mp4 <film.mp4> [--frames <dir>]     a film with no film.html behind it
// --clips lists the footage files used that are not among their clips by name and size; --audio writes the film's
// sound, mixed from film.html, for transcribing without a render.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { dHash, distance, vttWords } from '../skills/footage-cut/scripts/footage.mjs';

const FPS = 30;
const TWO = 2 / FPS;
const PAUSE = 0.12;
const args = process.argv.slice(2);
const take = (f) => { const i = args.indexOf(f); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const scriptFile = take('--script'), framesDir = take('--frames'), mp4 = take('--mp4'), clipsDir = take('--clips'), audioOut = take('--audio');
const asJson = args.includes('--json');
const film = resolve(args.find((a) => !a.startsWith('--')) ?? 'film.html');
const dir = dirname(film);
const r3 = (t) => Math.round(t * 1000) / 1000;

function run(cmd, a) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, a, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (b) => out.push(b));
    p.stderr.on('data', (b) => { err += b; });
    p.on('close', (c) => (c === 0 ? ok(Buffer.concat(out)) : fail(new Error(`${cmd}: ${err.slice(-300)}`))));
  });
}

// Tracks and clips of film.html
function clips(html) {
  const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '');
  const out = [];
  let track = -1;
  for (const m of text.matchAll(/<(\/?)(section|video|img|iframe|audio)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const name = m[2].toLowerCase();
    if (name === 'section') { if (!m[1]) track += 1; continue; }
    if (m[1]) continue;
    const attr = (k) => new RegExp(`\\b${k}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(m[3]);
    const a = (k) => { const x = attr(k); return x ? (x[2] ?? x[3]) : undefined; };
    const src = a('src') ?? '';
    const h = src.indexOf('#t=');
    const [from, to] = h < 0 ? [0, undefined] : src.slice(h + 3).split(',').map((v) => (v === '' ? undefined : Number(v)));
    let file = (h < 0 ? src : src.slice(0, h)).split('?')[0];
    try { file = decodeURIComponent(file); } catch {}
    out.push({ tag: name, track, file, from: from ?? 0, to, at: Number(a('at')) || 0, speed: Number(a('speed')) || 1, muted: /\bmuted\b/i.test(m[3]), volume: a('volume') === undefined ? 1 : Number(a('volume')) });
  }
  return out;
}

async function length(file) {
  const o = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(String(o).trim());
}

// Quiet runs of a file's sound, in its own seconds: 10 ms frames of 200-3500 Hz, 6 dB over the 5th percentile of the 10 s around them, -45 dB at least
const quietCache = new Map();
async function quiet(file) {
  if (quietCache.has(file)) return quietCache.get(file);
  const pcm = await run('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-af', 'highpass=f=200,lowpass=f=3500', '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  const step = 160;
  const db = [];
  for (let i = 0; i + step * 2 <= pcm.length; i += step * 2) {
    let e = 0;
    for (let k = 0; k < step; k++) { const v = pcm.readInt16LE(i + k * 2) / 32768; e += v * v; }
    db.push(10 * Math.log10(e / step + 1e-10));
  }
  // A floor per second, from the 10 s around it
  const limits = [];
  for (let i = 0; i < db.length; i += 100) {
    const near = db.slice(Math.max(0, i - 500), i + 500).sort((x, y) => x - y);
    limits.push(Math.max(-45, (near[Math.floor(near.length * 0.05)] ?? -100) + 6));
  }
  const runs = [];
  let start = -1;
  for (let i = 0; i <= db.length; i++) {
    const q = i < db.length && db[i] < limits[Math.floor(i / 100)];
    if (q && start < 0) start = i;
    if (!q && start >= 0) {
      if ((i - start) * 0.01 >= PAUSE) runs.push([r3(start * 0.01), r3(i * 0.01)]);
      start = -1;
    }
  }
  const res = { runs, length: r3(db.length * 0.01) };
  quietCache.set(file, res);
  return res;
}

// Seconds from t to the nearest quiet run, 0 inside one
const offRuns = (t, runs) => runs.reduce((best, [a, b]) => Math.min(best, t < a ? a - t : t > b ? t - b : 0), Infinity);

async function frameHash(file, t) {
  const o = await run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-']);
  return dHash(o);
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const strip = (s) => s.replace(/[\s\p{P}\p{S}]/gu, '');

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// A finished MP4 with no film.html behind it: cuts and pauses from the file itself
if (mp4 && args.includes('--render-only')) {
  const file = resolve(mp4);
  const { err } = await new Promise((ok, fail) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', "scale=320:-2,select='gte(scene,0)',metadata=print", '-f', 'null', '-'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let e = '';
    p.stderr.on('data', (b) => { e += b; });
    p.on('close', (c) => (c === 0 ? ok({ err: e }) : fail(new Error(e.slice(-300)))));
  });
  // Frame-to-frame change of every frame
  const frames = [];
  let t = 0;
  for (const line of err.split('\n')) {
    const a = /pts_time:([\d.]+)/.exec(line);
    if (a) t = Number(a[1]);
    const b = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (b) frames.push({ t, score: Number(b[1]) });
  }
  const cutTimes = frames.filter((f) => f.score >= 0.3 && f.t > 0.1).map((f) => r3(f.t));
  const q = await quiet(file);
  const off = cutTimes.map((c) => ({ t: c, frames: Math.round(offRuns(c, q.runs) * FPS) }));
  // How blurred each whole second is, by ffmpeg's blurdetect
  const blurLog = await new Promise((ok) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', 'scale=640:-2,format=gray,blurdetect,metadata=print', '-f', 'null', '-'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let e = '';
    p.stderr.on('data', (b) => { e += b; });
    p.on('close', () => ok(e));
  });
  const seconds = new Map();
  let at = 0;
  for (const line of blurLog.split('\n')) {
    const a = /pts_time:([\d.]+)/.exec(line);
    if (a) at = Math.floor(Number(a[1]));
    const b = /lavfi\.blur=([\d.]+)/.exec(line);
    if (b) seconds.set(at, [...(seconds.get(at) ?? []), Number(b[1])]);
  }
  const blur = [...seconds].map(([k, v]) => [k, v.reduce((x, y) => x + y, 0) / v.length]);
  const worst = blur.reduce((x, y) => (y[1] > x[1] ? y : x), [0, 0]);
  const r = {
    length: await length(file),
    cuts: cutTimes.length,
    cutTimes,
    cutsOnPause: off.filter((c) => c.frames <= 2).length,
    medianFrames: median(off.map((c) => c.frames)),
    worstFrames: off.length ? Math.max(...off.map((c) => c.frames)) : null,
    missed: off.filter((c) => c.frames > 2),
    blurWorst: { second: worst[0], blur: r3(worst[1]) },
    blurMedian: r3(median(blur.map((x) => x[1]))),
    quietRuns: q.runs.length,
  };
  if (framesDir) {
    mkdirSync(framesDir, { recursive: true });
    const edges = [0, ...cutTimes, r.length];
    for (let i = 0; i + 1 < edges.length; i++) {
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', ((edges[i] + edges[i + 1]) / 2).toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', join(framesDir, `shot${String(i + 1).padStart(2, '0')}.jpg`)]);
    }
    writeFileSync(join(framesDir, 'measure.json'), JSON.stringify(r, null, 1));
  }
  console.log(JSON.stringify(r, null, 1));
  process.exit(0);
}

const all = clips(readFileSync(film, 'utf8'));
for (const c of all) {
  const full = join(dir, c.file);
  c.full = full;
  c.exists = c.file !== '' && existsSync(full);
  if (c.to === undefined && c.exists && (c.tag === 'video' || c.tag === 'audio')) c.to = (await length(full));
  c.end = c.to === undefined ? undefined : c.at + (c.to - c.from) / c.speed;
}
const videos = all.filter((c) => c.tag === 'video' && c.exists).sort((x, y) => x.at - y.at);
const sounds = all.filter((c) => c.tag === 'audio' && c.exists);
const r = { film, clips: { video: videos.length, audio: sounds.length, page: all.filter((c) => c.tag === 'iframe').length, picture: all.filter((c) => c.tag === 'img').length, missing: all.filter((c) => !c.exists && c.tag !== 'iframe').map((c) => c.file) } };
const filmEnd = Math.max(0, ...all.map((c) => c.end ?? 0));
r.length = r3(filmEnd);

// Gaps with no footage and clips past their file's end
const covered = videos.map((v) => [v.at, v.end]).sort((a, b) => a[0] - b[0]);
let reach = 0, gap = 0;
for (const [a, b] of covered) { if (a > reach) gap += a - reach; reach = Math.max(reach, b); }
r.noFootage = r3(gap + Math.max(0, filmEnd - reach));
r.pastEnd = [];
for (const v of videos) { const L = await length(v.full); if (v.to > L + 0.001) r.pastEnd.push(`${basename(v.file)} ${v.to}>${r3(L)}`); }
r.speeds = videos.filter((v) => v.speed !== 1).map((v) => `${basename(v.file)} x${v.speed}`);

// Footage repeated: the same seconds of a file on screen twice, and clips whose middle frames look alike. A copy at
// the same moment on another track is a backdrop, not a repeat.
const together = (a, b) => Math.min(a.end, b.end) - Math.max(a.at, b.at) > 0.05;
let repeated = 0;
const repeats = [];
for (let i = 0; i < videos.length; i++) for (let j = i + 1; j < videos.length; j++) {
  const a = videos[i], b = videos[j];
  if (a.full !== b.full || together(a, b)) continue;
  const o = Math.min(a.to, b.to) - Math.max(a.from, b.from);
  if (o > 0.04) { repeated += o; repeats.push(`${basename(a.file)} ${r3(Math.max(a.from, b.from))}-${r3(Math.min(a.to, b.to))}`); }
}
r.repeatedSeconds = r3(repeated);
r.repeats = repeats;
for (const v of videos) { try { v.hash = await frameHash(v.full, (v.from + v.to) / 2); } catch { v.hash = null; } }
const alike = [];
for (let i = 0; i < videos.length; i++) for (let j = i + 1; j < videos.length; j++) {
  if (!together(videos[i], videos[j]) && videos[i].hash && videos[j].hash && distance(videos[i].hash, videos[j].hash) <= 6) alike.push(`#${i + 1} ${basename(videos[i].file)} = #${j + 1} ${basename(videos[j].file)}`);
}
r.lookAlike = alike;

// Cuts: where footage changes, on the voice's pauses when the voice is a separate sound
const cuts = [];
for (let i = 1; i < videos.length; i++) {
  const a = videos[i - 1], b = videos[i];
  if (Math.abs(b.at - a.end) < 0.5 / FPS) cuts.push({ t: b.at, a, b });
  else cuts.push({ t: b.at, a: b.at - a.end < 1 ? a : null, b, gap: r3(b.at - a.end) });
}
r.cuts = cuts.length;
r.shotMean = videos.length ? r3(videos.reduce((s, v) => s + (v.end - v.at), 0) / videos.length) : null;

if (sounds.length) {
  // Voice on in film time from every sound clip
  const on = [];
  for (const s of sounds) {
    const q = await quiet(s.full);
    let at = s.from;
    const pieces = [];
    for (const [a, b] of q.runs) { if (b <= s.from || a >= s.to) continue; if (a > at) pieces.push([at, a]); at = Math.max(at, b); }
    if (at < s.to) pieces.push([at, s.to]);
    for (const [a, b] of pieces) on.push([s.at + (a - s.from) / s.speed, s.at + (b - s.from) / s.speed]);
  }
  on.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const p of on) { if (merged.length && p[0] <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], p[1]); else merged.push([...p]); }
  const pauses = [[-1, merged[0]?.[0] ?? 0]];
  for (let i = 1; i < merged.length; i++) pauses.push([merged[i - 1][1], merged[i][0]]);
  pauses.push([merged.at(-1)?.[1] ?? 0, filmEnd + 1]);
  const usable = pauses.filter(([a, b]) => b - a >= PAUSE);
  const off = cuts.map((c) => ({ t: r3(c.t), frames: Math.round(offRuns(c.t, usable) * FPS) }));
  r.voice = {
    voiceSeconds: r3(merged.reduce((n, [a, b]) => n + b - a, 0)),
    cutsOnPause: off.filter((c) => c.frames <= 2).length,
    cutsMedianFrames: median(off.map((c) => c.frames)),
    cutsWorstFrames: off.length ? Math.max(...off.map((c) => c.frames)) : null,
    missed: off.filter((c) => c.frames > 2),
    footageSoundOn: videos.filter((v) => !v.muted && v.volume > 0).length,
  };

  // The voice's words against the script, read from the transcripts beside the sound
  const words = [];
  for (const s of [...sounds].sort((x, y) => x.at - y.at)) {
    const vtt = s.full.replace(/\.[^.]+$/, '.vtt');
    if (!existsSync(vtt)) continue;
    for (const w of vttWords(readFileSync(vtt, 'utf8'))) if (w.t >= s.from - 1e-3 && w.t < s.to) words.push({ text: w.text, t: s.at + (w.t - s.from) / s.speed });
  }
  r.voice.words = words.length;
  if (scriptFile) {
    const want = strip(readFileSync(scriptFile, 'utf8'));
    const got = strip(words.map((w) => w.text).join(''));
    r.voice.scriptChars = want.length;
    r.voice.vttDistanceFromScript = got ? levenshtein(want, got) : null;
  }
}

// Inside the footage's own speech: every join's two sides against the quiet runs and the sentences of the transcript
const speech = [];
for (const v of videos) {
  const vtt = v.full.replace(/\.[^.]+$/, '.vtt');
  if (!existsSync(vtt) || v.muted) continue;
  v.words = vttWords(readFileSync(vtt, 'utf8'));
}
if (videos.some((v) => v.words)) {
  const edges = [];
  for (const v of videos) {
    if (!v.words) continue;
    const q = await quiet(v.full);
    const inW = v.words.filter((w) => w.t >= v.from - TWO && w.t < v.to);
    edges.push({ file: basename(v.file), edge: 'in', t: r3(v.from), frames: Math.round(offRuns(v.from, q.runs) * FPS) });
    edges.push({ file: basename(v.file), edge: 'out', t: r3(v.to), frames: Math.round(offRuns(v.to, q.runs) * FPS) });
    speech.push({ file: basename(v.file), from: r3(v.from), to: r3(v.to), at: r3(v.at), said: inW.map((w) => w.text).join(' ') });
  }
  const said = [...speech].sort((x, y) => x.at - y.at);
  const files = new Map();
  for (const v of videos) if (v.words) files.set(basename(v.file), (files.get(basename(v.file)) ?? 0) + (v.end - v.at));
  r.speech = {
    edges: edges.length,
    onPause: edges.filter((e) => e.frames <= 2).length,
    medianFrames: median(edges.map((e) => e.frames)),
    worstFrames: edges.length ? Math.max(...edges.map((e) => e.frames)) : null,
    backInTime: said.filter((c, i) => said.slice(0, i).some((o) => o.file === c.file && o.from > c.from)).length,
    secondsBySpeaker: Object.fromEntries([...files].map(([k, n]) => [k, r3(n)])),
    bad: edges.filter((e) => e.frames > 2),
    said: speech,
  };
}

// How blurred the footage the film uses is, by ffmpeg's blurdetect on each clip's own seconds (lower is sharper):
// the film-time weighted mean, and the blurriest clip
{
  const done = [];
  const perSecond = new Map();
  for (const v of videos.filter((x, i) => !videos.slice(0, i).some((p) => p.full === x.full && together(p, x)))) {
    const log = await new Promise((ok) => {
      const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(v.from), '-t', String(v.to - v.from), '-i', v.full, '-an', '-vf', 'scale=640:-2,format=gray,blurdetect,metadata=print', '-f', 'null', '-'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let e = '';
      p.stderr.on('data', (b) => { e += b; });
      p.on('close', () => ok(e));
    });
    const vals = [];
    let t = 0;
    for (const line of log.split('\n')) {
      const a = /pts_time:([\d.]+)/.exec(line);
      if (a) t = Number(a[1]);
      const b = /lavfi\.blur=([\d.]+)/.exec(line);
      if (b) {
        vals.push(Number(b[1]));
        const k = Math.floor(v.at + t);
        perSecond.set(k, [...(perSecond.get(k) ?? []), Number(b[1])]);
      }
    }
    if (vals.length) done.push({ at: v.at, file: basename(v.file), from: v.from, len: v.end - v.at, blur: vals.reduce((a, b) => a + b, 0) / vals.length });
  }
  const total = done.reduce((s, d) => s + d.len, 0);
  const worst = done.reduce((a, b) => (b.blur > a.blur ? b : a), { blur: 0 });
  // Film seconds whose frames are blurred past 8: a whip pan or a smeared crowd
  const secs = [...perSecond].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]);
  const blurry = secs.filter(([, b]) => b > 8).map(([k, b]) => `${k} s (${r3(b)})`);
  r.blurSeconds = { over8: blurry.length, which: blurry, worst: secs.length ? secs.reduce((a, b) => (b[1] > a[1] ? b : a)).map(r3) : null };
  r.blur = { mean: r3(done.reduce((s, d) => s + d.blur * d.len, 0) / (total || 1)), worst: { file: worst.file, from: worst.from, at: r3(worst.at ?? 0), blur: r3(worst.blur) } };
}

// New video files in the project: footage made again rather than trimmed
r.videoFilesUsed = [...new Set(videos.map((v) => v.file))];
if (clipsDir) {
  const theirs = new Map(readdirSync(clipsDir).filter((f) => /\.(webm|mp4|mov|mkv)$/i.test(f)).map((f) => [f, statSync(join(clipsDir, f)).size]));
  r.notTheirs = r.videoFilesUsed.filter((f) => theirs.get(basename(f)) !== statSync(join(dir, f)).size);
}

// The film's sound mixed from film.html: every sound clip and every unmuted video's own sound, at its place
if (audioOut) {
  const src = all.filter((c) => c.exists && (c.tag === 'audio' || (c.tag === 'video' && !c.muted && c.volume > 0)));
  const inputs = src.flatMap((c) => ['-i', c.full]);
  const chains = src.map((c, i) => `[${i}:a]atrim=start=${c.from}:end=${c.to},asetpts=PTS-STARTPTS,volume=${c.volume},adelay=${Math.round(c.at * 1000)}:all=1[a${i}]`);
  const mix = `${src.map((_, i) => `[a${i}]`).join('')}amix=inputs=${src.length}:normalize=0:duration=longest[out]`;
  await run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${chains.join(';')};${mix}`, '-map', '[out]', '-ac', '1', '-ar', '16000', resolve(audioOut)]);
  r.audio = resolve(audioOut);
}

// A frame from the render at the middle of each voice sentence and of each shot
if (framesDir && mp4) {
  mkdirSync(framesDir, { recursive: true });
  for (const [i, v] of videos.entries()) {
    const t = (v.at + v.end) / 2;
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:-2', join(framesDir, `shot${String(i + 1).padStart(2, '0')}.jpg`)]);
  }
}

r.shots = videos.map((v, i) => `${i + 1}. ${r3(v.at)}-${r3(v.end)} ${basename(v.file)} ${r3(v.from)}-${r3(v.to)}${v.muted || v.volume === 0 ? ' muted' : ''}`);
if (asJson) console.log(JSON.stringify(r, null, 1));
else {
  console.log(`length ${r.length} s, ${r.clips.video} footage clips, ${r.clips.audio} sounds, ${r.clips.page} pages, ${r.clips.picture} pictures; no footage ${r.noFootage} s; past end ${r.pastEnd.length}; speed changes ${r.speeds.length}`);
  console.log(`blurred film seconds (over 8): ${r.blurSeconds.over8} ${r.blurSeconds.which.join(', ')}; blurriest second at ${r.blurSeconds.worst?.[0]} s (${r.blurSeconds.worst?.[1]})`);
  console.log(`blur of the footage used: mean ${r.blur.mean}, blurriest ${r.blur.worst.file} from ${r.blur.worst.from} s at film ${r.blur.worst.at} s (${r.blur.worst.blur})`);
  console.log(`same footage twice ${r.repeatedSeconds} s (${r.repeats.length}); clips that look alike ${r.lookAlike.length}`);
  if (r.voice) console.log(`cuts on the voice's pauses ${r.voice.cutsOnPause}/${r.cuts}, median ${r.voice.cutsMedianFrames} frames off, worst ${r.voice.cutsWorstFrames}; script distance ${r.voice.vttDistanceFromScript ?? 'n/a'} of ${r.voice.scriptChars ?? 'n/a'} chars`);
  if (r.speech) console.log(`clip edges in pauses ${r.speech.onPause}/${r.speech.edges}, median ${r.speech.medianFrames} frames off, worst ${r.speech.worstFrames}; clips earlier in their file than one before them ${r.speech.backInTime}; ${JSON.stringify(r.speech.secondsBySpeaker)}`);
  console.log(r.shots.join('\n'));
}
if (framesDir) writeFileSync(join(framesDir, 'measure.json'), JSON.stringify(r, null, 1));
