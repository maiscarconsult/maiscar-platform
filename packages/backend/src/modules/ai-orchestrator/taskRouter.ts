import { AICapability, AIProvider, RoutedTask } from "./types";

interface RouterConfig {
  providers: AIProvider[];
  /** Ordered preference per capability+quality, most preferred first.
   *  Falls through to the next provider if one is unavailable/fails. */
  preferences: Partial<Record<AICapability, Record<"draft" | "final", string[]>>>;
  allowMockFallback: boolean;
}

/**
 * Chooses which AIProvider handles a task, based on capability, desired
 * quality, and configured cost/latency preference — never hard-codes a
 * single vendor (section 25/26).
 */
export class TaskRouter {
  constructor(private config: RouterConfig) {}

  resolve(task: RoutedTask): AIProvider {
    return this.resolveChain(task)[0];
  }

  /** Ordered candidates for a task — preferred providers first, then any
   *  other configured provider, then mock last. Lets the caller retry the
   *  next candidate when the top pick fails at *runtime* (e.g. a configured
   *  key that's out of quota), not just when it's unconfigured. */
  resolveChain(task: RoutedTask): AIProvider[] {
    const chain: AIProvider[] = [];
    const preferredNames = this.config.preferences[task.capability]?.[task.quality] ?? [];
    for (const name of preferredNames) {
      const provider = this.config.providers.find(
        (p) => p.name === name && p.capabilities.includes(task.capability),
      );
      if (provider && !chain.includes(provider)) chain.push(provider);
    }

    for (const provider of this.config.providers) {
      if (provider.name !== "mock" && provider.capabilities.includes(task.capability) && !chain.includes(provider)) {
        chain.push(provider);
      }
    }

    if (this.config.allowMockFallback) {
      const mock = this.config.providers.find((p) => p.name === "mock");
      if (mock && !chain.includes(mock)) chain.push(mock);
    }

    if (chain.length === 0) {
      throw new Error(`NO_PROVIDER_AVAILABLE_FOR_${task.capability.toUpperCase()}`);
    }
    return chain;
  }
}

/** Default cost-aware preference table (section 26 — Cost Optimization):
 *  drafts favor cheaper/faster models, final/publish-ready output favors
 *  higher quality. Tune per-organization later via a DB-backed config. */
export const defaultPreferences: RouterConfig["preferences"] = {
  // 2026-09-10: OpenAI text generation is out of credits (real billing
  // issue, not a code bug — see OPENAI_TEXT_FAILED: insufficient_quota in
  // logs) and its draft-first position was silently eating every debate-Reel
  // script attempt. Anthropic (Haiku, via an explicit model override at the
  // call site) goes first now; OpenAI stays as fallback for whenever
  // billing is fixed.
  text: { draft: ["anthropic", "openai"], final: ["anthropic", "openai"] },
  // pollinations is free/keyless — default until OPENAI billing is set up;
  // once it is, swap the order here to prefer gpt-image-1 quality.
  image: { draft: ["pollinations", "openai"], final: ["pollinations", "openai"] },
  vision: { draft: ["anthropic"], final: ["anthropic"] },
  embedding: { draft: ["openai"], final: ["openai"] },
  video: { draft: ["replicate"], final: ["replicate"] },
  speech: { draft: [], final: [] },
};
