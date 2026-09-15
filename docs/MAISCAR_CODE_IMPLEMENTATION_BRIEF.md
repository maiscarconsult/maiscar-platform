# MAISCAR_CODE_IMPLEMENTATION_BRIEF.md

Ordered implementation brief for the Claude Code side. Reads
`docs/MAISCAR_CREATIVE_TRUTH.md` as the WHY; this file is the WHAT and the
WHERE. Every issue below names the exact file, function, and change so
Code does not re-derive intent from prose.

Priority is by *what the viewer perceives first*:
- **P0** — the Reel visibly does not match the reference format (slideshow
  feel, weak hook, avatar dominance, register monotony).
- **P1** — degrades quality but not format.
- **P2** — future polish once P0/P1 land.

Nothing below justifies rewriting `NarratedMotionReelV3.tsx`, `TalkingHost.tsx`,
`Mascot.tsx`, `pexelsVideo.ts`, `sourceVerifiedFactGate.ts`, `ttsProvider.ts`,
`autonomousReelCycle.ts`, `insightsSync.ts`, or the Prisma schema. Those
components are working and stay.

---

## P0-1 — Register variety gate (kill the slideshow feel)

**ISSUE**: The pilot cycles through visually similar Pexels automotive
B-roll on the same off-white palette. Measured: 7 cuts on a 27s Reel
(matches target average shot length) but only 3 of those are big-jump
cuts (`scene>0.4`). Reference: 12 big-jump cuts on 65.8s. The viewer
perceives the pilot as one long clip because the *type* of image barely
changes.

**CURRENT BEHAVIOR**: `narratedMotionReelV3Cycle.ts::pickBeatBRoll` (line
~880–920) queries Pexels Video with the beat's `videoQuery` string. Every
beat ends up in the same visual register (stock automotive B-roll).

**EXPECTED BEHAVIOR**: Each beat carries a `visualRegister` field. The
render must include ≥4 distinct registers across the Reel; the QA gate
`REGISTER_COUNT < 4` becomes a hard fail.

**ROOT CAUSE**: The Haiku prompt asks for a `videoQuery` per beat but
never asks for a *register*. The pipeline treats every clip as
interchangeable stock footage.

**FILES INVOLVED**:
- `packages/backend/src/jobs/contentPipeline/narratedMotionReelV3Cycle.ts`
  — Haiku prompt, `NarratedScriptV3`/`NarratedBeatV3` types, QA
  computation.
- `packages/backend/remotion/types.ts` — add `VisualRegister` union.
- `packages/backend/src/jobs/contentPipeline/pexelsVideo.ts` — accept
  register hint alongside `videoQuery` for scoring the returned clips.
- `packages/backend/src/jobs/contentPipeline/videoClipVerification.ts` —
  extend `verifyClipFrame` output with a returned register classification
  so the pipeline can *measure* register variety instead of trusting the
  requester.

**CODE CHANGE**:
1. Add `VisualRegister = "PRESENTER_FACE" | "SCREEN_EVIDENCE" |
   "PRODUCT_MACRO" | "DOCUMENT" | "LOCATION_BROLL" | "BIG_NUMBER" |
   "MONEY_STACK"` to `remotion/types.ts` and to `NarratedBeatV3`.
2. Update the Haiku writer's system prompt to require a register per
   beat and to distribute registers so ≥4 distinct ones appear (see
   worked prompt fragment in CREATIVE_TRUTH.md §Visual Language).
3. `pexelsVideo.searchAndDownloadClip` gains an optional `register`
   arg; when set, it appends a small vocabulary boost to the query
   (`"SCREEN_EVIDENCE" → " smartphone screen close up hand holding"`,
   `"DOCUMENT" → " contract paper signing hand"`, etc.).
4. QA computation adds `registerCount = new Set(beats.map(b =>
   b.visualRegister)).size` and the gate
   `REGISTER_COUNT >= 4` in `qa` (hard fail).

**TEST**: Given a 5-beat script emitting registers `[PRESENTER_FACE,
BIG_NUMBER, PRESENTER_FACE, BIG_NUMBER, PRESENTER_FACE]`, the QA computes
`registerCount=2` and marks the run as HELD_FOR_FIX.

**ACCEPTANCE**: Ship a Reel where the same-frame classifier reports ≥4
distinct visual registers over the timeline and the on-frame content
changes *category*, not just camera position, at least 4 times.

