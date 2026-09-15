import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest, requireAuth } from "../../middleware/auth";

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

// List organizations the authenticated user belongs to.
organizationsRouter.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const memberships = await prisma.membership.findMany({
      where: { userId: req.user!.userId },
      include: { organization: true },
    });
    res.json(memberships.map((m) => ({ ...m.organization, role: m.role })));
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({ name: z.string().min(1) });

organizationsRouter.post("/", async (req: AuthedRequest, res, next) => {
  try {
    const { name } = createSchema.parse(req.body);
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const org = await prisma.organization.create({
      data: {
        name,
        slug,
        memberships: { create: { userId: req.user!.userId, role: "OWNER" } },
      },
    });
    res.status(201).json(org);
  } catch (err) {
    next(err);
  }
});
