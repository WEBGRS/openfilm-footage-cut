#!/usr/bin/env node
// Every join of a speech film, for reading: what the film's sound says either side of the cut (a transcript of the
// finished film) beside what the source transcripts say either side of each clip's edge.
//   node evals/joins.mjs <film.html> <heard.vtt> [--words 8]
// heard.vtt is a word-timed transcript of the finished film (or of `measure.mjs --audio`'s mix), in film seconds.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseFilm, vttWords } from '../skills/footage-cut/scripts/footage.mjs';

const args = process.argv.slice(2);
const take = (f) => { const i = args.indexOf(f); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const n = Number(take('--words') ?? 8);
const [filmFile, heardFile] = args;
if (!filmFile || !heardFile) { console.error('node joins.mjs <film.html> <heard.vtt> [--words 8]'); process.exit(2); }
const dir = dirname(resolve(filmFile));
const heard = vttWords(readFileSync(heardFile, 'utf8'));
const clips = parseFilm(readFileSync(filmFile, 'utf8'), dir).tracks.filter((t) => !t.hidden).flatMap((t) => t.clips)
  .filter((c) => c.tag === 'video' && !c.muted).sort((a, b) => a.at - b.at);
const words = (c) => {
  const vtt = c.full.replace(/\.[^.]+$/, '.vtt');
  return existsSync(vtt) ? vttWords(readFileSync(vtt, 'utf8')) : [];
};
const last = (list, k) => list.slice(-k).map((w) => w.text).join(' ');
const first = (list, k) => list.slice(0, k).map((w) => w.text).join(' ');
for (let i = 0; i < clips.length; i++) {
  const c = clips[i], w = words(c);
  const end = c.at + (c.to - c.from) / c.speed;
  const prev = clips[i - 1];
  const contiguous = prev && prev.full === c.full && Math.abs(prev.to - c.from) < 0.05 && Math.abs(prev.at + (prev.to - prev.from) / prev.speed - c.at) < 0.05;
  if (i > 0 && !contiguous) {
    const before = heard.filter((x) => x.t < c.at - 0.05), after = heard.filter((x) => x.t >= c.at - 0.05);
    console.log(`join ${i} at ${c.at.toFixed(2)} s`);
    console.log(`  film says   ...${last(before, n)} | ${first(after, n)}...`);
    console.log(`  ${basename(prev.file)} out ${prev.to}: ...${last(words(prev).filter((x) => x.t < prev.to - 0.05), n)}`);
    console.log(`  ${basename(c.file)} in ${c.from}: ${first(w.filter((x) => x.t >= c.from - 0.05), n)}...   (before it in the source: ...${last(w.filter((x) => x.t < c.from - 0.05), 4)})`);
  }
  if (i === clips.length - 1) console.log(`end at ${end.toFixed(2)} s: film says ...${last(heard.filter((x) => x.t < end), n)}   (source after the clip: ${first(w.filter((x) => x.t >= c.to - 0.05), 4)}...)`);
}
console.log(`\n${clips.length} clips with sound`);
