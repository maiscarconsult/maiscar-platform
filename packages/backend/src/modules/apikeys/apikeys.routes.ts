import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { encrypt } from "../../lib/crypto";
import { AuthedRequest, requireAuth, requireOrganization } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const apiKeysRouter = Router();
apiKeysRouter.use(requireAuth, requireOrganization);

// Only ADMIN+ can manage third-party credentials for the organization.
apiKeysRouter.get("/", requireRole("ADMIN"), async (req: AuthedRequest, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { organizationId: req.organizationId },
      select: { id: true, provider: true, createdAt: true },
    });
    res.json(keys);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  provider: z.string().min(1),
  value: z.string().min(1),
});

apiKeysRouter.post("/", requireRole("ADMIN"), async (req: AuthedRequest, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const apiKey = await prisma.apiKey.create({
      data: {
        organizationId: req.organizationId!,
        provider: input.provider,
        encryptedValue: encrypt(input.value),
      },
      select: { id: true, provider: true, createdAt: true },
    });
    res.status(201).json(apiKey);
  } catch (err) {
    next(err);
  }
});

apiKeysRouter.delete("/:id", requireRole("ADMIN"), async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.apiKey.findFirst({
      where: { id: req.params.id, organizationId: req.organizationId },
    });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

    await prisma.apiKey.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
