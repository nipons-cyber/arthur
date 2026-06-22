# Q360 Video — Automated Render Pipeline

Turns `script.yaml` into `out/q360_v1.mp4` with one command. It runs even with
**no footage and no voiceover** — you get a timed *animatic* (clean caption
slates + silence/VO) to review immediately, then you drop in clips/VO and
re-run for the finished film.

```
render/
├── script.yaml          # single source of truth (VO text, captions, timing)
├── tts.py               # script.yaml -> audio/<scene>.mp3  (ElevenLabs/Azure)
├── build.py             # script.yaml + audio + clips -> out/q360_v1.mp4
├── render.sh            # install deps + tts + build, end to end
├── requirements.txt
├── config.example.env   # copy to .env, add your keys
└── assets/
    ├── clips/           # drop s01.mp4 … s16.mp4 (or .png/.jpg) here
    └── music/           # drop bed.mp3 here
```

## Prerequisites

- **ffmpeg + ffprobe** on PATH
  - macOS: `brew install ffmpeg` · Ubuntu: `sudo apt install ffmpeg`
  - Windows: `winget install Gyan.FFmpeg`
- **Python 3.9+** (`pip install -r requirements.txt` — pyyaml, requests)

## Quick start (animatic, no keys needed)

```bash
cd render
pip install -r requirements.txt
python build.py            # -> out/q360_v1.mp4 (caption slates, ~timed)
```

## Full render (with real English voiceover)

1. `cp config.example.env .env` and fill in your TTS keys. Recommended:
   - **ElevenLabs** for the most natural English narration, or **Azure Neural TTS**.
   - The delivery is pre-tuned to be calm and grounded (high stability, low
     style, slightly slower) — matching the "smooth, realistic, not over" brief.
2. Add visuals to `assets/clips/` named per scene: `s01.mp4 … s16.mp4`
   (videos or stills; see `../02-storyboard.md` for what each scene shows).
   Any scene without a clip falls back to a clean slate automatically.
3. Add a music track at `assets/music/bed.mp3` (one calm cinematic bed; it's
   looped, faded, and mixed low under the VO).
4. Render:

```bash
./render.sh               # installs deps, generates VO, assembles MP4
```

## How scene timing works

- If a scene has VO audio, its on-screen duration = the VO length (+ a short
  tail). VO is the spine — visuals are cut to it.
- If a scene has no VO, duration is derived from the timecodes in `script.yaml`.
- Edit any wording/caption/timecode in `script.yaml` and re-run.

## Output & encoding

- `out/q360_v1.mp4` — 1920×1080, 24fps, H.264 + AAC, gentle per-scene fades.
- For a 4K master change `resolution: [3840, 2160]` in `script.yaml`.
- Loudness for web: normalize the final file to ~-14 LUFS, e.g.
  `ffmpeg -i out/q360_v1.mp4 -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:v copy final.mp4`
- Social cutdowns (9:16 / 1:1): crop/pad the master, e.g.
  `ffmpeg -i out/q360_v1.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" -c:a copy vertical.mp4`

## Notes

- `.env`, `audio/`, `out/`, and your media in `assets/` are gitignored.
- Cloud TTS needs outbound network access; if your environment blocks it,
  generate the VO where you have access and copy the `.mp3`s into `audio/`.
- This pipeline assembles real footage + UI + VO. It does **not** create the
  cinematic B-roll or UI motion graphics themselves — source those (real
  recordings, licensed stock, or an AI video generator) per the storyboard.
