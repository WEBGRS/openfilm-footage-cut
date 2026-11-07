# Evals

How this skill was tried. Nothing here goes to the agent: only `skills/` is installed.

Result: the skill was not clearly better on these two requests. On the speech request both arms made a film of one talking head after another; the arm with the skill put every clip edge in a pause (14 of 14, against 9 of 14), ran its check six times to get there and handed over a shot list, and both films still end their first clip on a stranded "So,". On the narration request the arm with the skill first stopped after a minute because its brief sent it to the wrong voice command (fixed in 0.2.2); its second run made a film about as good as the arm without the skill: a shot list and a named list of unused footage, one blurred second on line 7 against three for the arm without, two of nine cuts off the voice's pauses, and no render. On OpenFilm 0.3.0 neither arm left `film.html` empty, which both did on 0.2.7.

## How it was tried

- Skill versions: 0.2.0 and 0.2.1 on the speech request, 0.2.1 and 0.2.2 on the narration request, each change named under its request.
- Agent: Claude Code 2.1.310, headless, model `claude-sonnet-5-5` as the init event of every run reports.
- OpenFilm 0.3.0, installed at that exact version in an empty project for each run, so no run read another version's manual.
- Windows 11, 2026-11-06 and 2026-11-07, a computer that was also rendering for other trials: minutes are not comparable between runs.
- Each request ran once with the skill and once without, in an empty project outside the home folder; the skill folder was the only difference. Requests were written before the first run and never changed. Where a fix followed a run, the request ran once more with the skill and the earlier row stays.
- Every `with` run read the skill first (the first call of each is the skill).
- Pictures: read from contact sheets (`look`) and frames, never watched in Studio. Sound: measured and transcribed, never heard.

## Request 1: a narration

```
clips 文件夹里是我在巴厘岛拍的猴子素材，script.txt 是我写好的解说稿。帮我剪成一条横屏的片子发 B 站，稿子一个字别改，配音用已经连好的本地配音服务。
```

Material: six clips by Mx. Granger from Wikimedia Commons, CC0, renamed `VID_0611` to `VID_0733` in the order filmed: "Ubud monkeys 1 - fiddling with a can", "2 - eating corn", "3 - wrestling", "4 - grooming", "Uluwatu monkey 3 - eating", "Uluwatu monkey 4 - stealing pom-poms". Two are vertical, 207 s in all. `script.txt` is 10 lines written for this trial; its last line (asleep on the ride back) has no shot in the footage, on purpose. Voice: a local voice service connected in both arms.

Transcripts supplied beside each clip, the same in every arm: faster-whisper large-v3 with its voice filter on, word-timed. Two of the six (`VID_0611`, `VID_0612`) came out as one stock sentence each ("thanks for watching" in Indonesian, "that's it for today" in German) from noise, so those two files are empty. `VID_0613` and `VID_0731` hold tourists talking, in Russian and Czech.

| measure | with 0.2.1 | with 0.2.2 | without |
| --- | --- | --- | --- |
| film made | no | yes | yes |
| `film.html` with their footage and voice-over in it | no film | 10 shots, 10 voice files | 12 clips (two are blurred copies behind vertical shots), 10 voice files |
| rendered MP4 | no | no, told the person to export from Studio | yes, 1920x1080, 63.6 s |
| length | no film | 61.2 s | 63.6 s |
| voice transcript against the script, punctuation aside | no film | identical, 0 of 223 characters | identical |
| cuts within 2 frames of a pause of the voice (`measure.mjs`) | no film | 7 of 9 | 11 of 11 |
| footage files that are not their clips, by name and size | no film | 0 | 0 |
| same seconds of footage used twice, or look-alike clips | no film | 0 | 0 |
| film seconds blurred past 8 by `blurdetect` | no film | 1 (42 s) | 3 (42, 44, 45 s) |
| lines 1 to 9 whose picture shows what they say, by my reading, not blind | no film | 8 | 8 |
| line 10, no shot in the footage, named | no film | yes | yes |
| shot list handed over | no film | table: line, source seconds, what it shows | none |
| footage left out that is worth a look, named | no film | yes, five stretches | no |
| `footage.mjs check` (0.2.2) run on the finished film afterwards | no film | no problems, cuts on pauses 8 of 8 | no problems, cuts on pauses 7 of 7 |
| turns (tool calls), minutes, cost | 7 (5), 1.2, $0.08 | 51 (49), 13.3, $0.73 | 2 reported (37), 25, $0.68 |

