// footage.mjs check: a film.html read against the footage, the words and the voice-over
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { checkFilm, linesOf, logFootage, parseFilm, quietRuns, report, vttWords } from '../skills/footage-cut/scripts/footage.mjs';

const SCRIPT = join(import.meta.dirname, '../skills/footage-cut/scripts/footage.mjs');
let root, proj;
const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
};
const bursts = (spans, d) => `aevalsrc=sin(2*PI*300*t)*0.5*(${spans.map(([a, b]) => `between(t\\,${a}\\,${b})`).join('+')}):s=16000:d=${d}`;
const kinds = (r) => r.problems.map((p) => p.kind).sort();

// A film in the project: clips as [file, from, to, at] on one track, or tracks as arrays of those
let n = 0;
const film = (tracks, extra = '') => {
  const list = Array.isArray(tracks[0]?.[0]) ? tracks : [tracks];
  const body = list.map((t) => `<section>\n${t.map(([f, a, b, at, attrs = '']) => `  <${f.endsWith('.wav') ? 'audio' : 'video'} src="assets/${f}#t=${a},${b}" at="${at}" ${attrs}></${f.endsWith('.wav') ? 'audio' : 'video'}>`).join('\n')}\n</section>`).join('\n');
  const file = join(proj, `film-${n++}.html`);
  writeFileSync(file, `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n${extra}</head>\n<body>\n${body}\n</body>\n</html>\n`);
  return file;
};

