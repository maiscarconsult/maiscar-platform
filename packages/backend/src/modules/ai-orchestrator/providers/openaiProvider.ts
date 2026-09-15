import { AIProvider, EmbedInput, EmbedOutput, GenerateImageInput, GenerateImageOutput, GenerateTextInput, GenerateTextOutput } from "../types";

/**
 * Thin wrapper around the OpenAI REST API. Requires OPENAI_API_KEY (see
 * .env.example). Only active when the key is present — the Task Router
 * skips providers without credentials.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly capabilities = ["text", "image", "embedding", "vision"] as const as any;

  constructor(private apiKey: string) {}

  async generateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          ...(input.system ? [{ role: "system", content: input.system }] : []),
          { role: "user", content: input.prompt },
        ],
        max_tokens: input.maxTokens ?? 800,
        temperature: input.temperature ?? 0.7,
      }),
    });
    if (!res.ok) throw new Error(`OPENAI_TEXT_FAILED: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as any;
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      tokensUsed: data.usage?.total_tokens,
    };
  }

  async generateImage(input: GenerateImageInput): Promise<GenerateImageOutput> {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: input.prompt,
        size: `${input.width ?? 1024}x${input.height ?? 1024}`,
      }),
    });
    if (!res.ok) throw new Error(`OPENAI_IMAGE_FAILED: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as any;
    // gpt-image-1 only returns b64_json (no hosted url, unlike dall-e-2/3) —
    // fall back to a data URI so the caller always gets a usable url. No
    // object-storage upload step exists yet, so this is what gets persisted
    // as-is on ContentAsset.url for now.
    const item = data.data?.[0];
    const url = item?.url ?? (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : "");
    return { url, raw: data };
  }

  async embed(input: EmbedInput): Promise<EmbedOutput> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: input.texts }),
    });
    if (!res.ok) throw new Error(`OPENAI_EMBED_FAILED: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as any;
    return { vectors: data.data.map((d: any) => d.embedding) };
  }
}