The first run with the skill (0.2.1) read the skill, logged the clips, ran `npx openfilm get tts --help`, got "Not connected here: tts" and stopped to ask the person to connect a voice service. It never ran `npx openfilm get`, which lists the local service that the arm without the skill found. The brief had named `get tts` as the way to voice a script. 0.2.2 says that `npx openfilm get` lists every service connected, their own included, and the last lines the log prints say the same; the request ran again.

Seen, from contact sheets and frames. Both films use the same clip for most lines. Line 5 asks for rolling about and both show monkeys lying on the boardwalk. Line 7 shows the monkey on the wall beside the crowd in both, with a moving camera. In the arm with the skill the frame is smeared at about 39.7 s, and the camera swings again around 42 s as the monkey jumps, which is the blurred second in the table. Its message says it took the steadiest stretch; it had moved the start from 11.5 s to 11.9 s after seeing a smear at 40.3 s, and the later smear stayed. The arm without it shows the monkey walking the wall for about four seconds, and then, at about 44.5 s, a passer-by's blurred head fills the left third of the frame. The arm with the skill cut the two vertical clips to fill the frame, about 1.8 times larger and softer; the arm without put a sharp strip over a blurred copy of the same clip. The arm without faded out to black at the end and normalized the render to -14 LUFS; the arm with the skill held on the sunset silhouette. Two cuts of the arm with the skill, at 44.6 s and 57.8 s, sit where one voice file ends and the next begins with under 0.12 s between them, so the voice has no pause there; the `check` counts such a seam as a pause, `measure.mjs` does not.

## Request 2: what people say in the clips

```
clips/ has four interviews I filmed at Wikimania in Cape Town, each with its transcript beside it (.vtt). Cut them into a film of about 90 seconds to open our Wikipedia meetup: why it's worth starting to edit, and what keeps people going. No voice-over, just the people talking.
```

Material: "WIKITONGUES- Gereon / Mckensie / Sam / William speaking English" by Bogreudell from Wikimedia Commons, CC BY-SA 4.0, Wikimania 2018 in Cape Town, 1080x606. William talks about South African privacy law, off the subject asked for. Transcripts supplied beside each clip, the same in every arm: word-timed WebVTT from faster-whisper large-v3, made beforehand.

| measure | with 0.2.0 | with 0.2.1 | without |
| --- | --- | --- | --- |
| length, about 90 s asked | 88.0 s | 86.7 s | 91.8 s |
| `film.html` with their footage in it | yes, 7 clips | yes, 7 clips | yes, 7 clips |
| footage files that are not their clips, by name and size | 0 | 0 | 0 |
| clip edges within 2 frames of a pause in the sound (`measure.mjs`) | 14 of 14, worst 0 frames | 14 of 14, worst 1 | 9 of 14, worst 24 |
| clips played out of their take's order | 0 | 0 | 0 |
| joins with a word stranded or a sentence stopped, read from the film's own transcript | 1 of 6 ("So,") | 1 of 6 ("So,", heard as "Now,") | 1 of 6 ("So,") |
| `footage.mjs check` (0.2.2) run on the finished film afterwards | 1 problem, that "So," | 1 problem, that "So," | 6 problems: that "So," and 5 edges off a pause |
| mean `blurdetect` of the footage used, lower is sharper | 6.56 | 6.36 | 6.45 |
| William left out | yes | yes | yes |
| name captions | none | none, asked for Sam's name | 3 |
| shot list handed over | table: film time, source seconds, words | the same | none, an outline by part |
| mix, from `look` | -18.6 LUFS, true peak 0.0 dBTP | -18.8, -2.0 | -18.5, -1.2 |
| runs of `check` by the agent | 6 | 6 | none, no skill |
| turns, minutes, cost | 26, 4.9, $0.51 | 25, 4.8, $0.60 | 23, 5.7, $0.55 |

