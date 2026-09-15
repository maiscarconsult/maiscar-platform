# MAISCAR_AUTONOMOUS_BUYER_PAIN_V2

Permanent master editorial + visual + performance standard for MAIS CAR
Reels, set 2026-09-13. **Supersedes**
`MAISCAR_AVATAR_NARRATED_REEL_MASTER.md` (kept for implementation history —
this file is the standing spec). Implemented in
`packages/backend/src/jobs/contentPipeline/narratedMotionReelV3Cycle.ts`.

## Mission

MAIS CAR is not a news portal, a spec-sheet magazine, a car comparator, or
a PowerPoint. It is **"the person who tells you the truth about buying and
owning a car, even when you don't want to hear it."** Priority order:
retention → comments → replay → shares → reach → saves.

## Rule #1 — comparison is forbidden by default

`COMPARISON_A_VS_B = FORBIDDEN_BY_DEFAULT` unless the account owner asks
for it explicitly. One strong thesis per Reel, never "Model A vs Model B"
or "which is better." Enforced in code: `isComparisonShapedTitle()` (title
stage, before a Haiku call is spent) + `looksLikeComparison()`
(narration-text stage, after generation) in `narratedMotionReelV3Cycle.ts`.

## The pauta must hurt

Before picking a topic, ask: *"Where can this person lose money, screw
up, fall into a trap, or find out they were wrong?"* If there's no real
money-pain / owner-identity / polarization / comment-trigger / curiosity /
utility angle, discard it. **The pauta is born from the loss/mistake, not
from the news** — news and complaints (Reddit, Reclame Aqui, forums,
recalls, manufacturers, workshops, specialists, used-car market) exist to
find and back up the thesis, not to define it.

**Implementation note (be honest about current state)**: the radar today
pulls from `controversyRadar`/`evergreenRadar` (automotive news +
controversy scoring) — there is no live Reddit/Reclame Aqui/forum scraper
wired up yet. Until built, `BUYER_PAIN_SEEDS` (below) is the actual
mechanism producing on-thesis pautas when the radar comes up short, which
given the news-radar's real-world scores (topping out around 40-50) is
most of the time.

## 50 buyer-pain seed theses

Creative seeds (not a checklist to recycle forever — generate new theses
in this spirit). Never publish a specific factual claim from one of these
without running it through `SOURCE_VERIFIED_FACT_GATE` first.

1. Tu acha que economizou comprando carro de locadora? Calma.
2. Se tu negocia parcela, a loja já começou ganhando.
3. Km baixa sozinha não prova porra nenhuma.
4. Carro muito barato normalmente tem uma história.
5. Se o vendedor já deixou o motor quente, presta atenção.
6. Carro frio entrega coisa que carro quente esconde.
7. Se não deixam levar no mecânico, eu ia embora.
8. Tu olha a pintura e esquece de olhar a estrutura.
9. Carro bonito também esconde merda.
10. 50 mil km mal cuidados podem ser piores que 150 mil bem cuidados.
11. O dono economizou em pneu. Onde mais ele economizou?
12. Tu compra parcela e esquece que o carro tem preço.
13. Entrada baixa pode ser só uma forma bonita de tu pagar mais.
14. Financiar acessório é pagar juro em tapete.
15. A loja adora quando tu diz quanto consegue pagar por mês.
16. Chegar na loja desesperado pra sair de carro é pedir pra pagar caro.
17. Pressa é uma das coisas mais caras na compra de um carro.
18. Se apaixonar pelo carro antes de negociar é dar vantagem pro vendedor.
19. Desconto grande no zero-km pode ter motivo.
20. Zero-km não é automaticamente a compra mais inteligente.
21. Carro de leilão não é sempre ruim. Comprar sem saber é que é burrice.
22. Carro batido não é automaticamente lixo. Mas tu precisa saber onde bateu.
23. Retoque de pintura não é o problema. O problema é o que estão escondendo.
24. Pintura bonita não conserta longarina.
25. Scanner na compra de usado não é frescura.
26. Luz apagada no painel não significa que o problema sumiu.
27. Apagar falha antes da venda não conserta porra nenhuma.
28. Histórico vale mais que muita conversa bonita.
29. Sem histórico? Tu tá comprando no escuro.
30. Manual carimbado pode valer mais que baixa quilometragem.
31. Tu não faz preventiva e depois chama o carro de bomba.
32. Economizar no óleo pode ser uma economia filha da puta de cara.
33. Óleo errado pode transformar R$ 100 de economia em uma puta conta.
34. Barulho pequeno hoje pode ser conta grande amanhã.
35. Garantia estendida não é automaticamente um bom negócio.
36. Avaliação alta no teu usado não significa que a negociação foi boa.
37. Troca com troco pode ser boa até tu fazer a conta direito.
38. O carro que tu consegue comprar pode ser o carro que tu não consegue manter.
39. SUV alto não vira tanque de guerra só por ser SUV.
40. "Carro de médico" não é laudo cautelar.
41. "Era carro de mulher" não prova absolutamente nada.
42. "Era só pra ir ao mercado" também não é histórico.
43. Carro de garagem também envelhece.
44. Tu pode estar pagando caro por um carro só porque ele tem fama boa.
45. Carro que todo mundo recomenda também pode ser uma compra ruim pra tu.
46. Má fama nem sempre significa carro ruim.
47. Às vezes a bomba não é o carro. É o dono anterior.
48. Tu não compra só o carro. Tu compra tudo que o antigo dono fez com ele.
49. A pior economia é a que tu descobre na oficina.
50. Barato não é bom negócio. Bom negócio é saber o que tu tá comprando.

