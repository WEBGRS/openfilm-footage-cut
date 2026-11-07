#!/usr/bin/env node
/**
 * The person's footage logged shot by shot, so a film can be cut from it, and the film checked against it.
 *
 *   node footage.mjs <folder> [--out <dir>] [--threshold 0.3]
 *   node footage.mjs check [film.html] [--script script.txt] [--list] [--repeat-ok] [--reorder-ok] [--footage <folder>]
 *
 * The log writes, in <folder>/footage-log/ (or --out):
 *   footage.json   the log
 *   footage.html   the same to look at: each shot's first, middle and last frame, and the sentences with their cut points
 *   <shot>.jpg     those frames, one picture per shot (A1.jpg …)
 * The log, format "openfilm-footage/1", every time in the clip's own seconds:
 *   { format, folder, clips: [{ id, file, bytes, duration, width, height, fps, audio, words, lines,
 *       shots: [{ id, start, end, picture, said, same }] }], same: [[shot ids]], skipped: [files with no picture] }
 * A clip's id is a letter in file-name order (A, B … AA), a shot's the clip's id and its number (A1). `words` is the
 * WebVTT beside the clip (npx openfilm get asr --src <clip>) or null; `said` is what is said during the shot, null
 * without words. `same` lists the other shots whose middle frames look alike, in any clip: one of them is enough.
 * `lines` (clips with words): the sentences, { start, end, in, out, said }; `in` and `out` are cut points inside the
 * pause before and after the sentence, null where the speech runs straight on.
 *
 * `check` reads film.html against the footage and the words beside it, prints what is wrong and what to do about it
 * last, and exits 1 when anything is.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'openfilm-footage/1';
const SELF = fileURLToPath(import.meta.url);
const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts)$/i;
/** Shots shorter than this are part of the one before (a flash, a wipe). */
const MIN_SHOT = 0.6;
/** Middle frames this many bits apart or fewer, of 64, look alike. */
const SAME_BITS = 6;
/** A pause is at least this long, in seconds. */
const PAUSE = 0.12;
const FPS = 30;
/** A cut this close to a pause, two frames, is in it. */
const TWO = 2 / FPS;
/** A cut this close to the start or end of a file is the file's own edge. */
const EDGE = 0.1;
const round = (/** @type {number} */ t) => Math.round(t * 1000) / 1000;

/** Run a program; resolves with its stdout and stderr. */
function run(/** @type {string} */ cmd, /** @type {string[]} */ args, binary = false) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    /** @type {Buffer[]} */
    const out = [];
    let err = '';
    p.stdout.on('data', (b) => out.push(b));
    p.stderr.on('data', (b) => { err += b; });
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok({ out: binary ? Buffer.concat(out) : Buffer.concat(out).toString('utf8'), err }) : fail(new Error(`${cmd}: ${err.trim().split('\n').slice(-3).join(' ')}`))));
  });
}

