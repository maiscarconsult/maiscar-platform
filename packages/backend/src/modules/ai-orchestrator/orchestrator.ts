import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { logAiCall } from "../../lib/aiTelemetry";
import { env } from "../../config/env";
import { MockProvider } from "./providers/mockProvider";
import { OpenAIProvider } from "./providers/openaiProvider";
import { AnthropicProvider } from "./providers/anthropicProvider";
import { ReplicateProvider } from "./providers/replicateProvider";
import { PollinationsProvider } from "./providers/pollinationsProvider";
import { TaskRouter, defaultPreferences } from "./taskRouter";
import {
  AIProvider,
  GenerateTextInput,
  GenerateTextOutput,
  GenerateImageInput,
  GenerateImageOutput,
  GenerateVideoInput,
  GenerateVideoOutput,
  AnalyzeImageInput,
} from "./types";

function buildProviders(): AIProvider[] {
  const providers: AIProvider[] = [new MockProvider()];
  if (env.OPENAI_API_KEY) providers.push(new OpenAIProvider(env.OPENAI_API_KEY));
  if (env.ANTHROPIC_API_KEY) providers.push(new AnthropicProvider(env.ANTHROPIC_API_KEY));
  if (env.REPLICATE_API_TOKEN) providers.push(new ReplicateProvider(env.REPLICATE_API_TOKEN));
  providers.push(new PollinationsProvider()); // free, keyless — always available
  return providers;
}

const providers = buildProviders();
const router = new TaskRouter({ providers, preferences: defaultPreferences, allowMockFallback: true });

interface OrchestratorContext {
  organizationId: string;
  promptVersionId?: string;
  quality?: "draft" | "final";
  /** Short tag identifying which pipeline step made this call (e.g. "editorial-scoring", "photo-verify") — used only for telemetry, never persisted with prompt content. */
  purpose?: string;
}

/**
 * Single entry point every domain module must use to talk to AI. Wraps every
 * call with a GenerationJob log (request_id, model, latency, cost, status —
 * section 30) so the platform can later discover which prompts/models/
 * strategies perform best (section 15 — Autonomous Learning Loop, section 31
 * — Prompt Management).
 */
export const aiOrchestrator = {
  async generateText(input: GenerateTextInput, ctx: OrchestratorContext): Promise<GenerateTextOutput> {
    const chain = router.resolveChain({ capability: "text", quality: ctx.quality ?? "draft" });
    return runWithFallback(chain, (provider) =>
      runLogged("generateText", provider, ctx, input, () => provider.generateText!(input)),
    );
  },

  async generateImage(
    input: GenerateImageInput,
    ctx: OrchestratorContext,
  ): Promise<GenerateImageOutput & { providerName: string }> {
    const chain = router.resolveChain({ capability: "image", quality: ctx.quality ?? "draft" });
    const { output, provider } = await runWithFallback(chain, async (provider) => ({
      output: await runLogged("generateImage", provider, ctx, input, () => provider.generateImage!(input)),
      provider,
    }));
    return { ...output, providerName: provider.name };
  },

  async analyzeImage(input: AnalyzeImageInput, ctx: OrchestratorContext): Promise<GenerateTextOutput> {
    const chain = router.resolveChain({ capability: "vision", quality: ctx.quality ?? "draft" });
    return runWithFallback(chain, (provider) =>
      runLogged("analyzeImage", provider, ctx, input, () => provider.analyzeImage!(input)),
    );
  },

  async embed(texts: string[], ctx: OrchestratorContext) {
    const chain = router.resolveChain({ capability: "embedding", quality: ctx.quality ?? "draft" });
    return runWithFallback(chain, (provider) =>
      runLogged("embed", provider, ctx, { texts }, () => provider.embed!({ texts })),
    );
  },

  async generateVideo(
    input: GenerateVideoInput,
    ctx: OrchestratorContext,
  ): Promise<GenerateVideoOutput & { providerName: string }> {
    const chain = router.resolveChain({ capability: "video", quality: ctx.quality ?? "draft" });
    const { output, provider } = await runWithFallback(chain, async (provider) => ({
      output: await runLogged("generateVideo", provider, ctx, input, () => provider.generateVideo!(input)),
      provider,
    }));
    return { ...output, providerName: provider.name };
  },
};

