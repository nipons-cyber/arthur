#!/usr/bin/env python3
"""Generate per-scene English voiceover from script.yaml.

Providers (set TTS_PROVIDER):
  elevenlabs  -> ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
  azure       -> AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, AZURE_VOICE
  none        -> (default) writes nothing; build.py then uses fixed timings

Output: audio/<scene_id>.mp3  (one file per scene)

The string " (beat) " in a scene's vo is turned into a real pause:
  - elevenlabs: rendered as an ellipsis, which the model reads as a pause
  - azure: rendered as an SSML <break time="600ms"/>

Tuning for a calm, realistic, "not over the top" read lives in the
constants below and in 03-production-notes.md.
"""
import os
import sys
import pathlib

try:
    import yaml
except ImportError:
    sys.exit("Missing dependency: pip install pyyaml")

HERE = pathlib.Path(__file__).resolve().parent
AUDIO_DIR = HERE / "audio"
SCRIPT = HERE / "script.yaml"

BEAT = "(beat)"
BREAK_MS = 600  # pause length for each (beat)


def load_scenes():
    data = yaml.safe_load(SCRIPT.read_text(encoding="utf-8"))
    return data["scenes"]


def elevenlabs(text, out_path):
    import requests
    key = os.environ["ELEVENLABS_API_KEY"]
    voice = os.environ.get("ELEVENLABS_VOICE_ID", "")
    if not voice:
        sys.exit("Set ELEVENLABS_VOICE_ID (pick a calm narration voice).")
    # (beat) -> ellipsis pause; keep it natural
    spoken = text.replace(BEAT, " ... ")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}"
    payload = {
        "text": spoken,
        "model_id": os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2"),
        "voice_settings": {
            # high stability + low style = grounded, non-salesy delivery
            "stability": 0.65,
            "similarity_boost": 0.75,
            "style": 0.15,
            "use_speaker_boost": True,
        },
    }
    headers = {"xi-api-key": key, "accept": "audio/mpeg",
               "content-type": "application/json"}
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    r.raise_for_status()
    out_path.write_bytes(r.content)


def azure(text, out_path):
    import requests
    key = os.environ["AZURE_SPEECH_KEY"]
    region = os.environ["AZURE_SPEECH_REGION"]
    voice = os.environ.get("AZURE_VOICE", "en-US-AndrewMultilingualNeural")
    body = text.replace(BEAT, f'<break time="{BREAK_MS}ms"/>')
    ssml = (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        'xml:lang="en-US">'
        f'<voice name="{voice}">'
        '<prosody rate="-8%">'  # slightly slower = premium, calm
        f'{body}'
        '</prosody></voice></speak>'
    )
    token_url = f"https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    tok = requests.post(token_url, headers={"Ocp-Apim-Subscription-Key": key},
                        timeout=30)
    tok.raise_for_status()
    tts_url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Authorization": f"Bearer {tok.text}",
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-160kbitrate-mono-mp3",
    }
    r = requests.post(tts_url, data=ssml.encode("utf-8"), headers=headers,
                      timeout=120)
    r.raise_for_status()
    out_path.write_bytes(r.content)


def main():
    provider = os.environ.get("TTS_PROVIDER", "none").lower()
    if provider == "none":
        print("TTS_PROVIDER=none -> skipping VO generation.")
        print("Set TTS_PROVIDER=elevenlabs or azure (see render/README.md).")
        return
    AUDIO_DIR.mkdir(exist_ok=True)
    fn = {"elevenlabs": elevenlabs, "azure": azure}.get(provider)
    if not fn:
        sys.exit(f"Unknown TTS_PROVIDER: {provider}")
    for sc in load_scenes():
        out = AUDIO_DIR / f"{sc['id']}.mp3"
        print(f"  {sc['id']} -> {out.name}")
        fn(sc["vo"], out)
    print("Voiceover done.")


if __name__ == "__main__":
    main()
