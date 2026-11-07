# Changelog

## 0.2.2

- The brief sent the agent to `npx openfilm get tts` for a script's voice-over. In the first narration trial of 0.2.1 that
  answered "Not connected here" and the agent stopped and asked, never running `npx openfilm get`, which lists the
  person's own local voice service. The brief and the last lines the log prints now say that `npx openfilm get` lists
  every service connected, the person's own included.

## 0.2.1

- `check`: a clip that ends on the first word or two of the next sentence ("So,") stopped mid-sentence even though the
  word ends in a comma, and the check let it through. Found in the first trial of 0.2.0, where it left "So," at the end
  of the film's first clip.

## 0.2.0

- `footage.mjs check film.html`: reads the finished film against the footage log, the words beside each clip and the
  narration, exits 1 on a problem and prints last what to do. It fails an empty `film.html` or one with no footage in
  it, a video that is not one of the logged clips unchanged, a person's sentences out of their take's order, a clip that
  starts or stops off a pause or inside a sentence, the same seconds on screen twice, shots that look alike, cuts off the
  voice-over's pauses, narration that differs from `--script`, footage speaking under the voice-over, and nothing on
  screen. The trials on 0.1.2 found a speaker's lines out of order, words lost at joins, and no `film.html`.
- `footage.mjs` log: a clip that speaks lists its sentences with `in` and `out` cut points inside the pauses, found
  from the sound because word times drift by up to half a second. Each clip also lists its size, so a file made again
  is told from the original.
- The brief says the film is `film.html`, every shot a clip in it, and that people in the footage keep their
  sentences in order.
- `openfilm.json` needs ffprobe as well as FFmpeg.

## 0.1.2

- `footage.mjs`: a clip whose sound runs on after its last frame stopped the whole log, because the last shot asked for
  a frame past the picture. A shot now ends with the picture. Found by the trials.

## 0.1.1

- `openfilm.json` says what it needs: FFmpeg on the PATH, a transcription service for clips with speech, a voice-over
  service for a written script.
- `evals/README.md`: the requests it was tried on, with and without it.

## 0.1.0

- First version: the brief and `footage.mjs`, which logs a folder of clips shot by shot.
