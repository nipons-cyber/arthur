#!/usr/bin/env python3
"""Assemble the Q360 video from script.yaml using ffmpeg.

Pipeline per scene:
  1. pick a visual:
       assets/clips/<asset>  (video or image)  -> scaled & padded to frame
       otherwise             -> a clean slate (bg + accent bar + caption)
  2. set the scene duration to its VO length (audio/<id>.mp3) or, if no VO,
     to the gap to the next scene's timecode (fallback 8s)
  3. burn in the caption, add gentle fade in/out (video + audio)
  4. attach the scene's VO (or silence)
Then concat all scenes and mix a low, ducked music bed underneath.

Works with zero footage and zero VO -> you still get a timed "animatic"
MP4 you can review immediately. Add clips/VO later and re-run.

Usage:  python build.py            -> out/q360_v1.mp4
Requires: ffmpeg + ffprobe on PATH, pip install pyyaml
"""
import os
import re
import sys
import json
import shutil
import pathlib
import subprocess

try:
    import yaml
except ImportError:
    sys.exit("Missing dependency: pip install pyyaml")

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = HERE / "script.yaml"
CLIPS = HERE / "assets" / "clips"
AUDIO = HERE / "audio"
TMP = HERE / "out" / "_tmp"
OUT = HERE / "out" / "q360_v1.mp4"

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
FALLBACK_DUR = 8.0
FONT_CANDIDATES = [
    os.environ.get("FONT", ""),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def need(tool):
    if not shutil.which(tool):
        sys.exit(f"'{tool}' not found on PATH. Install ffmpeg first.")


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        sys.stderr.write(" ".join(cmd) + "\n" + p.stderr[-2000:] + "\n")
        raise SystemExit(f"ffmpeg failed (exit {p.returncode}).")


def ffprobe_dur(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)], capture_output=True, text=True)
    try:
        return float(json.loads(out.stdout)["format"]["duration"])
    except Exception:
        return None


def tc_to_sec(tc):
    m, s = tc.split(":")
    return int(m) * 60 + float(s)


def find_font():
    for f in FONT_CANDIDATES:
        if f and pathlib.Path(f).exists():
            return f
    return None


def esc(text):
    # escape for ffmpeg drawtext
    return (text.replace("\\", "\\\\").replace(":", "\\:")
                .replace("'", "’").replace("%", "\\%"))


def find_asset(name):
    p = CLIPS / name
    if p.exists():
        return p
    stem = pathlib.Path(name).stem
    for cand in sorted(CLIPS.glob(stem + ".*")):
        return cand
    return None


def scene_duration(sc, scenes, idx):
    a = AUDIO / f"{sc['id']}.mp3"
    if a.exists():
        d = ffprobe_dur(a)
        if d:
            return round(d + 0.35, 3)  # small breathing tail
    # no VO: derive from timecodes
    if idx + 1 < len(scenes):
        try:
            return round(tc_to_sec(scenes[idx + 1]["start"])
                         - tc_to_sec(sc["start"]), 3)
        except Exception:
            pass
    return FALLBACK_DUR


