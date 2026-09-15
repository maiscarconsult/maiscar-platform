# MAISCAR_P0_EXECUTION_BRIEF_FOR_CLAUDE_CODE.md

Handoff from the Cowork orchestrator (Linux VM, cannot execute Windows
runtime) to Claude Code (running in the platform workspace on the
Windows host). Read `docs/MAISCAR_CREATIVE_TRUTH.md` and
`docs/MAISCAR_CODE_IMPLEMENTATION_BRIEF.md` FIRST — they define the
WHY and the WHAT. This file is only the STATE of the handoff and the
runbook to finish it.

Written 2026-09-15.

---

## State on disk after the orchestrator's session

**Files already added (compile-clean in isolation, not yet fully wired):**

- `packages/backend/remotion/types.ts` — extended with
  `VisualRegister`, `HookBlock`, `ScreenEvidenceProps`,
  `ScreenEvidenceTemplate`, `TimedBlockV3Additions`. All additive,
  every existing consumer keeps working.
- `packages/backend/remotion/ScreenEvidence.tsx` — new Remotion
  component. Self-contained. Not yet registered in `Root.tsx` and not
  yet routed to from `NarratedMotionReelV3.tsx`.
- `packages/backend/src/jobs/contentPipeline/powerpointStyleGate.ts`
  — new module. Pure heuristic + ffmpeg luma-histogram. Not yet
  called from the cycle.
- `packages/backend/src/jobs/contentPipeline/hookScoreGate.ts` — new
  module. Rederives hook score in code. Not yet called from the
  cycle.
- `packages/backend/src/jobs/contentPipeline/coverScoreGate.ts` — new
  module. Scores a cover variant. Not yet called from the cycle.
- `packages/backend/src/jobs/contentPipeline/screenEvidenceCompose.ts`
  — new module. Deterministic-only composition of ScreenEvidenceProps.
  Not yet called from the cycle.

**Files already modified in earlier orchestrator sessions:**

- `packages/backend/remotion/NarratedMotionReelV3.tsx` — CENTER /
  FOREGROUND_LEFT / FOREGROUND_RIGHT positions aliased to
  BOTTOM_RIGHT + `coerceCorner()` runtime guard + `MAX_MASCOT_SCALE =
  1.35` cap. This is done, keep it.
- `scripts/run-reel-and-publish-now.ps1` — the single-shot flag-flip +
  pipeline + restore runner. This is done, keep it.
- `docs/MAISCAR_CREATIVE_TRUTH.md` — canonical creative truth.
- `docs/MAISCAR_CODE_IMPLEMENTATION_BRIEF.md` — canonical code brief.

**Nothing else was touched.** The pipeline that publishes today
(`autonomousReelCycle.ts` → `runNarratedMotionReelV3Pilot`) is
unchanged from its last known-good state and still works.

---

## What Claude Code must do on Windows

The five P0 changes need finishing work that only makes sense with a
compile pass and a real render loop — Cowork could not run either.
Do this in ORDER. `npx tsc --noEmit` between every step. Any tsc
error, fix it before advancing.

### Step 1 — Register variety wiring (P0-1)

1. Open `packages/backend/src/jobs/contentPipeline/narratedMotionReelV3Cycle.ts`.
2. Find the `NarratedBeatV3` interface (around line 480–490). Add optional
   fields:
   ```ts
   visualRegister?: import("../../../remotion/types").VisualRegister;
   hookBlock?: import("../../../remotion/types").HookBlock;
   screenEvidence?: import("../../../remotion/types").ScreenEvidenceProps;
   ```
3. Locate the Haiku system prompt (`const system = ...`, around line 499)
   and the schema example inside `const prompt = ...` (around line
   524–541). Update the schema example so each beat has a
   `"visualRegister": "PRESENTER_FACE|SCREEN_EVIDENCE|PRODUCT_MACRO|DOCUMENT|LOCATION_BROLL|BIG_NUMBER|MONEY_STACK"`
   field. Add a rule to the prompt: "distribua os registros para que
   pelo menos 4 valores distintos apareçam num Reel de 4+ beats; nunca
   repita o mesmo register em beats adjacentes; o hook (beat 0) usa
   PRESENTER_FACE ou SCREEN_EVIDENCE."
4. In `runNarratedMotionReelV3Pilot`, after the QA metrics are computed,
   add:
   ```ts
   const registerCount = new Set(
     script.beats.map((b) => b.visualRegister).filter(Boolean),
   ).size;
   qa.REGISTER_COUNT_OK = registerCount >= 4;
   ```
