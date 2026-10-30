// The footage log: shots from scene changes, words per shot, shots that look alike across clips
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { alike, clipId, distance, logFootage, saidIn, shotsFrom, vttWords } from '../skills/footage-cut/scripts/footage.mjs';

let dir;
const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'footage-test-'));
  // A: two shots (a moving test pattern, then colour bars), with sound and words
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=2', '-f', 'lavfi', '-i', 'smptebars=s=640x360:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=4',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', join(dir, 'A-walk.mp4')]);
  writeFileSync(join(dir, 'A-walk.vtt'), 'WEBVTT\n\n00:00:00.300 --> 00:00:03.500\n<00:00:00.300>we <00:00:00.700>left <00:00:01.200>early <00:00:02.400>then <00:00:02.900>rain\n');
  // B: one shot, no sound
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=640x360:r=30', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'B-city.mp4')]);
  // C: the same footage as A again
  copyFileSync(join(dir, 'A-walk.mp4'), join(dir, 'C-copy.mp4'));
});

after(() => dir && rmSync(dir, { recursive: true, force: true }));

test('a folder logged: clips in name order, shots at the cut, words per shot, look-alikes across clips', async () => {
  const lines = await logFootage(dir, { log: () => undefined });
  const log = JSON.parse(readFileSync(join(dir, 'footage-log', 'footage.json'), 'utf8'));
  assert.equal(log.format, 'openfilm-footage/1');
  assert.deepEqual(log.clips.map((c) => [c.id, c.file]), [['A', '../A-walk.mp4'], ['B', '../B-city.mp4'], ['C', '../C-copy.mp4']]);
  const [a, b, c] = log.clips;
  assert.equal(a.shots.length, 2);
  assert.ok(Math.abs(a.shots[0].end - 2) < 0.1, `cut at ${a.shots[0].end}`);
  assert.deepEqual(a.shots.map((s) => s.said), ['we left early', 'then rain']);
  assert.equal(a.words, 'A-walk.vtt');
  assert.equal(b.shots.length, 1);
  assert.equal(b.audio, false);
  assert.equal(b.shots[0].said, null);
  assert.equal(c.words, null);
  assert.deepEqual(a.shots[0].same, ['C1']);
  assert.deepEqual(a.shots[1].same, ['C2']);
  assert.deepEqual(b.shots[0].same, []);
  for (const id of ['A1', 'A2', 'B1', 'C1', 'C2']) assert.ok(existsSync(join(dir, 'footage-log', `${id}.jpg`)), id);
  assert.match(readFileSync(join(dir, 'footage-log', 'footage.html'), 'utf8'), /looks like C1/);
  assert.match(lines.join('\n'), /C has sound and no words yet/);
});

test('shots: no shot under 0.6 s, the last one runs to the end', () => {
  assert.deepEqual(shotsFrom([2, 2.3, 5.8], 6), [[0, 2], [2, 6]]);
  assert.deepEqual(shotsFrom([], 0.4), [[0, 0.4]]);
});

test('words: tagged and untagged cues; Chinese runs together, other words take a space', () => {
  const w = vttWords('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<00:00:00.000>我们 <00:00:00.500>出发\n\n00:00:02.000 --> 00:00:03.000\nsee you\n');
  assert.deepEqual(w.map((x) => [x.t, x.text]), [[0, '我们'], [0.5, '出发'], [2, 'see you']]);
  assert.equal(saidIn(w, 0, 1), '我们出发');
  assert.equal(saidIn(w, 0, 3), '我们出发see you');
  assert.equal(saidIn([{ t: 0, text: 'a' }, { t: 1, text: 'b' }], 0, 2), 'a b');
  // A word the transcript split into pieces stays whole
  const split = vttWords('WEBVTT\n\n00:00:05.000 --> 00:00:08.000\n<00:00:05.000>刷到<00:00:07.060>P<00:00:07.160>y<00:00:07.200>thon<00:00:07.300>项目\n');
  assert.equal(saidIn(split, 5, 8), '刷到Python项目');
});

test('look-alikes join through any member; ids run past Z', () => {
  assert.equal(distance('ffff000000000000', 'fff0000000000000'), 4);
  assert.deepEqual(alike([{ id: 'A1', hash: '0000000000000000' }, { id: 'B1', hash: '000000000000000f' }, { id: 'C1', hash: '00000000000000ff' }, { id: 'D1', hash: 'ffffffffffffffff' }]), [['A1', 'B1', 'C1']]);
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(clipId), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
});