/** Letters for the n-th clip: A … Z, AA … */
export function clipId(/** @type {number} */ n) {
  let s = '';
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

/** `00:00:01.250` or `00:01.250` → seconds. */
const seconds = (/** @type {string} */ stamp) => {
  const parts = stamp.trim().split(':').map(Number);
  return parts.length < 2 || parts.some((n) => !Number.isFinite(n)) ? NaN : parts.reduce((acc, n) => acc * 60 + n, 0);
};

/**
 * The words a WebVTT times: a cue's timestamp tags start its words; a cue without them is one. `raw` keeps the word's
 * own spacing (a word split into pieces has none between them); `first` marks a cue's first word. A word ends where the
 * next begins, the cue's last word where the cue ends.
 */
export function vttWords(/** @type {string} */ body) {
  /** @type {{ t: number, end: number, text: string, raw: string, first: boolean }[]} */
  const words = [];
  for (const block of body.replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/)) {
    const rows = block.split('\n');
    const timing = rows.findIndex((r) => r.includes('-->'));
    if (timing < 0 || /^(NOTE|STYLE|REGION)\b/.test(rows[0] ?? '')) continue;
    const [a, b] = rows[timing].split('-->');
    const start = seconds(a), end = seconds(b.trim().split(/\s+/)[0] ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    /** @type {{ t: number, end: number, text: string, raw: string, first: boolean }[]} */
    const cue = [];
    let at = start, fresh = true;
    for (const [, tag, chunk] of rows.slice(timing + 1).join(' ').matchAll(/<([^>]*)>|([^<]+)/g)) {
      if (tag !== undefined) {
        const s = seconds(tag);
        if (Number.isFinite(s)) { at = s; fresh = true; }
        continue;
      }
      const text = chunk.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
      if (!text.trim()) {
        if (cue.length) cue[cue.length - 1].raw += text;
        continue;
      }
      if (fresh || !cue.length) cue.push({ t: at, end, text, raw: text, first: !cue.length });
      else { cue[cue.length - 1].text += text; cue[cue.length - 1].raw += text; }
      fresh = false;
    }
    cue.forEach((w, i) => { w.end = i + 1 < cue.length ? cue[i + 1].t : Math.max(end, w.t); w.text = w.text.replace(/\s+/g, ' ').trim(); });
    words.push(...cue);
  }
  return words.sort((x, y) => x.t - y.t);
}

const WIDE = /[　-鿿＀-￯]/;

const BETWEEN_WIDE = new RegExp(`(${WIDE.source}) (?=${WIDE.source})`, 'g');

/** What is said between start and end: the words that start in it, spaced as the transcript spaces them. */
export function saidIn(/** @type {{ t: number, text: string, raw?: string, first?: boolean }[]} */ words, /** @type {number} */ start, /** @type {number} */ end) {
  let s = '';
  for (const w of words.filter((x) => x.t >= start - 1e-6 && x.t < end - 1e-6)) {
    const piece = w.raw ?? ` ${w.text}`;
    // A new cue after Latin text takes a space; Chinese and Japanese run on
    const gap = w.first && s && !/\s$/.test(s) && !WIDE.test(s.at(-1) ?? '') && !WIDE.test(piece.trim()[0] ?? '') ? ' ' : '';
    s += gap + piece;
  }
  // No space between two Chinese or Japanese words
  return s.replace(/\s+/g, ' ').replace(BETWEEN_WIDE, '$1').trim();
}

/** Shots from the scene changes of a clip: [start, end) pairs, none shorter than MIN_SHOT except a short clip. */
export function shotsFrom(/** @type {number[]} */ changes, /** @type {number} */ duration) {
  const cuts = [0];
  for (const t of [...changes].sort((a, b) => a - b)) if (t - cuts.at(-1) >= MIN_SHOT && duration - t >= MIN_SHOT) cuts.push(t);
  return cuts.map((t, i) => [round(t), round(i + 1 < cuts.length ? cuts[i + 1] : duration)]);
}

/** 64-bit difference hash of a 9x8 grey picture, as a hex string. */
export function dHash(/** @type {Buffer} */ px) {
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] < px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

/** How many of the 64 bits two hashes differ in. */
export function distance(/** @type {string} */ a, /** @type {string} */ b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0;
  for (; x; x >>= 1n) n += Number(x & 1n);
  return n;
}

/** Groups of shots whose hashes are within SAME_BITS of each other (joined through any member). */
export function alike(/** @type {{ id: string, hash: string }[]} */ shots) {
  const parent = new Map(shots.map((s) => [s.id, s.id]));
  const top = (/** @type {string} */ id) => { while (parent.get(id) !== id) id = /** @type {string} */ (parent.get(id)); return id; };
  for (let i = 0; i < shots.length; i++) {
    for (let j = i + 1; j < shots.length; j++) if (distance(shots[i].hash, shots[j].hash) <= SAME_BITS) parent.set(top(shots[j].id), top(shots[i].id));
  }
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const s of shots) groups.set(top(s.id), [...(groups.get(top(s.id)) ?? []), s.id]);
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * The quiet runs of a sound, [from, to] in its own seconds, from 16 kHz mono 16-bit PCM: 10 ms frames of 200 to 3500 Hz,
 * quiet when 6 dB over the 5th percentile of the 10 s around, and under -45 dB at least, unless those 10 s hold no
 * pause at all (loud and quiet frames within 10 dB); a run is PAUSE long or more.
 */
export function quietRuns(/** @type {Buffer} */ pcm) {
  const step = 160;
  /** @type {number[]} */
  const db = [];
  for (let i = 0; i + step * 2 <= pcm.length; i += step * 2) {
    let e = 0;
    for (let k = 0; k < step; k++) { const v = pcm.readInt16LE(i + k * 2) / 32768; e += v * v; }
    db.push(10 * Math.log10(e / step + 1e-10));
  }
  // A limit per second, from the 10 s around it
  /** @type {number[]} */
  const limits = [];
  for (let i = 0; i < db.length; i += 100) {
    const near = db.slice(Math.max(0, i - 500), i + 500).sort((x, y) => x - y);
    // A steady sound (the loud and the quiet frames within 10 dB) has no pause in it: only silence is quiet
    const floor = near[Math.floor(near.length * 0.05)] ?? -100, loud = near[Math.floor(near.length * 0.95)] ?? -100;
    limits.push(Math.max(-45, loud - floor < 10 ? -100 : floor + 6));
  }
  /** @type {[number, number][]} */
  const runs = [];
  let start = -1;
  for (let i = 0; i <= db.length; i++) {
    const q = i < db.length && db[i] < limits[Math.floor(i / 100)];
    if (q && start < 0) start = i;
    if (!q && start >= 0) {
      if ((i - start) * 0.01 >= PAUSE - 1e-9) {
        // A blip of under 0.08 s between two pauses does not split them
        if (runs.length && start * 0.01 - runs.at(-1)[1] < 0.08) runs.at(-1)[1] = round(i * 0.01);
        else runs.push([round(start * 0.01), round(i * 0.01)]);
      }
      start = -1;
    }
  }
  return { runs, length: round(db.length * 0.01) };
}

const quietCache = new Map();
/** The quiet runs of a file's sound (cached). */
async function pausesOf(/** @type {string} */ file) {
  if (!quietCache.has(file)) {
    const { out } = await run('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-af', 'highpass=f=200,lowpass=f=3500', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], true);
    quietCache.set(file, quietRuns(/** @type {Buffer} */ (out)));
  }
  return quietCache.get(file);
}

/** Seconds from t to the nearest run, 0 inside one. */
const offRuns = (/** @type {number} */ t, /** @type {[number, number][]} */ runs) => runs.reduce((best, [a, b]) => Math.min(best, t < a ? a - t : t > b ? t - b : 0), Infinity);

