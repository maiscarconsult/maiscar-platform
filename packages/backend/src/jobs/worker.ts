import { Job, Worker } from "bullmq";
import { connection } from "../lib/queue";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { runMetricsSyncJob } from "./metricsSync";
import { runGenerationJob } from "./contentGeneration";
import { runPublishingJob } from "./publishing";

/**
 * These workers are the actual "runs forever" part of the platform. Deploy
 * this process (e.g. `node dist/jobs/worker.js` in its own container/
 * process, see docker-compose.yml `worker` service) and it keeps consuming
 * jobs indefinitely — no chat session, no manual trigger required.
 *
 * This is what makes section 15 (Autonomous Learning Loop) real: the loop
 * runs as long as this process runs, not as long as a conversation runs.
 */

const metricsWorker = new Worker(
  "metrics-sync",
  async (job: Job) => {
    logger.info({ jobId: job.id, data: job.data }, "Running metrics-sync job");
    return runMetricsSyncJob(job.data);
  },
  { connection, concurrency: 5 },
);

const generationWorker = new Worker(
  "content-generation",
  async (job: Job) => {
    logger.info({ jobId: job.id, data: job.data }, "Running content-generation job");
    return runGenerationJob(job.data);
  },
  { connection, concurrency: 3 },
);

const publishingWorker = new Worker(
  "publishing",
  async (job: Job) => {
    logger.info({ jobId: job.id, data: job.data }, "Running publishing job");
    return runPublishingJob(job.data);
  },
  { connection, concurrency: 5 },
);

for (const worker of [metricsWorker, generationWorker, publishingWorker]) {
  worker.on("failed", (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err }, "Job failed");
  });
}

logger.info("Workers started: metrics-sync, content-generation, publishing");

process.on("SIGTERM", async () => {
  logger.info("Shutting down workers...");
  await Promise.all([metricsWorker.close(), generationWorker.close(), publishingWorker.close()]);
  await prisma.$disconnect();
  process.exit(0);
});
