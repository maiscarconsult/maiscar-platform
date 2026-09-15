/**
 * RADAR DE POLÊMICA (2026-09-10) — real, no-auth signal gathering for the
 * FULL_AUTONOMOUS_MOTION_REEL pipeline. Zero LLM calls. Combines:
 *  - Reddit's public search JSON endpoint (no API key needed for read-only
 *    public search) for real owner complaints/discussion threads;
 *  - the existing comparison-debate candidate cache (already scraped from
 *    automotive press for "X ou Y, qual vale mais a pena" style pieces).
 * Produces ControversyCandidate objects for controversyScoring.ts to score
 * — this module does NOT decide what's good, it only counts real signals.
 */
import { cache } from "./cache";
import { getComparisonDebateCandidates } from "./comparisonDebateRadar";
import { getNewsRadar, preFilterCandidates } from "./newsRadar";
import { getEvergreenCandidates } from "./evergreenRadar";
import { ControversyCandidate, ControversyCategory } from "./controversyScoring";
import { logger } from "../../lib/logger";

const MONEY_KEYWORDS = ["preço", "caro", "manutenção", "desvaloriza", "revenda", "custo", "financiamento", "consumo"];
const RECURRING_KEYWORDS = ["recorrente", "vários relatos", "diversos relatos", "sempre", "toda vez", "de novo", "outra vez", "vários donos"];
const KNOWN_MODELS = ["compass", "corolla", "onix", "hb20", "polo", "kwid", "kicks", "creta", "renegade", "strada", "toro", "argo", "pulse", "fastback", "cronos", "tracker", "t-cross", "nivus", "duster", "dolphin", "byd"];

interface RedditPost {
  title: string;
  numComments: number;
  url: string;
  createdUtc: number;
}

async function searchReddit(query: string): Promise<RedditPost[]> {
  const cacheKey = `reddit:${query}`;
  const cached = cache.getSubkey<{ fetchedAt: string; result: RedditPost[] }>("PHOTO_QUERY_CACHE", cacheKey);
  if (cached && cache.isFresh(cached.fetchedAt, 12 * 60 * 60 * 1000)) return cached.result;

  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=15&t=month`;
    const res = await fetch(url, { headers: { "User-Agent": "MaisCarRadar/1.0 (by /u/maiscar)" } });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { children?: Array<{ data: { title: string; num_comments: number; permalink: string; created_utc: number } }> } };
    const items: RedditPost[] = (data.data?.children ?? []).map((c) => ({
      title: c.data.title,
      numComments: c.data.num_comments,
      url: `https://reddit.com${c.data.permalink}`,
      createdUtc: c.data.created_utc,
    }));
    cache.setSubkey("PHOTO_QUERY_CACHE", cacheKey, { fetchedAt: new Date().toISOString(), result: items });
    return items;
  } catch (err) {
    logger.warn({ err, query }, "reddit search failed, treating as no results");
    return [];
  }
}

const MYTH_KEYWORDS = ["mito", "vale a pena", "compensa", "verdade sobre", "será que"];

function buildCandidate(title: string, sourceCount: number, sourceUrl?: string, category?: ControversyCategory): ControversyCandidate {
  const lower = title.toLowerCase();
  // AUTOMOTIVE_MYTH is a content pattern, not a separate source: any
  // candidate (usually from the evergreen feed) framed as myth-busting/
  // "vale a pena?" gets reclassified regardless of where it was fetched.
  const resolvedCategory: ControversyCategory | undefined =
    category === "EVERGREEN_CONTROVERSY" && MYTH_KEYWORDS.some((k) => lower.includes(k)) ? "AUTOMOTIVE_MYTH" : category;
  return {
    title,
    sourceCount,
    mentionsSpecificModel: KNOWN_MODELS.some((m) => lower.includes(m)),
    mentionsMoney: MONEY_KEYWORDS.some((k) => lower.includes(k)),
    mentionsRecurringPattern: RECURRING_KEYWORDS.some((k) => lower.includes(k)) || sourceCount >= 3,
    isEvergreen: !/\b(202[4-9]|recall\s+\d)\b/.test(lower) || RECURRING_KEYWORDS.some((k) => lower.includes(k)),
    sourceUrl,
    category: resolvedCategory,
  };
}

/**
 * FULL RADAR (2026-09-10): gathers real controversy candidates across the
 * whole requested fallback chain — BREAKING (today's Quatro Rodas homepage,
 * tier-A-keyword filtered) -> OWNER_PAIN (Reddit real search) ->
 * EVERGREEN_CONTROVERSY (curated, real-article-grounded chronic-defect
 * seeds) -> UNPOPULAR_OPINION (comparison-debate cache) -> AUTOMOTIVE_MYTH
 * (myth-framed items reclassified out of the evergreen feed). Each branch
 * is independently try/caught — one source failing (e.g. Reddit down) never
 * empties the whole radar, which is exactly what lets the cycle never
 * abandon just for lack of breaking news. Zero LLM calls throughout.
 */
export async function getControversyCandidates(): Promise<ControversyCandidate[]> {
  const queries = ["carro problema recorrente brasil", "concessionária recusou garantia", "carro superestimado brasil", "reclame aqui carro defeito"];
  const redditResults = await Promise.all(queries.map((q) => searchReddit(q)));
  const redditCandidates = redditResults.flat().map((p) => buildCandidate(p.title, Math.max(1, Math.round(p.numComments / 20)), p.url, "OWNER_PAIN"));

  const debateCandidates = await getComparisonDebateCandidates();
  const debateAsControversy = debateCandidates.map((d) => buildCandidate(d.title, 2, d.url, "UNPOPULAR_OPINION"));

  let breakingCandidates: ControversyCandidate[] = [];
  try {
    const news = preFilterCandidates(await getNewsRadar(), 6);
    breakingCandidates = news.map((n) => buildCandidate(n.title, 1, n.url, "BREAKING"));
  } catch (err) {
    logger.warn({ err }, "FULL_RADAR: BREAKING source failed, continuing without it");
  }

  let evergreenCandidates: ControversyCandidate[] = [];
  try {
    const evg = await getEvergreenCandidates();
    evergreenCandidates = evg.map((e) => buildCandidate(e.title, 2, e.url, "EVERGREEN_CONTROVERSY"));
  } catch (err) {
    logger.warn({ err }, "FULL_RADAR: EVERGREEN_CONTROVERSY source failed, continuing without it");
  }

  // Dedup by normalized title prefix (cheap, no LLM). Merge order follows
  // the declared fallback-chain priority; scoreControversy() still decides
  // the actual winner, this only breaks ties/dedup collisions consistently.
  const seen = new Set<string>();
  const merged: ControversyCandidate[] = [];
  for (const c of [...breakingCandidates, ...redditCandidates, ...evergreenCandidates, ...debateAsControversy]) {
    const key = c.title.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return merged;
}
