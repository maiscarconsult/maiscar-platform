import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { env } from "../config/env";
import { decrypt } from "../lib/crypto";
import { publishImageToInstagram, publishCarouselToInstagram } from "../modules/social-accounts/meta-oauth";
import { uploadForPublicAccess } from "./contentPipeline/publicTunnel";

const GENERATED_DIR = path.join(__dirname, "..", "..", "generated");

interface PublishingPayload {
  organizationId: string;
}

/**
 * Processes PublishingJob rows that are due. Hard rule (section 19/37): a
 * job with approvalMode "HUMAN_APPROVAL" is NEVER published without
 * `approvedAt` set by a real user action via the API — this loop only
 * publishes jobs that are either AUTOMATIC (and the org has explicitly
 * enabled Autonomy Level >= 4) or already human-approved.
 */
export async function runPublishingJob({ organizationId }: PublishingPayload) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { autonomyLevel: true },
  });

  const dueJobs = await prisma.publishingJob.findMany({
    where: {
      organizationId,
      status: "scheduled",
      scheduledFor: { lte: new Date() },
    },
    include: { socialAccount: true },
  });

  let published = 0;
  let skippedForApproval = 0;

  for (const job of dueJobs) {
    const isAutomatic = job.approvalMode === "AUTOMATIC";

    // Hard gate: AUTOMATIC publishing only executes if the organization has
    // explicitly opted into Autonomy Level >= 4 (section 36). A job marked
    // AUTOMATIC on an org still at level 1-3 is treated as if it required
    // approval — the worker never publishes ahead of the user's configured
    // ceiling, regardless of what a single PublishingJob row says.
    const automaticAllowed = isAutomatic && org.autonomyLevel >= 4;

    if (!automaticAllowed && !job.approvedAt) {
      skippedForApproval++;
      continue;
    }

    // If the machine was off/asleep past the scheduled time by a lot (e.g.
    // computer stayed off overnight), don't fire off a stack of backed-up
    // posts at once when it comes back — that reads as spam and defeats the
    // whole point of staggered posting times. Recalculate: skip it as stale
    // and let the next day's pipeline run produce a fresh, properly-timed
    // replacement instead.
    const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;
    if (job.scheduledFor && Date.now() - job.scheduledFor.getTime() > STALE_THRESHOLD_MS) {
      await prisma.publishingJob.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: "SCHEDULE_TOO_STALE_SKIPPED" },
      });
      logger.warn({ jobId: job.id, scheduledFor: job.scheduledFor }, "publishing job too stale, skipping instead of posting late");
      continue;
    }

    const adapter = publishAdapters[job.socialAccount?.platform ?? ""];
    if (!adapter) {
      await prisma.publishingJob.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: "NO_PUBLISH_ADAPTER_CONFIGURED" },
      });
      continue;
    }

    // Idempotency: atomically claim the job by flipping scheduled->publishing
    // before doing any network call. If two ticks raced on the same job
    // (e.g. a manual test run overlapping the real cron), only one wins this
    // conditional update — the other sees count 0 and skips, so we never
    // create two Instagram posts for the same PublishingJob.
    const claim = await prisma.publishingJob.updateMany({
      where: { id: job.id, status: "scheduled" },
      data: { status: "publishing" },
    });
    if (claim.count === 0) continue;

    try {
      await publishWithRetry(adapter, job);
      await prisma.publishingJob.update({
        where: { id: job.id },
        data: { status: "published", publishedAt: new Date() },
      });
      published++;
    } catch (err) {
      await prisma.publishingJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "UNKNOWN_ERROR",
        },
      });
    }
  }

  logger.info({ organizationId, published, skippedForApproval }, "Publishing tick complete");
  return { published, skippedForApproval };
}

type DueJob = Prisma.PublishingJobGetPayload<{ include: { socialAccount: true } }>;
type PublishAdapter = (job: DueJob) => Promise<void>;