5. **Do not** hard-fail the run on `REGISTER_COUNT_OK=false` yet. Ship
   the metric first and observe two runs; then flip to hard fail once
   the numbers confirm.

**Test**: `npx tsc --noEmit`. Then run
`npx tsx packages/backend/scripts/autonomousReelCycle.ts` with the
flag disabled and confirm the JSON dump now carries `visualRegister`
on every beat and `REGISTER_COUNT_OK` in `qa`.

### Step 2 — SCREEN_EVIDENCE routing (P0-2)

1. Open `packages/backend/remotion/Root.tsx` (or wherever
   `NarratedMotionReelV3` is registered — grep for
   `registerRoot|Composition` there). Import
   `ScreenEvidence` from `./ScreenEvidence` — do not add it as a new
   Composition, only import it so the bundle picks it up.
2. In `packages/backend/remotion/NarratedMotionReelV3.tsx`, inside the
   per-block rendering loop, replace the current `<BRoll .../>`
   invocation with a branch:
   ```tsx
   {block.screenEvidence
     ? <ScreenEvidence {...block.screenEvidence} />
     : block.videoCuts.map((cut, i) => (
         <Sequence key={i} .../><BRoll .../></Sequence>
       ))
   }
   ```
3. In `narratedMotionReelV3Cycle.ts`, in the per-beat B-roll sourcing
   block (around line 890), branch BEFORE the Pexels call:
   ```ts
   if (beat.visualRegister === "SCREEN_EVIDENCE") {
     const template = beat.screenEvidence?.template
       ?? pickTemplateFromBeat(beat.keyword ?? "", beat.tier);
     beat.screenEvidence = composeScreenEvidence({
       template,
       values: beat.screenEvidence?.values ?? {},
       highlight: beat.screenEvidence?.highlight,
     });
     // Skip Pexels entirely — the beat's foreground is the phone screen.
     continue;
   }
   ```
4. Also thread the `values` through the Haiku prompt: add a
   `screenEvidenceValues` optional object to the JSON schema, populated
   only when the beat's register is SCREEN_EVIDENCE. Rule in the prompt:
   "para SCREEN_EVIDENCE, escreva os valores em português, jamais uma
   URL real, jamais um CPF/CNPJ real, jamais o nome de uma empresa
   real."

**Test**: `npx tsc --noEmit`. Then re-render a pilot; visually check
that at least one beat now shows the phone-frame with the fake page.

### Step 3 — HOOK_BLOCK (P0-3)

1. In the Haiku prompt, require beat 0 to carry a `"hookBlock"` object:
   ```json
   "hookBlock": {
     "firstOnScreenText": "3-5 palavras em CAIXA ALTA",
     "firstShotRegister": "PRESENTER_FACE" | "SCREEN_EVIDENCE" | "PRODUCT_MACRO"
   }
   ```
2. In `runNarratedMotionReelV3Pilot`, after script assembly, if
   `!script.beats[0]?.hookBlock`, either force a fallback hookBlock from
   `BUYER_PAIN_SEEDS[0]` or mark `usedFallback=true` and retry.
3. In `packages/backend/remotion/NarratedMotionReelV3.tsx`, add a
   first-15-frame slam-in of `firstOnScreenText` when `blocks[0].hookBlock`
   is set. Suppress the mascot in that same window.
4. QA metric: `hookFirstWordLatencyMs` — use `ffprobe -select_streams a
   -show_frames -show_entries frame=pkt_pts_time -read_intervals 0%+0.6`
   on the assembled narration MP3 and pick the first frame with RMS >
   threshold (there's a helper pattern in `ttsProvider.ts`'s silence
   normalization — reuse it). Hard-fail on `> 500ms`.

**Test**: `npx tsc --noEmit`. Then render and confirm frame 1 shows the
hook text with the voice audible immediately.

### Step 4 — POWERPOINT_STYLE gate (P0-4)

1. In `runNarratedMotionReelV3Pilot`, after `renderReel()` completes and
   before the publish step, call:
   ```ts
   const pp = await detectPowerpointStyle({
     beats: script.beats.map((b, i) => ({
       id: b.id,
       visualRegister: b.visualRegister,
       hasMascotPose: !!b.mascotPose,
       hasKineticText: !!b.keyword,
       startSec: timedBlocks[i].startSec,
       durationSec: timedBlocks[i].durationSec,
     })),
     videoPath: finalMp4Path,
   });
   qa.POWERPOINT_STYLE = !pp.powerpointStyle;
   ```
