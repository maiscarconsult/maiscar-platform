# MAISCAR_FULL_AUTONOMOUS_AVATAR_REEL_MASTER

Permanent master for MAIS CAR Reels, set 2026-09-14. **Supersedes**
`MAISCAR_AUTONOMOUS_BUYER_PAIN_V2.md` and `MAISCAR_AVATAR_NARRATED_REEL_MASTER.md`
(kept for implementation history). Pipeline:

```
RADAR → PAUTA (>=80 or BUYER_PAIN_SEEDS) → FACT CHECK → ROTEIRO → NARRAÇÃO
  → AVATAR (TalkingHost) → B-ROLL → MOTION → CAPA → MÚSICA → QA → PUBLICAÇÃO
  → INSIGHTS → MELHORIA
```

## Avatar — MAISCAR_TALKING_HOST_MASTER (locked)

The account owner's own reference photo (curly dark hair, round white-
framed glasses, dark beard/mustache, grey t-shirt) is the locked identity.
Implemented as `remotion/TalkingHost.tsx` — 100% code-drawn SVG (never a
raster copy of the photo), reusing `Mascot.tsx`'s pose/gesture tables
(`FACE`/`ARMS`, exported) so every gesture keeps working, with:
- **Talking mouth**: procedural 4-state (closed/small/medium/wide) cycle,
  deterministic per-frame pseudo-random pacing with brief closed-mouth
  "breath" pauses — not phoneme-accurate lip-sync (that would need the
  TTS word-boundary timestamps, already computed elsewhere in the
  pipeline, threaded into each `TimedBlock`; **not done yet**, flagged
  honestly as a real gap, not claimed as built).
- Blinking (~every 3s) and a subtle head bob.
- `AVATAR_IDENTITY_LOCK = TRUE`: same face/hair/glasses/beard/outfit in
  every pose — `TalkingHost` is now the only avatar component used, both
  in the video (`NarratedMotionReelV3.tsx`) and the cover
  (`MascotStill.tsx` → `remotionRenderer.renderMascotStillPng`).
- Present in every current beat (`mascotBeatRatio` measured ~0.8-1.0 in
  real runs — within the 40-65% target, usually above it since most
  seed-driven beats carry a pose).

## Everything else

Unchanged from `MAISCAR_AUTONOMOUS_BUYER_PAIN_V2.md`: comparison-forbidden-
by-default, `MIN_ENGAGEMENT_SCORE_HARD = 80` with `BUYER_PAIN_SEEDS`
fallback, `GENERIC_HOOK` hard-fail, `MAISCAR_SERVICE_MENTION_RULE`,
`MAISCAR_FLUID_VOICE_RULE`, one-voice TTS + silence normalization, real
B-roll with the CFR-integrity gate, kinetic text, `SOURCE_VERIFIED_FACT_GATE`,
15-30s standard duration (30-60s exception only for genuinely teaching
content). See that file for full detail — not restated here.

## Publishing — GitHub media-bridge (not R2, not Catbox, not Meta resumable)

`R2` was never actually configured (credentials stayed empty in `.env`
through several attempts) and Meta's Instagram-Login Content Publishing
API (`graph.instagram.com`, no linked Facebook Page — chosen specifically
because this org's Business Manager verification failed) rejected
`upload_type=resumable` with `"The parameter video_url is required"` —
confirmed by a real failed call, not assumed. The working path, proven by
a real successful publish (`instagram.com/reel/DdM40ydDie-`,
2026-09-12), is:

```
LOCAL MP4 → gh release upload (repo: maiscarconsult/maiscar-media-bridge)
  → browser_download_url validated (HTTP 200, byte-exact, ffprobe decodes)
  → that URL as Graph API video_url → wait FINISHED → media_publish
  → fetch permalink → gh release delete (asset removed, repo kept empty
    for the next cycle)
```

Implemented in `packages/backend/scripts/autonomousReelCycle.ts` (the
production runner both the manual "publish now" flow and the scheduled
09:00/19:00 jobs call — not a throwaway one-off script). Requires `gh`
CLI already authenticated on this machine (device-code login, done
2026-09-12) — the credential is stored in the OS keyring, not this
session, so it survives independently of any Claude Code session being
open.

## Scheduled automation — explicit opt-in, never self-enabled

Consistent with `packages/backend/src/jobs/contentPipeline/autopublishConfig.ts`'s
own standing design ("Deliberately NOT something Claude sets... a
standing decision only the account owner can make"): Claude prepares the
full scheduler but never flips it on. Two scripts at the repo root:

- **`enable-autopublish.ps1`** — run once by the account owner. Sets
  `packages/backend/.cache/autopublish.flag.json` to `{"enabled": true,
  "enabledAt": <now>, "enabledBy": "<user>"}` and registers two Windows
  Scheduled Tasks (`MaisCarReel_0900`, `MaisCarReel_1900`) that run
  `npx tsx scripts/autonomousReelCycle.ts` at 09:00 and 19:00 daily.
- **`disable-autopublish.ps1`** — flips the flag back to `false` and
  unregisters both scheduled tasks.

Once enabled, each scheduled run executes the full pipeline
(create → QA → publish → log) unattended — no open Claude Code session
required. `autonomousReelCycle.ts` checks the flag itself before the
publish step: if it's ever flipped back off, the script still generates
and QAs a Reel (so nothing is wasted) but stops before publishing and
leaves the file on disk for manual review instead.

**Insights / performance-memory loop (+1h/+6h/+24h/+72h)**: not built yet
(same honest gap as noted in the prior master doc) — reading Instagram
Insights after each publish and feeding which themes/hooks/covers/poses/
durations improved watch-time/reach/comments/shares/saves back into
topic/hook selection needs its own implementation pass. Flagged here so
it isn't silently assumed to already exist.

## Hard gates (unchanged, all must pass before publish)

`ENGAGEMENT_SCORE >= 80` (or a grounded `BUYER_PAIN_SEEDS` fallback),
`NO_COMPARISON = PASS`, `GENERIC_HOOK = FALSE`, `ONE_VOICE = PASS`,
`VOICE_FLUENCY = PASS`, `TALKING_AVATAR = PASS`,
`AVATAR_IDENTITY_LOCK = PASS`, `FACT_GATE = PASS`, `AUDIO = PASS`,
`FINAL_1080x1920 = PASS`, `POWERPOINT_STYLE = FALSE`. On a gate failure,
`autonomousReelCycle.ts` fixes the specific cause and retries **at most
once** before giving up and leaving the failure logged rather than
publishing something that didn't clear the bar.
