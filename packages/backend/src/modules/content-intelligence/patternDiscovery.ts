import { prisma } from "../../lib/prisma";
import { aiOrchestrator } from "../ai-orchestrator/orchestrator";

const MIN_SAMPLE_SIZE = 5;

export interface PatternDiscoveryResult {
  insufficientData: boolean;
  sampleSize: number;
  patterns?: string[];
  reasoning?: string;
}

/**
 * Extracts ABSTRACT structural patterns (e.g. "problem-aware hook + negative
 * framing + numbered list") from a brand's tracked competitor content — never
 * verbatim hooks/copy, and never presented as something to copy outright
 * (section 7 and 37: nunca copiar conteúdo protegido de concorrentes).
 *
 * Requires a minimum sample size; otherwise returns `insufficientData: true`
 * instead of forcing a conclusion from noise (section 34/44).
 */
export async function discoverHookPatterns(
  brandId: string,
  organizationId: string,
): Promise<PatternDiscoveryResult> {
  const topContent = await prisma.competitorContent.findMany({
    where: { competitor: { brandId }, hook: { not: null } },
    orderBy: { engagementRate: "desc" },
    take: 30,
  });

  if (topContent.length < MIN_SAMPLE_SIZE) {
    return { insufficientData: true, sampleSize: topContent.length };
  }

  const hooks = topContent.map((c) => c.hook).filter(Boolean) as string[];

  const prompt = [
    "You are a content-strategy analyst. Given these high-performing hooks",
    "from different creators in the same niche, identify the ABSTRACT",
    "structural patterns they share (framing, structure, psychological",
    "triggers, format). Do NOT quote or reproduce the hooks verbatim.",
    "Return 3-6 short pattern names, one per line, no numbering.",
    "",
    "Hooks (for pattern analysis only, do not reproduce):",
    hooks.map((h, i) => `${i + 1}. ${h}`).join("\n"),
  ].join("\n");

  const { text } = await aiOrchestrator.generateText(
    { prompt, system: "Identify abstract patterns only. Never output verbatim quotes back.", maxTokens: 400 },
    { organizationId, quality: "draft" },
  );

  const patterns = text
    .split("\n")
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);

  return {
    insufficientData: false,
    sampleSize: topContent.length,
    patterns,
    reasoning: `Derived from top ${topContent.length} competitor hooks by engagement rate.`,
  };
}
