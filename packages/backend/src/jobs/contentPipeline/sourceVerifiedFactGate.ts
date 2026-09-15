/**
 * SOURCE_VERIFIED_FACT_GATE (2026-09-10) — closes the structural gap in the
 * original factCheckTiers.ts: that gate only checked that a claim carried a
 * `tier` label and a `sourceUrl` STRING, never that (a) the URL was real or
 * (b) the source's actual content supports the specific number/price/%
 * being asserted. The published DdIA1I-D9mF Reel exposed this: both claims
 * were self-tagged CONFIRMED_FACT by Haiku with sourceUrl:"internal-radar-
 * signal" — a placeholder, not a fetchable source. That is exactly what
 * this gate no longer allows.
 *
 * Rule: CONFIRMED_FACT is never taken on the script-writer's word. Every
 * non-opinion claim is independently re-derived here from its real
 * sourceUrl:
 *  - no real (http/https) sourceUrl + the claim reads as a specific
 *    number/price/%/consumption/deadline/recall claim -> UNVERIFIED
 *  - sourceUrl is reddit.com or reclameaqui.com.br -> forced OWNER_REPORT,
 *    never a general/confirmed fact, regardless of what tier was requested
 *  - any other CONFIRMED_FACT is kept only if the source page's raw text
 *    actually contains the claim's numbers; otherwise UNVERIFIED
 * Verified/rejected results are cached by sourceUrl+claim text so the same
 * real source checked once is never re-fetched for a future Reel.
 */
import { logger } from "../../lib/logger";
import { cache } from "./cache";
import { FactTier, TieredClaim } from "./factCheckTiers";

const OWNER_REPORT_DOMAINS = ["reddit.com", "reclameaqui.com.br"];
const FACTUAL_SIGNAL = /(\d|r\$|%|km\/l|recall)/i;

export function looksLikeSpecificFactualClaim(text: string): boolean {
  return FACTUAL_SIGNAL.test(text);
}

function isRealUrl(url?: string): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

function isOwnerReportDomain(url: string): boolean {
  return OWNER_REPORT_DOMAINS.some((d) => url.includes(d));
}

// Bare digits are useless as a support signal — any page has dozens of
// stray numbers (dates, IDs, unrelated prices). A claim's number only means
// something once it's tied to its unit (km/l, %, R$, "mil"), so that's the
// token this checks for verbatim in the source text — not just the digit.
const QUANTIFIED_TOKEN_PATTERNS = [
  /r\$\s*\d+(?:[.,]\d+)?\s*(?:mil|milhões)?/gi,
  /\d+(?:[.,]\d+)?\s*%/gi,
  /\d+(?:[.,]\d+)?\s*km\/l/gi,
  /\d+(?:[.,]\d+)?\s*mil/gi,
  /\d+(?:[.,]\d+)?\s*(?:dias|meses|anos)/gi,
];

function extractQuantifiedTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const pattern of QUANTIFIED_TOKEN_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) tokens.push(...matches.map((m) => m.replace(/\s+/g, " ").trim().toLowerCase()));
  }
  return tokens;
}

interface VerifiedFactCacheEntry {
  verified: boolean;
  checkedAt: string;
}

async function fetchSourceText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "MaisCarFactCheck/1.0" } });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    logger.warn({ err, url }, "SOURCE_VERIFIED_FACT_GATE: failed to fetch source for verification");
    return null;
  }
}

/**
 * Re-derives a single claim's real tier from its sourceUrl. Never trusts
 * the tier the script-writer (Haiku or otherwise) requested at face value.
 */
