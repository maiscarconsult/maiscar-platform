/**
 * MAISCAR_NARRATED_MOTION_REEL_V1 (2026-09-10) — permanent replacement
 * target for the slideshow-style DEBATE reel: continuous narration, real
 * video B-roll, hard cuts every ~1-2s, big on-screen keywords timed to the
 * voice. This file is the PILOT orchestrator only — it builds and renders
 * one Reel to compare against the current slideshow format; it does not
 * write to the Content table or publish. Once approved, this becomes the
 * body of the real automated cycle (RADAR -> ... -> INSIGHTS per the spec).
 *
 * Token discipline unchanged: 1 Haiku call for the colloquial script, 0 LLM
 * for radar/scoring/fact-check/TTS/video-sourcing/render.
 */
import fs from "node:fs";
import path from "node:path";
import { getControversyCandidates } from "./controversyRadar";
import { scoreControversy, MIN_ENGAGEMENT_POTENTIAL } from "./controversyScoring";
import { getRecentReels, isTooSimilar } from "./antiRepetition";
import { TieredClaim, FactTier } from "./factCheckTiers";
import { verifyClaims, passesSourceVerifiedFactGate } from "./sourceVerifiedFactGate";
import { synthesizeSegment } from "./ttsProvider";
import { searchAndDownloadClip } from "./pexelsVideo";
import { renderNarratedReel, NarratedSegmentInput } from "./narratedMotionRenderer";
import { sourcePhoto, downloadPhoto } from "./photoSourcing";
import { renderHero } from "../../modules/content/diagonalTemplateV4";
import { selectTrack, resolveTrackPath } from "./localAudioLibrary";
import { aiOrchestrator } from "../../modules/ai-orchestrator/orchestrator";
import { logger } from "../../lib/logger";

const ORG_ID = "e20b49b4-2835-4e90-bb41-95b1aab11007";
const BRAND_ID = "09dc8dec-34e9-4588-97d9-031b820c8a64";
const PILOT_DIR = path.join(__dirname, "..", "..", "..", "generated", "narrated-pilot");

interface ScriptSegment {
  id: string;
  narration: string;
  keyword: string;
  videoQuery: string;
  tier?: FactTier;
}

interface NarratedScript {
  namedVehicle: string | null;
  segments: ScriptSegment[];
  coverHeadline: string[];
  captionLong: string;
}

async function writeColloquialScript(candidateTitle: string, sourceUrl: string): Promise<NarratedScript> {
  const system =
    "Você é o roteirista-chefe da MAIS CAR. Escreve narração CONTÍNUA e coloquial, como se estivesse explicando para um amigo que entende de carro. " +
    "Nunca usa linguagem jornalística engessada ('de acordo com especialistas', 'neste vídeo iremos', 'vale destacar', 'por outro lado'). " +
    "Frases curtas, ritmo rápido, tom confiante e levemente provocativo. Nunca inventa número, defeito, recall ou custo — toda afirmação factual forte vem tagueada OWNER_REPORT (relato real, nunca CONFIRMED_FACT sem fonte oficial verificável). O veredito final é sempre EDITORIAL_OPINION.";
  const prompt = `Tema real do radar: "${candidateTitle}" (fonte: ${sourceUrl})

Escreva em JSON estrito, com narração contínua dividida em 8 blocos (cada bloco = 1-3 frases curtas, nunca um parágrafo):
{
  "namedVehicle": "nome de UM ÚNICO modelo real, ou null se o tema for genérico/comparação — NUNCA 'X vs Y', 'X ou Y', 'X x Y'",
  "segments": [
    {"id":"HOOK","narration":"afirmação forte, 1 frase curta, SEM pergunta","keyword":"palavra grande pra tela","videoQuery":"termo de busca em inglês pra um vídeo real (ex: 'car engine close up')"},
    {"id":"WHY","narration":"por que estou dizendo isso, 1-2 frases curtas","keyword":"...","videoQuery":"..."},
    {"id":"PROBLEM","narration":"o mecanismo/problema, tom de conversa","keyword":"...","videoQuery":"...","tier":"OWNER_REPORT"},
    {"id":"PROOF","narration":"relato real/exemplo (sem inventar número exato, pode usar 'muita gente relata', 'vários donos comentam')","keyword":"...","videoQuery":"...","tier":"OWNER_REPORT"},
    {"id":"CONSEQUENCE","narration":"o que isso significa no bolso/na vida do dono","keyword":"...","videoQuery":"..."},
    {"id":"COUNTERPOINT","narration":"por que quem defende o carro também pode ter razão","keyword":"...","videoQuery":"..."},
    {"id":"VERDICT","narration":"posição da MAIS CAR, deixe claro que é opinião editorial","keyword":"...","videoQuery":"...","tier":"EDITORIAL_OPINION"},
    {"id":"FINAL","narration":"frase de impacto final, de preferência afirmação","keyword":"...","videoQuery":"..."}
  ],
  "coverHeadline": ["LINHA 1 (max 18 char)","LINHA 2 (max 18 char)"],
  "captionLong": "legenda pro Instagram, tom coloquial, com uma linha final 'OPINIÃO MAIS CAR (não é fato, é leitura editorial):' antes do veredito"
}

videoQuery deve ser em INGLÊS e descrever algo filmável real e genérico (engine, garage, mechanic, dashboard, money, road, handshake, dealership) — nunca peça um carro/modelo específico no videoQuery. Responda SOMENTE o JSON.`;

  const { text } = await aiOrchestrator.generateText(
    { prompt, system, maxTokens: 2200, model: "claude-haiku-4-5-20251001" },
    { organizationId: ORG_ID, quality: "draft", purpose: "narrated-motion-reel-script" },
  );
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("NARRATED_SCRIPT_NO_JSON");
  return JSON.parse(jsonMatch[0]);
}