---

## P0-2 — SCREEN_EVIDENCE register (new B-roll type)

**ISSUE**: The reference video's most attention-grabbing shots are phone
screenshots of a real page (a listing, a financing simulator, a WhatsApp
conversation). MAIS CAR produces zero of these. The absence alone
accounts for a large share of the "PowerPoint feel" complaint.

**CURRENT BEHAVIOR**: All B-roll is either Pexels footage or the mascot
still. There is no code path that renders a screenshot-of-a-phone-screen
as a beat's foreground.

**EXPECTED BEHAVIOR**: A beat with `visualRegister: "SCREEN_EVIDENCE"`
renders a portrait phone frame with a plausible page inside it (invoice,
financing simulator result, listing page, WhatsApp conversation, PIX
receipt). The page content is generated deterministically from the
beat's claim, in code — never a real screenshot of a real page from a
real service.

**ROOT CAUSE**: The visual vocabulary was designed around real-world
B-roll only.

**FILES INVOLVED**:
- New: `packages/backend/remotion/ScreenEvidence.tsx` — a Remotion
  component that renders a phone-frame with configurable inner content
  (`FINANCING_QUOTE`, `LISTING_PAGE`, `WHATSAPP_THREAD`, `PIX_RECEIPT`,
  `INVOICE`).
- New: `packages/backend/src/jobs/contentPipeline/screenEvidenceCompose.ts`
  — takes the beat's claim + tier + a small template ID and produces the
  structured props for `ScreenEvidence`.
- `packages/backend/remotion/NarratedMotionReelV3.tsx` — when `beat.visualRegister
  === "SCREEN_EVIDENCE"`, render `<ScreenEvidence {...props} />` instead
  of the `BRoll` clip.
- `packages/backend/src/jobs/contentPipeline/narratedMotionReelV3Cycle.ts`
  — the beat's Haiku output carries the template ID + the specific
  values (never a real URL or a real amount without source).

**CODE CHANGE**: New file pair as above. In V3Cycle, when a beat's
register is `SCREEN_EVIDENCE`, skip the Pexels search entirely and route
to `screenEvidenceCompose(beat)`.

**TEST**: A beat `{register: "SCREEN_EVIDENCE", template: "FINANCING_QUOTE",
values: {carro:"Corolla 2019", parcela:"1.847", n:"60", cet:"31,4%"}}`
renders a phone frame at 1080×1920 with those exact numbers on a
realistic quote screen, no external network, no privacy leak.

**ACCEPTANCE**: The pilot ships with ≥1 SCREEN_EVIDENCE beat and a
human viewer identifies it as a phone screenshot, not stock footage.

---

## P0-3 — Hook produced as its own asset (first 3 seconds)

**ISSUE**: The current pipeline treats beat 0 like any other beat.
Reference-video grammar shows the first 3 seconds are a distinct product
with its own rules: face + accusation text + zero mascot + immediate cut.

**CURRENT BEHAVIOR**:
- `narratedMotionReelV3Cycle.ts::writeShortScript` returns the hook as
  `beats[0]`, subject to the same register selection and mascot budget as
  every other beat.
- No enforcement of `HOOK_FIRST_WORD_LATENCY` — voice can start anywhere.
- No enforcement that beat 0 carries kinetic text.

**EXPECTED BEHAVIOR**:
- Beat 0 is treated as `HOOK_BLOCK` with its own required fields:
  `firstOnScreenText` (3–5 words), `firstShotRegister ∈
  {PRESENTER_FACE, SCREEN_EVIDENCE}`, `voiceStartOffsetMs ≤ 100`.
- Renderer forces mascot off for the first 0.5s regardless of what the
  beat says.
- QA fails on `HOOK_FIRST_WORD_LATENCY > 200ms` and on missing
  `firstOnScreenText`.

**ROOT CAUSE**: Editorial intent was in the prompt, not in the type
system.

**FILES INVOLVED**:
- `packages/backend/remotion/types.ts` — extend `NarratedBeatV3` with
  optional `hookBlock` sub-object.
- `packages/backend/src/jobs/contentPipeline/narratedMotionReelV3Cycle.ts`
  — the Haiku prompt asks explicitly for `hookBlock` on beat 0; if
  missing, `buildFallbackScript()` supplies one from
  `BUYER_PAIN_SEEDS`.