`BUYER_PAIN_SEEDS` in code currently implements a working subset of these
as full hand-written 5-beat scripts (hook/qualificação/risco/o-que-
verificar/punchline + keywords + video queries + mascot poses),
deliberately hand-crafted rather than left to Haiku, so `GENERIC_HOOK` and
`COMPARISON` can never slip through on the guaranteed-fallback path. Not
all 50 have a seed script yet — more get added as they're written, never
generated fresh by an LLM for this specific safety-critical fallback path
(only the radar+Haiku organic path uses live generation, gated by the
same checks below).

## Scoring — hard gate at 80

Score candidates on `MONEY_PAIN`, `OWNER_IDENTITY`, `POLARIZATION`,
`COMMENT_TRIGGER`, `CURIOSITY`, `UTILITY`, `SHAREABILITY`,
`PERSONAL_RELEVANCE`. `MIN_ENGAGEMENT_SCORE_HARD = 80` — a topic scoring
below that (e.g. the news radar's real ceiling of ~44-56 on a given day)
never proceeds to script/render; the pipeline falls back to
`BUYER_PAIN_SEEDS` and grounds it with a real source search instead of
shipping something weak just because it was the only result.

## Hook

`GENERIC_HOOK = HARD FAIL`. Banned: "Olha só.", "Isso está sendo
discutido.", "Você sabia?", "Hoje vamos falar…", "Neste vídeo…" (regex-
enforced via `GENERIC_HOOK_PATTERNS`, checked against every script's first
beat — any match escalates to a `BUYER_PAIN_SEEDS` script, on both the
radar+Haiku path and every internal fallback path). Wants a SOCÃO:
affirmative, consequence-first, never a question.

## Voice

`ONE_VOICE_ONLY = TRUE`, one TTS call, `pt-BR-AntonioNeural`. Brazilian,
fast, colloquial, sarcastic, confident, natural, funny, indignant when it
fits — cadence/energy/irony/rhythm/informality of the reference video,
never its literal vocal identity. Reads as "someone who knows cars as
hell explaining the truth to a friend."

## Profanity

`PROFANITY_MODE = SPARSE_IMPACT`. Allowed when natural: porra, merda,
caralho, cacete, fudido, se lascou, pra cacete. 0-2 per short Reel, only
for emphasis/humor/indignation/punchline — never replacing an argument.

## Avatar / host

Fixed visual host. **Search first** any legitimately-accessible photo/
video of the account owner (connected account media, project uploads,
cache, previously supplied references) before ever asking. If found,
extract references and build a cartoon avatar inspired by them. If not
found, **never invent the owner's appearance** — keep using the existing
code-drawn host and set `PERSONAL_AVATAR_PENDING = TRUE`, without blocking
production.

**Current real state**: searched the connected @mais.car Instagram media
(25 most recent items) and the project's asset folder — no photo/video of
the account owner exists in either. `PERSONAL_AVATAR_PENDING = TRUE`.
Production continues with the existing code-drawn `Mascot.tsx` character
until a real reference photo is supplied directly in chat.

