/**
 * FULL_AUTONOMOUS_MOTION_REEL cycle (2026-09-10) — the permanent pipeline:
 * RADAR -> SCORING -> FACT CHECK -> HOOK -> ROTEIRO -> ASSET SOURCING ->
 * MOTION -> ÁUDIO -> QA -> (GRAPH API only if autoPublish) -> INSIGHTS.
 *
 * Token discipline: LOCAL CODE > CACHE > SEARCH > HAIKU > SONNET. Exactly
 * ONE generateText call (Haiku tier, quality:"draft") turns the top-scored
 * real signal into a structured script. Vision only fires inside
 * sourcePhoto() when a candidate isn't already cache-approved. Render,
 * audio selection, publish, and insights are all 0-LLM.
 *
 * AUTO_PUBLISH is gated by autopublishConfig.ts, which only the account
 * owner can flip (enable-autopublish.ps1 / disable-autopublish.ps1) — this
 * function itself never decides to publish unattended; the caller passes
 * `autoPublish` explicitly (daily-cycle-and-publish.ts reads the flag file;
 * a one-off authorized run in a live session can pass true directly).
 */
import fs from "node:fs";
import path from "node:path";
import { getControversyCandidates } from "./controversyRadar";
import { scoreControversy, MIN_ENGAGEMENT_POTENTIAL } from "./controversyScoring";
import { getRecentReels, isTooSimilar } from "./antiRepetition";
import { TieredClaim, FactTier } from "./factCheckTiers";
import { verifyClaims, passesSourceVerifiedFactGate } from "./sourceVerifiedFactGate";
import { sourcePhoto, downloadPhoto } from "./photoSourcing";
import { renderHero, HeroInput } from "../../modules/content/diagonalTemplateV4";
import { renderReel } from "./reelRenderer";
import { selectTrack, resolveTrackPath, recordUsage } from "./localAudioLibrary";
import { checkNoDuplicates, perceptualHash } from "./duplicatePhotoGate";
import { publishReelToInstagram } from "../../modules/social-accounts/meta-oauth";
import { uploadForPublicAccess } from "./publicTunnel";
import { aiOrchestrator } from "../../modules/ai-orchestrator/orchestrator";
import { prisma } from "../../lib/prisma";
import { decrypt } from "../../lib/crypto";
import { logger } from "../../lib/logger";

const ORG_ID = "e20b49b4-2835-4e90-bb41-95b1aab11007";
const BRAND_ID = "09dc8dec-34e9-4588-97d9-031b820c8a64";
const GENERATED_DIR = path.join(__dirname, "..", "..", "..", "generated");
const TMP_DIR = path.join(__dirname, "..", "..", "..", ".cache", "sourced-photos");

// Reusable contextual "stock scene" library — every debate Reel about a car
// controversy needs the same handful of documentary beats (oficina, motor,
// concessionária, decisão). Sourced once, gated, cached — 0 Vision on reuse.
const CONTEXTUAL_SCENES = [
  { kicker: "O CONFLITO", topic: "car on lift service bay garage", contentMatch: "a real, modern after-sales/service context — a car on a lift or in a service bay, involving a current-model everyday car — NOT a vintage/classic/antique car" },
  { kicker: "A PROVA", topic: "mechanic tools engine bay close up", contentMatch: "car maintenance/repair in progress — a mechanic, tools, an open engine bay being serviced, no wrong/conflicting vehicle brand dominating the frame" },
  { kicker: "O CONTRAPONTO", topic: "car dealership negotiation contract", contentMatch: "a car purchase/negotiation moment — handshake, contract, dealership setting — no foreign currency, no wrong vehicle brand dominating the frame" },
] as const;
const VERDICT_SCENE = { kicker: "VEREDITO MAIS CAR", topic: "open road driving sunset", contentMatch: "a car on an open road, ideally at sunset/golden hour, conveying a personal choice/decision moment — no specific identifiable make/model dominating the frame" };
// Generic hook fallback (used only when the topic has no single namedVehicle,
// e.g. a two-car comparison or a market-wide trend) — must stay distinct
// from every CONTEXTUAL_SCENES/VERDICT_SCENE topic or the dedup gate fires.
const GENERIC_HOOK_SCENE = { topic: "modern car dashboard gauge close up", contentMatch: "a real car actively conveying speed/acceleration/dynamic performance or a modern dashboard/instrument cluster — no specific identifiable make/model dominating the frame" };