def build_scene(sc, dur, cfg, font):
    W, H = cfg["resolution"]
    fps = cfg["fps"]
    fade = cfg["scene_fade"]
    bg = cfg["bg"]
    accent = cfg["accent"]
    out = TMP / f"{sc['id']}.mp4"
    asset = find_asset(sc["asset"])
    audio = AUDIO / f"{sc['id']}.mp3"

    cmd = ["ffmpeg", "-y"]
    # ---- visual input ----
    if asset and asset.suffix.lower() in IMG_EXT:
        cmd += ["-loop", "1", "-t", str(dur), "-i", str(asset)]
        vsrc = "[0:v]"
    elif asset:
        cmd += ["-stream_loop", "-1", "-t", str(dur), "-i", str(asset)]
        vsrc = "[0:v]"
    else:
        cmd += ["-f", "lavfi", "-t", str(dur),
                "-i", f"color=c={bg}:s={W}x{H}:r={fps}"]
        vsrc = "[0:v]"
    # ---- audio input ----
    if audio.exists():
        cmd += ["-i", str(audio)]
        asrc = "[1:a]"
    else:
        cmd += ["-f", "lavfi", "-t", str(dur), "-i",
                "anullsrc=channel_layout=stereo:sample_rate=48000"]
        asrc = "[1:a]"

    # ---- video filter ----
    vf = (f"{vsrc}scale={W}:{H}:force_original_aspect_ratio=decrease,"
          f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={bg},setsar=1,fps={fps}")
    if not asset:
        # slate: subtle accent bar under the caption area
        vf += f",drawbox=x=0:y={int(H*0.74)}:w={W}:h=6:color={accent}@0.9:t=fill"
    cap = sc.get("caption") or ""
    if cap and font:
        vf += (f",drawtext=fontfile='{font}':text='{esc(cap)}':"
               f"fontcolor=white:fontsize=58:x=(w-text_w)/2:y={int(H*0.80)}:"
               f"alpha='if(lt(t,0.4),t/0.4,if(gt(t,{dur}-0.6),"
               f"({dur}-t)/0.6,1))'")
    if not asset:
        # wordmark on slates only
        if font:
            vf += (f",drawtext=fontfile='{font}':text='Q360':fontcolor={'white'}:"
                   f"fontsize=42:x=(w-text_w)/2:y={int(H*0.12)}:"
                   f"alpha=0.85")
    vf += (f",fade=t=in:st=0:d={fade},"
           f"fade=t=out:st={max(dur-fade,0):.3f}:d={fade}[v]")

    # ---- audio filter ----
    af = (f"{asrc}aresample=48000,apad,atrim=0:{dur},"
          f"afade=t=in:st=0:d=0.2,"
          f"afade=t=out:st={max(dur-0.4,0):.3f}:d=0.4[a]")

    cmd += ["-filter_complex", vf + ";" + af,
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p", "-r", str(fps),
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
            "-t", str(dur), str(out)]
    run(cmd)
    return out


def main():
    need("ffmpeg")
    need("ffprobe")
    cfg = yaml.safe_load(SCRIPT.read_text(encoding="utf-8"))
    project = cfg["project"]
    scenes = cfg["scenes"]
    font = find_font()
    if not font:
        print("WARN: no font found -> captions/wordmark skipped. "
              "Set FONT=/path/to/font.ttf to enable them.")

    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir(parents=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)

    total = 0.0
    parts = []
    for i, sc in enumerate(scenes):
        dur = scene_duration(sc, scenes, i)
        total += dur
        has_vo = (AUDIO / f"{sc['id']}.mp3").exists()
        has_clip = find_asset(sc["asset"]) is not None
        print(f"  {sc['id']}  {dur:6.2f}s  "
              f"vo={'Y' if has_vo else '-'} clip={'Y' if has_clip else 'slate'}")
        parts.append(build_scene(sc, dur, project, font))

    # ---- concat ----
    listf = TMP / "concat.txt"
    listf.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts),
                     encoding="utf-8")
    concat = TMP / "concat.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listf),
         "-c", "copy", str(concat)])

    # ---- music bed (optional) ----
    music_cfg = cfg.get("music") or {}
    music = HERE / music_cfg.get("file", "") if music_cfg.get("file") else None
    if music and music.exists():
        vol = music_cfg.get("volume", 0.12)
        mfade = music_cfg.get("fade", 2.0)
        fc = (f"[1:a]volume={vol},afade=t=in:st=0:d={mfade},"
              f"afade=t=out:st={max(total-mfade,0):.3f}:d={mfade}[m];"
              f"[0:a][m]amix=inputs=2:duration=first:normalize=0[a]")
        run(["ffmpeg", "-y", "-i", str(concat),
             "-stream_loop", "-1", "-i", str(music),
             "-filter_complex", fc,
             "-map", "0:v", "-map", "[a]",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "256k",
             "-t", f"{total:.3f}", str(OUT)])
    else:
        if music_cfg.get("file"):
            print(f"NOTE: no music at {music_cfg['file']} -> exporting VO only.")
        shutil.copyfile(concat, OUT)

    mm, ss = divmod(total, 60)
    print(f"\nDone -> {OUT}  ({int(mm)}:{ss:05.2f})")


if __name__ == "__main__":
    main()
