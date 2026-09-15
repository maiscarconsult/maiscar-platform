/**
 * AUTO INSIGHTS (2026-09-10) — snapshots reach/views/likes/comments/shares/
 * saves/watch-time at +1h, +6h, +24h, +72h after publish, so the pipeline
 * can eventually learn which hooks/topics/durations perform. Zero LLM —
 * just Graph API reads + a DB write. Meant to run frequently (hourly) via
 * its own scheduled task; each run only touches posts whose next snapshot
 * window has actually arrived.
 */
import { prisma } from "../../lib/prisma";
import { decrypt } from "../../lib/crypto";
import { logger } from "../../lib/logger";

const SNAPSHOT_WINDOWS_MS = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "72h": 72 * 60 * 60 * 1000,
} as const;
type WindowName = keyof typeof SNAPSHOT_WINDOWS_MS;

interface InsightsSnapshot {
  window: WindowName;
  takenAt: string;
  reach?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saved?: number;
  avgWatchTimeMs?: number;
  totalWatchTimeMs?: number;
}

async function fetchInsights(mediaId: string, accessToken: string): Promise<Omit<InsightsSnapshot, "window" | "takenAt"> | null> {
  const metrics = "reach,views,likes,comments,shares,saved,ig_reels_avg_watch_time,ig_reels_video_view_total_time";
  const res = await fetch(`https://graph.instagram.com/v21.0/${mediaId}/insights?${new URLSearchParams({ metric: metrics, access_token: accessToken })}`);
  const data = (await res.json()) as { data?: Array<{ name: string; values: Array<{ value: number }> }>; error?: unknown };
  if (!res.ok || !data.data) {
    logger.warn({ mediaId, error: data.error }, "insights fetch failed");
    return null;
  }
  const byName = Object.fromEntries(data.data.map((m) => [m.name, m.values[0]?.value]));
  return {
    reach: byName.reach,
    views: byName.views,
    likes: byName.likes,
    comments: byName.comments,
    shares: byName.shares,
    saved: byName.saved,
    avgWatchTimeMs: byName.ig_reels_avg_watch_time,
    totalWatchTimeMs: byName.ig_reels_video_view_total_time,
  };
}

/** Runs one pass: for every PUBLISHED content with a mediaId, take any snapshot windows that are now due and not yet taken. */
export async function runInsightsSync(): Promise<{ checked: number; snapshotsTaken: number }> {
  const socialAccount = await prisma.socialAccount.findFirst({ where: { platform: "instagram" } });
  if (!socialAccount?.accessTokenRef) return { checked: 0, snapshotsTaken: 0 };
  const apiKey = await prisma.apiKey.findUnique({ where: { id: socialAccount.accessTokenRef } });
  if (!apiKey) return { checked: 0, snapshotsTaken: 0 };
  const accessToken = decrypt(apiKey.encryptedValue);

  const versions = await prisma.contentVersion.findMany({
    where: { content: { status: "PUBLISHED" } },
    include: { content: true },
  });

  let checked = 0;
  let snapshotsTaken = 0;
  for (const version of versions) {
    const metadata = (version.metadata as Record<string, unknown>) ?? {};
    const mediaId = metadata.instagramMediaId as string | undefined;
    const publishedAt = version.content.updatedAt; // set when status flips to PUBLISHED
    if (!mediaId) continue;
    checked++;

    const existingSnapshots = (metadata.insightsSnapshots as InsightsSnapshot[]) ?? [];
    const takenWindows = new Set(existingSnapshots.map((s) => s.window));
    const ageMs = Date.now() - publishedAt.getTime();

    for (const [windowName, thresholdMs] of Object.entries(SNAPSHOT_WINDOWS_MS) as [WindowName, number][]) {
      if (takenWindows.has(windowName)) continue;
      if (ageMs < thresholdMs) continue;
      const data = await fetchInsights(mediaId, accessToken);
      if (!data) continue;
      existingSnapshots.push({ window: windowName, takenAt: new Date().toISOString(), ...data });
      snapshotsTaken++;
    }

    if (existingSnapshots.length !== (metadata.insightsSnapshots as InsightsSnapshot[] | undefined)?.length) {
      await prisma.contentVersion.update({
        where: { id: version.id },
        data: { metadata: { ...metadata, insightsSnapshots: JSON.parse(JSON.stringify(existingSnapshots)) } },
      });
    }
  }
  return { checked, snapshotsTaken };
}
