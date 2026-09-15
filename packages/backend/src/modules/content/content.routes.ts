import { Router } from "express";
import { z } from "zod";
import { ContentStatus, ContentType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AuthedRequest, requireAuth, requireOrganization } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { assertBrandInOrg } from "../brands/brands.util";
import { runGenerationJob } from "../../jobs/contentGeneration";
import { aiOrchestrator } from "../ai-orchestrator/orchestrator";
import { composeSlideImage } from "./imageComposer";

export const contentRouter = Router();
contentRouter.use(requireAuth, requireOrganization);

// On-demand trigger for the same ideation logic the daily cron runs
// (jobs/scheduler.ts) — lets the AI Orchestrator be exercised synchronously
// via the API instead of waiting for the 06:00 schedule.
contentRouter.post(
  "/generate-ideas",
  requireRole("EDITOR"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await runGenerationJob({ organizationId: req.organizationId! });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

const createSchema = z.object({
  brandId: z.string().uuid(),
  campaignId: z.string().uuid().optional(),
  pillarId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  title: z.string().optional(),
  type: z.nativeEnum(ContentType),
  hook: z.string().optional(),
  topic: z.string().optional(),
  format: z.string().optional(),
  cta: z.string().optional(),
  angle: z.string().optional(),
  targetAudience: z.string().optional(),
});

contentRouter.post("/", requireRole("EDITOR"), async (req: AuthedRequest, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    await assertBrandInOrg(input.brandId, req.organizationId!);

    if (input.campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: input.campaignId, brandId: input.brandId },
      });
      if (!campaign) return res.status(404).json({ error: "CAMPAIGN_NOT_FOUND" });
    }
    if (input.pillarId) {
      const pillar = await prisma.contentPillar.findFirst({
        where: { id: input.pillarId, brandId: input.brandId },
      });
      if (!pillar) return res.status(404).json({ error: "PILLAR_NOT_FOUND" });
    }
    if (input.productId) {
      const product = await prisma.product.findFirst({
        where: { id: input.productId, brandId: input.brandId },
      });
      if (!product) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
    }

    const content = await prisma.content.create({ data: { ...input, status: "IDEA" } });
    res.status(201).json(content);
  } catch (err) {
    next(err);
  }
});

