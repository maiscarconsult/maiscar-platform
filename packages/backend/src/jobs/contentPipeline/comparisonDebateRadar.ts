import { logger } from "../../lib/logger";
import { cache } from "./cache";
import { NewsCandidate } from "./newsRadar";
import { searchQuatroRodas } from "./evergreenRadar";

/**
 * ROUTE 3's OWN radar (2026-09-09) — the earlier bug: ROUTE 3 was judging
 * candidates correctly (ENGAGEMENT_SCORE worked) but drawing them from the
 * SAME single-vehicle news feed as ROUTE 1/2, which almost never produces a
 * genuine "Carro A x Carro B, mesmo orçamento" or "má fama ou injustiça?"
 * candidate. This module generates that shape directly, deterministically,
 * from a curated seed list of REAL, well-known Brazilian-market model
 * pairings/rivalries (data, not LLM output — same discipline as
 * evergreenRadar.ts's EVERGREEN_SEEDS).
 *
 * Nothing here invents a price, defect, or reputation claim: every
 * candidate is grounded by a real Quatro Rodas search hit (real HTTP fetch
 * + cheerio parse) before being offered — if no real article backs a
 * pairing, that pairing is silently dropped, never asserted anyway. Price
 * comparisons stay at "mesma faixa"/"mesmo orçamento" band language,
 * deliberately never a fabricated exact R$ figure.
 */
type ComparisonCategory =
  | "ZERO_X_USADO" | "ANTIGO_X_NOVO" | "ELETRICO_X_COMBUSTAO" | "HIBRIDO_X_COMBUSTAO"
  | "SUV_X_SEDA" | "MA_FAMA" | "SUPERVALORIZADO" | "ENTREGA_MENOS"
  | "NOVO_X_USADO_PREMIUM" | "CONCORRENTES_MESMO_PRECO";

interface ComparisonSeed {
  category: ComparisonCategory;
  modelA: string;
  modelB?: string;
  searchQuery: string;
  titleTemplate: (a: string, b?: string) => string;
}

// Real, well-known Brazilian-market pairings/rivalries and reputation
// patterns — curated data, not generated. Each still needs a real search
// hit to actually become a candidate (see below).
const SEEDS: ComparisonSeed[] = [
  { category: "ZERO_X_USADO", modelA: "Chevrolet Onix", modelB: "Toyota Corolla", searchQuery: "Onix zero km Corolla usado comparativo", titleTemplate: (a, b) => `${a} 0km ou ${b} usado no mesmo orçamento: qual vale mais?` },
  { category: "ELETRICO_X_COMBUSTAO", modelA: "BYD Dolphin", modelB: "Volkswagen Polo", searchQuery: "BYD Dolphin Polo comparativo custo", titleTemplate: (a, b) => `${a} ou ${b}: elétrico realmente sai mais barato?` },
  { category: "HIBRIDO_X_COMBUSTAO", modelA: "Toyota Corolla Hybrid", modelB: "Honda Civic", searchQuery: "Corolla Hybrid Civic comparativo", titleTemplate: (a, b) => `${a} ou ${b}: híbrido compensa o preço?` },
  { category: "SUV_X_SEDA", modelA: "Jeep Compass", modelB: "Toyota Corolla", searchQuery: "Compass Corolla comparativo qual comprar", titleTemplate: (a, b) => `${a} ou ${b}: SUV ou sedã no mesmo dinheiro?` },
  { category: "MA_FAMA", modelA: "Fiat Fastback", searchQuery: "Fiat Fastback problema reclamação dono", titleTemplate: (a) => `${a}: bomba ou fama injusta?` },
  { category: "MA_FAMA", modelA: "Jeep Renegade", searchQuery: "Jeep Renegade problema reclamação dono", titleTemplate: (a) => `${a}: má fama merecida ou exagero da internet?` },
  { category: "SUPERVALORIZADO", modelA: "Jeep Compass", searchQuery: "Jeep Compass caro vale a pena preço", titleTemplate: (a) => `${a}: vale mesmo esse preço?` },
  { category: "ENTREGA_MENOS", modelA: "Volkswagen Polo", searchQuery: "Polo nova geração perdeu equipamento mais caro", titleTemplate: (a) => `${a} novo: mais caro e com menos equipamento. Evolução?` },
  { category: "NOVO_X_USADO_PREMIUM", modelA: "Chevrolet Tracker", modelB: "BMW", searchQuery: "SUV compacto zero BMW usado comparativo preço", titleTemplate: (a, b) => `${a} 0km ou ${b} usado premium: qual você levaria?` },
  { category: "CONCORRENTES_MESMO_PRECO", modelA: "Hyundai Creta", modelB: "Chevrolet Tracker", searchQuery: "Creta Tracker comparativo qual comprar", titleTemplate: (a, b) => `${a} ou ${b}: mesma faixa de preço, qual leva?` },
  { category: "ANTIGO_X_NOVO", modelA: "Honda Civic", searchQuery: "Civic geração antiga nova comparativo vale a pena", titleTemplate: (a) => `${a} antigo ou novo: a geração nova realmente melhorou?` },
];

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * Deterministic collection (script + real search hit, zero LLM) capped at 3
 * — SPECIFICITY_GATE and ENGAGEMENT_SCORE run downstream in run.ts exactly
 * like every other source. Cached daily (rule: uma coleta, múltiplo
 * aproveitamento) so post 2 reuses post 1's results.
 */
export async function getComparisonDebateCandidates(opts: { forceRefresh?: boolean } = {}): Promise<NewsCandidate[]> {
  const cached = cache.get("COMPARISON_DEBATE_CANDIDATES");
  if (!opts.forceRefresh && cache.isFresh(cached?.fetchedAt, TWELVE_HOURS_MS)) {
    return cached!.items as NewsCandidate[];
  }

  const items: NewsCandidate[] = [];
  for (const seed of SEEDS) {
    if (items.length >= 3) break;
    try {
      const hits = await searchQuatroRodas(seed.searchQuery);
      if (hits.length === 0) continue; // no real article grounds this pairing today — drop it, never assert anyway
      items.push({
        title: seed.titleTemplate(seed.modelA, seed.modelB),
        url: hits[0].url,
        source: `Comparison Radar (${seed.category})`,
      });
    } catch (err) {
      logger.warn({ err, seed: seed.searchQuery }, "COMPARISON_DEBATE_RADAR: seed search failed, continuing with next");
    }
  }

  cache.set("COMPARISON_DEBATE_CANDIDATES", { fetchedAt: new Date().toISOString(), items });
  return items;
}
