import { prisma } from "../../lib/prisma";
import { EditorialScore, EDITORIAL_RELEVANCE_THRESHOLD, ENGAGEMENT_SCORE_MIN, scoreTier } from "./editorialScoring";

const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "com", "para", "por", "que", "no", "na", "um", "uma", "novo", "nova", "2026", "2027"]);

function significantWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return hits / a.size;
}

/**
 * DUPLICATE_CHECK_GATE — compares a candidate topic against recently
 * published Content rows (last 4 days) with a cheap keyword-overlap
 * heuristic. Script-first (rule 15): no LLM call for this, it's
 * deterministic and fast.
 */
export async function duplicateCheckGate(brandId: string, candidateTitle: string): Promise<{ pass: boolean; reason?: string }> {
  const recent = await prisma.content.findMany({
    where: { brandId, createdAt: { gte: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) } },
    select: { title: true, topic: true },
  });
  const candidateWords = significantWords(candidateTitle);
  for (const r of recent) {
    const existingWords = significantWords(`${r.title} ${r.topic ?? ""}`);
    const ratio = overlapRatio(candidateWords, existingWords);
    if (ratio > 0.5) {
      return { pass: false, reason: `Sobreposição de ${Math.round(ratio * 100)}% com pauta recente: "${r.title}"` };
    }
  }
  return { pass: true };
}

/**
 * EDITORIAL_RELEVANCE_GATE v2 — score alone isn't enough anymore (rule 5/6
 * of the hardening pass): WHO_CARES_TEST and CONSEQUENCE_TEST are hard
 * requirements, not just inputs folded into the numeric score. A pauta can
 * only reach PUBLISHABILITY_GATE at FORTE (80+) or above, per scoreTier().
 */
export function editorialRelevanceGate(score: EditorialScore): { pass: boolean; reason?: string } {
  if (!score.whoCaresPass) {
    return { pass: false, reason: `WHO_CARES_TEST falhou: "${score.whoCaresAnswer}"` };
  }
  if (!score.consequencePass) {
    return { pass: false, reason: `CONSEQUENCE_TEST falhou: "${score.consequence}"` };
  }
  const tier = scoreTier(score.total);
  if (score.total < EDITORIAL_RELEVANCE_THRESHOLD) {
    return { pass: false, reason: `Score ${score.total} (${tier}) abaixo do piso ${EDITORIAL_RELEVANCE_THRESHOLD}` };
  }
  return { pass: true };
}

/**
 * ENGAGEMENT_GATE — ROUTE 3 (CONTROVERSY/ENGAGEMENT) entry gate, used
 * instead of editorialRelevanceGate's 80-point NEWS bar. Still requires
 * WHO_CARES (genuine relevance, not fabricated debate) and a real
 * engagementScore floor — never "anything goes to hit 2 posts/day".
 */
export function engagementGate(score: EditorialScore): { pass: boolean; reason?: string } {
  if (!score.whoCaresPass) {
    return { pass: false, reason: `WHO_CARES_TEST falhou: "${score.whoCaresAnswer}"` };
  }
  if (score.engagementScore < ENGAGEMENT_SCORE_MIN) {
    return { pass: false, reason: `ENGAGEMENT_SCORE ${score.engagementScore} abaixo do piso ${ENGAGEMENT_SCORE_MIN}` };
  }
  return { pass: true };
}

export type FactStatus = "CONFIRMED" | "PARTIALLY_CONFIRMED" | "UNCONFIRMED";

export interface FactCheckResult {
  pass: boolean;
  reason?: string;
  primarySource: string;
  secondaryConfirmation: boolean;
  factStatus: FactStatus;
}