interface Script {
  namedVehicle: string | null;
  hook: string[]; // 2 short headline lines, assertive statement
  hookComplement: string;
  conflict: string;
  claims: { text: string; tier: FactTier; complement: string; headline: string[] }[];
  counterpointComplement: string;
  counterpointHeadline: string[];
  verdictComplement: string;
  verdictHeadline: string[];
  captionLong: string;
}

async function writeScript(candidateTitle: string, sourceUrl: string): Promise<Script> {
  const system =
    "Você é o editor-chefe da MAIS CAR. Escreve roteiros de Reels automotivos com afirmações fortes mas defensáveis — nunca inventa defeito, recall, custo ou culpa de fabricante. " +
    "Toda alegação forte que não seja opinião precisa vir de um relato/fonte real (marque como OWNER_REPORT, OFFICIAL_RECALL ou CONFIRMED_FACT); o veredito final é sempre EDITORIAL_OPINION, nunca apresentado como fato.";
  const prompt = `Tema real levantado pelo radar: "${candidateTitle}" (fonte: ${sourceUrl})

Escreva um roteiro de Reel MAIS CAR em JSON estrito, neste formato:
{
  "namedVehicle": "nome de UM ÚNICO modelo real (ex: 'Chevrolet Onix'), null se o tema for genérico OU se envolver comparação entre dois carros — NUNCA escreva os dois nomes juntos (nunca 'X vs Y', 'X ou Y', 'X x Y')",
  "hook": ["LINHA 1 CURTA", "LINHA 2 CURTA"],
  "hookComplement": "frase curta de apoio, max 30 caracteres",
  "conflict": "1-2 frases explicando por que existe polêmica",
  "claims": [
    {"text": "afirmação factual 1", "tier": "OWNER_REPORT|OFFICIAL_RECALL|CONFIRMED_FACT", "headline": ["LINHA 1", "LINHA 2"], "complement": "frase curta, max 30 caracteres"},
    {"text": "afirmação factual 2", "tier": "OWNER_REPORT|OFFICIAL_RECALL|CONFIRMED_FACT", "headline": ["LINHA 1", "LINHA 2"], "complement": "frase curta, max 30 caracteres"}
  ],
  "counterpointHeadline": ["LINHA 1", "LINHA 2"],
  "counterpointComplement": "frase curta, max 30 caracteres",
  "verdictHeadline": ["LINHA 1", "LINHA 2"],
  "verdictComplement": "frase curta, max 30 caracteres (pode incluir uma pergunta de confronto)",
  "captionLong": "legenda completa pro Instagram, com HOOK, CONFLITO, PROVAS, CONTRAPONTO e uma seção final marcada literalmente como 'OPINIÃO MAIS CAR (não é fato, é leitura editorial):' antes do veredito"
}

Regras de tamanho: cada linha de headline tem no máximo 18 caracteres. Cada "complement" tem no máximo 30 caracteres. Headlines em CAIXA ALTA. Responda SOMENTE o JSON.`;

  // maxTokens bumped 2026-09-10 — 1200 truncated the JSON mid-array on the
  // first real run (captionLong pushes the full response past that budget).
  // model explicit here: routing "anthropic" alone defaults to Sonnet in
  // anthropicProvider.ts — HAIKU_PRIMARY means this call must ask for Haiku
  // by name, not rely on quality:"draft" implying it.
  const { text } = await aiOrchestrator.generateText(
    { prompt, system, maxTokens: 2200, model: "claude-haiku-4-5-20251001" },
    { organizationId: ORG_ID, quality: "draft", purpose: "debate-reel-script" },
  );
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("SCRIPT_GENERATION_NO_JSON");
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(`SCRIPT_GENERATION_MALFORMED_JSON: ${(err as Error).message}`);
  }
}

/**
 * DETERMINISTIC_FALLBACK (2026-09-10) — 0 LLM. If writeScript() fails
 * outright (every text provider down), the cycle doesn't just abandon: it
 * builds a plain, honest, template-based script directly from the real
 * radar signal. Weaker copy than an LLM would write, but never fabricated —
 * every claim it produces is tagged OWNER_REPORT sourced straight at the
 * candidate's own title/URL, and the verdict is a genuinely neutral
 * editorial line, not a fabricated strong take.
 */
