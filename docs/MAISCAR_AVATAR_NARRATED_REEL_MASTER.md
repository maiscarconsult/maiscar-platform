# MAISCAR_AVATAR_NARRATED_REEL_MASTER

Permanent standard for MAIS CAR Instagram Reels, set 2026-09-12. Supersedes
all prior format-lock versions (`MAISCAR_NARRATED_MOTION_REEL_V3`,
`MAISCAR_REFERENCE_FORMAT_LOCK_V1`, `MAISCAR_BUYER_PAIN_FORMAT_V2`) — those
are the implementation history; this is the standing spec new Reels are
generated against. Implemented in
`packages/backend/src/jobs/contentPipeline/narratedMotionReelV3Cycle.ts`.

## Objective

Automotive Reels optimized, in order, for: **retention → comments → replay
→ shares → reach**. Each new Reel should read as an evolution of the last
one, not a reset — keep what worked, cut what made a prior video weak.

## Format (fixed)

- Vertical 9:16, final render **1080x1920**
- Duration: **18-30s ideal**; may exceptionally run longer only when the
  theme genuinely earns it (explicit override, not a default)
- One continuous voice (`ONE_VOICE_ONLY`), one synthesis call
- Real B-roll (vision-verified + ffprobe/CFR-integrity-checked)
- Kinetic text, SFX, licensed background music
- Cover is a separate asset — never just the first video frame

**Banned**: slideshow/PowerPoint pacing, static card sequences, A-vs-B
comparison as the main format, robotic/newsreader voice, multiple voices,
a generic/bland hook, a weak cover, a personality-less video.
`POWERPOINT_STYLE = FAIL` if it reads as a slide deck.

## Topic

No comparison-between-two-cars videos. Buyer-pain / consumer-protection
angle: buying mistakes, market traps, false economy, neglected
maintenance, bad financing, a seller hiding a problem, a buyer's own dumb
move, a cosmetically-fixed car, rental-car resale, odometer tricks,
auctions, skipped inspections, economy that becomes a loss, car myths,
emotional purchases turning into regret, strong buying tactics/negotiation
technique. Prefer polarizing, reaction-provoking angles.

Editorial-line examples: *"Se tu olha só a parcela, tu já começou
errado."*, *"Quilometragem baixa sozinha não prova porra nenhuma."*, *"O
problema não é o carro. É a compra mal feita."*

## Voice / tone

Natural, spoken, direct, confident, provocative, colloquial, funny, a
touch of deboche, energetic — "someone telling you the truth." Profanity
used sparingly and pointedly for emotional emphasis, never as filler or
vulgarity for its own sake. Reads as one continuous person speaking start
to finish (`ONE_VOICE_ONLY`).

## Avatar

Half-body, code-drawn host character (`remotion/Mascot.tsx`), reused across
every Reel and on the cover. Reacts and points every beat, larger/more
expressive than earlier revisions. Pose pack: `APONTANDO*`, `SURPRESO`,
`DESCONFIADO`, `BRAVO`, `INDIGNADO`, `PENSANDO`, `MAO_NA_CABECA`,
`EXPLICANDO`, `DINHEIRO`/`DINHEIRO_DOENDO`, `POSITIVO`, `NEGATIVO`, and
more (see `remotion/types.ts` `MascotPose`).

**Pending**: the account owner asked for this avatar to be redesigned from
a reference photo of themselves. No photo has actually been received in
any conversation yet — the current avatar is the pre-existing code-drawn
character, not a photo-likeness redesign. Redesigning it requires the
photo to actually be attached first; this is a real blocker, not a
decision made on the owner's behalf.

## Cover

Separate asset (`REEL_COVER`), built by compositing the avatar (rendered
via the `MascotStill` Remotion composition, `remotionRenderer.
renderMascotStillPng()`) onto the existing gated hero template
(`diagonalTemplateV4.renderHero`) — avatar composited *after* that
template's own structural/photo-dominance assertions pass, so it never
risks tripping those checks. 4-8 word affirmative headline, high contrast,
avatar visibly reacting/"speaking" the line.

## Narrative structure

```
0.0–1.5s   HOOK (strong, affirmative, never a generic question)
1.5–5s     tension / the problem
5–12s      visual proof / explanation
12–20s     consequence / cost / mistake
20–28s     strong close / verdict
```

Never ends on "comenta aí" — comments should come from the
conflict/identification/provocation itself.

## Visual grammar

Real B-roll, frequent cuts, kinetic text, arrows, highlights, big numbers,
punch-ins, microanimations, pattern interrupts. Hard rules (already
enforced by the pipeline's QA dict):
`STATIC_VISUAL_MAX_1_8S`, `PATTERN_INTERRUPT_INTERVAL_SEC = 5` (within the
4-6s band).

## Fact-check

Provocative is fine; false is not. Every specific factual claim goes
through `SOURCE_VERIFIED_FACT_GATE` — no invented recall, number,
consumption figure, cost, price, mechanical failure, process, or
statistic. Unverifiable claims are tagged `EDITORIAL_OPINION` or rewritten,
never asserted as fact.

## Performance loop

Every new Reel is treated as an iteration on the last: keep what tested
well (a strong hook shape, a pose that landed, a topic angle with real
comment potential), fix what was weak (bland hook, comparison creeping in,
low avatar presence, PowerPoint pacing, weak cover) — see
`GENERIC_HOOK` hard-fail, `MIN_ENGAGEMENT_SCORE_HARD`, and
`BUYER_PAIN_SEEDS` in the pipeline code for the current mechanical
enforcement of this loop.

## Stack / execution order

`CACHE → existing components (avatar kit, motion kit, verified B-roll) →
search → Haiku → Vision → Sonnet`. Remotion owns timeline/motion/
composition; ffmpeg (via `ffmpeg-static`) handles encode/audio/mix/export;
Canva only if it would genuinely improve a visual/motion element beyond
what Remotion+ffmpeg already do.

## Execution mode

When asked for a new Reel under this standard: don't ask which topic,
pick the strongest on-brief buyer-pain angle and generate the complete
Reel (video, cover, caption) end to end, evolving on the previous one.

## Output format

```
FORMAT:
TOPIC:
HOOK:
ANGLE:
DURATION:
VOICE:
AVATAR:
COVER:
FACT CHECK:
POWERPOINT STYLE: TRUE/FALSE
VIDEO FILE:
COVER FILE:
CAPTION:
```
