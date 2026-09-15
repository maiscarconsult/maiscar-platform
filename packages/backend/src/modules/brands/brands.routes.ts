import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest, requireAuth, requireOrganization } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const brandsRouter = Router();
brandsRouter.use(requireAuth, requireOrganization);

brandsRouter.get("/", requireRole("VIEWER"), async (req: AuthedRequest, res, next) => {
  try {
    const brands = await prisma.brand.findMany({
      where: { organizationId: req.organizationId },
      include: { products: true, audiences: true, competitors: true },
    });
    res.json(brands);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  positioning: z.string().optional(),
  tone: z.string().optional(),
  colors: z.array(z.string()).optional(),
});

brandsRouter.post("/", requireRole("EDITOR"), async (req: AuthedRequest, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const brand = await prisma.brand.create({
      data: { ...input, organizationId: req.organizationId! },
    });
    res.status(201).json(brand);
  } catch (err) {
    next(err);
  }
});

brandsRouter.get("/:id", requireRole("VIEWER"), async (req: AuthedRequest, res, next) => {
  try {
    const brand = await prisma.brand.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId },
      include: { products: true, audiences: true, competitors: true, contentPillars: true },
    });
    if (!brand) return res.status(404).json({ error: "NOT_FOUND" });
    res.json(brand);
  } catch (err) {
    next(err);
  }
});

brandsRouter.patch("/:id", requireRole("EDITOR"), async (req: AuthedRequest, res, next) => {
  try {
    const input = createSchema.partial().parse(req.body);
    const existing = await prisma.brand.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId },
    });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

    const brand = await prisma.brand.update({ where: { id: req.params.id }, data: input });
    res.json(brand);
  } catch (err) {
    next(err);
  }
});