- `packages/backend/remotion/NarratedMotionReelV3.tsx` — when the beat
  has `hookBlock`, render `firstOnScreenText` as a full-width slam-in
  on frame 1, ignore `mascotPose` for the first 15 frames.
- QA: `hookFirstWordLatencyMs = firstNonSilentFrame(narrationSrc)`
  measured with ffprobe on the assembled narration.

**TEST**: A hook block emitted with `firstOnScreenText: "TU TÁ COMPRANDO
ERRADO"` produces a first frame that (1) shows those 3 words centered,
(2) is a `PRESENTER_FACE` shot, (3) has voice already speaking at ≤100ms.

**ACCEPTANCE**: The pilot's frame 1 is visibly different from the pilot's
current frame 1 (which is a mascot-corner over Pexels footage) and reads
as an accusation, not an intro.

---

## P0-4 — POWERPOINT_STYLE detector

**ISSUE**: The account owner has repeatedly flagged pilots as "looking
like a PowerPoint" even when every mechanical gate passes. There is no
code that measures the specific failure mode.

**CURRENT BEHAVIOR**: No such gate exists.

**EXPECTED BEHAVIOR**: A heuristic that combines (a) low register
variety, (b) high mascot-beat ratio, (c) low frame-color variance
between beats, and (d) presence of KineticText on every single beat
without motion between them, into a single `POWERPOINT_STYLE = TRUE`
signal that hard-fails the QA.

**ROOT CAUSE**: The pipeline was measuring individual axes but not the
composite that the viewer actually perceives.

**FILES INVOLVED**:
- New: `packages/backend/src/jobs/contentPipeline/powerpointStyleGate.ts`
  — takes the assembled beats + the final MP4 path, returns
  `{ powerpointStyle: boolean, score: number, reasons: string[] }`.
- `packages/backend/src/jobs/contentPipeline/narratedMotionReelV3Cycle.ts`
  — call the gate after render and before publish.

**CODE CHANGE**: The heuristic:
```
score = 0
score += (registerCount < 3) ? 3 : 0
score += (mascotBeatRatio > 0.75) ? 2 : 0
score += (allBeatsHaveKineticText && noRegisterChangeBetween3Beats) ? 2 : 0
score += (frameColorHistogramDistanceBetweenAdjacentBeats < 0.15) ? 2 : 0
powerpointStyle = score >= 5
```

Frame-color histogram is cheap: `ffmpeg` a 256-bin luma histogram at
beat mid-points and compare adjacent bins with L1 distance. No Vision
needed.

**TEST**: The latest pilot (`run-1789430642043`) should score as
`powerpointStyle=true` (register count 1–2, mascot present in every
beat).

**ACCEPTANCE**: The gate blocks any run that would previously have shipped
as a slideshow.

---

## P0-5 — HOOK_SCORE gate raised to 88, coverScoring landed

**ISSUE**: `HOOK_SCORE ≥ 85` currently passes hooks that experienced
viewers flag as weak. Cover has no scoring gate at all — `WEAK_COVER` is
declared but never enforced.

**CURRENT BEHAVIOR**: Hook score is a Haiku-produced number, self-graded,
usually 85–92 regardless of quality. Cover is chosen by the first
successful render.

**EXPECTED BEHAVIOR**:
- Hook score is *rederived* from the hook block itself using a small
  code heuristic (first-word latency, on-screen text present, forbidden
  opener match, register, presence of a number / verb of consequence).
- Cover: 3 variants generated internally (`SHOCK`, `CONFRONTATION`,
  `MONEY_PAIN`), each scored on text-as-spoken-sentence, mascot
  expression match, and object visibility at thumbnail size. Best
  wins. If none clears 80, `WEAK_COVER = true` and the run
  HELD_FOR_FIX.

**FILES INVOLVED**:
- New: `packages/backend/src/jobs/contentPipeline/hookScoreGate.ts`
- New: `packages/backend/src/jobs/contentPipeline/coverScoreGate.ts`
- `packages/backend/src/jobs/contentPipeline/narratedMotionReelV3Cycle.ts`
- `packages/backend/remotion/CoverTemplate.tsx` (may already exist as
  `remotionRenderer.renderMascotStillPng` — extend to accept a variant
  parameter and produce 3 renders per run).

