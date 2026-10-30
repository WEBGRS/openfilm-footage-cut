---
name: footage-cut
description: Cut a film from the person's own footage - a folder of clips they shot or gathered - either to their narration (a voice-over or a script, each line covered by a shot that shows what it says) or, without one, to the story told by what people say in the clips. Use for a vlog, a travel or event film, a narrated mixed cut, or any film from raw clips (vlog 剪辑, 自己拍的素材, 素材剪成片, 混剪, 解说混剪, 按文案配画面, 粗剪).
---

# Footage cut

Make the film the person would have cut themselves with a free week: their footage, the best of it, each shot on
screen because of what is being said at that moment, in an order a viewer follows from the first shot to the last.

## What defines it

Every shot is there for the words it sits under. Clips laid in the order they were filmed, or shots picked to fill
the time, are not this, however good each shot is.

## What has to be true

- **Only their footage**, trimmed, never re-encoded; nothing generated or downloaded unless they ask for it.
- **Each line has its shot, and you can say why.** Keep a shot list (the line, the shot, what it shows) and hand it
  over. A shot is used once, and shots that look alike count as one, unless repeating is the point.
- **Usable shots.** Nothing shaky, out of focus, too dark or crossed by a stranger, unless it is the only shot of
  its moment, and then say so. Check the frames you use.
- **Cuts where they belong**: on the narration's pauses, on the beat where there is music, and inside the footage's
  own speech only in its pauses, each within two frames, by the word times.
- **Their words as they are.** The narration as they recorded or wrote it; people in the footage are not made to say
  what they did not.

## What you have

`node <this skill's folder>/scripts/footage.mjs <folder>` logs every clip in a folder, shot by shot: a picture of each
shot's first, middle and last frame, its times, what is said in it, and which shots in any clip look alike, in
`footage-log/footage.json` and `footage.html`. Clips with speech need their transcript first
(`npx openfilm get asr --src <clip>`); say how many minutes that is before transcribing on a paid service. The
narration is their recorded voice with its word times, or a script voiced with `npx openfilm get tts`. A shot is a
clip of the film: its file trimmed with `#t=`. `look` checks the cut; anything you can make titles and maps with.

## With the person

What they ask for comes first. What the film is for and where it will be watched, the narration or the story they
want told, how long, and the moments that must be in it. Ask without holding up the work. When done, tell them in a
few lines what was made, hand over the shot list, name the lines that had no good shot (and what to film for them),
and the footage left out that is worth a look.
