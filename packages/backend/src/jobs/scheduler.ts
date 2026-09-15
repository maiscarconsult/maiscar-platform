import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { generationQueue, metricsSyncQueue, publishingQueue } from "../lib/queue";

/**
 * Registers the recurring schedule for every active organization. Run this
 * ONCE at deploy time (or on a schedule itself, see docker-compose `worker`
 * command) — BullMQ persists repeatable job definitions in Redis, so they
 * keep firing even if this script isn't running continuously; only the
 * `worker.ts` process needs to stay up to actually execute them.
 *
 * This is literally "roda sozinho, diariamente, sem parar" — implemented as
 * infrastructure, not as a chat session.
 */
// 2026-09-02 audit: confirmed BullMQ's `jobId` DOES dedupe repeatable jobs
// across repeated calls (ran this function twice in a row — count stayed
// at 3, one per org, not 6). The 3 entries per queue found during the audit
// were 3 real orgs (Mais.car + 2 leftover test/QA orgs), not duplicates —
// false alarm, verified before "fixing" anything. Kept this one hardening:
// clear stale repeatables once per queue before re-adding, so a deleted org
// doesn't leave an orphaned scheduler running forever (jobId alone can't
// catch that case, since there's nothing left to overwrite).
async function clearRepeatables(queue: typeof metricsSyncQueue | typeof generationQueue | typeof publishingQueue, name: string) {
  const existing = await queue.getRepeatableJobs();
  for (const job of existing.filter((j) => j.name === name)) {
    await queue.removeRepeatableByKey(job.key);
  }
}

export async function scheduleRecurringJobs() {
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  await clearRepeatables(metricsSyncQueue, "sync-metrics");
  await clearRepeatables(generationQueue, "daily-ideation");
  await clearRepeatables(publishingQueue, "process-publishing-queue");

  for (const org of organizations) {
    // Every 6h: pull real performance data from connected platforms.
    await metricsSyncQueue.add(
      "sync-metrics",
      { organizationId: org.id },
      { repeat: { pattern: "0 */6 * * *" }, jobId: `metrics-sync-${org.id}` },
    );

    // Daily at 06:00: generate new content ideas from accumulated learning.
    await generationQueue.add(
      "daily-ideation",
      { organizationId: org.id, kind: "daily_ideation" },
      { repeat: { pattern: "0 6 * * *" }, jobId: `daily-ideation-${org.id}` },
    );

    // Every 15min: process anything scheduled/approved and ready to publish.
    await publishingQueue.add(
      "process-publishing-queue",
      { organizationId: org.id },
      { repeat: { pattern: "*/15 * * * *" }, jobId: `publishing-tick-${org.id}` },
    );
  }

  logger.info({ count: organizations.length }, "Recurring jobs scheduled for organizations");
}

if (require.main === module) {
  scheduleRecurringJobs()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, "Failed to schedule recurring jobs");
      process.exit(1);
    });
}
