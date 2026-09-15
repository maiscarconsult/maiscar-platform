/**
 * HEADLINE_CLAIM_GATE (2026-09-10) — deterministic, zero-cost check that a
 * cover's "mesmo dinheiro"/"mesmo orçamento"/"mesmo preço" claim is
 * actually true given the confirmed prices. A >10% relative difference
 * fails — the headline has to be reworded to something factual instead
 * (e.g. "vale pagar R$X a mais?").
 */
const SAME_BUDGET_CLAIM_RE = /mesmo (dinheiro|orçamento|pre[çc]o|valor)/i;
const MAX_RELATIVE_DIFF = 0.1; // 10%

export interface HeadlineClaimResult {
  pass: boolean;
  reason?: string;
}

export function checkHeadlineClaim(headlineAndCaptionText: string, priceA?: number, priceB?: number): HeadlineClaimResult {
  const claimsSameBudget = SAME_BUDGET_CLAIM_RE.test(headlineAndCaptionText);
  if (!claimsSameBudget) return { pass: true };
  if (priceA === undefined || priceB === undefined) {
    return { pass: false, reason: "Headline alega \"mesmo dinheiro/orçamento\" mas os preços não foram fornecidos pra verificar." };
  }
  const diff = Math.abs(priceA - priceB);
  const base = Math.min(priceA, priceB);
  const relativeDiff = base > 0 ? diff / base : 1;
  if (relativeDiff > MAX_RELATIVE_DIFF) {
    return {
      pass: false,
      reason: `Headline alega "mesmo dinheiro" mas a diferença de preço é ${(relativeDiff * 100).toFixed(0)}% (R$ ${diff.toLocaleString("pt-BR")}) — acima do limite de ${MAX_RELATIVE_DIFF * 100}%. Reescreva pra algo factual, ex: "vale pagar R$ ${diff.toLocaleString("pt-BR")} a mais?".`,
    };
  }
  return { pass: true };
}
