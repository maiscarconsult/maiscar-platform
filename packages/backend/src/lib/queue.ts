import { Queue, QueueOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env";

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const queueOptions: QueueOptions = {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
};

// One queue per async workflow, mirroring section 15/19/20 of the spec:
// generation (content/image/video), metrics sync (pull performance from
// platforms), publishing (post to social platforms with retry/approval).
export const generationQueue = new Queue("content-generation", queueOptions);
export const metricsSyncQueue = new Queue("metrics-sync", queueOptions);
export const publishingQueue = new Queue("publishing", queueOptions);
