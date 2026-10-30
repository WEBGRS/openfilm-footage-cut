#!/usr/bin/env node
// @ts-check
/**
 * The person's footage logged shot by shot, so a film can be cut from it. For a folder of clips it writes, in
 * <folder>/footage-log/ (or --out):
 *   footage.json   the log
 *   footage.html   the same to look at: each shot's first, middle and last frame and what is said in it
 *   <shot>.jpg     those frames, one picture per shot (A1.jpg …)
 *
 *   node footage.mjs <folder> [--out <dir>] [--threshold 0.3]
 *
 * The log, format "openfilm-footage/1", every time in the clip's own seconds:
 *   { format, folder, clips: [{ id, file, duration, width, height, fps, audio, words,
 *       shots: [{ id, start, end, picture, said, same }] }], same: [[shot ids]], skipped: [files with no picture] }
 * A clip's id is a letter in file-name order (A, B … AA), a shot's the clip's id and its number (A1). `words` is the
 * WebVTT beside the clip (npx openfilm get asr --src <clip>) or null; `said` is what is said during the shot, null
 * without words. `same` lists the other shots whose middle frames look alike, in any clip: one of them is enough.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'openfilm-footage/1';
const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts)$/i;
/** Shots shorter than this are part of the one before (a flash, a wipe). */
const MIN_SHOT = 0.6;
/** Middle frames this many bits apart or fewer, of 64, look alike. */
const SAME_BITS = 6;
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
 * own spacing (a word split into pieces has none between them); `first` marks a cue's first word.
 */
export function vttWords(/** @type {string} */ body) {
  /** @type {{ t: number, end: number, text: string, raw: string, first: boolean }[]} */
  const words = [];
  for (const block of body.replace(/^\ufeff/, '').replace(/\r/g, '').split(/\n{2,}/)) {
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

const WIDE = /[\u3000-\u9fff\uff00-\uffef]/;

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

async function probe(/** @type {string} */ file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', file]);
  const j = JSON.parse(String(out));
  const v = j.streams.find((/** @type {any} */ s) => s.codec_type === 'video');
  const [n, d] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return { duration: Number(j.format?.duration) || 0, width: v?.width ?? 0, height: v?.height ?? 0, fps: d ? round(n / d) : 0, audio: j.streams.some((/** @type {any} */ s) => s.codec_type === 'audio') };
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
    log(`${id} ${f}: ${facts.duration.toFixed(1)} s, ${spans.length} shot${spans.length > 1 ? 's' : ''}`);
    const shots = [];
    for (const [k, [a, b]] of spans.entries()) {
      const sid = `${id}${k + 1}`;
      const edge = Math.min(0.1, (b - a) / 4);
      await strip(file, [a + edge, (a + b) / 2, Math.max(a + edge, b - edge - 0.05)], join(outDir, `${sid}.jpg`));
      const hash = await middleHash(file, (a + b) / 2);
      hashes.push({ id: sid, hash });
      shots.push({ id: sid, start: a, end: b, picture: `${sid}.jpg`, said: words ? saidIn(words, a, b) : null, same: /** @type {string[]} */ ([]) });
    }
    clips.push({ id, file: relative(outDir, file).replace(/\\/g, '/'), duration: round(facts.duration), width: facts.width, height: facts.height, fps: facts.fps, audio: facts.audio, words: words ? basename(vtt) : null, shots });
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
  ];
}

/** The log as a page: a row per shot with its frames and words. */
function page(/** @type {any} */ data) {
  const rows = data.clips.map((/** @type {any} */ c) => `<h2>${c.id} · ${esc(c.file)} · ${c.duration} s${c.words ? '' : c.audio ? ' · no words yet' : ' · no sound'}</h2>
<table>${c.shots.map((/** @type {any} */ s) => `<tr><td class="id">${s.id}</td><td class="t">${s.start}–${s.end} s</td><td><img src="${s.picture}" alt="${s.id}"></td><td>${s.said ? esc(s.said) : ''}${s.same.length ? `<div class="same">looks like ${s.same.join(', ')}</div>` : ''}</td></tr>`).join('\n')}</table>`).join('\n');
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

const same = (/** @type {string} */ x) => (process.platform === 'win32' ? resolve(x).toLowerCase() : resolve(x));
if (process.argv[1] && same(process.argv[1]) === same(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const take = (/** @type {string} */ flag) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log('node footage.mjs <folder> [--out <dir>] [--threshold 0.3]\n\n  Logs every clip in the folder shot by shot: footage.json, footage.html and a picture per shot (first, middle and\n  last frame) in <folder>/footage-log/. What is said in each shot comes from the WebVTT beside its clip\n  (npx openfilm get asr --src <clip>); shots that look alike, in any clip, are listed together. A lower --threshold\n  finds more cuts.');
    process.exit(args.length ? 0 : 2);
  }
  const out = take('--out');
  const th = take('--threshold');
  const threshold = th === undefined ? undefined : Number(th);
  if (threshold !== undefined && !(threshold > 0 && threshold < 1)) { console.error('footage.mjs: --threshold is between 0 and 1'); process.exit(2); }
  logFootage(args[0], { out, threshold }).then(
    (lines) => { console.log(lines.join('\n')); process.exit(0); },
    (e) => { console.error(`footage.mjs: ${e.message}`); process.exit(1); },
  );
}