**CODE CHANGE**: New two files, wire into cycle. See heuristics in
CREATIVE_TRUTH.md §Hook Rules and §Cover Rules.

**TEST**: A cover with headline `PARCELA TE ENGANA / PRAZO` scores below
80 (title-case, slash separator, no spoken shape). A cover with headline
`ESSA CONTA VAI DOER` and `MAO_NA_CABECA` pose scores ≥85.

**ACCEPTANCE**: No pilot ships with a cover that scored <80.

---

## P1-1 — Pause discipline after PUNCHLINE / HOOK / REVEAL beats

**ISSUE**: The current TTS pipeline concatenates beats with a tight
inter-beat gap, so punchlines don't land. Reference presenter always
pauses briefly after a punchline.

**FILES INVOLVED**:
- `packages/backend/src/jobs/contentPipeline/ttsProvider.ts` —
  post-synth silence-insertion between beats based on the beat's `id`.
- `narratedMotionReelV3Cycle.ts` — pass beat id to the assembly step.

**CODE CHANGE**: In the concatenation step, insert 300ms silence after a
beat with `id ∈ {HOOK, PUNCHLINE, REVEAL, VEREDITO}`, 100ms otherwise.
Measure `longestPauseSec` post-hoc against the ≤600ms gate.

**ACCEPTANCE**: Measured pause after any PUNCHLINE beat ≥250ms on the
final MP4.

---

## P1-2 — PROFANITY_MODE actually enforced editorially, not just capped

**ISSUE**: `capProfanity` caps at 2 but never *requires* one when the
topic supports it. Result: buyer-pain Reels shipping with 0 profanity
and a flat tone.

**FILES INVOLVED**:
- `narratedMotionReelV3Cycle.ts::writeShortScript` — the Haiku prompt
  and the fallback library both need to guarantee at least one
  profanity on `BUYER_PAIN` / `MONEY_LOSS` / `DEALER_TRICK` topics.
- QA: soft warning (not hard fail) if a supported topic ships with 0.

**ACCEPTANCE**: Ten consecutive BUYER_PAIN Reels have `profanityCount ≥ 1`
in at least 8.

---

## P1-3 — B-roll relevance HARD failure on all-unverified

**ISSUE**: `pexelsVideo.ts` returns `verified:false` best-effort fallback
when every candidate is rejected by Vision. Currently the pipeline
publishes with unverified clips. Owner has repeatedly flagged off-topic
B-roll.

**FILES INVOLVED**:
- `packages/backend/src/jobs/contentPipeline/pexelsVideo.ts` — add
  `mode: "STRICT" | "BEST_EFFORT"` parameter; STRICT returns `null`
  instead of an unverified fallback when Vision was reachable.
- `narratedMotionReelV3Cycle.ts` — call in STRICT mode when
  `verifyClipFrame` did not throw an infrastructure error; on `null`,
  retry with an alternative query, then hard-fail the run if all beats
  still lack a verified clip.

**ACCEPTANCE**: No pilot ships with `unverifiedClipCount > 0` unless
Vision itself was unreachable (documented in the run log).

---

## P2 — Deferred, do NOT start until P0+P1 land

- Word-boundary phoneme lip-sync (msedge-tts word events → TimedBlock).
- Full learning loop: insights snapshots → topic/hook/cover/pose bias in
  radar scoring.
- Automatic reference-similarity classifier that watches the final MP4
  and grades it against the reference grammar.
- Trending-audio integration for Reels (currently local licensed
  library only; documented gap in AI_DECISIONS.md).

---

## Not touched by this brief, deliberately

- `TalkingHost.tsx`, `Mascot.tsx` — avatar identity is locked, the
  renderer was hardened 2026-09-15 to coerce CENTER/FOREGROUND_* to a
  corner. No further avatar work in this pass.
- `ttsProvider.ts` — voice profile is correct; only the between-beat
  silence needs adjustment (P1-1).
- `sourceVerifiedFactGate.ts` — working as intended.
- `insightsSync.ts` — collecting the right data; the loop (P2) is what's
  missing.
- Prisma schema — no changes needed.
- `autonomousReelCycle.ts` — no changes needed beyond calling the new
  gates.

The point of listing these is negative constraint: if the code editor
finds itself modifying one of these files to fix a P0 issue, that is a
signal the fix has drifted from the intent — pause and re-read the
brief.
