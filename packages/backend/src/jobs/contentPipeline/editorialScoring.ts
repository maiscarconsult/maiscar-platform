import { aiOrchestrator } from "../../modules/ai-orchestrator/orchestrator";
import { logger } from "../../lib/logger";
import { NewsCandidate } from "./newsRadar";

export interface EditorialScore {
  title: string;
  url: string;
  consumerRelevance: number; // /20
  buyingDecisionImpact: number; // /15
  curiosity: number; // /15
  controversy: number; // /15
  financialImpact: number; // /10
  sharePotential: number; // /10
  commentPotential: number; // /5
  currentness: number; // /5
  brandFit: number; // /5
  total: number; // 0-100, weighted sum above — NOT influenced by photo availability
  namedVehicle: string | null;
  tier: "A" | "B" | "C";
  brazilRelevant: boolean;
  whoCaresAnswer: string;
  whoCaresPass: boolean;
  consequence: string;
  consequencePass: boolean;
  reasoning: string;
  /** ENGAGEMENT_SCORE (0-100, rule 2026-09-09): a SEPARATE rubric from `total` — "real potencial de debate mesmo sem ser notícia". Read from the SAME Haiku call, zero extra cost. Used only by ROUTE 3 (CONTROVERSY/ENGAGEMENT), never to lower the NEWS bar. */
  engagementScore: number;
}

// Weights (points-out-of-100 each axis is worth once rescaled from the
// model's own 0-10 answer — see rescaleAxis()).
const MAX_BY_AXIS: Record<string, number> = {
  consumerRelevance: 20,
  buyingDecisionImpact: 15,
  curiosity: 15,
  controversy: 15,
  financialImpact: 10,
  sharePotential: 10,
  commentPotential: 5,
  currentness: 5,
  brandFit: 5,
};

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-5";

// Compact instruction shared by both the cheap pass and the Sonnet
// tie-break — kept short deliberately (rule from the 2026-09-03 cost
// audit: "proibido explicação longa ou raciocínio narrado", JSON only).
function buildScoringPrompt(candidates: NewsCandidate[]): string {
  return `Diretor editorial da Mais.Car (jornalismo automotivo BR, não agregador). Avalie cada manchete com rigor.
TIER A: defeito crônico, recall, manutenção cara, perda de equipamento, mudança grande de preço, desvalorização, comparação de compra, falha grave, segurança.
TIER B: lançamento relevante, mercado, tecnologia com impacto real, híbrido/elétrico, legislação.
TIER C: curiosidade/pesquisa isolada — só forte se excepcional.
whoCaresAnswer/consequence: MÁXIMO 12 palavras cada, sem narrar raciocínio.
brazilRelevant=true só se venda/preço/recall/legislação/mercado BR.
namedVehicle: modelo exato ou null.

TODOS os 9 eixos abaixo usam a MESMA escala 0-10 (10 = o máximo que esse eixo pode valer para QUALQUER manchete automotiva, não só para esta lista — não reserve o 9-10 "para casos ainda melhores"; um recall real com prejuízo financeiro claro já é 9-10 em consumerRelevance/financialImpact):
consumerRelevance (afeta quem tem/compra carro?), buyingDecisionImpact (muda uma decisão de compra?), curiosity (motivo real de parar o scroll?), controversy (conflito verdadeiro?), financialImpact (dinheiro/custo/perda envolvido?), sharePotential (alguém mandaria pra outra pessoa?), commentPotential (é discutível?), currentness (é atual?), brandFit (fortalece o posicionamento Mais.Car?).

Além dos 9 eixos, dê também "engagement" (0-10, rota polêmica/comparativa — ROUTE 3): teste é "duas pessoas que entendem de carro discordariam honestamente disso?". Alto engagement = tem DOIS LADOS defensáveis (elétrico x combustão, zero x usado, preço x manutenção, tecnologia x confiabilidade, marca com má fama x dados reais) e mexe com dinheiro/decisão de compra. Baixo engagement = resposta óbvia/morna, sem conflito real. Baseie-se só em fatos já presentes na manchete, nunca invente defeito/dado/reputação.

Manchetes:
${candidates.map((c, i) => `${i + 1}. ${c.title}`).join("\n")}

Responda SOMENTE JSON compacto, um objeto por manchete, mesma ordem, sem texto antes/depois, cada eixo 0-10:
[{"tier":"A|B|C","brazilRelevant":bool,"whoCaresAnswer":"...","whoCaresPass":bool,"consequence":"...","consequencePass":bool,"consumerRelevance":0-10,"buyingDecisionImpact":0-10,"curiosity":0-10,"controversy":0-10,"financialImpact":0-10,"sharePotential":0-10,"commentPotential":0-10,"currentness":0-10,"brandFit":0-10,"engagement":0-10,"namedVehicle":"..."|null,"reasoning":"<=8 palavras"}]`;
}

