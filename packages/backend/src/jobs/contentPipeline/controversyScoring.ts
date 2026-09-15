/**
 * ENGAGEMENT_POTENTIAL scoring (2026-09-10) — pure code, zero LLM calls.
 * Scores a candidate controversy topic on the 7 dimensions the user
 * specified, from cheap countable signals (how many independent sources/
 * threads mention it, whether it names a specific brand/model, whether a
 * cost/money angle is present, whether it's framed as a recurring pattern
 * vs a one-off, recency). This is a heuristic gate, not a claim of
 * scientific precision — its only job is "is this worth spending a Vision/
 * Haiku call on", same spirit as cheapRelevanceScore in photoSourcing.ts.
 */
/** FULL RADAR fallback-chain priority (2026-09-10): the pipeline never
 *  abandons a cycle just because there's no breaking news today — it walks
 *  this chain and always has something real to fall back to. */
export type ControversyCategory = "BREAKING" | "OWNER_PAIN" | "EVERGREEN_CONTROVERSY" | "UNPOPULAR_OPINION" | "AUTOMOTIVE_MYTH";

export interface ControversyCandidate {
  title: string;
  sourceCount: number; // how many distinct sources/threads raised this
  mentionsSpecificModel: boolean;
  mentionsMoney: boolean; // cost, price, desvalorização, manutenção cara, etc.
  mentionsRecurringPattern: boolean; // "recorrente", "vários relatos", not a single anecdote
  isEvergreen: boolean; // not tied to a single news event that will feel stale in days
  /** Real, fetchable URL of the thread/article this candidate came from —
   *  required by SOURCE_VERIFIED_FACT_GATE to check claims against actual
   *  source content instead of trusting the script-writer's own tags. */
  sourceUrl?: string;
  category?: ControversyCategory;
}

export interface EngagementScore {
  polarization: number;
  commentPotential: number;
  personalRelevance: number;
  financialConsequence: number;
  ownerPain: number;
  curiosity: number;
  shareability: number;
  total: number; // average of the 7, 0-100
}

export function scoreControversy(c: ControversyCandidate): EngagementScore {
  const sourceBoost = Math.min(c.sourceCount * 8, 40); // caps out at 5 independent sources
  const polarization = clamp(45 + sourceBoost + (c.mentionsRecurringPattern ? 15 : 0));
  const commentPotential = clamp(40 + sourceBoost + (c.mentionsSpecificModel ? 15 : 0) + (c.mentionsRecurringPattern ? 10 : 0));
  const personalRelevance = clamp(35 + (c.mentionsSpecificModel ? 25 : 0) + sourceBoost / 2);
  const financialConsequence = clamp(30 + (c.mentionsMoney ? 40 : 0) + sourceBoost / 2);
  const ownerPain = clamp(30 + (c.mentionsRecurringPattern ? 30 : 0) + (c.mentionsMoney ? 15 : 0) + sourceBoost / 3);
  const curiosity = clamp(40 + (c.mentionsSpecificModel ? 10 : 0) + sourceBoost / 2);
  const shareability = clamp(35 + (c.isEvergreen ? 20 : 0) + sourceBoost / 2 + (c.mentionsMoney ? 10 : 0));
  const total = Math.round((polarization + commentPotential + personalRelevance + financialConsequence + ownerPain + curiosity + shareability) / 7);
  return { polarization, commentPotential, personalRelevance, financialConsequence, ownerPain, curiosity, shareability, total };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export const MIN_ENGAGEMENT_POTENTIAL = 80;
