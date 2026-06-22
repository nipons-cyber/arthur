# Q360 — Production Notes & Style Guide

Everything here serves one goal from the brief: **smooth and realistic, never
over the top.** When in doubt, do less.

## 1. Voice direction (the most important choice)

- **Casting:** one narrator, mid-range, warm and grounded. A trustworthy
  operator, not a hype announcer. Think "senior colleague explaining something
  clearly," not "movie trailer."
- **Pace:** ~125–135 wpm. Slower than conversational. Respect every `(beat)` in
  the script — silence is what makes premium VO feel premium.
- **Tone:** confident and calm. Downward inflections at line ends; avoid the
  rising "salesy" lilt. No vocal fry theatrics, no over-emphasis.
- **Energy curve:** Acts 1–2 measured and slightly serious → Act 3 a quiet lift
  (the turn) → Acts 4–5 assured and clear → Act 6 warm pride → Act 7 settle.
- **TTS settings (if using AI voice):** pick a natural/"narration" preset, set
  stability/consistency high, expressiveness moderate (not "expressive max"),
  speaking rate ~0.9–0.95×. Insert pauses (SSML `<break time="600ms"/>`) at each
  `(beat)`. Render act-by-act and reassemble for cleaner pacing.

## 2. Music & sound

- Single evolving cinematic bed: soft piano/pad → gentle pulse from Act 3 →
  fuller but still restrained in Acts 4–5 → resolve at the close. One track,
  one arc. **No drops, no big swells.**
- VO sits ~6 dB above music. Duck music under VO automatically.
- Subtle, tasteful SFX only: soft UI "snap" when modules connect (S5, S11), a
  light whoosh on the main transitions. Keep them quiet.
- Leave the last 3s on music alone for the end card to breathe.

## 3. Visual / brand

- **Grade:** cool neutral base, muted saturation, gentle contrast. One brand
  accent color used sparingly (CTAs, key UI highlights, the "connect" lines).
- **Motion:** ease everything (ease-in-out). Push-ins and parallax at 2–6% —
  barely-there movement reads as "expensive." 24fps for a filmic feel.
- **Cuts:** prefer cross-dissolves and match-cuts on motion. Average shot ~6–8s.
  Never flash or hard-cut on the beat for "energy" — that reads as "over."
- **Typography:** one clean sans-serif. On-screen text is minimal and never
  competes with the VO — it reinforces a single word/phrase, then fades.
- **UI shots:** use real Q360 screens (or faithful mockups). Animate the data
  populating rather than showing static screenshots — that's where the
  "connected system" story lands.

## 4. Footage strategy (pick one)

- **A — Real footage (best):** integrator B-roll (sites, technicians, ops) +
  screen recordings of Q360. Most credible, fully on-brand.
- **B — Stock + UI:** licensed B-roll for the field scenes + animated UI for the
  product walk. Fast and affordable.
- **C — AI-generated:** generate 4–8s cinematic clips per the storyboard prompts,
  plus animated UI. Keep prompts consistent (lens, light, grade) for continuity;
  avoid showing AI faces too close. Always pair with real/accurate UI for Act 4.

## 5. How to assemble

1. Record/generate the VO from `01-voiceover-script.md`; lock it first — VO is
   the spine and everything cuts to it.
2. Drop VO on the timeline at the Act timecodes; place the music bed under it.
3. Fill visuals per `02-storyboard.md`, trimming each shot to the VO, not the
   other way around.
4. Add on-screen text last; animate fades (~300ms), generous margins.
5. Color-grade for one consistent look; final loudness ~ -14 LUFS (web).
6. Export 16:9 master; then 1:1 and 9:16 cutdowns (use Acts 3, 5, 7 for a 30–45s
   social teaser).

## 6. Guardrails — what "not over the top" means here

- No superlatives stacked on superlatives; one claim per scene.
- No frantic motion, lens flares, glitch effects, or aggressive SFX.
- No fake urgency. Confidence comes from calm, not volume.
- Keep claims accurate to Q360's real capabilities (see `README.md`).