Seen. All three are one talking head after another, so the skill's shot choice had nothing to choose between; the contact sheets differ in who is on screen and for how long. The arm with the skill did not cut at the points `footage.json` lists for each sentence. It ran ffmpeg's `silencedetect` itself, and `check` then flagged three clip edges off a pause in its first film and, in the next, one clip that stopped on "Thank" (from Gereon's "Thank you"); the agent moved those cuts until it passed. In 0.2.0 the `check` let a clip that ends on "So," pass because the comma made it a clause end; in the film that "So," is the first word of a sentence Sam finishes after the cut (the sound shows a short word just before the cut, and a pause after it). 0.2.1 flags a clause end that holds only the first word or two of a sentence. The run on 0.2.1 got that problem, kept the cut and told the person why: its message says the cut is in silence and moving it earlier would cut Sam's last word. The arm without the skill has the same "So," at the end of its first clip. Word times at a join can sit half a second off, so a one-word lead-in at a cut ("But", "Just", "And") is placed on either side by the transcripts and I could not tell which; those are not counted.

Earlier rows, kept for what the fixes changed. Both ran in a project with OpenFilm 0.2.7 installed while the agent read the 0.3.0 manual, so they mix versions.

| measure | with 0.1.2 | without |
| --- | --- | --- |
| clips played out of their take's order | 1 | 0 |
| clip edges within 2 frames of a pause | 12 of 20 | 12 of 16 |
| joins with a word lost or a sentence stopped or spliced, read from the film re-transcribed | 5 of 9 | 2 of 7 |
| narration request: `film.html` (with 0.1.1) | empty, an MP4 built with ffmpeg | empty, an MP4 built with ffmpeg |

0.1.2 moved one speaker's lines out of order, so the film has that speaker say a sentence they did not say. `check` now fails that (a test builds it), and neither 0.2.x film has a clip out of order. The empty `film.html` did not come back in any arm on 0.3.0.

## Measures

One script is applied to every finished film, whichever arm made it, and the `check` is run on each afterwards.

- `node evals/measure.mjs <film.html> [--script script.txt] [--clips <their clips folder>] [--audio <out.wav>] [--json]` reads `film.html` and the sound of its files. A pause is a run of at least 0.12 s under a limit: 10 ms frames of 200 to 3500 Hz, 6 dB over the 5th percentile of the 10 s around them, and -45 dB at least. It reports clips and sounds in the film, footage made again (`--clips`), the same seconds on screen twice (a copy of a clip at the same moment on another track is a backdrop, not a repeat), clips that look alike, edges of the footage's speech and cuts against the voice-over's pauses, the voice's words against `--script`, and sharpness: `blurdetect` on each used second of footage (a film second counts as blurred past 8). `--audio` writes the film's sound mixed from `film.html`, for transcribing without a render.
- `node evals/joins.mjs <film.html> <heard.vtt>` prints every join of a speech film: what the film's own transcript says either side of the cut beside what the source transcripts say either side of each clip's edge. `heard.vtt` is a word-timed transcript of the `--audio` mix (faster-whisper large-v3, English, no voice filter). I read each join for a word left standing at the end of a clip, a word lost at the start of the next, or a sentence stopped.
- `node skills/footage-cut/scripts/footage.mjs check film.html` is the skill's own check, run afterwards on all four films, with the arm with the skill having run it during the work.
- To run it again, download the clips from Commons by the names above and put the transcripts beside them; the media stays out of this repository.

## What was not tried

- No person watched or listened to any film, in Studio or anywhere else; every statement about pictures comes from contact sheets and frames, and sound from numbers and transcripts. The joins are read from a transcript of each film's mix, which mishears: "so important" came out as "so much fun" in one film.
- One run per arm and request (two for the `with` arm where a fix followed), on one model. The differences in cost and minutes are inside what machine load and chance explain.
- Footage with several shots per clip: every clip here is a single shot, so the log's shot detection and look-alike grouping had little to do.
- A person's own recording of a narration, music with a beat, a language other than Chinese for the narration and English for the speech, and clips with no transcript.
- Shaky, dark or crossed shots are only read from frames; no script finds them except the blur figure above.
- A render of the arm-with-skill films: neither was rendered, so `look --full` was not run on them.
