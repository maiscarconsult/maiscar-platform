# MAISCAR_CREATIVE_TRUTH.md

Single source of creative truth for MAIS CAR Reels. Written 2026-09-15 after
comparing the account owner's reference video (`~/Downloads/ScreenRecording_09-10-2026 22-24-55_1.mp4`,
65.8s / 60fps / 1290×2796 screen recording of a real published Reel) against
the most recent pilot output (`packages/backend/generated/narrated-v3-pilot/run-1789430642043/narrated-reel-v3.mp4`,
27.1s / 30fps / 1080×1920) and all prior owner critiques captured in
`docs/AI_DECISIONS.md`, the MAISCAR MASTER files, and the last several
sessions of chat history.

Two mistakes this file exists to end:
1. Restarting the audit every time a Reel disappoints.
2. Confusing technical motion (a Ken-Burns pan, a crossfade, a mascot
   blinking) with perceptual change (a new subject, a new framing, a new
   idea).

If a change to code, prompt, or asset does not move the resulting Reel
CLOSER to the reference grammar catalogued here, do not merge it.

---

## WHAT WE ARE BUILDING

An opinionated, first-person-voice, short-form car-buyer-pain Reel — the
kind a friend who fixes cars would send you on WhatsApp because he saw you
about to make a mistake. The presenter is a real personality with real
opinions. The mascot is a *reaction* character, not the subject. The
content is the car / the money / the trap / the paperwork / the mechanic
bay. The Reel exists to make the viewer stop scrolling, feel something
strong enough to comment or share, and remember MAIS CAR as the account
that told them the truth other channels wouldn't.

**Target duration**: 18–35s standard, up to 60s only when the topic is a
genuine teaching thread (`DICA` mode) and the extra seconds carry new
information — never to pad.

**Target voice**: pt-BR-AntonioNeural (locked), MAISCAR_VOICE_PROFILE
prosody (rate +30% base, per-emotion pitch/rate deltas), 180–210 WPM
measured on the final MP4.

**Aspect + resolution**: 1080×1920, 30fps final render.

## WHAT WE ARE NOT BUILDING

- A comparison show. Model A vs Model B is banned as default framing.
  `COMPARISON_FORMAT = HARD FAIL` in the pipeline and the reason is
  editorial, not technical: comparisons flatten personality into a spec
  sheet and the reference video shows zero of that shape.
- A news anchor. No "Você sabia?", no "Hoje vamos falar sobre…", no
  "Isso está sendo discutido…". `GENERIC_HOOK = HARD FAIL`.
- A slideshow with music. A Ken-Burns pan over a stock photo is not motion.
  A crossfade between two photos of the same dashboard is not a cut.
- A mascot-driven Reel. The mascot never occupies frame center during the
  Reel and never exceeds 1.35× base size. Center is for the content.
- A carousel of raw facts. A Reel that reads like an infographic has no
  personality and no reason to be watched twice.

---

## REFERENCE CHARACTERISTICS (measured, not guessed)

Reference video: 65.8s, 60fps, portrait (1290×2796 iPhone screen recording
of a published Reel). Measured with `ffmpeg select=gt(scene,0.25)` and
manual keyframe inspection.

| Metric | Reference | Latest MAIS CAR pilot | Δ |
|---|---:|---:|---|
| Duration | 65.8s | 27.1s | shorter is fine for the format we ship, but the reference sustains attention for 2× the time |
| fps (source) | 60 | 30 | not a quality gap on IG delivery — same 30fps after IG re-encode |
| Real scene cuts (@0.25) | 15 | 7 | reference changes SUBJECT ~every 4.4s; pilot changes subject ~every 3.9s but the cuts are *between clips from the same B-roll library shot in the same palette* — perceptually the pilot feels flatter |
| Cuts @0.4 (big jumps) | 12 | 3 | this is the real gap: the reference has 12 dramatic visual reframings; the pilot has 3 |