// Heuristics for "this article carries enough weight to auto-publish
// without a second outlet" — an official company statement/quote, a
// documented process (petition/bulletin/recall/lawsuit), or the outlet's
// own first-hand experience (a long-term test car, not hearsay).
const OFFICIAL_STATEMENT_MARKERS = ["disse que", "afirmou", "declarou", "em nota", "comunicado", "respondeu que", "diz que", "não comenta"];
const DOCUMENTED_PROCESS_MARKERS = ["petição pública", "boletim técnico", "recall", "processo", "notificação extrajudicial", "ordem de serviço", "inmetro", "procon"];
const FIRST_HAND_MARKERS = ["longa duração", "testamos", "nosso carro de longa", "rodamos com"];

/**
 * FACT_CHECK_GATE v2 — classifies FACT_STATUS instead of a bare pass/fail.
 * Only CONFIRMED clears PUBLISHABILITY_GATE automatically; PARTIALLY_
 * CONFIRMED and UNCONFIRMED still block auto-publish (fail closed) even
 * though the candidate "has a source" in a loose sense — this is
 * deliberately stricter than v1, which only checked "is there a URL and
 * enough text".
 */
export function factCheckGate(article: { text: string; url: string }): FactCheckResult {
  if (!article.url || !article.url.startsWith("http")) {
    return { pass: false, primarySource: article.url ?? "", secondaryConfirmation: false, factStatus: "UNCONFIRMED", reason: "Sem URL de fonte" };
  }
  if (article.text.length < 400) {
    return { pass: false, primarySource: article.url, secondaryConfirmation: false, factStatus: "UNCONFIRMED", reason: "Texto da matéria curto demais" };
  }

  const lower = article.text.toLowerCase();
  const hasOfficialStatement = OFFICIAL_STATEMENT_MARKERS.some((m) => lower.includes(m));
  const hasDocumentedProcess = DOCUMENTED_PROCESS_MARKERS.some((m) => lower.includes(m));
  const isFirstHand = FIRST_HAND_MARKERS.some((m) => lower.includes(m));

  const secondaryConfirmation = hasOfficialStatement || hasDocumentedProcess;
  const factStatus: FactStatus = secondaryConfirmation || isFirstHand ? "CONFIRMED" : "PARTIALLY_CONFIRMED";

  return {
    pass: factStatus === "CONFIRMED",
    primarySource: article.url,
    secondaryConfirmation,
    factStatus,
    reason: factStatus === "CONFIRMED" ? undefined : "Fonte única sem declaração oficial, processo documentado ou relato em primeira mão da própria publicação — PARTIALLY_CONFIRMED não publica automaticamente.",
  };
}

/**
 * DEFECT_CLAIM_CLASSIFICATION — the copy must never claim a tier higher
 * than what the article text actually supports (brand-personality rule
 * added after Ciclo 4). Returns the highest tier the article text itself
 * evidences; copywriting.ts is told not to exceed it.
 */
export type DefectClaimTier =
  | "OWNER_REPORT"
  | "MULTIPLE_REPORTS"
  | "PUBLIC_PETITION"
  | "OFFICIAL_RECALL"
  | "MANUFACTURER_ACKNOWLEDGED"
  | "TECHNICAL_BULLETIN"
  | "CHRONIC_DEFECT_CONFIRMED"
  | "NOT_A_DEFECT_STORY";

export function classifyDefectClaim(text: string): DefectClaimTier {
  const lower = text.toLowerCase();
  if (lower.includes("recall")) return "OFFICIAL_RECALL";
  if (lower.includes("boletim técnico")) return "TECHNICAL_BULLETIN";
  if ((lower.includes("fabricante") || lower.includes("montadora")) && (lower.includes("reconhece") || lower.includes("admite"))) return "MANUFACTURER_ACKNOWLEDGED";
  if (lower.includes("petição pública") || lower.includes("petição") ) return "PUBLIC_PETITION";
  if (/\d{2,}\s+(propriet|dono|relato|queixa|reclama)/.test(lower)) return "MULTIPLE_REPORTS";
  if (lower.includes("defeito") || lower.includes("falha") || lower.includes("problema")) return "OWNER_REPORT";
  return "NOT_A_DEFECT_STORY";
}
