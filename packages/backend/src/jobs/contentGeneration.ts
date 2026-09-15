import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { aiOrchestrator } from "../modules/ai-orchestrator/orchestrator";
import { discoverHookPatterns } from "../modules/content-intelligence/patternDiscovery";

interface GenerationPayload {
  organizationId: string;
  kind?: "daily_ideation";
}

/**
 * The core of the "Autonomous Learning Loop" (section 15): for every brand
 * in the organization, look at what has worked historically (patterns +
 * Revenue Content Score leaders), then generate a batch of new Content
 * rows in status IDEA — never auto-published from here (publishing has its
 * own explicit approval gate, see publishing.ts).
 */
export async function runGenerationJob({ organizationId }: GenerationPayload) {
  const brands = await prisma.brand.findMany({ where: { organizationId } });
  let ideasCreated = 0;

  for (const brand of brands) {
    const patterns = await discoverHookPatterns(brand.id, organizationId);

    const topPerforming = await prisma.content.findMany({
      where: { brandId: brand.id, status: { in: ["PUBLISHED", "OPTIMIZED"] } },
      include: { performance: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    const context = [
      `Brand: ${brand.name}. Positioning: ${brand.positioning ?? "n/a"}. Tone: ${brand.tone ?? "n/a"}.`,
      patterns.insufficientData
        ? "Not enough competitor data yet for pattern-based hooks."
        : `Known winning hook patterns: ${patterns.patterns?.join(", ")}`,
      topPerforming.length > 0
        ? `Recent top content topics: ${topPerforming.map((c) => c.topic).filter(Boolean).join(", ")}`
        : "No historical published content yet.",
    ].join("\n");

    const { text } = await aiOrchestrator.generateText(
      {
        system:
          "You generate original content ideas for a brand's social media. Never copy any specific competitor line verbatim — only apply abstract patterns. Output exactly 5 ideas, one per line, format: Topic | Hook | Format | CTA.",
        prompt: context,
        maxTokens: 600,
      },
      { organizationId, quality: "draft" },
    );

    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.includes("|"));

    for (const line of lines) {
      const [topic, hook, format, cta] = line.split("|").map((s) => s.trim());
      if (!topic) continue;
      await prisma.content.create({
        data: {
          brandId: brand.id,
          type: "REEL",
          status: "IDEA",
          topic,
          hook,
          format,
          cta,
        },
      });
      ideasCreated++;
    }
  }

  logger.info({ organizationId, ideasCreated }, "Daily ideation complete");
  return { ideasCreated };
}