/** Tries each provider in the chain in order, moving to the next on failure
 *  (e.g. a configured key that's hit a quota/outage at call time) instead of
 *  failing the whole request just because the top preference is down. */
async function runWithFallback<T>(
  chain: AIProvider[],
  fn: (provider: AIProvider) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (const provider of chain) {
    try {
      return await fn(provider);
    } catch (err) {
      lastErr = err;
      logger.warn({ err, provider: provider.name }, "provider failed, trying next fallback");
    }
  }
  throw lastErr;
}

/**
 * DB-RESILIENT LOGGING (2026-09-11) — this row is telemetry, not part of
 * the actual AI request. A Postgres outage (confirmed real scenario:
 * Docker Desktop's engine down) used to fail generateText/analyzeImage
 * outright at this line, before the real provider was ever called — losing
 * a usage-tracking row is a fine trade-off, losing a whole Haiku/Vision
 * call to a logging failure is not. Wrapped in try/catch; a failure here
 * logs a warning and proceeds with `jobId: undefined` (later update calls
 * are then skipped, not attempted against a nonexistent row).
 */
async function createJobLogSafely(provider: AIProvider, ctx: OrchestratorContext, operation: string, input: unknown): Promise<string | undefined> {
  try {
    const job = await prisma.generationJob.create({
      data: {
        organizationId: ctx.organizationId,
        promptVersionId: ctx.promptVersionId,
        modelUsed: provider.name,
        status: "running",
        // Redacted: only shape/size metadata, never prompt/image content
        // (rule from the token-usage audit — a full prompt/base64 image was
        // being written to this row on every call before this fix).
        input: { operation, purpose: ctx.purpose, ...redactedShape(input) },
      },
    });
    return job.id;
  } catch (err) {
    logger.warn({ err, provider: provider.name, operation }, "generationJob logging unavailable (DB down?) — proceeding without a job id, AI call still runs");
    return undefined;
  }
}

async function runLogged<T>(
  operation: string,
  provider: AIProvider,
  ctx: OrchestratorContext,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const jobId = await createJobLogSafely(provider, ctx, operation, input);

  const startedAt = Date.now();
  try {
    const output = await fn();
    const latencyMs = Date.now() - startedAt;
    const usage = (output as { usage?: { model: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number; thinkingTokens?: number } })?.usage;
    if (jobId) {
      try {
        await prisma.generationJob.update({
          where: { id: jobId },
          data: {
            status: "completed",
            output: redactedShape(output) as any,
            latencyMs,
            completedAt: new Date(),
          },
        });
      } catch (err) {
        logger.warn({ err, jobId }, "generationJob completion update failed (DB down?) — AI call still succeeded");
      }
    }
    logAiCall({
      timestamp: new Date().toISOString(),
      purpose: ctx.purpose ?? operation,
      provider: provider.name,
      model: usage?.model,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      cacheReadTokens: usage?.cacheReadTokens,
      cacheCreationTokens: usage?.cacheCreationTokens,
      thinkingTokens: usage?.thinkingTokens,
      latencyMs,
      status: "completed",
    });
    return output;
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    logger.error({ err, provider: provider.name, operation }, "AI generation failed");
    if (jobId) {
      try {
        await prisma.generationJob.update({
          where: { id: jobId },
          data: {
            status: "failed",
            latencyMs,
            errorMessage: err instanceof Error ? err.message : "UNKNOWN_ERROR",
            completedAt: new Date(),
          },
        });
      } catch (updateErr) {
        logger.warn({ updateErr, jobId }, "generationJob failure update failed (DB down?)");
      }
    }
    logAiCall({
      timestamp: new Date().toISOString(),
      purpose: ctx.purpose ?? operation,
      provider: provider.name,
      latencyMs,
      status: "failed",
    });
    throw err;
  }
}

/** Strips prompt/image/text content, keeps only sizes and non-content fields — used for both the DB row and would be used for logs if any were added here. */
function redactedShape(value: unknown): Record<string, unknown> {
  const CONTENT_KEYS = new Set(["prompt", "system", "text", "imageBase64", "imageUrl", "texts"]);
  const obj = JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (CONTENT_KEYS.has(k) && typeof v === "string") {
      out[`${k}Chars`] = v.length;
    } else if (CONTENT_KEYS.has(k) && Array.isArray(v)) {
      out[`${k}Count`] = v.length;
    } else {
      out[k] = v;
    }
  }
  return out;
}
