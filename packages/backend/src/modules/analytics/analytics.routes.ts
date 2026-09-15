import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest, requireAuth, requireOrganization } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { assertBrandInOrg } from "../brands/brands.util";
import { computeRevenueContentScore, defaultWeights, ScoreWeights } from "../content-intelligence/scoring";
import { discoverHookPatterns } from "../content-intelligence/patternDiscovery";
import { predictContentScore } from "../content-intelligence/predictiveScoring";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth, requireOrganization);

// Section 20 dashboard "Performance" + "Intelligence" data, derived only
// from observed ContentPerformance rows — never fabricated.
analyticsRouter.get("/overview", requireRole("VIEWER"), async (req: AuthedRequest, res, next) => {
  try {
    const brandId = req.query.brandId as string | undefined;
    if (brandId) await assertBrandInOrg(brandId, req.organizationId!);

    const performances = await prisma.contentPerformance.findMany({
      where: brandId
        ? { content: { brandId } }
        : { content: { brand: { organizationId: req.organizationId } } },
      include: { content: { select: { id: true, title: true, hook: true, type: true, format: true, cta: true } } },
      orderBy: { measuredAt: "desc" },
      take: 500,
    });

    if (performances.length === 0) {
      return res.json({ insufficientData: true, totals: null, topContent: [] });
    }

    const totals = performances.reduce(
      (acc, p) => {
        acc.views += p.views ?? 0;
        acc.leads += p.leads ?? 0;
        acc.sales += p.sales ?? 0;
        acc.revenue += p.revenue ? Number(p.revenue) : 0;
        return acc;
      },
      { views: 0, leads: 0, sales: 0, revenue: 0 },
    );

    const weights = parseWeights(req.query.weights as string | undefined);

    const scored = performances
      .map((p) => ({
        contentId: p.content.id,
        title: p.content.title,
        hook: p.content.hook,
        ...computeRevenueContentScore(
          {
            engagementRate: p.engagementRate ?? undefined,
            retentionRate: p.retentionRate ?? undefined,
            clicks: p.clicks ?? undefined,
            views: p.views ?? undefined,
            leads: p.leads ?? undefined,
            sales: p.sales ?? undefined,
            revenue: p.revenue ? Number(p.revenue) : undefined,
          },
          weights,
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    res.json({ insufficientData: false, totals, topContent: scored, weightsUsed: weights });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get(
  "/patterns/hooks",
  requireRole("VIEWER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const brandId = req.query.brandId as string;
      if (!brandId) return res.status(400).json({ error: "brandId is required" });
      await assertBrandInOrg(brandId, req.organizationId!);

      const result = await discoverHookPatterns(brandId, req.organizationId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

analyticsRouter.get(
  "/content/:id/predict",
  requireRole("VIEWER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const content = await prisma.content.findFirst({
        where: { id: req.params.id, brand: { organizationId: req.organizationId } },
      });
      if (!content) return res.status(404).json({ error: "NOT_FOUND" });

      const result = await predictContentScore(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

function parseWeights(raw?: string): ScoreWeights {
  if (!raw) return defaultWeights;
  try {
    const parsed = JSON.parse(raw);
    return z
      .object({
        engagement: z.number(),
        retention: z.number(),
        clicks: z.number(),
        leads: z.number(),
        conversions: z.number(),
        revenue: z.number(),
      })
      .parse(parsed);
  } catch {
    return defaultWeights;
  }
}