The reference's cuts alternate between at least four distinct visual
registers: presenter's face (real person, real room), phone screenshot of
a real page/app, product close-up, and quick B-roll from a different
location. That variety is what makes it feel alive. The pilot's cuts stay
inside one register (stock automotive B-roll on off-white background)
almost the whole way through.

**Grammar to imitate (not identity, not voice, not character):**

1. **Register-switching cuts.** Every 3–5s, jump to a *different kind of
   image*, not the next clip from the same library. Presenter → screenshot
   → product macro → paperwork → dashboard → back to presenter is one
   register cycle.
2. **Screenshot / document / receipt / spreadsheet as B-roll.** The
   reference uses a phone-screen capture of a real page as a shot type.
   MAIS CAR currently has zero of these. Adding a category
   `SCREEN_EVIDENCE` (fake but plausible — invoice, financing simulator
   result, WhatsApp conversation, listing page) is the single biggest
   register-diversity gain available in-code.
3. **First 0.0–0.5s: face + accusation on-screen text.** The reference
   opens on the presenter's face with big centered text stating the
   conflict — no build-up, no fade-in, no logo. The current pipeline opens
   on B-roll with a mascot-corner reaction; move the accusation to frame 1
   and the B-roll to frame 2.
4. **Punchy pauses in narration.** The reference's presenter *stops*
   speaking briefly after each punchline so the viewer registers it. The
   current TTS runs continuously at 180+ WPM with no pause discipline. Add
   a 200–400ms silence after any beat tagged `PUNCHLINE`, `HOOK`, or
   `REVEAL`.
5. **On-screen text is short, punchy, matched to the exact word.** 2–4
   word bursts, appearing on the accented syllable, disappearing before
   the next phrase starts. Currently KineticText plays as decoration; make
   it a beat-tied punctuation.
6. **Zero mascot in the first 1.5 seconds.** Reference has the presenter
   himself; a mascot in the corner during the hook signals "explainer
   video", which is exactly the frame we're trying to break.

---

## EDITORIAL IDENTITY

**Prime editorial question**: *"What mistake, belief, or decision could
make this person lose money or regret a purchase?"*