export async function verifyClaim(claim: TieredClaim): Promise<TieredClaim> {
  if (claim.tier === "EDITORIAL_OPINION") return claim;

  if (!isRealUrl(claim.sourceUrl)) {
    if (looksLikeSpecificFactualClaim(claim.text)) {
      logger.warn({ claim: claim.text }, "SOURCE_VERIFIED_FACT_GATE: specific claim with no real sourceUrl -> UNVERIFIED");
      return { ...claim, tier: "UNVERIFIED" as FactTier };
    }
    return claim;
  }

  if (isOwnerReportDomain(claim.sourceUrl)) {
    // A Reddit/Reclame Aqui thread is a real, checkable relato — but it is
    // never promoted past OWNER_REPORT, no matter what tier was requested.
    return { ...claim, tier: "OWNER_REPORT" as FactTier };
  }

  if (claim.tier !== "CONFIRMED_FACT") return claim;

  const cacheKey = `${claim.sourceUrl}::${claim.text}`;
  const cached = cache.getSubkey<VerifiedFactCacheEntry>("VERIFIED_FACT_CACHE", cacheKey);
  if (cached) return { ...claim, tier: (cached.verified ? "CONFIRMED_FACT" : "UNVERIFIED") as FactTier };

  const sourceText = await fetchSourceText(claim.sourceUrl);
  if (!sourceText) {
    cache.setSubkey("VERIFIED_FACT_CACHE", cacheKey, { verified: false, checkedAt: new Date().toISOString() });
    return { ...claim, tier: "UNVERIFIED" as FactTier };
  }
  const claimTokens = extractQuantifiedTokens(claim.text);
  const lowerSourceText = sourceText.toLowerCase();
  let supported: boolean;
  if (claimTokens.length > 0) {
    supported = claimTokens.every((t) => lowerSourceText.includes(t));
  } else if (/recall/i.test(claim.text)) {
    supported = /recall/i.test(sourceText);
  } else {
    // A bare digit with no recognizable unit (km/l, R$, %, mil, prazo) can't
    // be confidently matched against page text — a stray "20" or "5" proves
    // nothing. Err on the side of NOT confirming rather than a false match.
    supported = false;
  }
  cache.setSubkey("VERIFIED_FACT_CACHE", cacheKey, { verified: supported, checkedAt: new Date().toISOString() });
  if (!supported) logger.warn({ claim: claim.text, sourceUrl: claim.sourceUrl }, "SOURCE_VERIFIED_FACT_GATE: source text does not support claim's numbers -> UNVERIFIED");
  return { ...claim, tier: (supported ? "CONFIRMED_FACT" : "UNVERIFIED") as FactTier };
}

export async function verifyClaims(claims: TieredClaim[]): Promise<TieredClaim[]> {
  return Promise.all(claims.map(verifyClaim));
}

/**
 * Gate: at least one claim must survive as real evidence (OWNER_REPORT,
 * OFFICIAL_RECALL, or source-verified CONFIRMED_FACT) carrying a real
 * sourceUrl. UNVERIFIED claims are never counted as evidence — the caller
 * (debateReelCycle.ts) is expected to drop or reformulate them BEFORE
 * calling this gate, not rely on it to average them out.
 */
export function passesSourceVerifiedFactGate(claims: TieredClaim[], verdict: TieredClaim): { pass: boolean; reason?: string } {
  if (claims.length === 0) return { pass: false, reason: "NO_CLAIMS_PROVIDED" };
  if (verdict.tier !== "EDITORIAL_OPINION") {
    return { pass: false, reason: "VERDICT_MUST_BE_TAGGED_EDITORIAL_OPINION_NOT_PRESENTED_AS_FACT" };
  }
  const unverified = claims.filter((c) => c.tier === "UNVERIFIED");
  if (unverified.length > 0) {
    return { pass: false, reason: `UNVERIFIED_CLAIMS_MUST_BE_REMOVED_OR_REFORMULATED: ${unverified.map((c) => c.text).join(" | ")}` };
  }
  const evidence = claims.filter((c) => c.tier === "OWNER_REPORT" || c.tier === "OFFICIAL_RECALL" || c.tier === "CONFIRMED_FACT");
  if (evidence.length === 0) return { pass: false, reason: "ALL_CLAIMS_ARE_OPINION_OR_UNVERIFIED_NO_EVIDENCE" };
  const untaggedSource = evidence.find((c) => !isRealUrl(c.sourceUrl));
  if (untaggedSource) return { pass: false, reason: `CLAIM_MISSING_REAL_SOURCE_URL: "${untaggedSource.text}"` };
  return { pass: true };
}
