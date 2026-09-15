import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { decrypt } from "../lib/crypto";

interface MetricsSyncPayload {
  organizationId: string;
}

/**
 * Pulls real performance numbers from every connected SocialAccount /
 * sales integration and writes them as ContentPerformance / Sale rows.
 *
 * This function intentionally does NOT fabricate numbers. Each platform
 * adapter below is a clearly marked integration point — plug in the actual
 * API call using the credentials in `ApiKey` once you have them; until then
 * this job simply logs that there is nothing to sync for accounts without
 * a configured adapter, honoring section 37 ("nunca inventar métricas").
 */
export async function runMetricsSyncJob({ organizationId }: MetricsSyncPayload) {
  const accounts = await prisma.socialAccount.findMany({
    where: { brand: { organizationId } },
  });

  let synced = 0;

  for (const account of accounts) {
    const adapter = platformAdapters[account.platform];
    if (!adapter) {
      logger.debug({ platform: account.platform }, "No metrics adapter configured, skipping");
      continue;
    }
    try {
      synced += await adapter(account.id);
    } catch (err) {
      logger.error({ err, socialAccountId: account.id }, "metrics adapter failed, continuing with other accounts");
    }
  }

  const postsSynced = await syncContentPerformance(organizationId);

  logger.info({ organizationId, accountsChecked: accounts.length, synced, postsSynced }, "Metrics sync complete");
  return { accountsChecked: accounts.length, synced, postsSynced };
}

/**
 * Per-post learning loop: for content published in the last 14 days with a
 * stored Instagram media id (jobs/publishing.ts writes this to
 * ContentVersion.metadata.instagramMediaId right after a successful
 * publish), fetch real Instagram media insights and record them as
 * ContentPerformance rows (never estimated — section 37). This is what lets
 * the content pipeline eventually learn which themes/hooks/times perform.
 */
async function syncContentPerformance(organizationId: string): Promise<number> {
  const recentVersions = await prisma.contentVersion.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      content: { brand: { organizationId } },
    },
    include: { content: { include: { brand: { include: { socialAccounts: true } } } } },
  });

  let synced = 0;
  for (const version of recentVersions) {
    const mediaId = (version.metadata as Record<string, unknown> | null)?.instagramMediaId as string | undefined;
    if (!mediaId) continue;

    const account = version.content.brand.socialAccounts.find((a) => a.platform === "instagram");
    if (!account?.accessTokenRef) continue;
    const apiKey = await prisma.apiKey.findUnique({ where: { id: account.accessTokenRef } });
    if (!apiKey) continue;
    const accessToken = decrypt(apiKey.encryptedValue);

    const res = await fetch(
      `https://graph.instagram.com/v21.0/${mediaId}/insights?metric=reach,saved,likes,comments,shares&access_token=${accessToken}`,
    );
    if (!res.ok) {
      logger.warn({ mediaId, status: res.status }, "content performance fetch failed, skipping this post");
      continue;
    }
    const data = (await res.json()) as { data?: Array<{ name: string; values: Array<{ value: number }> }> };
    const metrics: Record<string, number> = {};
    for (const m of data.data ?? []) {
      const value = m.values?.[m.values.length - 1]?.value;
      if (typeof value === "number") metrics[m.name] = value;
    }

    await prisma.contentPerformance.create({
      data: {
        contentId: version.contentId,
        platform: "instagram",
        reach: metrics.reach,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        saves: metrics.saved,
        source: "meta_api",
        confidence: 1.0,
      },
    });
    synced++;
  }
  return synced;
}

type PlatformAdapter = (socialAccountId: string) => Promise<number>;

/**
 * Fetches real audience numbers (never estimated/fabricated — section 37)
 * for a Page/Instagram Business account the org itself owns, via the Meta
 * Graph API. Stored as an AudienceSnapshot, not ContentPerformance — Meta
 * only exposes account-level audience stats through this endpoint, not
 * per-post performance (that requires the platform to have actually
 * published the post itself, which jobs/publishing.ts's Meta adapter does
 * not do yet — see TODO there).
 */
async function metaAdapter(socialAccountId: string): Promise<number> {
  const account = await prisma.socialAccount.findUnique({ where: { id: socialAccountId } });
  if (!account?.accessTokenRef) {
    logger.debug({ socialAccountId }, "No Meta access token configured, skipping");
    return 0;
  }

  const apiKey = await prisma.apiKey.findUnique({ where: { id: account.accessTokenRef } });
  if (!apiKey) return 0;
  const accessToken = decrypt(apiKey.encryptedValue);

  const isInstagram = account.platform === "instagram";
  // Instagram API with Instagram Login tokens (see modules/social-accounts/
  // meta-oauth.ts) only work against graph.instagram.com — graph.facebook.com
  // requires a classic Page-linked token this org doesn't have (Business
  // Manager verification rejected, see project memory). Facebook Pages, if
  // ever connected via a different flow, would keep using graph.facebook.com.
  const graphHost = isInstagram ? "graph.instagram.com" : "graph.facebook.com";
  const profileField = isInstagram ? "followers_count" : "fan_count";
  const insightsMetrics = isInstagram
    ? "reach,profile_views"
    : "page_impressions,page_engaged_users";

  const [profileRes, insightsRes] = await Promise.all([
    fetch(`https://${graphHost}/v21.0/${account.handle}?fields=${profileField}&access_token=${accessToken}`),
    fetch(
      `https://${graphHost}/v21.0/${account.handle}/insights?metric=${insightsMetrics}&period=day&access_token=${accessToken}`,
    ),
  ]);

  if (!profileRes.ok) {
    throw new Error(`META_PROFILE_FETCH_FAILED: ${profileRes.status} ${await profileRes.text()}`);
  }
  const profile = (await profileRes.json()) as any;

  let reach: number | undefined;
  let impressions: number | undefined;
  let profileViews: number | undefined;
  let engagedUsers: number | undefined;

  if (insightsRes.ok) {
    const insights = (await insightsRes.json()) as any;
    for (const metric of insights.data ?? []) {
      const latest = metric.values?.[metric.values.length - 1]?.value;
      if (typeof latest !== "number") continue;
      if (metric.name === "reach") reach = latest;
      if (metric.name === "impressions" || metric.name === "page_impressions") impressions = latest;
      if (metric.name === "profile_views") profileViews = latest;
      if (metric.name === "page_engaged_users") engagedUsers = latest;
    }
  } else {
    logger.warn(
      { socialAccountId, status: insightsRes.status },
      "Meta insights fetch failed, saving profile-only snapshot",
    );
  }

  await prisma.audienceSnapshot.create({
    data: {
      socialAccountId,
      followers: profile.followers_count ?? profile.fan_count,
      reach,
      impressions,
      profileViews,
      engagedUsers,
      source: "meta_api",
      confidence: 1.0,
    },
  });

  return 1;
}

/**
 * TODO(tiktok-api): implement using TIKTOK_CLIENT_KEY/SECRET.
 */
async function tiktokAdapter(_socialAccountId: string): Promise<number> {
  return 0;
}

const platformAdapters: Record<string, PlatformAdapter> = {
  instagram: metaAdapter,
  facebook: metaAdapter,
  tiktok: tiktokAdapter,
};