`MAISCAR_HOST_AVATAR_MASTER`: same face/hair/outfit/colors/style forever
once locked. Pack: NORMAL, FALANDO, EXPLICANDO, APONTANDO, SURPRESO,
DESCONFIADO, INDIGNADO, IRONICO, RINDO, FACEPALM, MAO_NA_CABECA, PENSANDO,
SUSSURRANDO, DINHEIRO_DOENDO, POSITIVO, NEGATIVO (`remotion/Mascot.tsx`
`MascotPose` — already a superset of this list).

`SMALL_STATIC_ICON = HARD FAIL`: the host must point, look, react, enter,
exit, change expression, emphasize, explain — present in ~35-60% of beats
(enforced/measured as `mascotBeatRatio`/`hostSizeAvgPct` in the pipeline's
QA dict), occupying 40-55% of frame height on reaction beats.

## Cover

Separate performance asset, never the first video frame. Formula:
expressive avatar + car/object + 2-5 words. Expression maps to thesis
type: money loss → mão na cabeça, owner negligence → facepalm, dealer
trick → desconfiado, secret/tip → sussurrando, problem → surpreso,
unpopular opinion → indignado/apontando — varied, not the same pose every
time (`buildBuyerPainSeedScript` picks per-seed; the radar+Haiku path
picks from the script's own `mascotPose`s).

**Implementation note**: the described A/B/C cover-variant generation +
auto-scoring loop (`COVER_A = SHOCK` / `COVER_B = CONFRONTATION` /
`COVER_C = CURIOSITY`, picked by `STOP_SCROLL`/`READABILITY`/etc., 0 extra
LLM) is **not built yet** — today one cover is composited per Reel (hero
template + avatar, see `MAISCAR_AVATAR_NARRATED_REEL_MASTER.md`). Flagged
honestly as a real gap, not silently skipped.

## Script length

15-30s standard. Exceptionally 30-60s only for content that truly
*teaches* (negotiation, checklist, scam patterns, technique, inspection,
used-car buying, a genuinely complex mechanism) — more duration only for
more value, never more rambling.

## Narrative structure

```
0.0-1.5s   SOCÃO
1.5-5s     why this matters
5-12s      proof
12-20s     consequence
20-28s     solution / verdict
```

Ends on a contestable/memorable line, never "comenta aí" — disagreement
itself should make someone comment.

## Educational format (for técnica/dica content)

`ERRO → POR QUE TU SE LASCA → O QUE FAZER → EXEMPLO → RESULTADO`. The
viewer should finish thinking "caralho, isso eu vou usar."

## Motion

Unchanged engine: Remotion (timeline/motion/composition) + ffmpeg
(encode/audio/mix/export). Real B-roll, kinetic text, host, arrows,
highlights, useful zooms, cuts, SFX, music.
`STATIC_VISUAL_MAX_1_8S`, `PATTERN_INTERRUPT_INTERVAL_SEC = 5` (within the
4-6s band) — both already enforced.

## Fact-check

`SOURCE_VERIFIED_FACT_GATE = REQUIRED`. Provocation can be aggressive;
facts cannot be loose. Haiku never unilaterally decides `CONFIRMED_FACT`.
An owner report / Reddit / Reclame Aqui signal is `OWNER_REPORT`, not
automatically fact. A number with no real source gets removed, not kept.

## Performance memory (learning loop)

**Not built yet** (flagged honestly): reading Instagram Insights at 1h/
6h/24h/72h post-publish and feeding which themes/hooks/profanity/covers/
poses/durations/conflicts/phrases raised watch time/reach/comments/
shares/saves back into topic/hook selection. Today's "performance loop"
is the qualitative one from `MAISCAR_AVATAR_NARRATED_REEL_MASTER.md`
(treat each new Reel as an iteration on the last, mechanically enforced
via the hard gates below) — not yet a quantitative Insights-driven one.

## Autonomy

On "faça um Reel": don't ask which topic/hook/avatar/cover/music/
duration, or whether to research — decide within this master
automatically. Only interrupt for: payment required, a new sensitive
credential, a legal/license block, a destructive action, or a real
technical block (e.g., a render crash, a missing dependency, an API
rejecting a required parameter).

## Low token mode

`CACHE → CODE → SEARCH → HAIKU → VISION → SONNET`. No LLM for motion,
render, music, cover scoring, SFX, upload, or metrics.

## MAISCAR_SERVICE_MENTION_RULE (added 2026-09-13)

Whenever the topic genuinely relates to buying/inspecting a car — pre-
purchase evaluation, inspection, vistoria, laudo cautelar, buying used,
cosmetically-fixed car, hidden defect, maintenance history, scanner,
structure, signs of a crash, suspicious odometer, rental-car resale,
auction, "is it worth buying?", risk of loss on a purchase —
`MAISCAR_SERVICE_MENTION = REQUIRED`; for everything else it's optional.
The mention must be earned: **teach first → show the risk → connect to
the evaluation**, inside the reasoning of the proof/explanation beat,
never a bare tacked-on line ("contrate a avaliação MAIS CAR" alone is
banned). Varies phrasing across Reels — never the same sentence twice.
Never invent a capability, certification, guarantee, procedure, coverage,
or a promise to catch 100% of problems — only claim the evaluation checks
an item that's actually part of it. A relevant Reel's close may add one
short natural line ("Antes de comprar, avalia o carro de verdade.") —
never a long commercial CTA.

**Implementation**: `isServiceMentionRelevant()` (keyword match on the
topic title) gates a conditional instruction block in the Haiku prompt
(`writeShortScript`) for the organic radar path; for the guaranteed-
quality `BUYER_PAIN_SEEDS` fallback path, each relevant seed carries a
hand-written `serviceMention` string appended into its `O_QUE_VERIFICAR`
beat (`buildBuyerPainSeedScript`) — 10 of 15 seeds currently have one
(the ones genuinely about inspecting/evaluating a used car; financing-
psychology and trade-in-math seeds correctly have none).

## MAISCAR_FLUID_VOICE_RULE (added 2026-09-13)

Script must read as **spoken**, not written: short connected sentences,
no article/listicle structure ("Verifique X. Verifique Y. Verifique Z."
is banned outright — `NO_ARTICLE_STYLE_SCRIPT`), real spoken connectors
("aí é que tá", "só que tem um detalhe", "e é aqui que começa o
problema", "agora presta atenção", "pois é", "meu amigo", "não é por
nada, mas…", "e o pior é que…", "só que muita gente esquece disso", "e aí
vem a conta") — pick 2-3 per Reel, never all of them. A profanity word
must sit inside a fluid sentence, never staccato/capitalized-for-emphasis
("E aí, porra, não adianta culpar o carro depois." — never "PORRA. O
CARRO. ESTÁ. ERRADO.").

Targets (already enforced in code, not new):
`ONE_VOICE_ONLY = TRUE` (single `pt-BR-AntonioNeural` TTS call, never
swapped), `VOICE_WPM_185_200` (via `MAISCAR_VOICE_LOCK.rate`, tuned
empirically — see `ttsProvider.ts`), `NORMAL_PAUSE_MAX_350MS` (via
`MAX_NORMAL_PAUSE_SEC = 0.33` + deterministic `normalizeSilences()` post-
processing, 0 LLM). If a script runs long, the fix is **cutting text**
(the existing word-budget truncation), never speeding up the voice.

**Implementation note — be honest about what's NOT built**: per-section
prosody variation (hook hits harder, alert sounds tense, punchline lands
marked, close sounds confident — all *without* switching voice) is a
real ask this doesn't do yet. Today's synthesis is one flat `rate`/`pitch`
for the entire narration; there's no SSML-per-sentence emphasis or
multi-segment prosody blending wired up. Flagged as a genuine gap rather
than claimed as done — building it safely (without risking the "one
continuous voice" guarantee by literally calling the API multiple times)
needs its own pass.

## Hard gates (all must pass before shipping)

`ENGAGEMENT_SCORE >= 80`, `GENERIC_HOOK = FALSE`, `NO_COMPARISON = PASS`,
`ONE_VOICE = PASS`, `HOST_ACTIVE = PASS`, `REAL_BROLL = PASS`,
`FACT_GATE = PASS`, `POWERPOINT_STYLE = FALSE`.
`COVER_STOP_SCROLL = PASS` is asserted qualitatively today (cover always
includes the reacting avatar + short affirmative headline) since the
A/B/C auto-scoring loop isn't built — see the Cover section's
implementation note.