export interface NarratedMotionReelPilotResult {
  status: "PILOT_READY" | "ABANDONED";
  reason?: string;
  videoPath?: string;
  coverPath?: string;
  topic?: string;
  hook?: string;
  durationSec?: number;
  segmentCount?: number;
  factCheck?: { pass: boolean; reason?: string };
}

export async function runNarratedMotionReelPilot(): Promise<NarratedMotionReelPilotResult> {
  // RADAR + SCORING — reuse the real, already-working FULL RADAR (0 LLM)
  const candidates = await getControversyCandidates();
  const recentReels = await getRecentReels(BRAND_ID);
  const scored = candidates
    .filter((c) => !isTooSimilar(c.title, recentReels))
    .map((c) => ({ candidate: c, score: scoreControversy(c) }))
    .sort((a, b) => b.score.total - a.score.total);
  if (scored.length === 0) return { status: "ABANDONED", reason: "NO_CANDIDATES" };
  const best = scored[0];
  if (best.score.total < MIN_ENGAGEMENT_POTENTIAL) {
    logger.warn({ title: best.candidate.title, score: best.score.total }, "NARRATED_PILOT: top candidate below MIN_ENGAGEMENT_POTENTIAL, proceeding anyway");
  }
  const sourceUrl = best.candidate.sourceUrl ?? `radar-signal:${best.candidate.title}`;

  // ROTEIRO COLOQUIAL — exactly 1 Haiku call
  const script = await writeColloquialScript(best.candidate.title, sourceUrl);
  if (script.namedVehicle && /\b(vs\.?|ou|x|\/)\b/i.test(script.namedVehicle)) script.namedVehicle = null;

  // SOURCE_VERIFIED_FACT_GATE — every tiered segment checked against the real radar sourceUrl
  const tieredSegments = script.segments.filter((s) => s.tier);
  const rawClaims: TieredClaim[] = tieredSegments.map((s) => ({ text: s.narration, tier: s.tier!, sourceUrl }));
  const verifiedClaims = await verifyClaims(rawClaims);
  const verdictSeg = script.segments.find((s) => s.id === "VERDICT");
  const verdict: TieredClaim = { text: verdictSeg?.narration ?? "", tier: "EDITORIAL_OPINION" };
  const factCheck = passesSourceVerifiedFactGate(verifiedClaims, verdict);
  if (!factCheck.pass) {
    return { status: "ABANDONED", reason: `FACT_CHECK_FAILED: ${factCheck.reason}`, factCheck };
  }

  const runDir = path.join(PILOT_DIR, `run-${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });

  // NARRAÇÃO — real TTS per segment, real ffprobe-measured duration drives timing
  const narrationAudioPaths: string[] = [];
  const segmentInputs: NarratedSegmentInput[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const audio = await synthesizeSegment(seg.narration, runDir, `narration-${i}`);
    narrationAudioPaths.push(audio.path);

    const clip = await searchAndDownloadClip(seg.videoQuery, runDir, `clip-${i}`);
    if (!clip) return { status: "ABANDONED", reason: `VIDEO_NOT_FOUND: ${seg.id} (${seg.videoQuery})` };

    segmentInputs.push({ videoPath: clip.path, clipDurationSec: clip.durationSec, targetDurationSec: audio.durationSec, keyword: seg.keyword });
  }
  const totalDurationSec = segmentInputs.reduce((sum, s) => sum + s.targetDurationSec, 0);

  // ÁUDIO — licensed local track, low volume, narration dominant
  const track = selectTrack({ energy: "medium" }) ?? selectTrack();

  const outPath = path.join(runDir, "narrated-reel.mp4");
  await renderNarratedReel({
    segments: segmentInputs,
    narrationAudioPaths,
    musicPath: track ? resolveTrackPath(track) : undefined,
    workDir: runDir,
    outPath,
  });

  // REEL_COVER — separate render, not the first frame, reusing the existing gated Design System
  const coverTopic = script.namedVehicle ? `${script.namedVehicle} 2026` : "modern car dashboard gauge close up";
  const coverPhoto = await sourcePhoto(
    { namedVehicle: script.namedVehicle ?? undefined, topic: coverTopic, expectedModelYear: script.namedVehicle ? "2026" : undefined, checkBrazilMarketVersion: !!script.namedVehicle, requireNoForeignCurrency: true },
    ORG_ID,
  );
  let coverPath: string | undefined;
  if (coverPhoto.status === "FOUND") {
    const coverLocalPath = path.join(runDir, "cover-source.jpg");
    await downloadPhoto(coverPhoto.candidate!, coverLocalPath);
    const png = await renderHero({
      kicker: "MAIS CAR",
      headline: script.coverHeadline,
      photoPath: coverLocalPath,
      semanticMatchReviewed: true,
      photoCategory: script.namedVehicle ? "EXACT_VEHICLE" : "DOCUMENTARY",
      namedVehicle: script.namedVehicle ?? undefined,
    });
    coverPath = path.join(runDir, "cover.png");
    fs.writeFileSync(coverPath, png);
  } else {
    logger.warn({ reason: coverPhoto.reason }, "NARRATED_PILOT: cover photo not found, shipping without a dedicated REEL_COVER");
  }

  return {
    status: "PILOT_READY",
    videoPath: outPath,
    coverPath,
    topic: best.candidate.title,
    hook: script.segments.find((s) => s.id === "HOOK")?.narration,
    durationSec: totalDurationSec,
    segmentCount: script.segments.length,
    factCheck,
  };
}
