import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest, requireAuth, requireOrganization } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { assertBrandInOrg } from "../brands/brands.util";
import { syncCompetitorInstagramContent } from "./instagramDiscovery";

export const competitorsRouter = Router();
competitorsRouter.use(requireAuth, requireOrganization);

const createSchema = z.object({
  brandId: z.string().uuid(),
  name: z.string().min(1),
  profileUrl: z.string().url().optional(),
  platform: z.string().optional(),
  niche: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).optional(),
  // Enforces section 2: only legal/authorized sources.
  dataSource: z.enum(["official_api", "user_provided", "manual"]),
});

competitorsRouter.post("/", requireRole("EDITOR"), async (req: AuthedRequest, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    await assertBrandInOrg(input.brandId, req.organizationId!);
    const competitor = await prisma.competitor.create({ data: input as any });
    res.status(201).json(competitor);
  } catch (err) {
    next(err);
  }
});

competitorsRouter.get("/", requireRole("VIEWER"), async (req: AuthedRequest, res, next) => {
  try {
    const brandId = req.query.brandId as string | undefined;
    if (brandId) await assertBrandInOrg(brandId, req.organizationId!);

    const competitors = await prisma.competitor.findMany({
      where: brandId ? { brandId } : { brand: { organizationId: req.organizationId } },
      include: { competitorContent: { take: 20, orderBy: { createdAt: "desc" } } },
    });
    res.json(competitors);
  } catch (err) {
    next(err);
  }
});

// Manual ingestion of competitor content (section 2/3): the platform never
// scrapes on its own — content comes from an official API integration (to be
// plugged in as a job — see jobs/syncCompetitorContent.ts) or from data the
// user supplies themselves (e.g. exported reports, manual entry).
const contentSchema = z.object({
  platform: z.string(),
  contentType: z.string(),
  publishedAt: z.string().datetime().optional(),
  views: z.number().optional(),
  likes: z.number().optional(),
  comments: z.number().optional(),
  shares: z.number().optional(),
  saves: z.number().optional(),
  hook: z.string().optional(),
  topic: z.string().optional(),
  format: z.string().optional(),
  durationSeconds: z.number().optional(),
  cta: z.string().optional(),
  transcript: z.string().optional(),
  source: z.string(),
  confidence: z.number().min(0).max(1).default(1),
});

competitorsRouter.post(
  "/:id/content",
  requireRole("EDITOR"),
  async (req: AuthedRequest, res, next) => {
    try {
      const input = contentSchema.parse(req.body);
      const competitor = await prisma.competitor.findFirst({
        where: { id: req.params.id, brand: { organizationId: req.organizationId } },
      });
      if (!competitor) return res.status(404).json({ error: "NOT_FOUND" });

      const engagementRate = computeEngagementRate(input);

      const content = await prisma.competitorContent.create({
        data: {
          ...input,
          publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
          competitorId: competitor.id,
          engagementRate,
        },
      });
      res.status(201).json(content);
    } catch (err) {
      next(err);
    }
  },
);

// Fetches the competitor's public posts via Instagram Business Discovery
// (official Graph API — see instagramDiscovery.ts) and stores them as
// CompetitorContent, feeding the abstract pattern-discovery pipeline
// (content-intelligence/patternDiscovery.ts) that generates new AI ideas
// inspired by top performers, never copied verbatim.
competitorsRouter.post(
  "/:id/sync-instagram",
  requireRole("EDITOR"),
  async (req: AuthedRequest, res, next) => {
    try {
      const competitor = await prisma.competitor.findFirst({
        where: { id: req.params.id, brand: { organizationId: req.organizationId } },
      });
      if (!competitor) return res.status(404).json({ error: "NOT_FOUND" });

      const synced = await syncCompetitorInstagramContent(competitor.id);
      res.json({ synced });
    } catch (err) {
      next(err);
    }
  },
);

function computeEngagementRate(input: {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}): number | undefined {
  if (!input.views || input.views === 0) return undefined;
  const interactions =
    (input.likes ?? 0) + (input.comments ?? 0) + (input.shares ?? 0) + (input.saves ?? 0);
  return Number(((interactions / input.views) * 100).toFixed(4));
}
