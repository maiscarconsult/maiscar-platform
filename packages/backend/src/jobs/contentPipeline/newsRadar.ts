import * as cheerio from "cheerio";
import { cache } from "./cache";
import { logger } from "../../lib/logger";

export interface NewsCandidate {
  title: string;
  url: string;
  section?: string;
  source: string;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Fast scan (rule 16): fetch + parse headline links only — no LLM call, no
 * full-article read. Deep-read happens later, only for the 2-3 finalists
 * that survive editorial scoring. Shared by the homepage scan and the
 * broader fallback sweep below — just a different listing URL + item cap.
 */
async function fetchListingPage(url: string, cap: number): Promise<NewsCandidate[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MaisCarRadar/1.0)" },
  });
  if (!res.ok) throw new Error(`QUATRO_RODAS_FETCH_FAILED: ${res.status} (${url})`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const items: NewsCandidate[] = [];
  $("a[href*='/noticias/'], a[href*='/auto-servico/'], a[href*='/testes/']").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!href || !text || text.length < 15) return;
    // Strip a leading rank number from "mais lidas" list items ("1 Título...").
    const title = text.replace(/^\d+\s+/, "");
    if (seen.has(href)) return;
    seen.add(href);
    items.push({ title, url: href.startsWith("http") ? href : `https://quatrorodas.abril.com.br${href}`, source: "Quatro Rodas" });
  });
  return items.slice(0, cap);
}

async function fetchQuatroRodas(): Promise<NewsCandidate[]> {
  return fetchListingPage("https://quatrorodas.abril.com.br", 40);
}

/** Cached, delta-first: won't re-fetch/re-parse within the freshness window. */
export async function getNewsRadar(opts: { forceRefresh?: boolean } = {}): Promise<NewsCandidate[]> {
  const cached = cache.get("NEWS_CANDIDATES");
  if (!opts.forceRefresh && cache.isFresh(cached?.fetchedAt, SIX_HOURS_MS)) {
    logger.debug("news radar cache hit");
    return cached!.items as NewsCandidate[];
  }

  const items = await fetchQuatroRodas();
  cache.set("NEWS_CANDIDATES", { fetchedAt: new Date().toISOString(), items });
  cache.set("LAST_NEWS_SCAN", new Date().toISOString());
  return items;
}

const EXPANDED_SECTION_URLS = [
  "https://quatrorodas.abril.com.br/noticias/",
  "https://quatrorodas.abril.com.br/auto-servico/",
  "https://quatrorodas.abril.com.br/testes/",
];

/**
 * ECONOMIC_FALLBACK_SCAN (2026-09-03): a deterministic, zero-LLM second
 * sweep used ONLY when the normal cycle's first scoring pass finds nothing
 * editorially strong — broadens the net (homepage + 3 section listing
 * pages instead of just the homepage, higher per-page cap) before giving
 * up on the cycle. Honest caveat: this is NOT a true 48h-timestamp filter
 * — Quatro Rodas' listing pages don't expose reliable per-article publish
 * times without a deep-read per item, which would cost more than this
 * fallback is meant to save. "Janela ampliada" here means more listing
 * surface area, not a verified time window. Always bypasses the 6h cache
 * (the whole point is to look beyond what the normal scan already covered).
 */
export async function getNewsRadarExpanded(): Promise<NewsCandidate[]> {
  const pages = await Promise.allSettled(EXPANDED_SECTION_URLS.map((url) => fetchListingPage(url, 40)));
  const seen = new Set<string>();
  const items: NewsCandidate[] = [];
  for (const p of pages) {
    if (p.status !== "fulfilled") {
      logger.warn({ reason: p.reason }, "ECONOMIC_FALLBACK_SCAN: one section page failed, continuing with the others");
      continue;
    }
    for (const item of p.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
  }
  cache.set("NEWS_CANDIDATES_EXPANDED", { fetchedAt: new Date().toISOString(), items });
  return items;
}

const TIER_A_KEYWORDS = [
  "recall", "defeito", "falha", "problema", "revisão", "garantia", "desvalorização", "valorização",
  "preço", "aumento", "redução", "reajuste", "multa", "lei", "legislação", "consumidor", "processo",
  "freio", "airbag", "câmbio", "motor", "bateria", "manutenção", "custo", "seguro", "reclamação",
];
const TIER_B_KEYWORDS = [
  "lançamento", "híbrido", "elétrico", "tecnologia", "mercado", "versão", "vendas", "chegou", "novo",
];
const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "com", "para", "por", "que", "no", "na", "um", "uma", "novo", "nova"]);

function significantWords(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return hits / a.size;
}

/**
 * PRE_LLM_CANDIDATE_FILTER (rule 19/20 of the hardening pass) — the news
 * radar can return ~40 raw headlines; sending all of them to
 * scoreCandidates() burns tokens on obviously-weak/duplicate items before
 * the LLM ever gets a chance to judge them. This is a zero-cost, keyword +
 * dedupe heuristic that shrinks the raw list down to a handful of
 * plausible finalists — it's deliberately loose (it only needs to NOT
 * throw away a genuinely strong pauta, not to replace the real editorial
 * judgment that scoreCandidates() still does on what survives).
 */
export function preFilterCandidates(items: NewsCandidate[], limit = 8): NewsCandidate[] {
  const deduped: NewsCandidate[] = [];
  const seenWords: Set<string>[] = [];
  for (const item of items) {
    const words = significantWords(item.title);
    const isDup = seenWords.some((w) => overlapRatio(words, w) > 0.6);
    if (isDup) continue;
    seenWords.push(words);
    deduped.push(item);
  }

  const scored = deduped.map((item) => {
    const lower = item.title.toLowerCase();
    const tierAHits = TIER_A_KEYWORDS.filter((k) => lower.includes(k)).length;
    const tierBHits = TIER_B_KEYWORDS.filter((k) => lower.includes(k)).length;
    return { item, heuristicScore: tierAHits * 3 + tierBHits };
  });

  scored.sort((a, b) => b.heuristicScore - a.heuristicScore);
  return scored.slice(0, limit).map((s) => s.item);
}

/**
 * Deep-read: fetches one article's full text — only called for finalists,
 * not for every candidate (rule 16). Deterministic HTML extraction, no LLM.
 */
export async function deepReadArticle(url: string): Promise<{ title: string; text: string; publishedAt?: string }> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MaisCarRadar/1.0)" } });
  if (!res.ok) throw new Error(`ARTICLE_FETCH_FAILED: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const article = $("article").first();
  const title = $("h1").first().text().trim() || $("title").text().trim();
  const text = (article.length ? article.text() : $("body").text()).replace(/\s+/g, " ").trim();
  return { title, text: text.slice(0, 8000) };
}
