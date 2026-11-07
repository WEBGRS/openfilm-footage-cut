# footage-cut

An [OpenFilm](https://github.com/openfilm/openfilm) skill: a film cut from your own footage. Give it a folder of
clips and either a narration (a voice-over, or a script it voices) or nothing but the clips, and each shot ends up on
screen because of what is being said at that moment: a line of your narration, or the people in the footage.

| | | |
| --- | --- | --- |
| <img src="skills/footage-cut/cover.jpg" width="200" alt=""> | [Cut my footage](skills/footage-cut) | Your own clips cut into a film, each shot chosen for what is being said, to your narration or the story in the footage. |

An agent can't watch a folder of video. It can read pictures and transcripts, so the skill's script turns the folder
into both, and reads the finished film back against them:

```sh
node skills/footage-cut/scripts/footage.mjs <folder>
```

It writes `footage-log/` in the folder: `footage.json`, `footage.html`, and one picture per shot with its first,
middle and last frame. Each clip gets a letter in file-name order and each shot a number (`A1`, `A2`, `B1`), so a
shot list can name them. Shots come from ffmpeg's scene detection (`--threshold`, 0.3 by default; lower finds more
cuts), and none is shorter than 0.6 s unless the whole clip is. What is said in a shot comes from the WebVTT beside its clip, which
`npx openfilm get asr --src <clip>` writes; clips with sound and no transcript yet are listed. Shots whose middle frames
look alike, in any clip, are grouped (a 64-bit difference hash, 6 bits apart or fewer), so the same moment filmed
twice isn't used twice. For a clip that speaks, `footage.json` also lists its sentences, each with `in` and `out` cut
points inside the pauses around it. Word times drift by up to half a second, so the points come from the sound
(10 ms frames of 200 to 3500 Hz, quiet when 6 dB over the floor of the 10 s around, at least 0.12 s), not from the
transcript alone.

When the film is cut, the same script checks it:

```sh
node skills/footage-cut/scripts/footage.mjs check film.html [--script script.txt] [--list]
```

It exits 1, and prints last what to do, when `film.html` is empty or has no footage in it; when a video is not one of
the logged clips, unchanged; when a person's sentences play out of their take's order (`--reorder-ok` when asked
for); when a clip starts or stops more than two frames from a pause, or inside a sentence; when the same seconds are
on screen twice or two shots look alike (`--repeat-ok` when repeating is the point); when a cut is off the
voice-over's pauses; when the voice-over's words differ from `--script`; when footage speaks under the voice-over;
when nothing is on screen. A copy of a clip at the same moment on another track is a backdrop, not a repeat.

What the brief asks of the agent:

- only your footage, trimmed, never re-encoded; nothing generated or downloaded unless you ask;
- a shot list (line, shot, what it shows) handed over with the film; a shot used once, look-alikes counted as one;
- no shaky, blurred, dark or photobombed shots unless one is the only shot of its moment, and then it says so;
- cuts on the narration's pauses, on the beat, and inside speech in the footage only in its pauses, within two
  frames, taking sentences whole;
- the film is `film.html`, every shot a clip in it that opens in Studio, not an MP4 built beside an empty one;
- your narration as you recorded or wrote it; people in the footage keep their sentences in order and are not made to
  say what they didn't;
- the minutes of transcription said before a paid service runs, and at the end, the lines that had no good shot
  and what to film for them.

## Use it

- **In OpenFilm**: open Skills, add one from a link, and paste `https://github.com/WEBGRS/openfilm-footage-cut`.
- **In your own agent** (Claude Code, Codex and others): `npx skills add WEBGRS/openfilm-footage-cut`.

It needs Node 22 or later and ffmpeg on the PATH (OpenFilm needs ffmpeg too). For clips with speech, a transcription
service connected in OpenFilm (Settings → Providers). With music, it pairs with
[beat-cut](https://github.com/WEBGRS/openfilm-beat-cut), which measures the music's beats and bars and checks each cut
against them.

## Develop

```sh
npm test            # makes short clips with ffmpeg, logs them and checks films made from them (about a minute)
npm run check       # the skill folder against OpenFilm's skill rules
```

## 中文说明

OpenFilm 技能：用你自己拍的素材剪成片。给它一个素材文件夹，再给一段解说（录好的配音，或者让它配音的文案），或者什么都不给只有素材；每个镜头出现在画面上，都是因为那一刻在说的话：你的解说，或者素材里的人说的话。

智能体看不了一整个文件夹的视频，但能看图、能读文字，所以这个技能的脚本把文件夹变成这两样，剪完后再拿成片对照检查：`node skills/footage-cut/scripts/footage.mjs <文件夹>` 在文件夹里写出 `footage-log/`：`footage.json`、`footage.html`，每个镜头一张图（首帧、中间帧、尾帧）。每段素材按文件名排序编一个字母，每个镜头编一个号（`A1`、`A2`、`B1`），镜头表就用这些编号。镜头由 ffmpeg 的场景检测切出（`--threshold` 默认 0.3，调低会切得更细），除非整段素材本身更短，否则每个镜头至少 0.6 秒。每个镜头里说了什么，来自素材旁边的 WebVTT，用 `npx openfilm get asr --src <素材>` 生成；有声音但还没转写的素材会被列出来。各段素材里中间帧长得一样的镜头会归成一组，同一个画面拍了两遍不会用两次。有人说话的素材还会列出每一句，并给出落在停顿里的入点和出点（`in`、`out`）。

剪完后用 `node skills/footage-cut/scripts/footage.mjs check film.html [--script 文案.txt]` 检查：`film.html` 是空的或里面没有素材、视频不是记录过的原文件、同一个人的句子顺序被打乱、素材边缘离停顿超过两帧或剪在一句话中间、同一段画面出现两次、剪点不在配音的停顿上、配音的字和文案不一致、素材里的人声盖住配音、画面空了，都会让它以 1 退出，并在最后写明该怎么改。

需求书对智能体的要求：只用你的素材，只裁剪不重新编码，没你同意不生成、不下载；交片时附镜头表（哪句话、哪个镜头、拍的是什么），一个镜头只用一次，长得一样的算同一个；不用晃的、虚的、太暗的、有路人乱入的镜头，除非那是那一刻唯一的镜头，并且要说明；在解说的停顿和音乐的节拍上剪，素材里有人说话就只在停顿处剪，误差两帧以内；你的解说保持原样，不让素材里的人说他们没说过的话；用付费服务转写前先说要转写多少分钟；最后告诉你哪些句子没有合适的镜头、还该补拍什么。

**安装**：在 OpenFilm 的技能页点「添加 skill」，粘贴链接 `https://github.com/WEBGRS/openfilm-footage-cut`；用自己的智能体就运行 `npx skills add WEBGRS/openfilm-footage-cut`。需要 Node 22 以上和 PATH 里的 ffmpeg；素材里有人说话的，还要在 OpenFilm 的设置（左上角的 OpenFilm 标志）→ 服务商里连好一个语音转写服务。有音乐时和 [beat-cut](https://github.com/WEBGRS/openfilm-beat-cut)（测出音乐的拍子和小节，逐个检查剪辑点）配合使用。
