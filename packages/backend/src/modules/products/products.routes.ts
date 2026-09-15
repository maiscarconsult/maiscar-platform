import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest, requireAuth, requireOrganization } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { assertBrandInOrg } from "../brands/brands.util";

export const productsRouter = Router();
productsRouter.use(requireAuth, requireOrganization);

const createSchema = z.object({
  brandId: z.string().uuid(),
  name: z.string().min(1),
  benefits: z.array(z.string()).optional(),
  features: z.array(z.string()).optional(),
  price: z.number().optional(),
  offers: z.array(z.string()).optional(),
  proofs: z.array(z.string()).optional(),
  guarantees: z.string().optional(),
});

productsRouter.post("/", requireRole("EDITOR"), async (req: AuthedRequest, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    await assertBrandInOrg(input.brandId, req.organizationId!);
    const product = await prisma.product.create({ data: input as any });
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

productsRouter.get("/", requireRole("VIEWER"), async (req: AuthedRequest, res, next) => {
  try {
    const brandId = req.query.brandId as string | undefined;
    if (brandId) await assertBrandInOrg(brandId, req.organizationId!);

    const products = await prisma.product.findMany({
      where: brandId ? { brandId } : { brand: { organizationId: req.organizationId } },
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
});
