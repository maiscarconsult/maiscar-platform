/**
 * FACT_CHECK tiers (2026-09-10) — every claim used in a debate/controversy
 * Reel must be tagged with where it actually comes from. A strong headline
 * is allowed; an unlabeled strong CLAIM is not. This is the structural
 * defense against "reclamação de internet virando defeito comprovado."
 */
export type FactTier = "CONFIRMED_FACT" | "OWNER_REPORT" | "OFFICIAL_RECALL" | "EDITORIAL_OPINION" | "UNVERIFIED";

export interface TieredClaim {
  text: string;
  tier: FactTier;
  sourceUrl?: string;
}

/**
 * FINAL_EDITORIAL_GATE (fact side): a debate Reel must rest on at least one
 * claim that ISN'T pure opinion — an owner report, a recall, or a
 * confirmed fact — and the closing verdict must be explicitly tagged
 * EDITORIAL_OPINION (never disguised as CONFIRMED_FACT). No LLM involved —
 * this checks tags the caller already assigned when building the script.
 */
export function passesFactCheckGate(claims: TieredClaim[], verdict: TieredClaim): { pass: boolean; reason?: string } {
  if (claims.length === 0) return { pass: false, reason: "NO_CLAIMS_PROVIDED" };
  const hasNonOpinionEvidence = claims.some((c) => c.tier !== "EDITORIAL_OPINION");
  if (!hasNonOpinionEvidence) return { pass: false, reason: "ALL_CLAIMS_ARE_OPINION_NO_EVIDENCE" };
  if (verdict.tier !== "EDITORIAL_OPINION") {
    return { pass: false, reason: "VERDICT_MUST_BE_TAGGED_EDITORIAL_OPINION_NOT_PRESENTED_AS_FACT" };
  }
  const untaggedSource = claims.find((c) => c.tier !== "EDITORIAL_OPINION" && !c.sourceUrl);
  if (untaggedSource) return { pass: false, reason: `CLAIM_MISSING_SOURCE_URL: "${untaggedSource.text}"` };
  return { pass: true };
}
