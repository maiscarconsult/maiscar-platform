import { AIProvider, GenerateVideoInput, GenerateVideoOutput } from "../types";

// Kling v1.6 standard (image-optional text-to-video). Swap via env later if
// a different model/quality tier is needed — kept as a single constant
// instead of a config table since this is the only video model wired up.
const MODEL_VERSION = "kwaivgi/kling-v1.6-standard";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40; // ~2 minutes; caller gets back "processing" if exceeded

/**
 * Thin wrapper around the Replicate REST API. Requires REPLICATE_API_TOKEN
 * (see .env.example). Video generation is async on Replicate's side — this
 * creates the prediction and polls briefly for a fast result, but returns
 * status "processing" with the jobId if it doesn't finish in time so the
 * caller isn't blocked indefinitely on a slow generation.
 */
export class ReplicateProvider implements AIProvider {
  readonly name = "replicate";
  readonly capabilities = ["video"] as const as any;

  constructor(private apiToken: string) {}

  async generateVideo(input: GenerateVideoInput): Promise<GenerateVideoOutput> {
    const createRes = await fetch(`https://api.replicate.com/v1/models/${MODEL_VERSION}/predictions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiToken}`,
        Prefer: "wait=5", // ask Replicate to hold the response up to 5s if it's fast
      },
      body: JSON.stringify({
        input: {
          prompt: input.script,
          duration: input.durationSeconds ?? 5,
        },
      }),
    });

    if (!createRes.ok) {
      throw new Error(`REPLICATE_VIDEO_CREATE_FAILED: ${createRes.status} ${await createRes.text()}`);
    }

    let prediction = (await createRes.json()) as any;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      if (prediction.status === "succeeded" || prediction.status === "failed" || prediction.status === "canceled") {
        break;
      }
      await sleep(POLL_INTERVAL_MS);
      const pollRes = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      if (!pollRes.ok) {
        throw new Error(`REPLICATE_VIDEO_POLL_FAILED: ${pollRes.status} ${await pollRes.text()}`);
      }
      prediction = (await pollRes.json()) as any;
    }

    if (prediction.status === "succeeded") {
      const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      return { jobId: prediction.id, status: "completed", url };
    }
    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(`REPLICATE_VIDEO_GENERATION_FAILED: ${prediction.error ?? prediction.status}`);
    }
    // Still running after MAX_POLL_ATTEMPTS — caller can poll Replicate
    // directly using jobId via GET /v1/predictions/{id} if needed.
    return { jobId: prediction.id, status: "processing" };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
