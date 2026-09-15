import { AIProvider, GenerateImageInput, GenerateImageOutput, GenerateTextInput, GenerateTextOutput, GenerateVideoInput, GenerateVideoOutput, EmbedInput, EmbedOutput } from "../types";

/**
 * Deterministic, offline provider. Used as the automatic fallback when no
 * API key is configured for a capability, so the whole platform (including
 * demos/tests) runs end-to-end without external dependencies. Never used
 * silently for anything presented to the end user as "real AI output" in
 * production — the Task Router only falls back to it when explicitly
 * allowed (see taskRouter.ts `allowMockFallback`).
 */
export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly capabilities = ["text", "image", "video", "embedding", "vision", "speech"] as const as any;

  async generateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
    const fields = extractPipeFormat(input.system);
    const text = fields
      ? Array.from({ length: 5 }, (_, i) => fields.map((f) => `Mock ${f} ${i + 1}`).join(" | ")).join("\n")
      : `[MOCK OUTPUT] ${input.prompt.slice(0, 120)}`;
    return {
      text,
      tokensUsed: Math.ceil(input.prompt.length / 4),
    };
  }

  async generateImage(input: GenerateImageInput): Promise<GenerateImageOutput> {
    return { url: `https://placehold.co/${input.width ?? 1024}x${input.height ?? 1024}?text=mock` };
  }

  async generateVideo(_input: GenerateVideoInput): Promise<GenerateVideoOutput> {
    return { jobId: `mock-${Date.now()}`, status: "completed", url: "https://example.com/mock-video.mp4" };
  }

  async embed(input: EmbedInput): Promise<EmbedOutput> {
    // Deterministic pseudo-embedding so tests are reproducible.
    return {
      vectors: input.texts.map((t) => {
        const seed = hashString(t);
        return Array.from({ length: 16 }, (_, i) => Math.sin(seed + i));
      }),
    };
  }
}

// Recognizes prompts that ask for a "field | field | field" output line
// (e.g. jobs/contentGeneration.ts) so the mock provider can still exercise
// callers' parsing logic end-to-end without a real model configured.
function extractPipeFormat(system?: string): string[] | null {
  if (!system) return null;
  const match = system.match(/format:\s*([^.]+)\./i);
  if (!match) return null;
  const fields = match[1].split("|").map((f) => f.trim()).filter(Boolean);
  return fields.length > 1 ? fields : null;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