/**
 * Rescales the model's uniform 0-10 answer to that axis's actual point
 * weight (5/10/15/20). Fixes a real calibration bug found 2026-09-08: when
 * the model was asked to emit the weighted value directly (0-20 for one
 * axis, 0-5 for another, in the same response), it defaulted to a flat
 * ~0-10 answer regardless of the stated ceiling — clamping (Math.min)
 * silently ate points on every low-ceiling axis while high-ceiling axes
 * (consumerRelevance/20) never got scored anywhere near their real max even
 * for textbook recall/defect cases. Calibration test: 5 textbook TIER A
 * headlines (real recall/defect/price patterns) averaged total=58 before
 * this fix — clearly miscalibrated against the 80+ "forte/publicável" band
 * the scale is supposed to represent. Uniform 0-10 input + code-side
 * rescaling removes the burden of tracking 4 different ceilings from the
 * model entirely.
 */
function rescaleAxis(raw0to10: number, axisMax: number): number {
  const clamped = Math.min(Math.max(raw0to10, 0), 10);
  return Math.round((clamped / 10) * axisMax);
}

function parseScores(text: string, candidates: NewsCandidate[]): EditorialScore[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    logger.error({ textChars: text.length }, "editorial scoring returned no parseable JSON");
    throw new Error("EDITORIAL_SCORING_PARSE_FAILED");
  }
  const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
  return parsed.map((p, i) => {
    const axes = Object.fromEntries(
      Object.keys(MAX_BY_AXIS).map((key) => [key, rescaleAxis(Number(p[key]) || 0, MAX_BY_AXIS[key])]),
    ) as Record<keyof typeof MAX_BY_AXIS, number>;
    const total = Object.values(axes).reduce((sum, v) => sum + v, 0);
    return {
      title: candidates[i]?.title ?? "",
      url: candidates[i]?.url ?? "",
      consumerRelevance: axes.consumerRelevance,
      buyingDecisionImpact: axes.buyingDecisionImpact,
      curiosity: axes.curiosity,
      controversy: axes.controversy,
      financialImpact: axes.financialImpact,
      sharePotential: axes.sharePotential,
      commentPotential: axes.commentPotential,
      currentness: axes.currentness,
      brandFit: axes.brandFit,
      total: Math.round(total),
      namedVehicle: (p.namedVehicle as string) || null,
      tier: (["A", "B", "C"].includes(p.tier as string) ? p.tier : "C") as "A" | "B" | "C",
      brazilRelevant: Boolean(p.brazilRelevant),
      whoCaresAnswer: String(p.whoCaresAnswer ?? ""),
      whoCaresPass: Boolean(p.whoCaresPass),
      consequence: String(p.consequence ?? ""),
      consequencePass: Boolean(p.consequencePass),
      reasoning: String(p.reasoning ?? ""),
      engagementScore: rescaleAxis(Number(p.engagement) || 0, 100),
    };
  });
}

/**
 * Does the cheap pass leave something Sonnet actually needs to resolve?
 * Tightened 2026-09-09 per explicit cost rule: a lone strong-ish candidate
 * (even Tier A, even with a real defect claim) is NEVER escalated on its
 * own — that would be "usar Sonnet pra tentar salvar uma pauta fraca",
 * which is exactly what's now prohibited. Escalation requires ALL of: the
 * top score already clears the near-threshold floor (75), AND there's a
 * real tie/ambiguity (a close second place) — not just "this one candidate
 * looks promising".
 */