**Allowed topic types** (in radar/scoring priority order):
- BUYER_PAIN (owner mistake)
- MONEY_LOSS (financing / depreciation / bad trade-in)
- USED_CAR_TRAP (odometer, structural damage, dealer history)
- OWNER_NEGLIGENCE (maintenance ignored → catastrophic bill)
- DEALER_TRICK (test-drive refusal, pressure tactic, hidden fee)
- BAD_PURCHASE (wrong car for the use case)
- MAINTENANCE (specific service the audience skips)
- FINANCING (parcela vs. desconto à vista, taxa nominal vs. CET)
- MYTH (widely believed automotive myth debunked)
- HIDDEN_DAMAGE (what a real inspection reveals that a test drive doesn't)
- UNPOPULAR_OPINION (a defensible take that will earn contested comments)

**Forbidden as *primary* frame**:
- Model A vs Model B (`COMPARISON_FORMAT = HARD FAIL`)
- Spec-sheet reading (torque, HP, ranking)
- News summary (repeating something the outlet already said)
- Pure product tour (no thesis, no risk to the viewer)

MAIS CAR the service (inspeção veicular, cautelar, avaliação) is mentioned
ONLY when the topic naturally leads there (compra de usado, defeito
escondido, histórico, estrutura). `FORCED_SERVICE_MENTION = HARD FAIL`.

---

## VOICE

**Register**: Brazilian Portuguese, coloquial, fast, ironic, confident,
sometimes indignant. A friend who knows the topic, not a broadcaster.

**WPM**: 180–210 measured on the final MP4 (`voiceWpm` in the QA record).

**Pause discipline**: 200–400ms silence after every beat tagged
`HOOK`/`PUNCHLINE`/`REVEAL`; ≤200ms otherwise. No pause longer than
600ms anywhere.

**Slang (natural, not forced)**: pra caramba, pra cacete, meu amigo, olha
que loucura, se lascou, se fodeu, dá pra acreditar, tá de sacanagem,
ficou fudido, comprou gato por lebre, sacou.

**Profanity budget (`PROFANITY_MODE = SPARSE_CONTEXTUAL`)**: 1–2
occurrences per Reel, from `{porra, caralho, cacete, merda, fudido, se
lascou}`, allowed ONLY at hook / punchline / reaction — never as filler,
never as insult to a group or personal characteristic. Enforced in code
by `capProfanity`; if the final count is 0 and the topic supports it (any
BUYER_PAIN / MONEY_LOSS / DEALER_TRICK), the QA gate flags it for
manual review before publishing.

**Humor beat**: `HUMOR_BEAT = REQUIRED` (at least one). Types allowed:
irony, absurd comparison, sarcasm, exasperated aside, avatar reaction
punchline. Never stand-up, never long joke setups.

---

## AVATAR ROLE

The avatar (`TalkingHost.tsx`, code-drawn SVG, `AVATAR_IDENTITY_LOCK`
permanent — same face, hair, glasses, beard, outfit in every pose) is a
**reaction** character.

**Legal positions during the Reel**: `BOTTOM_LEFT`, `BOTTOM_RIGHT`,
`TOP_LEFT`, `TOP_RIGHT`. **`CENTER_AVATAR_FRAMES = 0` is a hard gate.**
Any beat that emits `CENTER`, `FOREGROUND_LEFT`, or `FOREGROUND_RIGHT`
is coerced to `BOTTOM_RIGHT` at render (defensive, 2026-09-15 patch).

**Size ceiling**: base size × 1.35 max (~28% of frame height). No
pattern-interrupt beat may exceed this — a bigger visual event uses new
B-roll, a big number, a screenshot, or kinetic text, never a bigger
mascot.

**When the avatar appears**: reaction shots to a claim (facepalm on
"paguei 20 mil a mais", `INDIGNADO` on a dealer trick, `DESCONFIADO` when
introducing a myth, `APONTANDO` toward on-screen text). Aim for the
avatar being present in 40–60% of beats (`mascotBeatRatio`), never
100%.

**When the avatar does NOT appear**: the first 1.5 seconds of the Reel,
any beat whose center-screen content is itself the visual proof (a big
number, a screenshot, a receipt, a real close-up of a car part). Adding
the avatar to those beats *demotes* the evidence.

**On the cover only**: the avatar can be large and dominant. That is the
only place a 40–50% avatar is allowed.

---

## VISUAL LANGUAGE

**Registers we cycle through** (target: touch at least 4 of these per
Reel):
- `PRESENTER_FACE` — the mascot as head-and-shoulders reaction (corner)
- `SCREEN_EVIDENCE` — screenshot of a page/app/listing (new register,
  not currently produced — add)
- `PRODUCT_MACRO` — close-up of a car part, tire, dashboard, key
- `DOCUMENT` — contract, receipt, sticker, VIN plate
- `LOCATION_BROLL` — mechanic bay, dealership floor, road, gas station
- `BIG_NUMBER` — full-frame kinetic number (R$ figure, percentage,
  months, years)
- `MONEY_STACK` — cash, cards, calculator, PIX screen

A Reel that stays inside 1–2 registers reads as slideshow (the current
pilot failure mode).

**Motion vocabulary**:
- CUT (instantaneous change of register) — the primary rhythmic element.
  Target: 6–10 cuts on a 25s Reel, 10–14 on a 40s Reel.
- SLIDE-IN of kinetic text on the accented word (250–350ms in, hold
  400–800ms, out 150ms).
- STATIC HOLD (locked frame, no zoom) between 300ms and 1000ms — allowed,
  not eliminated. A locked frame with the right image at the right moment
  is more powerful than a Ken-Burns pan. `LONGEST_STATIC ≤ 2.0s` — but
  a locked frame ≤2s is not a failure; it is a rhythmic beat.
- KEN-BURNS pan/zoom is the *last* option, not the default. If the B-roll
  is a photograph rather than a video, Ken-Burns is acceptable but does
  not by itself count as a visual event; the beat still needs kinetic
  text or a mascot reaction to *feel* like a change.

**What does NOT count as a visual event** (for `VISUAL_EVENT_AVG ≤ 1.8s`
QA metric): Ken-Burns pan continuation, mascot blink, mascot idle bob,
music transition, on-screen text still on frame from a previous beat.

**What DOES count**: register change, kinetic text on/off, mascot pose
change, mascot enter/exit, big-number cut-in, freeze-frame, hard cut to a
new B-roll clip.

---

## HOOK RULES (0.0–3.0s)

The first three seconds are the whole game. The pipeline must treat this
as a separate produced asset with its own gates.

**0.0–0.5s** (frame 1 to frame 15 at 30fps):
- One on-screen text of 3–5 words stating the conflict or accusation.
- Voice already speaking (no cold silence, no music-only intro).
- Register: `PRESENTER_FACE` OR `SCREEN_EVIDENCE` — not stock B-roll.
- Mascot absent.

**0.5–1.5s**:
- Complete the hook sentence.
- Cut (real cut, not pan) to the register that names the stakes:
  `BIG_NUMBER`, `SCREEN_EVIDENCE`, or `PRODUCT_MACRO`.
- Mascot may enter in a corner as a reaction on the punch word.

**1.5–3.0s**:
- Deliver the promise ("por que isso é uma cilada / por que tu paga a
  mais / o que ninguém te falou").
- At least one register change inside this window.

**HARD FAILS on the hook**:
- Generic opener (`GENERIC_HOOK`, existing gate) — keep.
- No on-screen text in the first 15 frames (add).
- Mascot in center or dominating frame (existing gate, hardened
  2026-09-15).
- Cold silence >200ms before first word (add).
- Comparison shape ("A é melhor que B") anywhere in the hook (existing
  gate).

**Score gates for the hook alone** (separate from overall script score):
`HOOK_SCORE ≥ 88` (was 85 in earlier docs — raised because the current
pipeline routinely passes at 85 with weak hooks).

---

## COVER RULES

A cover is a separate product. It must work in the feed with the sound
off and the video not playing.

**Composition formula**:
- 40–50% of vertical space: mascot in strong expression
  (`MAO_NA_CABECA` / `FACEPALM` / `INDIGNADO` / `DESCONFIADO` /
  `APONTANDO`).
- 30–40%: the *object* of the Reel — a car (correct generation, real
  model when named), a stack of money, a screenshot, a receipt, a
  dashboard, a highlighted spec.
- 20–30%: 2–5 words of on-cover text. Never a title-case corporate
  headline. Always a spoken-voice sentence.

**On-cover text style** — human sentence, not editorial title:
- ✅ `TU TÁ COMPRANDO ERRADO`
- ✅ `NÃO COMPRA ASSIM`
- ✅ `BARATO SAIU CARO`
- ✅ `ESSA CONTA VAI DOER`
- ✅ `A CULPA É TUA`
- ✅ `PARO OU CARRO?` (only with real matching image)
- ❌ `PARCELA TE ENGANA / PRAZO` (reads as PowerPoint bullet list)
- ❌ `AVALIAÇÃO DE VEÍCULO` (product-catalog voice)
- ❌ Any two-line heading with a slash separator.

**Cover pipeline**:
1. Generate 3 internal variants: `SHOCK`, `CONFRONTATION`, `MONEY_PAIN`.
2. Score each on: (a) does the text read as a spoken sentence? (b) does
   the mascot expression *match* the text? (c) is the object clearly
   visible at Instagram thumbnail size?
3. Ship the top-scoring one. `WEAK_COVER = HARD FAIL` — if none clears
   the bar, hold for fix, do not publish.

**Never**: use the first frame of the video as the cover. The cover is
its own composition.

---

## FACT RULES

`SOURCE_VERIFIED_FACT_GATE` is permanent and unchanged.

Every claim carries a tier:
- `CONFIRMED_FACT` — a real URL exists AND its raw text contains the
  specific number (with unit) or the specific claim. Cached in
  `VERIFIED_FACT_CACHE`.
- `OFFICIAL_RECALL` — a real recall page from Denatran / manufacturer.
- `OWNER_REPORT` — a real Reddit / Reclame Aqui / forum thread URL. Never
  presented as a general fact; the caption and any on-screen tier label
  says "relato de dono".
- `EDITORIAL_OPINION` — MAIS CAR's own take. Always labeled.

Numbers without a real source URL are removed, not softened. A qualitative
statement in the voice of the narrator is acceptable; an invented number
is not.

---

## HARD FAILS (the QA gate treats these as `usedFallback = true` failures
that abort the publish step, not warnings)

- `COMPARISON_FORMAT` — script or hook reads as A vs B.
- `GENERIC_HOOK` — first line matches the banned-opener list.
- `CENTER_AVATAR_FRAMES > 0` — any beat renders the mascot in the center
  or the two foreground positions (renderer coerces defensively, but the
  gate still fails if the cycle emitted one).
- `AVATAR_COLLISIONS > 0` — mascot overlaps kinetic text or big-number
  layer.
- `AVATAR_SCALE > 1.35` — a beat's mascotScale exceeds the ceiling.
- `LONGEST_STATIC > 2.0s` — a single locked composition holds too long.
- `VISUAL_EVENT_AVG > 1.8s` — the Reel averages fewer events per second
  than the reference grammar.
- `REGISTER_VARIETY < 3` — the Reel touches fewer than 3 of the visual
  registers listed above. (New gate — needs implementation.)
- `HOOK_FIRST_WORD_LATENCY > 200ms` — voice does not begin within 200ms
  of frame 1. (New gate — needs implementation.)
- `WEAK_COVER` — no cover variant passes the cover scoring gate.
- `PROFANITY_MODE=SPARSE_CONTEXTUAL` violated — more than 2 profanities,
  or any profanity outside hook/punchline/reaction context.
- `FACT_GATE` — any surviving `UNVERIFIED` claim.
- `POWERPOINT_STYLE` — new heuristic (see brief §P0-4).
- `BROLL_RELEVANCE` — a beat ships with a `verified:false` clip AND
  vision was reachable during the run (i.e. rejection was semantic, not
  infrastructure).

On any hard fail: `autonomousReelCycle.ts` retries at most once with the
specific fix (regenerate the failing beat / re-search B-roll / re-score
covers), then abandons and leaves the artifacts on disk with the reason
recorded. Never publishes a partial pass.

---

## QUALITY GATES (soft — recorded in QA, not blocking, but tracked over
time for the learning loop)

- `HOOK_SCORE ≥ 88`
- `SCRIPT_SCORE ≥ 88`
- `TOPIC_SCORE ≥ 80` (or a grounded BUYER_PAIN_SEED)
- `VOICE_WPM ∈ [180, 210]`
- `MASCOT_BEAT_RATIO ∈ [0.40, 0.65]`
- `HUMOR_BEAT ≥ 1`
- `PROFANITY_COUNT ∈ [1, 2]` when topic supports it, `0` otherwise
- `REGISTER_COUNT ≥ 4`
- `SCREEN_EVIDENCE_PRESENT` (target: true; not yet enforced)

---

## THE ONE-LINE TEST

Before publishing any Reel, one human question decides:

> *"Would I stop scrolling for this — not because it's mine, but because
> the first second made me feel something?"*

If the answer is no, no gate score justifies shipping it.
