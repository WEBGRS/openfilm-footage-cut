# Changelog

## 0.1.2

- `footage.mjs`: a clip whose sound runs on after its last frame stopped the whole log, because the last shot asked for
  a frame past the picture. A shot now ends with the picture. Found by the trials.

## 0.1.1

- `openfilm.json` says what it needs: FFmpeg on the PATH, a transcription service for clips with speech, a voice-over
  service for a written script.
- `evals/README.md`: the requests it was tried on, with and without it.

## 0.1.0

- First version: the brief and `footage.mjs`, which logs a folder of clips shot by shot.
