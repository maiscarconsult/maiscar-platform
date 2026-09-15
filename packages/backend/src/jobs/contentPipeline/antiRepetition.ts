/**
 * NÃO REPETIR (2026-09-10) — checks the last few published/prepared Reels
 * so the pipeline doesn't run the same car, same music, or a near-identical
 * title back to back. Pure DB query, zero LLM.
 */
import { prisma } from "../../lib/prisma";

export interface RecentReel {
  title: string;
  musicTrack?: string;
}

export async function getRecentReels(brandId: string, limit = 5): Promise<RecentReel[]> {
  const recent = await prisma.content.findMany({
    where: { brandId, type: "REEL" },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { versions: { orderBy: { versionNum: "desc" }, take: 1 } },
  });
  return recent.map((c) => ({
    title: c.title ?? "",
    musicTrack: (c.versions[0]?.metadata as Record<string, unknown> | undefined)?.musicTrack as string | undefined,
  }));
}

/** Cheap word-overlap check — not semantic, just enough to catch "same car, same angle" repeats. */
export function isTooSimilar(candidateTitle: string, recent: RecentReel[]): boolean {
  const candidateWords = new Set(candidateTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  for (const r of recent) {
    const recentWords = new Set(r.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const overlap = [...candidateWords].filter((w) => recentWords.has(w)).length;
    if (overlap >= 3) return true; // 3+ shared significant words = probably the same topic
  }
  return false;
}
