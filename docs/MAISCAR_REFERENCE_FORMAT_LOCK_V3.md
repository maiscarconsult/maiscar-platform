# MAISCAR_REFERENCE_FORMAT_LOCK_V3

Permanent standard for MAIS CAR Reels, set 2026-09-14. **Supersedes**
`MAISCAR_FULL_AUTONOMOUS_AVATAR_REEL_MASTER.md` on avatar behavior and
editorial tone specifically — everything else there (pipeline order,
publish path, scheduler, hard gates not listed again below) still
applies. The account owner's reference video (never copied — character/
brand/identity are original) is the permanent benchmark for rhythm,
humor, narration, and how the avatar is *used*, not what it looks like.

## The core correction: the avatar is not the content

A real run measured `hostSizeAvgPct` ~45% with the avatar parked
**dead-center** on every pattern-interrupt beat — exactly the "boneco no
meio da tela escondendo o B-roll" this rule exists to ban. Root cause
(found and fixed in `narratedMotionReelV3Cycle.ts`): the block-building
loop literally set `mascotPosition = "CENTER"` on every pattern interrupt
and used `FOREGROUND_LEFT/RIGHT` (chest-height, near-center) otherwise.

Fixed:
- `CENTER_SCREEN_AVATAR = FORBIDDEN` — `CENTER`/`FOREGROUND_LEFT`/
  `FOREGROUND_RIGHT` are never emitted anymore. Only true corners:
  `BOTTOM_RIGHT` / `BOTTOM_LEFT` / `TOP_RIGHT` / `TOP_LEFT`
  (`remotion/types.ts`, `MASCOT_POSITION_STYLE` in
  `NarratedMotionReelV3.tsx`), rotating per beat.
- `CONTENT_SAFE_ZONE` (central 55-65%) stays free by construction — a
  corner-anchored avatar at the sizes below physically can't reach center.
- Size: `BASE_HOST_SIZE` cut from 460→300. Normal presence now ~21% of
  frame height (target 15-25%), reaction beats (`mascotScale: 1.35`) ~28%
  (target 25-32%) — down from the old ~45-52%. Cover still gets to be
  big (35-50%) — that rule is unchanged, covers are a different asset.
- Frequency: the avatar now appears on roughly 2 of every 5 beats
  (`showAvatarThisBeat = i > 0 && i % 2 === 0`, i.e. reaction/consequence-
  shaped beats — skips the hook and the first explanation beat by
  design), landing in the 25-45% target instead of the old ~80-100%
  (every beat with a `mascotPose` used to render it). The rest of the
  Reel is pure B-roll/kinetic-text/content — "deixa o conteúdo respirar."
- `AVATAR_CONTENT_COLLISION = HARD FAIL`: a corner-anchored, ≤32%-height
  avatar cannot overlap a centered B-roll subject by construction: no
  separate runtime collision detector was added (would need per-frame
  subject-position knowledge B-roll doesn't carry), but the geometry
  itself makes the collision the rule bans structurally rare — flagged
  honestly rather than claimed as independently measured.

## Avatar identity — still hard-locked

`AVATAR_IDENTITY_LOCK = HARD`. Same `TalkingHost.tsx` as before (face/
hair/glasses/beard/outfit from the account owner's reference photo) —
never redesigned, never a new character. New poses are always derived
from the same `FACE`/`ARMS` tables (`Mascot.tsx`, reused by
`TalkingHost.tsx`), never a fresh drawing.

## Editorial: always controversy, never comparison

`CONTROVERSY_REQUIRED = TRUE`, `COMPARISON_FORMAT = FORBIDDEN_BY_DEFAULT`
(unchanged — `isComparisonShapedTitle()` + `looksLikeComparison()`) and
`MIN_ENGAGEMENT_SCORE_HARD = 80` (unchanged, renamed `CONTROVERSY_SCORE`
in the account owner's own language — same mechanism, same
`BUYER_PAIN_SEEDS` fallback when the news radar tops out around 44-56).

## Profanity — the real bug, found and fixed

The account owner correctly reported profanity vanishing from scripts.
Root cause: **most of the 15 `BUYER_PAIN_SEEDS` simply never contained a
word from `PROFANITY_WORDS`** (a couple used "puta", which isn't even in
the tracked list) — `capProfanity()` only *caps* existing occurrences, it
never adds one, so a seed with zero profanity words shipped with zero,
which then correctly reported `profanityCount: 0`. This wasn't the
capping logic failing; the source text just didn't have any to cap.
Fixed by editing all 15 seeds' hook/punchline lines to include one
natural `PROFANITY_WORDS`-list word each (`porra`, `cacete`/`pra cacete`,
`merda`, `se lascou`), following the account owner's own placement rule
(punchline/emphasis, inside a fluid sentence, never a staccato list of
bare curse words). `PROFANITY_MODE = NATURAL_COMEDIC`, target 1-2 per
short Reel. The all-caps-casing bug found earlier this same day
("PORRA" → "porra" mid-hook) was already fixed in `capProfanity()` and
stays fixed.

## Everything else unchanged

Voice (`ONE_VOICE_ONLY`, 185-200 WPM, ≤350ms pause,
`MAISCAR_FLUID_VOICE_RULE`'s spoken-not-written connectors), narrative
structure (0-1.5s hook → 1.5-5s context → 5-12s explanation+humor →
12-20s proof/consequence → 20-28s punchline, continuous narrative, never
"slide 1/2/3"), `MAISCAR_SERVICE_MENTION_RULE` (teach → risk → connect to
MAIS CAR, only when genuinely relevant), real B-roll prioritized over
avatar (`REAL_B-ROLL > AVATAR` — the avatar illustrates, never replaces,
what the narration is describing), `STATIC_VISUAL_MAX_1_8S` /
`PATTERN_INTERRUPT_INTERVAL_SEC = 5`, `SOURCE_VERIFIED_FACT_GATE`,
15-30s standard duration (12-18s for a simple topic, 30-60s only when
genuinely teaching more), `POWERPOINT_STYLE = FALSE`. See
`MAISCAR_FULL_AUTONOMOUS_AVATAR_REEL_MASTER.md` for the publish pipeline
(GitHub media-bridge), scheduler (`enable-autopublish.ps1`), and the
still-open gaps (Insights/performance-memory loop, phoneme-accurate
lip-sync) — none of that changed here.

## Hard gates (superset — new ones from this lock in bold)

`CONTROVERSY_SCORE >= 80`, `NO_COMPARISON = PASS`, **`ASSERTIVE_HOOK = PASS`**,
`GENERIC_HOOK = FALSE`, **`HUMOR_BEAT = PASS`** (not independently measured
yet — a real punchline/ironic line is written into every seed and
instructed in the Haiku prompt, but no code-level humor detector exists;
flagged, not fabricated), **`NATURAL_SLANG = PASS`**,
**`PROFANITY_WHEN_APPROPRIATE = PASS`** (now genuinely measurable per-Reel
via `profanityCount`, fixed by the source-text fix above), `ONE_VOICE = PASS`,
`VOICE_FLUENCY = PASS`, `AVATAR_IDENTITY_LOCK = PASS`,
**`AVATAR_CENTER_SCREEN = FALSE`** (structurally true — no code path emits
`CENTER` anymore), **`AVATAR_CONTENT_COLLISION = 0`** (structural, not an
independent per-frame measurement — see note above), `REAL_BROLL = PASS`,
`SOURCE_VERIFIED_FACTS = PASS`, `POWERPOINT_STYLE = FALSE`.
