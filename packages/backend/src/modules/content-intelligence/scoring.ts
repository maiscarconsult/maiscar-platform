export interface ScoreWeights {
  engagement: number;
  retention: number;
  clicks: number;
  leads: number;
  conversions: number;
  revenue: number;
}

export const defaultWeights: ScoreWeights = {
  engagement: 0.1,
  retention: 0.15,
  clicks: 0.15,
  leads: 0.2,
  conversions: 0.2,
  revenue: 0.2,
};

export interface PerformanceInputs {
  engagementRate?: number; // 0-100
  retentionRate?: number; // 0-100
  clicks?: number;
  views?: number;
  leads?: number;
  sales?: number;
  revenue?: number;
}

/**
 * Normalizes raw performance metrics into 0-100 sub-scores and combines them
 * via configurable weights into a single Revenue Content Score. Per-business
 * weight configuration matters more than any fixed formula (section 32): a
 * lead-gen business should weight `leads` far more than `engagement`.
 *
 * `benchmarks` should come from the brand's own historical distribution
 * (e.g. p90 values) — passing none falls back to conservative defaults so
 * the score never silently reports 100 for an average result.
 */
export function computeRevenueContentScore(
  perf: PerformanceInputs,
  weights: ScoreWeights = defaultWeights,
  benchmarks: Partial<Record<keyof PerformanceInputs, number>> = {},
): { score: number; breakdown: Record<string, number> } {
  const clickRate = perf.views && perf.views > 0 ? ((perf.clicks ?? 0) / perf.views) * 100 : 0;
  const leadRate = perf.views && perf.views > 0 ? ((perf.leads ?? 0) / perf.views) * 100 : 0;
  const conversionRate = perf.leads && perf.leads > 0 ? ((perf.sales ?? 0) / perf.leads) * 100 : 0;
  const revenuePerThousandViews =
    perf.views && perf.views > 0 ? ((perf.revenue ?? 0) / perf.views) * 1000 : 0;

  const breakdown = {
    engagement: normalize(perf.engagementRate ?? 0, benchmarks.engagementRate ?? 10),
    retention: normalize(perf.retentionRate ?? 0, benchmarks.retentionRate ?? 50),
    clicks: normalize(clickRate, 5),
    leads: normalize(leadRate, 2),
    conversions: normalize(conversionRate, 20),
    revenue: normalize(revenuePerThousandViews, benchmarks.revenue ?? 50),
  };

  const score =
    breakdown.engagement * weights.engagement +
    breakdown.retention * weights.retention +
    breakdown.clicks * weights.clicks +
    breakdown.leads * weights.leads +
    breakdown.conversions * weights.conversions +
    breakdown.revenue * weights.revenue;

  return { score: Number(score.toFixed(2)), breakdown };
}

/** Maps a raw metric to 0-100 relative to a benchmark ("what good looks like
 *  for this brand"), capping at 100 so one outlier doesn't dominate. */
function normalize(value: number, benchmark: number): number {
  if (benchmark <= 0) return 0;
  return Math.min(100, Number(((value / benchmark) * 100).toFixed(2)));
}
