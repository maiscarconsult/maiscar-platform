import * as cheerio from "cheerio";
import { logger } from "../../lib/logger";
import { cache } from "./cache";
import { NewsCandidate } from "./newsRadar";

// Shared across both daily cycles (rule 2026-09-09: "UMA COLETA → MÚLTIPLO
// APROVEITAMENTO") — post 2's evergreen search reuses post 1's results
// instead of re-searching every seed again within the same day.
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * HIGH_INTEREST_EVERGREEN route (2026-09-08) — only runs when BREAKING_NEWS
 * (today's radar + its own broader-sweep fallback, both in run.ts) finds
 * nothing >=80. Rather than "today's news", this route looks for durable,
 * high-consequence automotive topics for Brazilian buyers/owners — chronic
 * defects, expensive maintenance, depreciation, "before you buy this" —
 * that don't need to have appeared today to matter.
 *
 * Deterministic end-to-end, no LLM: EVERGREEN_SEEDS is a fixed, curated list
 * of specific model+engine/transmission+problem-pattern combinations (data,
 * not generated text), each checked against Quatro Rodas' own site search
 * (real HTTP fetch + cheerio parse) so every candidate is backed by an
 * actual, fetchable article — never asserted from memory alone. A local
 * specificity filter then discards anything that reads as generic ("sinais
 * de defeito no câmbio") instead of naming a real mechanism + consequence.
 */
const EVERGREEN_SEEDS = [
  "câmbio CVT Nissan problema",
  "motor 1.0 turbo corrente de comando",
  "câmbio automatizado Dualogic defeito",
  "motor EA211 TSI consumo de óleo",
  "câmbio CVT X-Tronic Renault problema",
  "câmbio automático ZF 9 marchas Jeep defeito",
  "HB20 câmbio automático problema",
  "Onix motor problema quilometragem",
  "T-Cross câmbio problema",
  "carro usado que compensa comprar",
  "desvalorização carro usado motor problema",
  "antes de comprar carro usado atenção",
];

const MODEL_OR_MECH_TOKENS = [
  "cvt", "dualogic", "automatizado", "tsi", "turbo", "zf", "x-tronic", "dsg",
  "onix", "hb20", "t-cross", "compass", "argo", "mobi", "uno", "kwid", "polo",
  "virtus", "tracker", "creta", "nivus", "tera", "pulse", "renegade", "tucson",
  "spin", "cronos", "versa", "kicks", "duster", "sandero", "logan", "corolla",
  "hilux", "câmbio", "motor", "embreagem",
];
const CONSEQUENCE_TOKENS = [
  "defeito", "problema", "falha", "desgaste", "consumo de óleo", "recall",
  "corrente", "superaquecimento", "travamento", "trepidação", "ruído",
  "custo", "reparo", "conserto", "substituição", "desvaloriza", "compensa",
  "vale a pena", "atenção", "cuidado", "caro",
];

/** Rejects generic titles ("sintomas de câmbio com defeito") — requires a real mechanism/model token AND a consequence token together, matching the rule's "modelo/motor/câmbio + problema + consequência" shape. */
function isSpecificEvergreen(title: string): boolean {
  const lower = title.toLowerCase();
  const hasMech = MODEL_OR_MECH_TOKENS.some((t) => lower.includes(t));
  const hasConsequence = CONSEQUENCE_TOKENS.some((t) => lower.includes(t));
  return hasMech && hasConsequence;
}

/** Exported for reuse by comparisonDebateRadar.ts — same real-site-search grounding discipline, different seed queries. */
export async function searchQuatroRodas(query: string): Promise<NewsCandidate[]> {
  const url = `https://quatrorodas.abril.com.br/?s=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MaisCarRadar/1.0)" } });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const items: NewsCandidate[] = [];
  $("a[href*='/noticias/'], a[href*='/auto-servico/'], a[href*='/testes/']").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!href || !text || text.length < 15 || seen.has(href)) return;
    seen.add(href);
    items.push({
      title: text.replace(/^\d+\s+/, ""),
      url: href.startsWith("http") ? href : `https://quatrorodas.abril.com.br${href}`,
      source: "Quatro Rodas (evergreen)",
    });
  });
  return items.slice(0, 3); // cap per-seed so one popular seed can't dominate all 10 slots
}

export async function getEvergreenCandidates(opts: { forceRefresh?: boolean } = {}): Promise<NewsCandidate[]> {
  const cached = cache.get("EVERGREEN_CANDIDATES");
  if (!opts.forceRefresh && cache.isFresh(cached?.fetchedAt, TWELVE_HOURS_MS)) {
    return cached!.items as NewsCandidate[];
  }

  const seen = new Set<string>();
  const items: NewsCandidate[] = [];
  for (const seed of EVERGREEN_SEEDS) {
    if (items.length >= 10) break;
    try {
      const hits = await searchQuatroRodas(seed);
      for (const h of hits) {
        if (seen.has(h.url) || !isSpecificEvergreen(h.title)) continue;
        seen.add(h.url);
        items.push(h);
        if (items.length >= 10) break;
      }
    } catch (err) {
      logger.warn({ err, seed }, "HIGH_INTEREST_EVERGREEN: seed search failed, continuing with next");
    }
  }
  cache.set("EVERGREEN_CANDIDATES", { fetchedAt: new Date().toISOString(), items });
  return items;
}