contentRouter.get("/", requireRole("VIEWER"), async (req: AuthedRequest, res, next) => {
  try {
    const { brandId, status } = req.query as { brandId?: string; status?: ContentStatus };
    if (brandId) await assertBrandInOrg(brandId, req.organizationId!);

    const content = await prisma.content.findMany({
      where: {
        ...(brandId ? { brandId } : { brand: { organizationId: req.organizationId } }),
        ...(status ? { status } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { performance: true, assets: true },
    });
    res.json(content);
  } catch (err) {
    next(err);
  }
});

contentRouter.get("/:id", requireRole("VIEWER"), async (req: AuthedRequest, res, next) => {
  try {
    const content = await prisma.content.findFirst({
      where: { id: req.params.id, brand: { organizationId: req.organizationId } },
      include: {
        versions: true,
        assets: true,
        performance: { orderBy: { measuredAt: "desc" } },
        analyses: true,
        conversions: { include: { sale: true } },
      },
    });
    if (!content) return res.status(404).json({ error: "NOT_FOUND" });
    res.json(content);
  } catch (err) {
    next(err);
  }
});

const statusSchema = z.object({ status: z.nativeEnum(ContentStatus) });

contentRouter.patch(
  "/:id/status",
  requireRole("EDITOR"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { status } = statusSchema.parse(req.body);
      const existing = await prisma.content.findFirst({
        where: { id: req.params.id, brand: { organizationId: req.organizationId } },
      });
      if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

      const content = await prisma.content.update({
        where: { id: req.params.id },
        data: { status },
      });
      res.json(content);
    } catch (err) {
      next(err);
    }
  },
);

// Manual/official-API ingestion of performance data (never fabricated —
// section 44: dados observados vs. estimados).
const performanceSchema = z.object({
  platform: z.string(),
  views: z.number().optional(),
  reach: z.number().optional(),
  likes: z.number().optional(),
  comments: z.number().optional(),
  shares: z.number().optional(),
  saves: z.number().optional(),
  clicks: z.number().optional(),
  leads: z.number().optional(),
  sales: z.number().optional(),
  revenue: z.number().optional(),
  retentionRate: z.number().optional(),
  source: z.string(),
  confidence: z.number().min(0).max(1).default(1),
});

contentRouter.post(
  "/:id/generate-image",
  requireRole("EDITOR"),
  async (req: AuthedRequest, res, next) => {
    try {
      const content = await prisma.content.findFirst({
        where: { id: req.params.id, brand: { organizationId: req.organizationId } },
      });
      if (!content) return res.status(404).json({ error: "NOT_FOUND" });

      const prompt =
        req.body?.prompt ||
        [content.topic, content.hook, content.angle].filter(Boolean).join(". ") ||
        content.title ||
        "";
      if (!prompt) return res.status(400).json({ error: "NO_PROMPT_AVAILABLE" });

      const width = req.body?.width ?? 1024;
      const height = req.body?.height ?? 1024;
      const { url, providerName } = await aiOrchestrator.generateImage(
        { prompt, width, height },
        { organizationId: req.organizationId!, quality: "final" },
      );

      // Carousel mode: composite the generated background with the slide's
      // message text + a fixed brand footer (see imageComposer.ts). Opt-in
      // via `slideText` so plain single-image generation is unaffected.
      let finalUrl = url;
      if (req.body?.slideText) {
        const bgRes = await fetch(url);
        if (!bgRes.ok) throw new Error(`BACKGROUND_FETCH_FAILED: ${bgRes.status}`);
        const background = Buffer.from(await bgRes.arrayBuffer());
        // Deliberately false: `background` here is AI-generated
        // (aiOrchestrator.generateImage above), which the project's real-
        // photography rule bans for final publications, and this route has
        // no human review step. Fails closed — see imageComposer.ts.
        const composed = await composeSlideImage({ background, slideText: req.body.slideText, width, height, semanticMatchReviewed: false });
        finalUrl = `${req.protocol}://${req.get("host")}${composed.url}`;
      }

      const asset = await prisma.contentAsset.create({
        data: { contentId: content.id, type: "image", url: finalUrl, provider: providerName },
      });
      res.status(201).json(asset);
    } catch (err) {
      next(err);
    }
  },
);

contentRouter.post(
  "/:id/generate-video",
  requireRole("EDITOR"),
  async (req: AuthedRequest, res, next) => {
    try {
      const content = await prisma.content.findFirst({
        where: { id: req.params.id, brand: { organizationId: req.organizationId } },
      });
      if (!content) return res.status(404).json({ error: "NOT_FOUND" });

      const script =
        req.body?.script ||
        [content.hook, content.topic, content.cta].filter(Boolean).join(". ") ||
        "";
      if (!script) return res.status(400).json({ error: "NO_SCRIPT_AVAILABLE" });

      const result = await aiOrchestrator.generateVideo(
        { script, durationSeconds: req.body?.durationSeconds },
        { organizationId: req.organizationId!, quality: "final" },
      );

      if (result.status !== "completed" || !result.url) {
        // Still processing on the provider's side — nothing to persist yet.
        return res.status(202).json(result);
      }

      const asset = await prisma.contentAsset.create({
        data: { contentId: content.id, type: "video", url: result.url, provider: result.providerName },
      });
      res.status(201).json(asset);
    } catch (err) {
      next(err);
    }
  },
);

contentRouter.post(
  "/:id/performance",
  requireRole("EDITOR"),
  async (req: AuthedRequest, res, next) => {
    try {
      const input = performanceSchema.parse(req.body);
      const content = await prisma.content.findFirst({
        where: { id: req.params.id, brand: { organizationId: req.organizationId } },
      });
      if (!content) return res.status(404).json({ error: "NOT_FOUND" });

      const engagementRate =
        input.views && input.views > 0
          ? Number(
              (
                (((input.likes ?? 0) + (input.comments ?? 0) + (input.shares ?? 0) +
                  (input.saves ?? 0)) /
                  input.views) *
                100
              ).toFixed(4),
            )
          : undefined;

      const performance = await prisma.contentPerformance.create({
        data: { ...input, contentId: content.id, engagementRate },
      });
      res.status(201).json(performance);
    } catch (err) {
      next(err);
    }
  },
);
