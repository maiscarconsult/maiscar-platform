export type AICapability = "text" | "image" | "video" | "embedding" | "vision" | "speech";

export interface GenerateTextInput {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Explicit model override — lets a caller force a cheaper tier (e.g. Haiku) within a provider that supports it. Provider-specific; ignored by providers that don't. */
  model?: string;
}

export interface TokenUsage {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Only populated when the provider's API exposes it (e.g. extended thinking on Claude). */
  thinkingTokens?: number;
}

export interface GenerateTextOutput {
  text: string;
  tokensUsed?: number;
  usage?: TokenUsage;
}

export interface GenerateImageInput {
  prompt: string;
  width?: number;
  height?: number;
  style?: string;
}

export interface GenerateImageOutput {
  url: string; // object-storage URL once uploaded by the caller
  raw?: unknown;
}

export interface GenerateVideoInput {
  script: string;
  style?: "ugc" | "faceless" | "educational" | "storytelling" | "product" | "testimonial";
  durationSeconds?: number;
}

export interface GenerateVideoOutput {
  jobId: string; // most video providers are async — caller polls or gets a webhook
  status: "queued" | "processing" | "completed" | "failed";
  url?: string;
}

export interface AnalyzeImageInput {
  /** Fetched by the provider's own HTTP call — fails for hosts that block generic fetchers (some CDNs/wikis do), prefer imageBase64 for those. */
  imageUrl?: string;
  /** Raw image bytes, base64-encoded — use when the caller already has the file locally or imageUrl fetch is unreliable. */
  imageBase64?: string;
  mediaType?: "image/jpeg" | "image/png" | "image/webp";
  question?: string;
  model?: string;
}

export interface AnalyzeVideoInput {
  videoUrl: string;
  question?: string;
}

export interface EmbedInput {
  texts: string[];
}

export interface EmbedOutput {
  vectors: number[][];
}

/**
 * Every AI capability the platform needs goes through this interface.
 * No domain module ever imports an SDK (OpenAI/Anthropic/Stability/...)
 * directly — only implementations of AIProvider do, keeping the platform
 * provider-agnostic (section 11/25).
 */
export interface AIProvider {
  readonly name: string;
  readonly capabilities: AICapability[];

  generateText?(input: GenerateTextInput): Promise<GenerateTextOutput>;
  generateImage?(input: GenerateImageInput): Promise<GenerateImageOutput>;
  generateVideo?(input: GenerateVideoInput): Promise<GenerateVideoOutput>;
  analyzeImage?(input: AnalyzeImageInput): Promise<GenerateTextOutput>;
  analyzeVideo?(input: AnalyzeVideoInput): Promise<GenerateTextOutput>;
  embed?(input: EmbedInput): Promise<EmbedOutput>;
}

export interface RoutedTask {
  capability: AICapability;
  /** Rough quality bar needed: "draft" for cheap/fast iterations, "final" for
   *  publish-ready output. Lets the Task Router pick cheaper models for
   *  drafts (section 26 — Cost Optimization). */
  quality: "draft" | "final";
}
