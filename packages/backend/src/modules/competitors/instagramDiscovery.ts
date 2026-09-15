import { prisma } from "../../lib/prisma";
import { decrypt } from "../../lib/crypto";
import { logger } from "../../lib/logger";

interface BusinessDiscoveryMedia {
  id: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
}

/**
 * Pulls a competitor's public Instagram posts via the Graph API's official
 * "Business Discovery" field — the sanctioned way to inspect ANOTHER public
 * Instagram Business/Creator account's own posts and aggregate counts,
 * without needing their permission. Requires the ORG's OWN Instagram
 * Business account + access token (a connected SocialAccount) to make the
 * call — Meta attributes the call to your account, not the competitor's.
 *
 * This never touches individual follower data — only the competitor's own
 * published posts (caption, like/comment counts, timestamp), same as what
 * is already visible to anyone viewing their public profile in the app.
 * If the competitor isn't a Business/Creator account, Meta simply won't
 * return `business_discovery` data (private/personal accounts are opaque).
 */
export async function syncCompetitorInstagramContent(competitorId: string): Promise<number> {
  const competitor = await prisma.competitor.findUniqueOrThrow({ where: { id: competitorId } });

  if (competitor.platform !== "instagram") {
    throw new Error("COMPETITOR_PLATFORM_NOT_INSTAGRAM");
  }
  if (competitor.dataSource !== "official_api") {
    throw new Error("COMPETITOR_NOT_CONFIGURED_FOR_OFFICIAL_API_SYNC");
  }

  const account = await prisma.socialAccount.findFirst({
    where: { brandId: competitor.brandId, platform: "instagram", accessTokenRef: { not: null } },
  });
  if (!account?.accessTokenRef) {
    throw new Error("NO_INSTAGRAM_BUSINESS_ACCOUNT_CONNECTED");
  }

  const apiKey = await prisma.apiKey.findUnique({ where: { id: account.accessTokenRef } });
  if (!apiKey) throw new Error("ACCESS_TOKEN_NOT_FOUND");
  const accessToken = decrypt(apiKey.encryptedValue);

  const username = competitor.name;
  const fields =
    `business_discovery.username(${encodeURIComponent(username)})` +
    `{followers_count,media_count,media.limit(25){caption,like_count,comments_count,media_type,media_url,permalink,timestamp}}`;

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${account.handle}?fields=${encodeURIComponent(fields)}&access_token=${accessToken}`,
  );
  if (!res.ok) {
    throw new Error(`INSTAGRAM_BUSINESS_DISCOVERY_FAILED: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const discovery = data.business_discovery;
  if (!discovery) {
    logger.warn({ competitorId, username }, "No business_discovery data — competitor may not be a public Business/Creator account");
    return 0;
  }

  const followersCount: number | undefined = discovery.followers_count;
  const media: BusinessDiscoveryMedia[] = discovery.media?.data ?? [];

  let synced = 0;
  for (const item of media) {
    const existing = await prisma.competitorContent.findFirst({
      where: { competitorId, externalId: item.id },
    });
    if (existing) continue; // already imported on a previous sync

    const likes = item.like_count ?? 0;
    const comments = item.comments_count ?? 0;
    // Business Discovery never returns reach/views/impressions for accounts
    // you don't manage — only public like/comment counts — so engagement
    // rate here is (likes+comments)/followers, the standard proxy formula
    // used when view counts aren't available (never fabricated: omitted
    // entirely when followers_count is missing).
    const engagementRate =
      followersCount && followersCount > 0
        ? Number((((likes + comments) / followersCount) * 100).toFixed(4))
        : undefined;

    await prisma.competitorContent.create({
      data: {
        competitorId,
        platform: "instagram",
        contentType: item.media_type ?? "unknown",
        publishedAt: item.timestamp ? new Date(item.timestamp) : undefined,
        likes,
        comments,
        hook: item.caption?.slice(0, 500),
        engagementRate,
        externalId: item.id,
        source: "instagram_business_discovery",
        confidence: 1.0,
      },
    });
    synced++;
  }

  logger.info({ competitorId, username, mediaFound: media.length, synced }, "Instagram Business Discovery sync complete");
  return synced;
}