function needsSonnetEscalation(scores: EditorialScore[]): EditorialScore[] {
  const NEAR_THRESHOLD = EDITORIAL_RELEVANCE_THRESHOLD - 5; // 75
  const sorted = [...scores].sort((a, b) => b.total - a.total);
  const top = sorted[0];
  if (!top || top.total < NEAR_THRESHOLD) return [];
  const second = sorted[1];
  const isRealTie = !!second && Math.abs(top.total - second.total) <= 3;
  if (!isRealTie) return [];
  return sorted.slice(0, 2);
}

/** Sonnet tie-break/final judgment — ONLY called for the small set needsSonnetEscalation() flags, never for the full candidate list (rule 3/6: Sonnet reserved for disputed finalists, not routine scoring). */
async function sonnetTiebreak(disputed: EditorialScore[], organizationId: string): Promise<Map<string, EditorialScore>> {
  const asCandidates: NewsCandidate[] = disputed.map((d) => ({ title: d.title, url: d.url, source: "" }));
  const prompt = `Julgamento final (desempate) — mesma régua editorial Mais.Car. Estes candidatos ficaram próximos do piso ou empatados na triagem barata; dê a nota definitiva com mais cuidado.\n\n${buildScoringPrompt(asCandidates)}`;
  const { text } = await aiOrchestrator.generateText(
    { prompt, maxTokens: 1200, model: SONNET_MODEL },
    { organizationId, quality: "final", purpose: "editorial-scoring-sonnet-tiebreak" },
  );
  const rescored = parseScores(text, asCandidates);
  const byUrl = new Map<string, EditorialScore>();
  for (const s of rescored) byUrl.set(s.url, s);
  return byUrl;
}

/**
 * Content Opportunity Score v2 — cost-hardened 2026-09-03 (see token-usage
 * audit): the routine scoring pass now runs on Haiku (cheapest Claude
 * tier), short max_tokens (1200), JSON-only output, and Sonnet is called
 * ONLY for the small subset needsSonnetEscalation() flags — never for every
 * cycle. Weights/WHO_CARES_TEST/CONSEQUENCE_TEST are unchanged from the
 * prior recalibration. Photo availability plays NO role here.
 */
export async function scoreCandidates(
  candidates: NewsCandidate[],
  organizationId: string,
  opts: { allowSonnetEscalation?: boolean } = {},
): Promise<EditorialScore[]> {
  if (candidates.length === 0) return [];

  const { text } = await aiOrchestrator.generateText(
    { prompt: buildScoringPrompt(candidates), maxTokens: 1200, model: HAIKU_MODEL },
    { organizationId, quality: "final", purpose: "editorial-scoring-haiku" },
  );
  const scores = parseScores(text, candidates);

  // ECONOMIC_FALLBACK_SCAN calls this with allowSonnetEscalation:false — the
  // fallback exists to catch a genuinely strong pauta the first pass missed,
  // never to argue a weak one up to the bar with a second, pricier opinion.
  if (opts.allowSonnetEscalation === false) return scores;

  const disputed = needsSonnetEscalation(scores);
  if (disputed.length === 0) return scores;

  logger.info({ disputedCount: disputed.length, titles: disputed.map((d) => d.title) }, "escalating disputed candidates to Sonnet tie-break");
  const revised = await sonnetTiebreak(disputed, organizationId);
  return scores.map((s) => revised.get(s.url) ?? s);
}

/** PUBLISHABILITY_GATE tiers (rule 1) — 80 is the hard floor for automatic publication. */
export function scoreTier(total: number): "EXCEPCIONAL" | "MUITO_FORTE" | "FORTE" | "PROMISSORA_INSUFICIENTE" | "REJEITAR" {
  if (total >= 90) return "EXCEPCIONAL";
  if (total >= 85) return "MUITO_FORTE";
  if (total >= 80) return "FORTE";
  if (total >= 75) return "PROMISSORA_INSUFICIENTE";
  return "REJEITAR";
}

export const EDITORIAL_RELEVANCE_THRESHOLD = 80;

/** ROUTE 3 (CONTROVERSY/ENGAGEMENT) floor — deliberately lower than the NEWS threshold since this route isn't judged as journalism, but still a real bar (not "anything goes just to hit 2 posts/day"). */
export const ENGAGEMENT_SCORE_MIN = 65;