/** A word that ends a sentence, and one that ends a clause. */
const ENDS = /[.!?…。！？]["'”’)\]]*$/;
const CLAUSE = /[,;:，；：、—–-]["'”’)\]]*$/;

/** The words of a transcript as sentences, each split after . ? ! … */
export function sentencesOf(/** @type {{ t: number, end: number, text: string }[]} */ words) {
  /** @type {typeof words[]} */
  const out = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (ENDS.test(w.text)) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * The sentences of a clip and where to cut each one out. `in` and `out` are inside the quiet run between it and the
 * sentence before or after (a little before the next word, a little after the last), null where the speech runs on.
 */
export function linesOf(/** @type {{ t: number, end: number, text: string, raw?: string, first?: boolean }[]} */ words, /** @type {[number, number][]} */ runs, /** @type {number} */ length) {
  const sentences = sentencesOf(words);
  // The pause at boundary k, between sentence k-1 and k: the longest quiet run over the transcript's gap. The words'
  // times drift, a sentence can start half a second after its first word's time, so the run is looked for that far on.
  const gap = (/** @type {number} */ k) => {
    const prev = k > 0 ? sentences[k - 1].at(-1) : null;
    const next = k < sentences.length ? sentences[k][0] : null;
    const from = prev ? prev.end : 0, to = next ? next.t : from + 1;
    const found = runs.filter(([a]) => a >= (prev ? prev.t + 0.1 : 0) && a <= (next ? next.t + 0.5 : length));
    const away = ([a, b]) => (a < to && b > from ? 0 : Math.min(Math.abs(a - to), Math.abs(from - b)));
    const run = found.sort((x, y) => away(x) - away(y) || y[1] - y[0] - (x[1] - x[0]))[0];
    if (!run) return null;
    const d = Math.min(0.15, (run[1] - run[0]) / 2);
    return { out: round(run[0] + d), in: round(run[1] - d) };
  };
  return sentences.map((s, k) => {
    const before = gap(k), after = gap(k + 1);
    const start = s[0].t;
    return {
      start: round(start), end: round(s.at(-1)?.end ?? start),
      in: before ? before.in : k === 0 && start <= 0.4 ? 0 : null,
      out: after ? after.out : null,
      said: saidIn(s, start, Infinity),
    };
  });
}

async function probe(/** @type {string} */ file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', file]);
  const j = JSON.parse(String(out));
  const v = j.streams.find((/** @type {any} */ s) => s.codec_type === 'video');
  const [n, d] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const fps = d ? n / d : 0;
  let duration = Number(j.format?.duration) || 0;
  if (v) {
    // The sound can run on after the last frame: a shot ends with the picture
    const { out: stamps } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file]);
    const last = String(stamps).split(/\s+/).map(Number).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
    if (last > 0) duration = Math.min(duration, last + (fps ? 1 / fps : 0));
  }
  return { duration, width: v?.width ?? 0, height: v?.height ?? 0, fps: round(fps), audio: j.streams.some((/** @type {any} */ s) => s.codec_type === 'audio') };
}

async function sceneChanges(/** @type {string} */ file, /** @type {number} */ threshold) {
  const { err } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-']);
  return [...err.matchAll(/Parsed_showinfo.*?pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

/** The first, middle and last frame of a shot side by side, 160 px tall. */
function strip(/** @type {string} */ file, /** @type {number[]} */ times, /** @type {string} */ out) {
  const inputs = times.flatMap((t) => ['-ss', t.toFixed(3), '-i', file]);
  const filter = `${times.map((_, i) => `[${i}:v]scale=-2:160,setsar=1[p${i}]`).join(';')};${times.map((_, i) => `[p${i}]`).join('')}hstack=inputs=${times.length}`;
  return run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-frames:v', '1', '-q:v', '4', out]);
}

async function middleHash(/** @type {string} */ file, /** @type {number} */ t) {
  const { out } = await run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-'], true);
  return dHash(/** @type {Buffer} */ (out));
}

const esc = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Log every clip in `folder`. */
export async function logFootage(/** @type {string} */ folder, /** @type {{ out?: string, threshold?: number, log?: (s: string) => void }} */ o = {}) {
  const dir = resolve(folder);
  const outDir = resolve(o.out ?? join(dir, 'footage-log'));
  const log = o.log ?? ((s) => process.stderr.write(`${s}\n`));
  const files = readdirSync(dir).filter((f) => VIDEO.test(f)).sort((a, b) => a.localeCompare(b));
  if (!files.length) throw new Error(`${folder}: no video clips (${VIDEO.source.replace(/[\\()$]/g, '').replace(/\|/g, ' ')})`);
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^[A-Z]+\d+\.jpg$/.test(f)) rmSync(join(outDir, f));
  const clips = [];
  /** @type {{ id: string, hash: string }[]} */
  const hashes = [];
  /** @type {string[]} */
  const skipped = [];
  for (const f of files) {
    const file = join(dir, f);
    // A file with no picture (sound only, or unreadable) is listed, not logged
    const facts = await probe(file).catch(() => null);
    if (!facts?.width || !(facts.duration > 0)) { skipped.push(f); log(`${f}: no picture, left out`); continue; }
    const id = clipId(clips.length);
    const vtt = file.slice(0, -extname(file).length) + '.vtt';
    const words = existsSync(vtt) ? vttWords(readFileSync(vtt, 'utf8')) : null;
    const spans = shotsFrom(await sceneChanges(file, o.threshold ?? 0.3), facts.duration);
    // The sentences with cut points inside the pauses, for a clip that speaks
    const lines = words?.length && facts.audio ? linesOf(words, (await pausesOf(file)).runs, facts.duration) : null;
    log(`${id} ${f}: ${facts.duration.toFixed(1)} s, ${spans.length} shot${spans.length > 1 ? 's' : ''}${lines ? `, ${lines.length} sentences` : ''}`);
    const shots = [];
    for (const [k, [a, b]] of spans.entries()) {
      const sid = `${id}${k + 1}`;
      const edge = Math.min(0.1, (b - a) / 4);
      await strip(file, [a + edge, (a + b) / 2, Math.max(a + edge, b - edge - 0.05)], join(outDir, `${sid}.jpg`));
      const hash = await middleHash(file, (a + b) / 2);
      hashes.push({ id: sid, hash });
      shots.push({ id: sid, start: a, end: b, picture: `${sid}.jpg`, said: words ? saidIn(words, a, b) : null, same: /** @type {string[]} */ ([]) });
    }
    clips.push({ id, file: relative(outDir, file).replace(/\\/g, '/'), bytes: statSync(file).size, duration: round(facts.duration), width: facts.width, height: facts.height, fps: facts.fps, audio: facts.audio, words: words ? basename(vtt) : null, lines, shots });
  }
  const same = alike(hashes);
  for (const g of same) for (const c of clips) for (const s of c.shots) if (g.includes(s.id)) s.same = g.filter((x) => x !== s.id);
  const logData = { format: FORMAT, folder: relative(outDir, dir).replace(/\\/g, '/') || '.', clips, same, skipped };
  writeFileSync(join(outDir, 'footage.json'), `${JSON.stringify(logData, null, 1)}\n`);
  writeFileSync(join(outDir, 'footage.html'), page(logData));
  const shotsN = clips.reduce((n, c) => n + c.shots.length, 0);
  return [
    `${outDir}${process.platform === 'win32' ? '\\' : '/'}footage.json  ${clips.length} clips, ${shotsN} shots, ${clips.filter((c) => c.words).length} with words`,
    same.length ? `look alike: ${same.map((g) => g.join(' = ')).join(' · ')}` : 'no two shots look alike',
    ...(skipped.length ? [`left out, no picture: ${skipped.join(', ')}`] : []),
    ...clips.filter((c) => c.audio && !c.words).map((c) => `${c.id} has sound and no words yet: npx openfilm get asr --src ${join(dir, c.file.split('/').pop() ?? '')}`),
    ...(clips.some((c) => c.lines) ? ['clips with words: footage.json lists their sentences with in and out points inside the pauses; cut there'] : []),
    'a script to voice: npx openfilm get lists the services connected here, their own included',
    `when the film is cut: node ${SELF} check film.html`,
  ];
}

/** The log as a page: a row per shot with its frames and words, a row per sentence for a clip that speaks. */
function page(/** @type {any} */ data) {
  const rows = data.clips.map((/** @type {any} */ c) => `<h2>${c.id} · ${esc(c.file)} · ${c.duration} s${c.words ? '' : c.audio ? ' · no words yet' : ' · no sound'}</h2>
<table>${c.shots.map((/** @type {any} */ s) => `<tr><td class="id">${s.id}</td><td class="t">${s.start}–${s.end} s</td><td><img src="${s.picture}" alt="${s.id}"></td><td>${c.lines ? '' : s.said ? esc(s.said) : ''}${s.same.length ? `<div class="same">looks like ${s.same.join(', ')}</div>` : ''}</td></tr>`).join('\n')}</table>
${c.lines ? `<table>${c.lines.map((/** @type {any} */ l) => `<tr><td class="t">in ${l.in ?? '–'} · out ${l.out ?? '–'}</td><td>${esc(l.said)}</td></tr>`).join('\n')}</table>` : ''}`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Footage log</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 24px; color: #1d1b18; background: #faf8f4; }
  table { border-collapse: collapse; margin-bottom: 24px; }
  td { border-top: 1px solid #ddd6c8; padding: 6px 10px; vertical-align: top; }
  td.id { font-weight: 700; } td.t { color: #6d675c; white-space: nowrap; }
  img { height: 80px; display: block; }
  .same { color: #b4441f; font-size: 13px; }
</style>
</head>
<body>
<h1>Footage log</h1>
${rows}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------------------------
// check: the film against the footage

/** @typedef {{ tag: string, track: number, src: string, file: string, full: string, from: number, to: number | undefined, at: number, speed: number, muted: boolean, volume: number, style: string, end?: number, hidden: boolean }} Clip */

/** The tracks and clips of film.html: what it says, as the Studio would read it. */
export function parseFilm(/** @type {string} */ html, /** @type {string} */ dir = '.') {
  const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '');
  /** @type {{ hidden: boolean, muted: boolean, captions: string[], clips: Clip[] }[]} */
  const tracks = [];
  for (const m of text.matchAll(/<(\/?)(section|video|img|iframe|audio|track)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    if (m[1]) continue;
    const name = m[2].toLowerCase();
    const bare = m[3].replace(/"[^"]*"|'[^']*'/g, '""');
    const flag = (/** @type {string} */ k) => new RegExp(`(?:^|\\s)${k}(?=[\\s=/]|$)`, 'i').test(bare);
    const attr = (/** @type {string} */ k) => { const x = new RegExp(`(?:^|\\s)${k}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(m[3]); return x ? (x[2] ?? x[3]) : undefined; };
    if (name === 'section') { tracks.push({ hidden: flag('hidden'), muted: flag('muted'), captions: [], clips: [] }); continue; }
    const track = tracks.at(-1);
    if (!track) continue;
    if (name === 'track') { track.captions.push(attr('src') ?? ''); continue; }
    const src = attr('src') ?? '';
    const h = src.indexOf('#t=');
    const [from, to] = h < 0 ? [undefined, undefined] : src.slice(h + 3).split(',').map((v) => (v === '' ? undefined : Number(v)));
    let file = (h < 0 ? src : src.slice(0, h)).split('?')[0];
    try { file = decodeURIComponent(file); } catch { /* keep as written */ }
    const volume = attr('volume') === undefined ? 1 : Number(attr('volume'));
    track.clips.push({
      tag: name, track: tracks.length - 1, src, file, full: join(dir, file), from: from ?? 0, to,
      at: Number(attr('at')) || 0, speed: Number(attr('speed')) || 1, muted: flag('muted') || track.muted || volume === 0,
      volume, style: attr('style') ?? '', hidden: track.hidden,
    });
  }
  return { tracks };
}

const levenshtein = (/** @type {string} */ a, /** @type {string} */ b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
const plain = (/** @type {string} */ s) => s.replace(/[\s\p{P}\p{S}]/gu, '');
const stamp = (/** @type {number} */ t) => `${t.toFixed(2)} s`;
const quote = (/** @type {string} */ s, /** @type {number} */ n = 70) => `«${s.length > n ? `${s.slice(0, n - 1)}…` : s}»`;

/**
 * Check film.html against the footage it uses. Resolves with { problems, notes, shots, summary }; a problem is
 * { kind, t, text } with t the film second, or null. Every file is read from disk: nothing is trusted from the page.
 * @param {string} filmFile
 * @param {{ script?: string, repeatOk?: boolean, reorderOk?: boolean, footage?: string }} [o]
 */
export async function checkFilm(filmFile, o = {}) {
  const file = resolve(filmFile);
  if (!existsSync(file)) throw new Error(`${filmFile}: no such file`);
  const dir = dirname(file);
  /** @type {{ kind: string, t: number | null, text: string }[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  const bad = (/** @type {string} */ kind, /** @type {number | null} */ t, /** @type {string} */ text) => problems.push({ kind, t, text });
  const film = parseFilm(readFileSync(file, 'utf8'), dir);
  const live = film.tracks.filter((t) => !t.hidden).flatMap((t) => t.clips);
  const result = (/** @type {string[]} */ summary = [], /** @type {string[]} */ shots = []) => ({ problems, notes, summary, shots });
  if (!live.length) {
    bad('empty', null, 'film.html has no clips in it, so there is no film for the person to open in Studio');
    return result();
  }

  // Facts about every media file the film names
  /** @type {Map<string, any>} */
  const facts = new Map();
  const about = async (/** @type {Clip} */ c) => {
    if (!facts.has(c.full)) facts.set(c.full, existsSync(c.full) && statSync(c.full).isFile() ? await probe(c.full).catch(() => null) : null);
    return facts.get(c.full);
  };
  for (const c of live) {
    if (c.tag === 'iframe') { c.end = c.to === undefined ? undefined : c.at + c.to - c.from; continue; }
    if (c.tag === 'img') { c.end = c.to === undefined ? undefined : c.at + c.to - c.from; continue; }
    const f = await about(c);
    if (!f) { bad('file', c.at, `${c.file} is not there, or not a media file`); continue; }
    if (c.to === undefined) c.to = f.duration;
    if (c.to > f.duration + 0.05) bad('file', c.at, `${basename(c.file)} is asked for up to ${stamp(c.to)}, and it is ${stamp(f.duration)} long`);
    c.end = c.at + (c.to - c.from) / c.speed;
  }
  for (const c of live) {
    const moved = /(^|;)\s*(position|transform|margin|transition)\s*:/i.exec(c.style);
    if (moved) bad('style', c.at, `${basename(c.file)} at ${stamp(c.at)} has ${moved[2]} in its style, which Studio refuses: place it with left, top, width and height, and move it with translate, scale and rotate in @keyframes`);
  }
  const video = live.filter((c) => c.tag === 'video' && c.end !== undefined && facts.get(c.full)).sort((a, b) => a.at - b.at);
  const sound = live.filter((c) => c.tag === 'audio' && c.end !== undefined && facts.get(c.full));
  const filmEnd = Math.max(0, ...live.map((c) => c.end ?? 0));
  if (!video.length) {
    bad('empty', null, 'film.html has no footage in it: not one video clip of theirs');
    return result();
  }

  // Their words, from the transcript beside the clip, else beside the file it was copied from
  /** @type {{ folder: string, clips: any[] }[]} */
  const logs = [];
  const logAt = (/** @type {string} */ d) => {
    const p = join(d, 'footage-log', 'footage.json');
    if (!existsSync(p)) return;
    try { const j = JSON.parse(readFileSync(p, 'utf8')); logs.push({ folder: resolve(d, 'footage-log', j.folder), clips: j.clips }); } catch { /* an unreadable log is none */ }
  };
  const seen = new Set();
  for (const d of [o.footage, dir, dirname(dir), ...[dir, dirname(dir)].flatMap((p) => { try { return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => join(p, e.name)); } catch { return []; } })]) {
    if (d && !seen.has(resolve(d))) { seen.add(resolve(d)); logAt(d); }
  }
  /** @type {Map<string, any>} */
  const wordCache = new Map();
  const wordsOf = (/** @type {Clip} */ c) => {
    if (!wordCache.has(c.full)) {
      const name = basename(c.full).replace(/\.[^.]+$/, '.vtt');
      const places = [join(dirname(c.full), name), ...logs.map((l) => join(l.folder, name))];
      const at = places.find((p) => existsSync(p));
      wordCache.set(c.full, at ? vttWords(readFileSync(at, 'utf8')) : null);
    }
    return wordCache.get(c.full);
  };
  const audible = (/** @type {Clip} */ c) => !c.muted && c.volume > 0 && facts.get(c.full)?.audio;

  // Only their footage: every video file is one of the logged clips, unchanged
  const logged = new Map(logs.flatMap((l) => l.clips.map((c) => [basename(c.file), c])));
  if (!logged.size) notes.push(`no footage log found (node ${SELF} <folder> writes one), so footage made again could not be told from theirs`);
  else {
    for (const name of new Set(video.map((c) => basename(c.file)))) {
      const was = logged.get(name);
      const c = video.find((v) => basename(v.file) === name);
      if (!was) bad('made', c?.at ?? null, `${name} is not one of the logged clips: footage made again, or from somewhere else. Trim their own clip with #t= instead`);
      else if (was.bytes && c && statSync(c.full).size !== was.bytes) bad('made', c.at, `${name} is not the logged clip's own file (its size changed): re-encoded or cut into a new file. Use their file, trimmed with #t=`);
    }
  }

  // The voice: sound with words beside it
  const voice = sound.filter((c) => wordsOf(c)?.length);
  /** The voice's quiet runs in film time, from every voice clip. */
  let voicePauses = /** @type {[number, number][] | null} */ (null);
  /** @type {{ t: number, text: string, first: boolean }[]} */
  const voiceWords = [];
  if (voice.length) {
    /** @type {[number, number][]} */
    const on = [];
    // Where one voice-over file ends and the next begins is a seam: a cut there is between two lines
    /** @type {[number, number][]} */
    const seams = [];
    for (const s of voice) {
      const q = await pausesOf(s.full);
      let at = s.from;
      /** @type {[number, number][]} */
      const pieces = [];
      for (const [a, b] of q.runs) { if (b <= s.from || a >= (s.to ?? 0)) continue; if (a > at) pieces.push([at, a]); at = Math.max(at, b); }
      if (at < (s.to ?? 0)) pieces.push([at, s.to ?? 0]);
      for (const [a, b] of pieces) on.push([s.at + (a - s.from) / s.speed, s.at + (b - s.from) / s.speed]);
      for (const w of wordsOf(s)) if (w.t >= s.from - 1e-3 && w.t < (s.to ?? 0)) voiceWords.push({ t: s.at + (w.t - s.from) / s.speed, text: w.text, first: w.first });
      seams.push([s.at, s.at], [s.end ?? s.at, s.end ?? s.at]);
    }
    on.sort((x, y) => x[0] - y[0]);
    /** @type {[number, number][]} */
    const merged = [];
    for (const p of on) { if (merged.length && p[0] <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], p[1]); else merged.push([p[0], p[1]]); }
    /** @type {[number, number][]} */
    const gaps = [[-1, merged[0]?.[0] ?? 0]];
    for (let i = 1; i < merged.length; i++) gaps.push([merged[i - 1][1], merged[i][0]]);
    gaps.push([merged.at(-1)?.[1] ?? 0, filmEnd + 1]);
    voicePauses = [...gaps.filter(([a, b]) => b - a >= PAUSE - 1e-9), ...seams];
    voiceWords.sort((a, b) => a.t - b.t);
  }

  // A shot is on screen once; the same footage twice at one moment is a backdrop, not a repeat
  const sameSeconds = (/** @type {Clip} */ a, /** @type {Clip} */ b) => a.full === b.full && Math.min(a.to ?? 0, b.to ?? 0) - Math.max(a.from, b.from) > 0.04;
  const together = (/** @type {Clip} */ a, /** @type {Clip} */ b) => Math.min(a.end ?? 0, b.end ?? 0) - Math.max(a.at, b.at) > 0.05;
  const backdrop = (/** @type {Clip} */ a, /** @type {Clip} */ b) => sameSeconds(a, b) && together(a, b);
  const shown = video.filter((c, i) => !video.slice(0, i).some((p) => backdrop(p, c)));
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    const a = shown[i], b = shown[j];
    if (sameSeconds(a, b) && !o.repeatOk) {
      const s = Math.max(a.from, b.from), e = Math.min(a.to ?? 0, b.to ?? 0);
      bad('repeat', b.at, `${basename(b.file)} ${stamp(s)} to ${stamp(e)} is on screen at ${stamp(a.at)} and again at ${stamp(b.at)}`);
    }
  }
  const spoken = (/** @type {Clip} */ c) => !!wordsOf(c)?.length;
  /** @type {Map<Clip, string>} */
  const hashes = new Map();
  for (const c of shown.filter((c) => !spoken(c))) hashes.set(c, await middleHash(c.full, (c.from + (c.to ?? c.from)) / 2).catch(() => ''));
  for (let i = 0; i < shown.length; i++) for (let j = i + 2; j < shown.length; j++) {
    const a = shown[i], b = shown[j], ha = hashes.get(a), hb = hashes.get(b);
    if (!ha || !hb || sameSeconds(a, b) || distance(ha, hb) > SAME_BITS) continue;
    const text = `${basename(b.file)} at ${stamp(b.at)} looks like ${basename(a.file)} at ${stamp(a.at)}: the same shot twice`;
    if (o.repeatOk) notes.push(text); else bad('alike', b.at, text);
  }

  // What is on screen all the time
  const covered = live.filter((c) => c.tag !== 'audio' && c.end !== undefined).map((c) => [c.at, /** @type {number} */ (c.end)]).sort((a, b) => a[0] - b[0]);
  let reach = 0;
  for (const [a, b] of [...covered, [filmEnd, filmEnd]]) {
    if (a - reach > 0.2) bad('gap', reach, `nothing is on screen from ${stamp(reach)} to ${stamp(a)}`);
    reach = Math.max(reach, b);
  }

  // Footage that speaks over the voice-over
  if (voice.length) {
    for (const c of video.filter((v) => audible(v) && v.volume > 0.3 && spoken(v))) {
      const over = wordsOf(c).filter((/** @type {any} */ w) => w.t >= c.from && w.t < (c.to ?? 0) && (voicePauses ?? []).every(([a, b]) => { const t = c.at + (w.t - c.from) / c.speed; return t < a || t > b; }));
      if (over.length >= 2) bad('over', c.at, `people in ${basename(c.file)} speak at ${stamp(c.at)} under the voice-over (${over.length} words, at volume ${c.volume}): mute it or lower it`);
    }
  } else {
    // A speech cut needs every spoken clip's words
    for (const c of video) if (audible(c) && !wordsOf(c)) { bad('words', c.at, `${basename(c.file)} has sound and no words beside it: npx openfilm get asr --src ${c.full}`); break; }
  }

  // Cuts on the voice's pauses
  const cuts = voicePauses ? shown.slice(1).filter((c, i) => !(shown[i].full === c.full && Math.abs(c.at - (shown[i].end ?? 0)) < 0.05 && Math.abs(c.from - (shown[i].to ?? 0)) < 0.05)) : [];
  let cutsOn = 0;
  for (const c of cuts) {
    const off = offRuns(c.at, /** @type {[number, number][]} */ (voicePauses));
    if (off <= TWO + 1e-9 || c.at <= 0.01) { cutsOn += 1; continue; }
    const near = /** @type {[number, number][]} */ (voicePauses).filter(([a]) => a >= 0 && a < filmEnd).sort((x, y) => offRuns(c.at, [x]) - offRuns(c.at, [y])).slice(0, 2).map(([a, b]) => (b - a > 0.005 ? `${a.toFixed(2)} to ${b.toFixed(2)}` : a.toFixed(2)));
    const said = voiceWords.filter((w) => w.t < c.at).slice(-3).map((w) => w.text).join(' ');
    const next = voiceWords.filter((w) => w.t >= c.at).slice(0, 3).map((w) => w.text).join(' ');
    bad('cut', c.at, `the cut to ${basename(c.file)} at ${stamp(c.at)} is ${Math.ceil(off * FPS - 1e-9)} frames from a pause of the voice (${quote(said, 30)} | ${quote(next, 30)}); nearest pauses ${near.join(', ')}`);
  }

  // The narration as written
  if (o.script) {
    const want = plain(readFileSync(resolve(o.script), 'utf8'));
    if (!voiceWords.length) notes.push(`${basename(o.script)}: no word times beside the voice-over to compare it with`);
    else {
      const got = plain(voiceWords.map((w) => w.text).join(''));
      const d = levenshtein(want, got);
      if (d > 0) bad('script', null, `the voice-over's words differ from ${basename(o.script)} by ${d} of ${want.length} characters (punctuation aside)`);
    }
  }

  // Their speech: order, edges in pauses, whole sentences
  /** @type {(Clip & { words: any[], q: [number, number][] })[]} */
  const talk = [];
  for (const c of video.filter((v) => audible(v) && spoken(v))) {
    const run = talk.at(-1);
    if (run && run.full === c.full && Math.abs(c.at - (run.end ?? 0)) < 0.05 && Math.abs(c.from - (run.to ?? 0)) < 0.05 * Math.max(1, c.speed)) { run.to = c.to; run.end = c.end; }
    else talk.push({ ...c, words: wordsOf(c), q: (await pausesOf(c.full)).runs });
  }
  let edges = 0, edgesOn = 0;
  const punctuated = talk.every((c) => c.words.filter((/** @type {any} */ w) => ENDS.test(w.text)).length * 60 >= c.words.length);
  if (talk.length && !punctuated) notes.push('a transcript has hardly any sentence punctuation, so whole sentences could not be checked');
  for (const [j, c] of talk.entries()) {
    const name = basename(c.file);
    const length = facts.get(c.full).duration;
    const before = talk.slice(0, j).find((p) => p.full === c.full && c.from < p.from - 0.04);
    if (before) {
      const text = `${name} at ${stamp(c.at)} plays ${stamp(c.from)} of the take, which comes earlier than the ${stamp(before.from)} played before it at ${stamp(before.at)}: ${quote(saidIn(c.words, c.from, c.to ?? 0))} after ${quote(saidIn(before.words, before.from, before.to ?? 0))} puts their sentences in an order they did not say them`;
      if (o.reorderOk) notes.push(text); else bad('order', c.at, text);
    }
    for (const side of /** @type {const} */ (['in', 'out'])) {
      const t = side === 'in' ? c.from : c.to ?? 0;
      const nat = side === 'in' ? t <= EDGE : t >= length - EDGE;
      edges += 1;
      const off = offRuns(t, c.q);
      // Words are timed early: one stamped inside a pause is said after it. At a pause, the words before it are those
      // stamped before it starts
      const pause = c.q.find(([a, b]) => t >= a - TWO - 1e-9 && t <= b + TWO + 1e-9);
      const split = pause ? pause[0] - 1e-6 : t - 0.05;
      const spokenBefore = c.words.filter((/** @type {any} */ w) => w.t < split);
      const spokenAfter = c.words.filter((/** @type {any} */ w) => w.t >= split);
      const last = spokenBefore.at(-1), first = spokenAfter[0];
      // The sentence the edge is in: its words from the edge to its end, and from its start to the edge
      const toEnd = [];
      for (const w of spokenAfter.slice(0, 8)) { toEnd.push(w); if (ENDS.test(w.text)) break; }
      const sinceStart = [];
      for (const w of [...spokenBefore].reverse().slice(0, 8)) { if (sinceStart.length && ENDS.test(w.text)) break; sinceStart.unshift(w); }
      const reasons = [];
      let kind = 'sentence';
      if (!nat && off > TWO + 1e-9) {
        const near = [...c.q].sort((x, y) => offRuns(t, [x]) - offRuns(t, [y])).slice(0, 2).map(([a, b]) => `${a.toFixed(2)} to ${b.toFixed(2)}`);
        kind = 'edge';
        reasons.push(`${Math.ceil(off * FPS - 1e-9)} frames from a pause${last ? `, inside ${quote(last.text, 20)}` : ''}; pauses near it ${near.join(', ') || 'none found'}`);
      } else edgesOn += 1;
      if (punctuated && !nat) {
        // A clip begins where a sentence or a clause begins and ends where one ends
        if (side === 'in' && first && last && !ENDS.test(last.text) && !CLAUSE.test(last.text)) reasons.push(`it starts in the middle of a sentence, at ${quote(toEnd.map((/** @type {any} */ w) => w.text).join(' '), 40)}`);
        // A clause end is a place to stop, unless it is the first word or two of a sentence the clip does not finish (So,)
        if (side === 'out' && last && !ENDS.test(last.text) && (!CLAUSE.test(last.text) || sinceStart.length <= 2)) reasons.push(`it stops in the middle of a sentence, on ${quote(sinceStart.map((/** @type {any} */ w) => w.text).join(' '), 40)}`);
      }
      if (reasons.length) bad(kind, side === 'in' ? c.at : c.end ?? c.at, `${name} ${side} at ${stamp(t)} (film ${stamp(side === 'in' ? c.at : c.end ?? c.at)}): ${reasons.join('; ')}`);
    }
  }

  // The shot list: what is on screen, and what is said then
  const shots = shown.map((c) => {
    const line = voiceWords.length ? saidIn(voiceWords, c.at - 0.02, c.end ?? c.at) : saidIn(wordsOf(c) ?? [], c.from, c.to ?? 0);
    return `${stamp(c.at).padStart(8)}  ${basename(c.file)} ${c.from.toFixed(2)}-${(c.to ?? 0).toFixed(2)}${c.speed !== 1 ? ` x${c.speed}` : ''}${audible(c) ? '' : ' muted'}  ${line ? quote(line, 60) : ''}`;
  });
  const summary = [
    `${basename(file)}: ${stamp(filmEnd)}, ${video.length} footage clips from ${new Set(video.map((c) => c.full)).size} files${voice.length ? `, ${voice.length} voice-over clips` : ''}`,
    ...(voicePauses ? [`cuts on the voice's pauses: ${cutsOn} of ${cuts.length}`] : []),
    ...(talk.length ? [`edges of their speech in pauses: ${edgesOn} of ${edges}`] : []),
  ];
  return result(summary, shots);
}

/** What to do about each kind of problem, printed last. */
const ADVICE = {
  empty: 'Build the film in film.html itself: a <video src="assets/<their clip>#t=in,out" at="…"> for every shot, as `npx openfilm skill edit` says. An MP4 made with ffmpeg is not the film.',
  file: 'Point every clip at a file that is there, inside its length.',
  style: 'Studio reads film.html strictly: change the style as the message says.',
  made: 'Use their own clip, copied as it is into the project, trimmed only with #t=.',
  order: 'Keep each person\'s sentences in the order they said them. If the person asked for another order, say so in the shot list and run check again with --reorder-ok.',
  edge: 'Move each cut into a pause of the speech: footage.json lists every sentence with `in` and `out` points inside its pauses, and the message names the pauses nearest the cut.',
  sentence: 'Start the clip where a sentence begins and end it where one ends: take the sentence whole, from footage.json lines.',
  repeat: 'Use a shot once: take other footage for one of them. If repeating is the point, say so in the shot list and run check again with --repeat-ok.',
  alike: 'Shots that look alike count as one: pick one and cover the other line with other footage. If repeating is the point, say so in the shot list and run check again with --repeat-ok.',
  gap: 'Cover the time with footage, or take it out of the film.',
  over: 'Mute that clip (muted) or give it a low volume so the voice-over is heard alone.',
  words: 'Get the words of that clip first, then cut it by them.',
  cut: 'Move the cut to a pause of the voice-over, or change which line the shot covers. The voice-over\'s own pauses are where a viewer expects the picture to change.',
  script: 'The narration is the person\'s script word for word: make the voice-over again from the script, and put the new files in place of the old.',
};

/** The check's report: what it found, then what to do. */
export function report(/** @type {Awaited<ReturnType<typeof checkFilm>>} */ r, /** @type {{ list?: boolean }} */ o = {}) {
  const lines = [...r.summary];
  if (o.list && r.shots.length) lines.push('', 'on screen, in film order:', ...r.shots);
  if (r.notes.length) lines.push('', ...r.notes.map((n) => `note: ${n}`));
  if (!r.problems.length) return [...lines, '', 'No problems. Now run `npx openfilm look` and read the sheet and the frames, then hand over the shot list.'];
  const sorted = [...r.problems].sort((a, b) => (a.t ?? -1) - (b.t ?? -1));
  lines.push('', `${r.problems.length} problem${r.problems.length > 1 ? 's' : ''}:`);
  /** @type {Map<string, number>} */
  const shownOf = new Map();
  for (const p of sorted) {
    const n = (shownOf.get(p.kind) ?? 0) + 1;
    shownOf.set(p.kind, n);
    if (n <= 8) lines.push(`  [${p.kind}] ${p.text}`);
    else if (n === 9) lines.push(`  [${p.kind}] and ${sorted.filter((x) => x.kind === p.kind).length - 8} more of the same kind`);
  }
  lines.push('', 'What to do:');
  for (const kind of new Set(sorted.map((p) => p.kind))) lines.push(`  [${kind}] ${ADVICE[/** @type {keyof typeof ADVICE} */ (kind)] ?? ''}`);
  lines.push('Fix film.html, then run this check again until it passes. Then `npx openfilm look`.');
  return lines;
}

const same = (/** @type {string} */ x) => (process.platform === 'win32' ? resolve(x).toLowerCase() : resolve(x));
if (process.argv[1] && same(process.argv[1]) === same(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const take = (/** @type {string} */ flag) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const has = (/** @type {string} */ flag) => { const i = args.indexOf(flag); if (i >= 0) args.splice(i, 1); return i >= 0; };
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log('node footage.mjs <folder> [--out <dir>] [--threshold 0.3]\n\n  Logs every clip in the folder shot by shot: footage.json, footage.html and a picture per shot (first, middle and\n  last frame) in <folder>/footage-log/. What is said in each shot comes from the WebVTT beside its clip\n  (npx openfilm get asr --src <clip>); a clip that speaks also gets its sentences with cut points inside the pauses;\n  shots that look alike, in any clip, are listed together. A lower --threshold finds more cuts.\n\nnode footage.mjs check [film.html] [--script script.txt] [--list] [--repeat-ok] [--reorder-ok] [--footage <folder>]\n\n  Reads film.html against the footage and the words beside it: clips of one take in order, edges in pauses, whole\n  sentences, nothing on screen twice, cuts on the voice-over\'s pauses, the narration as written, footage that is\n  really theirs. Prints what is wrong, then what to do; exits 1 when anything is wrong.');
    process.exit(args.length ? 0 : 2);
  }
  if (args[0] === 'check') {
    args.shift();
    const script = take('--script'), footage = take('--footage');
    const list = has('--list'), repeatOk = has('--repeat-ok'), reorderOk = has('--reorder-ok');
    checkFilm(args[0] ?? 'film.html', { script, footage, repeatOk, reorderOk }).then(
      (r) => { console.log(report(r, { list }).join('\n')); process.exit(r.problems.length ? 1 : 0); },
      (e) => { console.error(`footage.mjs: ${e.message}`); process.exit(2); },
    );
  } else {
    const out = take('--out');
    const th = take('--threshold');
    const threshold = th === undefined ? undefined : Number(th);
    if (threshold !== undefined && !(threshold > 0 && threshold < 1)) { console.error('footage.mjs: --threshold is between 0 and 1'); process.exit(2); }
    logFootage(args[0], { out, threshold }).then(
      (lines) => { console.log(lines.join('\n')); process.exit(0); },
      (e) => { console.error(`footage.mjs: ${e.message}`); process.exit(1); },
    );
  }
}
