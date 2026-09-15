import { prisma } from "../../lib/prisma";
import { computeRevenueContentScore, defaultWeights } from "./scoring";

const MIN_HISTORICAL_SAMPLES = 10;

export interface PredictiveScore {
  insufficientData: boolean;
  sampleSize: number;
  isEstimate: true; // always explicit — section 33/44: never present as fact
  scores?: {
    viralPotential: number;
    engagementPotential: number;
    retentionPotential: number;
    leadPotential: number;
    conversionPotential: number;
    revenuePotential: number;
    overall: number;
  };
}

/**
 * Estimates potential performance for a not-yet-published Content item by
 * comparing it (same pillar/format/type) against the brand's own historical
 * distribution. This is explicitly a statistical estimate, never a
 * guarantee — callers must render `isEstimate` prominently in the UI.
 */
export async function predictContentScore(contentId: string): Promise<PredictiveScore> {
  const content = await prisma.content.findUniqueOrThrow({
    where: { id: contentId },
    select: { brandId: true, type: true, pillarId: true },
  });

  const historical = await prisma.content.findMany({
    where: {
      brandId: content.brandId,
      type: content.type,
      ...(content.pillarId ? { pillarId: content.pillarId } : {}),
      status: { in: ["PUBLISHED", "ANALYZING", "OPTIMIZED"] },
    },
    include: { performance: { orderBy: { measuredAt: "desc" } } },
    take: 200,
  });

  const samples = historical.filter((c) => c.performance.length > 0);

  if (samples.length < MIN_HISTORICAL_SAMPLES) {
    return { insufficientData: true, sampleSize: samples.length, isEstimate: true };
  }

  const perScores = samples.map((c) => {
    const perf = aggregateLatest(c.performance);
    return computeRevenueContentScore(perf, defaultWeights).score;
  });

  const overall = average(perScores);
  const p90 = percentile(perScores, 0.9);

  // Simple, explainable heuristic for the MVP: potentials are the brand's
  // own historical average/percentile for this format+pillar, not a
  // black-box ML prediction. Upgrade path: replace with a trained model
  // once enough labeled data accumulates (section 34 — avoid false causal
  // claims from small samples).
  return {
    insufficientData: false,
    sampleSize: samples.length,
    isEstimate: true,
    scores: {
      viralPotential: Number(overall.toFixed(1)),
      engagementPotential: Number(average(perScores.map((s) => Math.min(100, s * 1.1))).toFixed(1)),
      retentionPotential: Number(overall.toFixed(1)),
      leadPotential: Number(overall.toFixed(1)),
      conversionPotential: Number(overall.toFixed(1)),
      revenuePotential: Number(p90.toFixed(1)),
      overall: Number(overall.toFixed(1)),
    },
  };
}

function aggregateLatest(performance: { views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; clicks: number | null; leads: number | null; sales: number | null; revenue: any; retentionRate: number | null; engagementRate: number | null }[]) {
  const latest = performance[0];
  return {
    engagementRate: latest?.engagementRate ?? undefined,
    retentionRate: latest?.retentionRate ?? undefined,
    clicks: latest?.clicks ?? undefined,
    views: latest?.views ?? undefined,
    leads: latest?.leads ?? undefined,
    sales: latest?.sales ?? undefined,
    revenue: latest?.revenue ? Number(latest.revenue) : undefined,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx] ?? 0;
}
