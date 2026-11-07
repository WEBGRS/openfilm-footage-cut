# Evals

How this skill was tried. Nothing here goes to the agent: only `skills/` is installed.

Result: the skill was not clearly better. On the narration request the two films picked almost the same shots, and the
skill's advantage was the handover, at 1.8 times the cost. On the speech request the arm without the skill was as good
or better. The trials also found one real defect in `footage.mjs`, fixed in 0.1.2.

Each request ran once with the skill and once without, in an empty project outside the home folder, the skill folder
being the only difference.

- Skill version: 0.1.1, and 0.1.2 for the second speech row.
- Agent: Claude Code 2.1.310, headless, model `claude-sonnet-5-5` as reported by each run's init event.
- OpenFilm: 0.2.7 installed in the project. The agent's entry point runs `npx -y openfilm@latest`, which was 0.3.0 that
  day, so an agent that ran it read the 0.3.0 manual, and the installed 0.2.7 answered `no skill edit` to what that manual
  told it to read. In the speech request all three arms ran `open` and `look` through `@latest`; in the narration request
  both arms used 0.2.7. The narration films are the agents' own MP4s; I rendered the speech films with 0.2.7 to measure.
- Date and computer: 2026-11-06, Windows 11.
- Pictures: read from contact sheets and frames, never watched in Studio. Sound: measured and re-transcribed, never
  heard.

## Request 1: a narration

```
clips 文件夹里是我在巴厘岛拍的猴子素材，script.txt 是我写好的解说稿。帮我剪成一条横屏的片子发 B 站，稿子一个字别改，配音用已经连好的本地配音服务。
```

Material: six clips by Mx. Granger from Wikimedia Commons, CC0, renamed `VID_0611` to `VID_0733` in the order listed:
"Ubud monkeys 1 - fiddling with a can", "2 - eating corn", "3 - wrestling", "4 - grooming", "Uluwatu monkey 3 - eating",
"Uluwatu monkey 4 - stealing pom-poms". Two are vertical. 207 s in all. `script.txt` is 10 lines written for this trial
before any run; its last line (asleep on the ride back) has no shot in the footage, on purpose. Voice: local-voice,
connected in both arms.

| measure | with 0.1.1 | without |
| --- | --- | --- |
| length | 62.9 s | 62.5 s |
| cuts within 2 frames of a pause in the sound | 7 of 8, worst 12 frames | 7 of 7, worst 0 |
| blurriest second of the film (`blurdetect`) | 8.8 at 42 s | 10.1 at 44 s |
| same seconds of footage used twice, from each arm's build script | 0 | 0 |
| voice transcripts against the script, punctuation aside | identical | identical |
| lines whose picture shows what they say, by my reading, not blind | 9 of 10 | 9 of 10 |
| line 10, no shot in the footage, named at the end | yes | yes |
| shot list | a file: line, clip, seconds, what it shows | a table in the message: line and clip, no seconds |
| footage left out worth a look, named | yes | no |
| turns, minutes, cost | 47, 6.3, $0.74 | 35, 7.1, $0.41 |

Seen: both agents chose the same clip for every line, and often nearly the same seconds. Line 7 is where they differ. The
arm with the skill cut out a whip pan with a jump inside the sentence, the one cut that misses a pause; the arm without
kept the whole stretch, so at 44 s a passer-by's blurred head fills the left half of the frame. Line 5 asks for rolling
about, and in both films the two monkeys settle within about two seconds. The arm without also burned in subtitles and kept the clips' own sound at 15% under the voice; neither was asked
for. Both put the vertical clips over a blurred copy of themselves.

Both arms read the footage, voiced the script, then built an MP4 with ffmpeg and left `film.html` empty, so neither film
can be edited in Studio. The brief says "trimmed, never re-encoded" and "a shot is a clip of the film"; the agent with the
skill read that and built the MP4 anyway, without ever reading OpenFilm's manual. The agent without it read the manual,
hit `no skill edit`, and said so in its message. The version mismatch may explain both, so I can't say how much of this
belongs to the brief.

## Request 2: what people say in the clips

```
clips/ has four interviews I filmed at Wikimania in Cape Town, each with its transcript beside it (.vtt). Cut them into a film of about 90 seconds to open our Wikipedia meetup: why it's worth starting to edit, and what keeps people going. No voice-over, just the people talking.
```

Material: "WIKITONGUES- Gereon / Mckensie / Sam / William speaking English" by Bogreudell from Wikimedia Commons, CC BY-SA
4.0, Wikimania 2018, 1080x606. William talks about South African privacy law, off the subject asked for. The transcripts
were supplied, the same in every arm: word-timed WebVTT from faster-whisper large-v3, made beforehand.

In the first arm with the skill, `footage.mjs` stopped with an ffmpeg error on the first clip and the agent went on
without a log. These files' sound runs about a second past their last frame, and the script asked for a frame past the
picture. A shot now ends with the picture (0.1.2, with a test), and the request was run again with the skill. Both rows
are kept.

| measure | with 0.1.1 (log failed) | with 0.1.2 | without |
| --- | --- | --- | --- |
| length, about 90 s asked | 94.3 s | 90.4 s | 87.6 s |
| clip edges within 2 frames of a pause in the sound | 8 of 12 | 12 of 20 | 12 of 16 |
| clips played out of their take's order | 0 | 1 | 0 |
| joins with a word lost or a sentence stopped or spliced, read from the finished film re-transcribed | 1 of 5 | 5 of 9 | 2 of 7 |
| William left out | yes | yes | yes |
| same seconds of footage used twice | 0 | 0 | 0 |
| name captions | none | 3 | 3 |
| shot list | source seconds in one line | table: source seconds, words, why | outline by speaker, film times only |
| turns, minutes, cost | 24, 3.0, $0.46 | 28, 4.7, $0.64 | 26, 5.1, $0.67 |

Seen: all three are one talking head after another, so the skill's shot choice had nothing to choose between; the
contact sheets differ only in who is on screen for how long. The differences are in the words. With 0.1.2 the agent moved
Mackenzie's lines out of order, so the film has her say "22,000 articles on Wikipedia, but to learn how to edit", which
she did not say in that form, against the brief's own rule. It also loses "fun" from "It's lots of fun" and ends a line on
"tips" before "on what to do". With 0.1.1, "Maybe write to them" arrives without the line saying who should write, and
the agent's message quotes "I get what I want" from a clip that stops before those words. Without the skill, "It's lots of
fun" runs straight into "I think it's a waste" with the sentences that explain it gone, and the film ends on "that helps
so much more getting new users for Wikipedia".

Re-transcription can mishear, and word times in these noisy rooms drift, so the counts in the "joins" row are approximate.

## Measures

`node evals/measure.mjs <film.html>` for a film, `node evals/measure.mjs --render-only --mp4 <film.mp4>` for an MP4 with no
`film.html` behind it. A pause is a run of at least 0.12 s under a limit: 10 ms frames of 200 to 3500 Hz, 6 dB over the
5th percentile of the 10 s around them, and -45 dB at least. On the four interviews this rule finds 32 of 35 sentence
gaps in the transcripts and calls about 14% of word middles quiet (138 of 981), most of them in Sam's and William's clips. Picture
cuts in an MP4 come from ffmpeg's scene score at 0.3. To run it again, download the clips from Commons by the names above;
the media stays out of this repository. The "joins" row came from transcribing each finished film with faster-whisper
large-v3 and reading every join against the source transcript.