/** Retries transient failures (network/fetch-level errors) with backoff.
 * Does NOT retry on errors that indicate the call reached Instagram and got
 * an explicit rejection (e.g. content policy, invalid media) — retrying
 * those would just fail again identically. */
async function publishWithRetry(adapter: PublishAdapter, job: DueJob): Promise<void> {
  const delaysMs = [0, 5_000, 15_000];
  let lastErr: unknown;
  for (const delay of delaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      await adapter(job);
      return;
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = /fetch failed|ECONNRESET|ETIMEDOUT|network|timeout/i.test(message);
      if (!isTransient) throw err;
      logger.warn({ jobId: job.id, message }, "publish attempt failed with a transient error, retrying");
    }
  }
  throw lastErr;
}

/**
 * Instagram API with Instagram Login (Content Publishing API) — publishes
 * the content's generated image(s) with the pipeline's full caption.
 * socialAccount.handle holds the Instagram user id (from the OAuth
 * callback, see modules/social-accounts/meta-callback.routes.ts);
 * socialAccount.accessTokenRef points at the encrypted long-lived token.
 */
async function instagramPublishAdapter(job: DueJob): Promise<void> {
  if (!job.socialAccount?.accessTokenRef) {
    throw new Error("SOCIAL_ACCOUNT_NOT_CONNECTED");
  }
  if (!job.contentId) {
    throw new Error("PUBLISHING_JOB_HAS_NO_CONTENT");
  }

  const content = await prisma.content.findUniqueOrThrow({
    where: { id: job.contentId },
    include: {
      assets: { where: { type: "image" }, orderBy: { createdAt: "asc" } },
      versions: { orderBy: { versionNum: "desc" }, take: 1 },
    },
  });
  const apiKey = await prisma.apiKey.findUniqueOrThrow({
    where: { id: job.socialAccount.accessTokenRef },
  });

  if (content.assets.length === 0) throw new Error("NO_IMAGE_ASSET_TO_PUBLISH");

  // Prefer the fully-written caption (ContentVersion.copy, produced by the
  // content pipeline) — hook/topic/cta join is only a fallback for content
  // created before that pipeline existed.
  const version = content.versions[0];
  const caption = version?.copy ?? [content.hook, content.topic, content.cta].filter(Boolean).join("\n\n");
  const accessToken = decrypt(apiKey.encryptedValue);

  // Instagram can't fetch images from this machine directly (no fixed
  // public domain, and Meta actively blocks ephemeral tunnel domains as
  // media sources — see contentPipeline/publicTunnel.ts). Any locally-served
  // asset gets re-hosted on a real public host before it's handed to the
  // Content Publishing API.
  const localPrefix = `http://localhost:${env.PORT}/generated/`;
  const imageUrls = await Promise.all(
    content.assets.map(async (a) => {
      if (!a.url.startsWith(localPrefix)) return a.url;
      const fileName = a.url.slice(localPrefix.length);
      return uploadForPublicAccess(path.join(GENERATED_DIR, fileName));
    }),
  );

  const result =
    content.type === "CAROUSEL" && imageUrls.length >= 2
      ? await publishCarouselToInstagram(job.socialAccount!.handle, accessToken, imageUrls, caption)
      : await publishImageToInstagram(job.socialAccount!.handle, accessToken, imageUrls[0], caption);

  if (version) {
    await prisma.contentVersion.update({
      where: { id: version.id },
      data: {
        metadata: {
          ...((version.metadata as Record<string, unknown>) ?? {}),
          instagramMediaId: result.mediaId,
        },
      },
    });
  }
}

/** Facebook Page publishing needs the classic Page-based Graph API, which
 * this org can't use yet (Business Manager verification rejected — see
 * project memory). Not implemented until that's resolved. */
async function facebookPublishAdapter(_job: DueJob): Promise<void> {
  throw new Error("FACEBOOK_PUBLISH_NOT_CONFIGURED");
}

const publishAdapters: Record<string, PublishAdapter> = {
  instagram: instagramPublishAdapter,
  facebook: facebookPublishAdapter,
};
