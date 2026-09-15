import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest, requireAuth, requireOrganization } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { assertBrandInOrg } from "../brands/brands.util";
import { buildAuthorizationUrl } from "./meta-oauth";

export const socialAccountsRouter = Router();
socialAccountsRouter.use(requireAuth, requireOrganization);

// Kicks off Instagram API with Instagram Login (no Facebook Page needed —
// chosen because this org's Business Manager verification is rejected,
// which blocks the classic Page-based Instagram Graph API flow).
socialAccountsRouter.get(
  "/instagram/oauth-url",
  requireRole("ADMIN"),
  async (req: AuthedRequest, res, next) => {
    try {
      const brandId = req.query.brandId as string | undefined;
      if (!brandId) return res.status(400).json({ error: "BRAND_ID_REQUIRED" });
      await assertBrandInOrg(brandId, req.organizationId!);

      const url = buildAuthorizationUrl({ organizationId: req.organizationId!, brandId });
      res.json({ url });
    } catch (err) {
      next(err);
    }
  },
);

// Connects the org's OWN Meta account (Page / Instagram Business or Creator
// account). accessTokenRef must point at an ApiKey the org already created
// via POST /api/api-keys (provider "meta") — the raw token is never sent or
// stored here directly, only its encrypted reference (section 30).
const createSchema = z.object({
  brandId: z.string().uuid(),
  platform: z.enum(["instagram", "facebook", "tiktok"]),
  // Meta Page ID or Instagram Business Account ID (numeric id, not @handle)
  handle: z.string().min(1),
  accessTokenRef: z.string().uuid(),
});

socialAccountsRouter.post("/", requireRole("ADMIN"), async (req: AuthedRequest, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    await assertBrandInOrg(input.brandId, req.organizationId!);

    const apiKey = await prisma.apiKey.findFirst({
      where: { id: input.accessTokenRef, organizationId: req.organizationId },
    });
    if (!apiKey) return res.status(404).json({ error: "API_KEY_NOT_FOUND" });

    const account = await prisma.socialAccount.create({ data: input });
    res.status(201).json({ id: account.id, brandId: account.brandId, platform: account.platform, handle: account.handle });
  } catch (err) {
    next(err);
  }
});

socialAccountsRouter.get("/", requireRole("VIEWER"), async (req: AuthedRequest, res, next) => {
  try {
    const brandId = req.query.brandId as string | undefined;
    if (brandId) await assertBrandInOrg(brandId, req.organizationId!);

    const accounts = await prisma.socialAccount.findMany({
      where: brandId ? { brandId } : { brand: { organizationId: req.organizationId } },
      select: { id: true, brandId: true, platform: true, handle: true, connectedAt: true },
    });
    res.json(accounts);
  } catch (err) {
    next(err);
  }
});

socialAccountsRouter.get(
  "/:id/audience",
  requireRole("VIEWER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const account = await prisma.socialAccount.findFirst({
        where: { id: req.params.id, brand: { organizationId: req.organizationId } },
      });
      if (!account) return res.status(404).json({ error: "NOT_FOUND" });

      const snapshots = await prisma.audienceSnapshot.findMany({
        where: { socialAccountId: account.id },
        orderBy: { measuredAt: "desc" },
        take: 90,
      });
      res.json(snapshots);
    } catch (err) {
      next(err);
    }
  },
);

socialAccountsRouter.delete("/:id", requireRole("ADMIN"), async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.socialAccount.findFirst({
      where: { id: req.params.id, brand: { organizationId: req.organizationId } },
    });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

    await prisma.socialAccount.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