before(() => {
  root = mkdtempSync(join(tmpdir(), 'footage-check-'));
  proj = join(root, 'proj');
  const assets = join(proj, 'assets');
  mkdirSync(assets, { recursive: true });
  // S: one person talking, five sentences; the fourth has a pause inside it, after "tips"
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=14', '-f', 'lavfi', '-i', bursts([[1, 2.2], [3, 4.2], [5, 6.2], [7, 8.2], [8.8, 10], [11, 12.2]], 14),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', join(assets, 'S.mp4')]);
  writeFileSync(join(assets, 'S.vtt'), `WEBVTT

00:00:01.000 --> 00:00:02.200
We<00:00:01.400> left<00:00:01.800> early.

00:00:03.000 --> 00:00:04.200
Then<00:00:03.400> it<00:00:03.700> rained.

00:00:05.000 --> 00:00:06.200
The<00:00:05.300> lake<00:00:05.600> was<00:00:05.900> calm.

00:00:07.000 --> 00:00:10.000
We<00:00:07.400> learned<00:00:07.800> tips<00:00:08.800> on<00:00:09.200> what<00:00:09.500> to<00:00:09.700> do.

00:00:11.000 --> 00:00:12.200
It<00:00:11.400> was<00:00:11.800> fun.
`);
  // Four silent shots that look nothing alike
  for (const [name, src] of [['a', 'testsrc2'], ['b', 'mandelbrot'], ['c', 'smptebars'], ['d', 'rgbtestsrc']]) {
    ff(['-f', 'lavfi', '-i', `${src}=s=320x180:r=30`, '-t', '10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(assets, `${name}.mp4`)]);
  }
  copyFileSync(join(assets, 'a.mp4'), join(assets, 'a-copy.mp4'));
  // A voice-over: four lines, each with a pause round it
  ff(['-f', 'lavfi', '-i', bursts([[1, 2], [3, 4], [5, 6], [7, 8]], 10), '-c:a', 'pcm_s16le', join(assets, 'V.wav')]);
  writeFileSync(join(assets, 'V.vtt'), `WEBVTT

00:00:01.000 --> 00:00:02.000
We<00:00:01.300> left<00:00:01.600> early.

00:00:03.000 --> 00:00:04.000
Then<00:00:03.300> it<00:00:03.600> rained.

00:00:05.000 --> 00:00:06.000
The<00:00:05.300> lake<00:00:05.600> was<00:00:05.800> calm.

00:00:07.000 --> 00:00:08.000
It<00:00:07.300> was<00:00:07.600> fun.
`);
  // Two voice-over files that run into each other with no silence between them
  for (const name of ['W1', 'W2']) {
    ff(['-f', 'lavfi', '-i', bursts([[0, 4]], 4), '-c:a', 'pcm_s16le', join(assets, `${name}.wav`)]);
    writeFileSync(join(assets, `${name}.vtt`), 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nOne<00:00:01.000> two<00:00:02.000> three.\n');
  }
});

after(() => root && rmSync(root, { recursive: true, force: true }));

test('film.html with nothing in it fails, and says to build it in film.html', async () => {
  const empty = join(proj, 'empty.html');
  writeFileSync(empty, '<!doctype html>\n<html>\n<head></head>\n<body>\n</body>\n</html>\n');
  const r = await checkFilm(empty);
  assert.deepEqual(kinds(r), ['empty']);
  const last = report(r).at(-2);
  assert.match(last, /Build the film in film\.html/);
  // Voice-over and no footage is no film either
  assert.deepEqual(kinds(await checkFilm(film([['V.wav', 0, 10, 0]]))), ['empty']);
});

test('the film as Studio reads it: tracks, fragments, speed, muted tracks', () => {
  const p = parseFilm('<body><section muted><video src="assets/a%20b.mp4#t=2,5" at="1" speed="2" class="muted" style="left: 0px"></video></section><section hidden><audio src="x.wav#t=3"></audio></section><section><track kind="captions" src="c.vtt"></section></body>', 'd');
  assert.equal(p.tracks.length, 3);
  const [v] = p.tracks[0].clips;
  assert.deepEqual([v.file, v.from, v.to, v.at, v.speed, v.muted], ['assets/a b.mp4', 2, 5, 1, 2, true]);
  assert.equal(p.tracks[1].hidden, true);
  assert.deepEqual(p.tracks[2].captions, ['c.vtt']);
  assert.equal(parseFilm('<section><video src="a.mp4" volume="0"></video></section>').tracks[0].clips[0].muted, true);
});

test('whole sentences, each edge in a pause, in the order said: no problems', async () => {
  const r = await checkFilm(film([['S.mp4', 0.8, 2.4, 0], ['S.mp4', 2.8, 4.4, 1.6], ['S.mp4', 4.8, 6.4, 3.2]]));
  assert.deepEqual(r.problems, []);
  assert.match(r.summary.join('\n'), /edges of their speech in pauses: 6 of 6/);
  assert.match(report(r).at(-1), /No problems/);
});

test('their sentences played out of the take order', async () => {
  const text = [['S.mp4', 4.8, 6.4, 0], ['S.mp4', 0.8, 2.4, 1.6]];
  const r = await checkFilm(film(text));
  assert.deepEqual(kinds(r), ['order']);
  assert.match(r.problems[0].text, /It was|rained|calm|early/);
  assert.match(report(r).at(-1), /run this check again/);
  // Asked for: it is said, and passes
  const asked = await checkFilm(film(text), { reorderOk: true });
  assert.deepEqual(asked.problems, []);
  assert.match(asked.notes.join(' '), /order they did not say/);
});

test('a clip that starts inside a word', async () => {
  const r = await checkFilm(film([['S.mp4', 1.5, 2.4, 0]]));
  assert.deepEqual(kinds(r), ['edge']);
  assert.match(r.problems[0].text, /inside «left»/);
  assert.match(r.problems[0].text, /pauses near it 0\.00 to 0\.99/);
});

test('a word timed early, inside the pause before it, is said after the pause', async () => {
  // "The" is stamped 0.3 s before the speech starts, in the pause that precedes it
  copyFileSync(join(proj, 'assets', 'S.mp4'), join(proj, 'assets', 'E.mp4'));
  writeFileSync(join(proj, 'assets', 'E.vtt'), readFileSync(join(proj, 'assets', 'S.vtt'), 'utf8').replace('00:00:05.000 --> 00:00:06.200\nThe', '00:00:04.700 --> 00:00:06.200\nThe'));
  const r = await checkFilm(film([['E.mp4', 2.8, 4.6, 0], ['E.mp4', 4.8, 6.4, 1.8]]));
  assert.deepEqual(r.problems, []);
});

test('a clip that ends on the first word of the next sentence ("So,") stops mid-sentence; a longer clause end does not', async () => {
  // "So," is said at the end of the burst, after "rained."
  copyFileSync(join(proj, 'assets', 'S.mp4'), join(proj, 'assets', 'Q.mp4'));
  writeFileSync(join(proj, 'assets', 'Q.vtt'), readFileSync(join(proj, 'assets', 'S.vtt'), 'utf8').replace('Then<00:00:03.400> it<00:00:03.700> rained.', 'Then<00:00:03.400> it<00:00:03.700> rained.<00:00:03.900> So,'));
  const r = await checkFilm(film([['Q.mp4', 2.8, 4.6, 0]]));
  assert.deepEqual(kinds(r), ['sentence']);
  assert.match(r.problems[0].text, /stops in the middle of a sentence, on «So,»/);
  // The same clip with a longer clause before the comma is a place to stop
  writeFileSync(join(proj, 'assets', 'Q.vtt'), readFileSync(join(proj, 'assets', 'S.vtt'), 'utf8').replace('Then<00:00:03.400> it<00:00:03.700> rained.', 'Then<00:00:03.400> it<00:00:03.700> rained,'));
  assert.deepEqual((await checkFilm(film([['Q.mp4', 2.8, 4.6, 0]]))).problems, []);
});

test('a clip that stops in the middle of a sentence, and one that starts in the middle of one', async () => {
  const stops = await checkFilm(film([['S.mp4', 6.8, 8.5, 0]]));
  assert.deepEqual(kinds(stops), ['sentence']);
  assert.match(stops.problems[0].text, /stops in the middle of a sentence, on «.*tips»/);
  const starts = await checkFilm(film([['S.mp4', 8.5, 10.4, 0]]));
  assert.deepEqual(kinds(starts), ['sentence']);
  assert.match(starts.problems[0].text, /starts in the middle of a sentence, at «on what to do\.»/);
  // The two halves one after the other are one clip of the take, not a join
  assert.deepEqual((await checkFilm(film([['S.mp4', 6.8, 8.5, 0], ['S.mp4', 8.5, 10.4, 1.7]]))).problems, []);
  // A sentence stopped, and another one begun after it: the join is said
  const spliced = await checkFilm(film([['S.mp4', 6.8, 8.5, 0], ['S.mp4', 10.4, 12.4, 1.7]]));
  assert.deepEqual(kinds(spliced), ['sentence']);
});

test('the same seconds twice are a repeat; the same clip under itself is a backdrop', async () => {
  const twice = await checkFilm(film([['S.mp4', 0.8, 2.4, 0], ['S.mp4', 0.8, 2.4, 5]]));
  assert.deepEqual(kinds(twice).filter((k) => k !== 'gap'), ['repeat']);
  const ok = await checkFilm(film([['S.mp4', 0.8, 2.4, 0], ['S.mp4', 0.8, 2.4, 1.6]]), { repeatOk: true });
  assert.deepEqual(ok.problems, []);
  const under = await checkFilm(film([[['S.mp4', 0.8, 2.4, 0]], [['S.mp4', 0.8, 2.4, 0, 'muted']]]));
  assert.deepEqual(under.problems, []);
});

test('two clips that look alike, not next to each other', async () => {
  const same = film([['a.mp4', 0, 2, 0], ['b.mp4', 0, 2, 2], ['a-copy.mp4', 5, 7, 4]]);
  const r = await checkFilm(same);
  assert.deepEqual(kinds(r), ['alike']);
  assert.match(r.problems[0].text, /a-copy\.mp4 at 4\.00 s looks like a\.mp4 at 0\.00 s/);
  assert.deepEqual((await checkFilm(same, { repeatOk: true })).problems, []);
});

test('nothing on screen for a while', async () => {
  const r = await checkFilm(film([['a.mp4', 0, 2, 0], ['b.mp4', 0, 2, 3]]));
  assert.deepEqual(kinds(r), ['gap']);
  assert.match(r.problems[0].text, /nothing is on screen from 2\.00 s to 3\.00 s/);
});

test('cuts on the voice-over: in its pauses, or named with the pauses nearest', async () => {
  const good = film([[['a.mp4', 0, 2.5, 0], ['b.mp4', 0, 2, 2.5], ['c.mp4', 0, 2, 4.5], ['d.mp4', 0, 3.5, 6.5]], [['V.wav', 0, 10, 0]]]);
  const r = await checkFilm(good);
  assert.deepEqual(r.problems, []);
  assert.match(r.summary.join('\n'), /cuts on the voice's pauses: 3 of 3/);
  const off = await checkFilm(film([[['a.mp4', 0, 3.5, 0], ['b.mp4', 0, 3, 3.5], ['c.mp4', 0, 3.5, 6.5]], [['V.wav', 0, 10, 0]]]));
  assert.deepEqual(kinds(off), ['cut']);
  assert.match(off.problems[0].text, /the cut to b\.mp4 at 3\.50 s is 15 frames from a pause of the voice \(/);
  assert.match(off.problems[0].text, /nearest pauses/);
  assert.match(report(off).join('\n'), /\[cut\] Move the cut to a pause/);
});

test('a cut where one voice-over file ends and the next begins is between two lines', async () => {
  const voice = [['W1.wav', 0, 4, 0], ['W2.wav', 0, 4, 4]];
  const seam = await checkFilm(film([[['a.mp4', 0, 4, 0], ['b.mp4', 0, 4, 4]], voice]));
  assert.deepEqual(seam.problems, []);
  const mid = await checkFilm(film([[['a.mp4', 0, 2, 0], ['b.mp4', 0, 6, 2]], voice]));
  assert.deepEqual(kinds(mid), ['cut']);
  assert.match(mid.problems[0].text, /nearest pauses 0\.00, 4\.00/);
});

test('the narration as written, word for word', async () => {
  const good = film([[['a.mp4', 0, 2.5, 0], ['b.mp4', 0, 2, 2.5], ['c.mp4', 0, 2, 4.5], ['d.mp4', 0, 3.5, 6.5]], [['V.wav', 0, 10, 0]]]);
  const script = join(proj, 'script.txt');
  writeFileSync(script, 'We left early.\nThen it rained.\nThe lake was calm.\nIt was fun.\n');
  assert.deepEqual((await checkFilm(good, { script })).problems, []);
  writeFileSync(script, 'We left early.\nThen it rained.\nThe lake was very calm.\nIt was fun.\n');
  const r = await checkFilm(good, { script });
  assert.deepEqual(kinds(r), ['script']);
  assert.match(r.problems[0].text, /differ from script\.txt by 4 of/);
});

test('footage that is theirs: the logged file, as it is, not one made again', async () => {
  const p2 = join(root, 'proj2');
  mkdirSync(join(p2, 'assets'), { recursive: true });
  mkdirSync(join(p2, 'clips'));
  for (const f of ['S.mp4', 'S.vtt']) copyFileSync(join(proj, 'assets', f), join(p2, 'clips', f));
  await logFootage(join(p2, 'clips'), { log: () => undefined });
  const html = (src) => `<!doctype html>\n<html>\n<head></head>\n<body>\n<section>\n<video src="assets/${src}#t=0.8,2.4"></video>\n</section>\n</body>\n</html>\n`;
  // Their own file, copied
  copyFileSync(join(p2, 'clips', 'S.mp4'), join(p2, 'assets', 'S.mp4'));
  writeFileSync(join(p2, 'film.html'), html('S.mp4'));
  assert.deepEqual((await checkFilm(join(p2, 'film.html'))).problems, []);
  // The same name, made again
  ff(['-i', join(p2, 'clips', 'S.mp4'), '-c:v', 'libx264', '-crf', '40', '-c:a', 'aac', '-b:a', '48k', join(p2, 'assets', 'S.mp4')]);
  assert.deepEqual(kinds(await checkFilm(join(p2, 'film.html'))), ['made']);
  // Another name
  copyFileSync(join(p2, 'assets', 'S.mp4'), join(p2, 'assets', 'cut-1.mp4'));
  writeFileSync(join(p2, 'film.html'), html('cut-1.mp4'));
  const r = await checkFilm(join(p2, 'film.html'));
  assert.ok(kinds(r).includes('made'));
  assert.match(r.problems.find((p) => p.kind === 'made').text, /cut-1\.mp4 is not one of the logged clips/);
});

test('footage.json lists the sentences with cut points inside their pauses', async () => {
  const folder = join(root, 'speaker');
  mkdirSync(folder);
  for (const f of ['S.mp4', 'S.vtt']) copyFileSync(join(proj, 'assets', f), join(folder, f));
  await logFootage(folder, { log: () => undefined });
  const { clips: [c] } = JSON.parse(readFileSync(join(folder, 'footage-log', 'footage.json'), 'utf8'));
  assert.equal(c.lines.length, 5);
  assert.ok(c.bytes > 0);
  const [one, two, , four, five] = c.lines;
  assert.ok(one.in > 0.6 && one.in < 1, `in ${one.in}`);
  assert.ok(two.in > 2.2 && two.in <= 3 && two.out >= 4.2 && two.out < 5, `${two.in} ${two.out}`);
  // The pause inside a sentence is not where one ends
  assert.equal(four.said, 'We learned tips on what to do.');
  assert.ok(four.in > 6.2 && four.in <= 7 && four.out >= 10 && four.out < 11, `${four.in} ${four.out}`);
  assert.ok(five.out === null || five.out >= 12.2);
  // Cutting at them passes
  const html = join(folder, 'film.html');
  mkdirSync(join(folder, 'assets'), { recursive: true });
  copyFileSync(join(folder, 'S.mp4'), join(folder, 'assets', 'S.mp4'));
  writeFileSync(html, `<!doctype html>\n<html>\n<head></head>\n<body>\n<section>\n<video src="assets/S.mp4#t=${two.in},${two.out}" at="0"></video>\n<video src="assets/S.mp4#t=${four.in},${four.out}" at="${two.out - two.in}"></video>\n</section>\n</body>\n</html>\n`);
  assert.deepEqual((await checkFilm(html)).problems, []);
});

test('quiet runs and the sentence cut points, from numbers alone', () => {
  // 1 s of tone, 0.5 s silence, 1 s of tone, 16 kHz
  const pcm = Buffer.alloc(16000 * 2 * 2.5);
  for (let i = 0; i < 40000; i++) if (i < 16000 || i >= 24000) pcm.writeInt16LE(Math.round(Math.sin(i / 3) * 12000), i * 2);
  const { runs, length } = quietRuns(pcm);
  assert.equal(length, 2.5);
  assert.deepEqual(runs.map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]), [[1, 1.5]]);
  const words = vttWords('WEBVTT\n\n00:00:00.100 --> 00:00:00.900\nHello<00:00:00.500> there.\n\n00:00:01.600 --> 00:00:02.400\nWe<00:00:02.000> go.\n');
  const lines = linesOf(words, runs, 2.5);
  assert.deepEqual(lines.map((l) => l.said), ['Hello there.', 'We go.']);
  assert.equal(lines[0].out, 1.15);
  assert.equal(lines[1].in, 1.35);
});

test('the command: exit 1 with what to do last, 0 when nothing is wrong', () => {
  const bad = film([['S.mp4', 1.5, 2.4, 0]]);
  const r = spawnSync('node', [SCRIPT, 'check', bad], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const out = r.stdout.trim().split('\n');
  assert.match(out.at(-1), /^Fix film\.html, then run this check again/);
  assert.match(out.at(-2), /^ {2}\[edge\] Move each cut into a pause/);
  const ok = spawnSync('node', [SCRIPT, 'check', film([['S.mp4', 0.8, 2.4, 0]]), '--list'], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /S\.mp4 0\.80-2\.40/);
  assert.match(ok.stdout, /npx openfilm look/);
  assert.equal(spawnSync('node', [SCRIPT, 'check', join(proj, 'nothing.html')], { encoding: 'utf8' }).status, 2);
});