function buildDeterministicScript(candidateTitle: string, sourceUrl: string): Script {
  const shortTitle = candidateTitle.length > 34 ? candidateTitle.slice(0, 31) + "..." : candidateTitle;
  return {
    namedVehicle: null,
    hook: ["ISSO ESTÁ SENDO", "DISCUTIDO AGORA"],
    hookComplement: shortTitle.slice(0, 30),
    conflict: `Donos e compradores estão discutindo: ${candidateTitle}.`,
    claims: [
      { text: candidateTitle, tier: "OWNER_REPORT", headline: ["RELATO REAL", "DE PROPRIETÁRIOS"], complement: "Fonte: radar de discussão pública" },
    ],
    counterpointComplement: "Cada caso tem seu contexto",
    counterpointHeadline: ["NEM TODO MUNDO", "TEM A MESMA EXPERIÊNCIA"],
    verdictComplement: "Você já passou por isso?",
    verdictHeadline: ["VALE PESQUISAR", "ANTES DE DECIDIR"],
    captionLong: `${candidateTitle}\n\nEsse assunto está gerando discussão real entre donos e compradores (fonte: ${sourceUrl}).\n\nOPINIÃO MAIS CAR (não é fato, é leitura editorial): antes de qualquer decisão de compra, vale pesquisar relatos reais de quem já tem o carro — nem toda experiência é igual.\n\nVocê já passou por isso?`,
  };
}

export interface DebateReelCycleResult {
  status: "PUBLISHED" | "PREPARED_AWAITING_PUBLISH" | "ABANDONED";
  reason?: string;
  contentId?: string;
  mediaId?: string;
  permalink?: string;
}

