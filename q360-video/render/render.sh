#!/usr/bin/env bash
# End-to-end: install deps -> generate VO -> assemble MP4.
# Run from the render/ folder:  ./render.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then set -a; . ./.env; set +a; fi

echo "==> Checking ffmpeg"
command -v ffmpeg >/dev/null || { echo "Install ffmpeg first."; exit 1; }

echo "==> Installing Python deps"
pip install -q -r requirements.txt

echo "==> Generating voiceover (TTS_PROVIDER=${TTS_PROVIDER:-none})"
python tts.py

echo "==> Assembling video"
python build.py

echo "==> Output: out/q360_v1.mp4"