2. **Do not** hard-fail on this yet either. Observe two runs. Then flip
   to `if (pp.powerpointStyle) return { status: "ABANDONED", reason:
   "POWERPOINT_STYLE: " + pp.reasons.join(", "), qa };`.

**Test**: run the pipeline against the LATEST existing pilot
(`packages/backend/generated/narrated-v3-pilot/run-1789430642043/narrated-reel-v3.mp4`)
by calling `detectPowerpointStyle` in a repl or a scratch script; it
should return `powerpointStyle: true` (register count 1–2, mascot in
every beat). That confirms the detector fires on the failure mode
it's supposed to catch.

### Step 5 — HOOK & COVER scoring (P0-5)

1. In `runNarratedMotionReelV3Pilot`, after script assembly, call
   `scoreHook({ narration: script.beats[0].narration, hookBlock:
   script.beats[0].hookBlock, firstWordLatencyMs })`. If `hardFail`,
   set `usedFallback=true` and retry. If `score < 90`, warn but do
   not block yet.
2. For the cover, extend `remotionRenderer.renderMascotStillPng()` to
   accept a `variant: "SHOCK" | "CONFRONTATION" | "MONEY_PAIN"` and
   render three PNGs per run (`cover-shock.png`, `cover-confront.png`,
   `cover-money.png`). Score each with `scoreCover(...)`, ship the
   top-scoring, and hard-fail on `WEAK_COVER=true` (all three scored
   <80).

**Test**: `npx tsc --noEmit`. Render a pilot; confirm three covers on
disk with scores and a winner chosen deterministically.

---

## Publish step (only after Steps 1–5 land)

Once `tsc` passes and a fresh pilot ships with:

- `REGISTER_COUNT >= 4`
- `HOOK_SCORE >= 90` and no hook `hardFail`
- `SCRIPT_SCORE >= 88`
- `CENTER_AVATAR_FRAMES = 0` (already enforced by renderer)
- `AVATAR_COLLISIONS = 0`
- `VISUAL_EVENT_AVG <= 1.8s`
- `LONGEST_STATIC <= 2.0s`
- `POWERPOINT_STYLE = false`
- `WEAK_COVER = false`
- `FACT_GATE = pass`

Run from the repo root, on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-reel-and-publish-now.ps1
```

That flips the autopublish flag on for one run, executes
`autonomousReelCycle.ts`, restores the flag in a `finally` block, and
prints a `PUBLISHED: {"mediaId":"…","permalink":"…"}` line.

**Paste that line back into the Cowork orchestrator** so it can
register `mediaId`, `permalink`, `publishedAt`, `topic`, `thesis`,
`hook`, `hookType`, `coverType`, `duration`, `humorType`,
`profanityLevel`, `avatarUsage` and fire the initial `sync-insights.ts`
snapshot.

---

## Non-negotiables while doing all of the above

- Do not rewrite `TalkingHost.tsx`, `Mascot.tsx`, `pexelsVideo.ts`,
  `sourceVerifiedFactGate.ts`, `ttsProvider.ts`, `insightsSync.ts`,
  or the Prisma schema. If a P0 fix looks like it needs to, pause
  and re-read the code brief — the intent has drifted.
- Do not enable the standing scheduler (`enable-autopublish.ps1`).
  The single-shot runner is the correct entry point for this run.
- Do not attempt word-boundary lip-sync, the full learning loop, or
  the 09:00/19:00 scheduler in this pass. Those are P2.
- If a step's `tsc` fails, fix the specific type error before
  advancing. Do not skip ahead.
- If a step's render fails, look at the run log first
  (`packages/backend/.cache/reel-run-*.log`), not the source. Most
  render failures at this stage come from a missing environment
  variable (PEXELS_API_KEY, META_APP_ID/SECRET, DATABASE_URL,
  REDIS_URL), not from the P0 code.

---

## Orchestrator's validation step (after Claude Code returns)

Paste back to the Cowork orchestrator:
- The final `PUBLISHED: {...}` line.
- The `qa` object dumped by `autonomousReelCycle.ts` for the winning
  run.
- The permalink so the orchestrator can validate the Reel against
  `MAISCAR_CREATIVE_TRUTH.md` §Reference Characteristics — i.e. does
  the shipped Reel actually read like the reference now, not just
  pass the gates?