export async function runDebateReelCycle(opts: { autoPublish: boolean }): Promise<DebateReelCycleResult> {
  // RADAR + SCORING — 0 LLM
  const candidates = await getControversyCandidates();
  const recentReels = await getRecentReels(BRAND_ID);
  const scored = candidates
    .filter((c) => !isTooSimilar(c.title, recentReels))
    .map((c) => ({ candidate: c, score: scoreControversy(c) }))
    .sort((a, b) => b.score.total - a.score.total);

  if (scored.length === 0) {
    return { status: "ABANDONED", reason: "NO_CANDIDATES_AFTER_ANTI_REPETITION_FILTER" };
  }
  const best = scored[0];
  if (best.score.total < MIN_ENGAGEMENT_POTENTIAL) {
    logger.warn({ title: best.candidate.title, score: best.score.total }, "top controversy candidate below MIN_ENGAGEMENT_POTENTIAL, proceeding anyway (no stronger fallback source wired yet)");
  }

  // HOOK + ROTEIRO — exactly 1 Haiku call, with a 0-LLM deterministic
  // fallback if every text provider is unavailable (real outage, not a
  // reason to abandon a perfectly good real signal).
  const sourceUrlForScript = best.candidate.sourceUrl ?? `radar-signal:${best.candidate.title}`;
  let script: Script;
  try {
    script = await writeScript(best.candidate.title, sourceUrlForScript);
  } catch (err) {
    logger.warn({ err, title: best.candidate.title }, "LLM script generation failed, using DETERMINISTIC_FALLBACK template");
    script = buildDeterministicScript(best.candidate.title, sourceUrlForScript);
  }

  // DEFENSIVE NORMALIZATION (2026-09-10): the model occasionally names a
  // two-car comparison as a single compound "namedVehicle" (e.g. "X vs Y"),
  // which can never resolve as EXACT_VEHICLE and would abandon a perfectly
  // good real topic. Treat that shape as "no single named vehicle" instead
  // of trying (and failing) to source a photo of a car that doesn't exist.
  if (script.namedVehicle && /\b(vs\.?|ou|x|\/)\b/i.test(script.namedVehicle)) {
    logger.warn({ namedVehicle: script.namedVehicle }, "namedVehicle looked like a two-car comparison, treating as generic instead of EXACT_VEHICLE");
    script.namedVehicle = null;
  }

  // SOURCE_VERIFIED_FACT_GATE (2026-09-10) — every claim is re-derived from
  // the radar's real sourceUrl, never trusted from the script-writer's own
  // tag. CONFIRMED_FACT is only kept if the source page's text actually
  // contains the claim's numbers; Reddit/Reclame Aqui sources are forced to
  // OWNER_REPORT no matter what tier was requested.
  const rawClaims: TieredClaim[] = script.claims.map((c) => ({ text: c.text, tier: c.tier, sourceUrl: sourceUrlForScript }));
  let verifiedClaims = await verifyClaims(rawClaims);

  // REMOVE/REFORMULATE: an UNVERIFIED claim never gets published dressed as
  // evidence — it's dropped. If nothing survives, fall back to the
  // deterministic template, whose only claim is an honestly-tagged
  // OWNER_REPORT pointing at the same real source.
  let keepIdx = verifiedClaims.map((c, i) => (c.tier === "UNVERIFIED" ? -1 : i)).filter((i) => i !== -1);
  if (keepIdx.length < verifiedClaims.length) {
    const dropped = verifiedClaims.filter((c) => c.tier === "UNVERIFIED").map((c) => c.text);
    logger.warn({ dropped, title: best.candidate.title }, "SOURCE_VERIFIED_FACT_GATE: dropped claims that could not be verified against the real source");
  }
  if (keepIdx.length === 0) {
    logger.warn({ title: best.candidate.title }, "SOURCE_VERIFIED_FACT_GATE: no claim survived verification, falling back to DETERMINISTIC template");
    script = buildDeterministicScript(best.candidate.title, sourceUrlForScript);
    verifiedClaims = await verifyClaims(script.claims.map((c) => ({ text: c.text, tier: c.tier, sourceUrl: sourceUrlForScript })));
    keepIdx = verifiedClaims.map((_, i) => i);
  }
  script.claims = keepIdx.map((i) => script.claims[i]);
  const claims = keepIdx.map((i) => verifiedClaims[i]);

  const verdict: TieredClaim = { text: script.verdictComplement, tier: "EDITORIAL_OPINION" };
  const factCheck = passesSourceVerifiedFactGate(claims, verdict);
  if (!factCheck.pass) {
    return { status: "ABANDONED", reason: `FACT_CHECK_FAILED: ${factCheck.reason}` };
  }

  // ASSET SOURCING — reuses cached contextual scenes; only the named vehicle (if any) may need fresh Vision
  const scenePlan: { kicker: string; headline: string[]; complement: string; topic: string; contentMatch?: string; namedVehicle?: string }[] = [];
  scenePlan.push({
    kicker: "DEBATE MAIS CAR",
    headline: script.hook,
    complement: script.hookComplement,
    topic: script.namedVehicle ? `${script.namedVehicle} 2026` : GENERIC_HOOK_SCENE.topic,
    contentMatch: script.namedVehicle ? undefined : GENERIC_HOOK_SCENE.contentMatch,
    namedVehicle: script.namedVehicle ?? undefined,
  });
  script.claims.forEach((c, i) => {
    const scene = CONTEXTUAL_SCENES[i % CONTEXTUAL_SCENES.length];
    scenePlan.push({ kicker: scene.kicker, headline: c.headline, complement: c.complement, topic: scene.topic, contentMatch: scene.contentMatch });
  });
  scenePlan.push({ kicker: "O CONTRAPONTO", headline: script.counterpointHeadline, complement: script.counterpointComplement, topic: CONTEXTUAL_SCENES[2].topic, contentMatch: CONTEXTUAL_SCENES[2].contentMatch });
  scenePlan.push({ kicker: "VEREDITO MAIS CAR", headline: script.verdictHeadline, complement: script.verdictComplement, topic: VERDICT_SCENE.topic, contentMatch: VERDICT_SCENE.contentMatch });

  const photoPaths: (string | Buffer)[] = [];
  const usedUrls = new Set<string>();
  for (const scene of scenePlan) {
    const result = await sourcePhoto(
      { namedVehicle: scene.namedVehicle, topic: scene.topic, expectedModelYear: scene.namedVehicle ? "2026" : undefined, checkBrazilMarketVersion: !!scene.namedVehicle, contentMatchDescription: scene.contentMatch, requireNoForeignCurrency: true },
      ORG_ID,
    );
    if (result.status !== "FOUND") return { status: "ABANDONED", reason: `PHOTO_NOT_FOUND: ${scene.kicker} (${scene.topic}) — ${result.reason}` };
    if (usedUrls.has(result.candidate!.imageUrl)) return { status: "ABANDONED", reason: `DUPLICATE_PHOTO_URL: ${scene.kicker}` };
    usedUrls.add(result.candidate!.imageUrl);
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const localPath = path.join(TMP_DIR, `debate-${scene.kicker.replace(/\s/g, "")}-${Date.now()}.jpg`);
    await downloadPhoto(result.candidate!, localPath);
    photoPaths.push(localPath);
  }

  // VISUAL_QA — perceptual-hash dedup across the actual rendered images
  const hashes = await Promise.all(photoPaths.map((p) => perceptualHash(p)));
  const dup = checkNoDuplicates(hashes.map((h, i) => ({ name: scenePlan[i].kicker, hash: h })));
  if (!dup.pass) return { status: "ABANDONED", reason: `NO_DUPLICATE_PHOTO_GATE_FAILED: ${JSON.stringify(dup.duplicatePairs)}` };

  // MOTION — render slides then the Reel
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const slidePngPaths: string[] = [];
  for (let i = 0; i < scenePlan.length; i++) {
    const input: HeroInput = {
      kicker: scenePlan[i].kicker,
      headline: scenePlan[i].headline,
      complement: scenePlan[i].complement,
      photoPath: photoPaths[i],
      semanticMatchReviewed: true,
      photoCategory: scenePlan[i].namedVehicle ? "EXACT_VEHICLE" : "DOCUMENTARY",
      namedVehicle: scenePlan[i].namedVehicle,
    };
    const png = await renderHero(input);
    const p = path.join(GENERATED_DIR, `debate-auto-${i + 1}-${Date.now()}.png`);
    fs.writeFileSync(p, png);
    slidePngPaths.push(p);
  }

  // ÁUDIO — code-only selection, least-used first
  const track = selectTrack({ energy: "medium" }) ?? selectTrack();
  if (!track) return { status: "ABANDONED", reason: "NO_AUDIO_TRACK_AVAILABLE" };

  const reelPath = path.join(GENERATED_DIR, `debate-reel-${Date.now()}.mp4`);
  await renderReel({ slidePngPaths, outPath: reelPath, audioPath: resolveTrackPath(track), secondsPerSlide: 4.5 });
  recordUsage(track.id);

  // Save as Content (REVIEW until publish decision below)
  let pillar = await prisma.contentPillar.findFirst({ where: { brandId: BRAND_ID, name: "DEBATE" } });
  if (!pillar) pillar = await prisma.contentPillar.create({ data: { brandId: BRAND_ID, name: "DEBATE", description: "Polêmicas reais do mercado automotivo, com fato + opinião editorial" } });
  const content = await prisma.content.create({
    data: {
      brandId: BRAND_ID,
      pillarId: pillar.id,
      type: "REEL",
      status: "REVIEW",
      title: script.hook.join(" "),
      hook: script.hook.join(" "),
      topic: best.candidate.title,
      cta: script.verdictComplement,
    },
  });
  await prisma.contentVersion.create({
    data: {
      contentId: content.id,
      versionNum: 1,
      copy: script.captionLong,
      metadata: { route: "ROUTE_DEBATE_REEL_AUTONOMOUS", musicTrack: track.track, musicSourceUrl: track.sourceUrl, engagementScore: best.score.total, factTiers: claims.map((c) => c.tier) },
    },
  });

  if (!opts.autoPublish) {
    return { status: "PREPARED_AWAITING_PUBLISH", contentId: content.id };
  }

  // GRAPH API — only reached when the caller explicitly passed autoPublish:true
  const socialAccount = await prisma.socialAccount.findFirstOrThrow({ where: { platform: "instagram" } });
  const apiKey = await prisma.apiKey.findUniqueOrThrow({ where: { id: socialAccount.accessTokenRef! } });
  const accessToken = decrypt(apiKey.encryptedValue);
  const videoUrl = await uploadForPublicAccess(reelPath, { mimeType: "video/mp4", fileName: "reel.mp4" });
  const result = await publishReelToInstagram(socialAccount.handle, accessToken, videoUrl, script.captionLong);

  await prisma.content.update({ where: { id: content.id }, data: { status: "PUBLISHED" } });
  const version = await prisma.contentVersion.findFirst({ where: { contentId: content.id } });
  if (version) {
    await prisma.contentVersion.update({ where: { id: version.id }, data: { metadata: { ...(version.metadata as object), instagramMediaId: result.mediaId } } });
  }

  const permalinkRes = await fetch(`https://graph.instagram.com/v21.0/${result.mediaId}?${new URLSearchParams({ fields: "permalink", access_token: accessToken })}`);
  const permalinkData = (await permalinkRes.json()) as { permalink?: string };

  return { status: "PUBLISHED", contentId: content.id, mediaId: result.mediaId, permalink: permalinkData.permalink };
}
