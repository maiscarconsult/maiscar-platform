import { AIProvider, AnalyzeImageInput, GenerateTextInput, GenerateTextOutput } from "../types";

/**
 * Thin wrapper around the Anthropic Messages API. Requires ANTHROPIC_API_KEY.
 * Good fit for copy/hook generation, content analysis and reasoning-heavy
 * tasks (e.g. pattern discovery in content-intelligence module).
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly capabilities = ["text", "vision"] as const as any;

  constructor(private apiKey: string) {}

  async generateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
    const model = input.model ?? "claude-sonnet-5";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens ?? 1000,
        system: input.system,
        messages: [{ role: "user", content: input.prompt }],
      }),
    });
    if (!res.ok) throw new Error(`ANTHROPIC_TEXT_FAILED: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as any;
    const text = data.content?.map((c: any) => c.text ?? "").join("\n") ?? "";
    return { text, usage: extractUsage(model, data.usage) };
  }

  async analyzeImage(input: AnalyzeImageInput): Promise<GenerateTextOutput> {
    // Anthropic's own URL-fetch source rejects some hosts outright (CDNs/wikis
    // that block generic server-side fetchers — confirmed against Wikimedia,
    // 400 "Unable to download the file"). base64 is the reliable path; url
    // stays supported for hosts that do work with it.
    const model = input.model ?? "claude-sonnet-5";
    const source = input.imageBase64
      ? { type: "base64", media_type: input.mediaType ?? "image/jpeg", data: input.imageBase64 }
      : { type: "url", url: input.imageUrl };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source },
              { type: "text", text: input.question ?? "Describe the visual style and composition." },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ANTHROPIC_VISION_FAILED: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as any;
    const text = data.content?.map((c: any) => c.text ?? "").join("\n") ?? "";
    return { text, usage: extractUsage(model, data.usage) };
  }
}

/** Anthropic's `usage` object shape varies slightly by feature (cache/thinking fields only appear when relevant) — read defensively, never throw on a missing field. */
function extractUsage(model: string, usage: any) {
  if (!usage) return undefined;
  return {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens,
    thinkingTokens: usage.output_tokens_details?.thinking_tokens,
  };
}
