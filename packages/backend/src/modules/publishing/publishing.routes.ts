import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest, requireAuth, requireOrganization } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { publishingQueue } from "../../lib/queue";

export const publishingRouter = Router();
publishingRouter.use(requireAuth, requireOrganization);

// ADMIN-only: raising autonomy level is a deliberate, explicit act by the
// organization owner/admin (section 36/37 — never inferred, never defaulted
// up). Lowering it always succeeds immediately; raising it requires OWNER.
const autonomySchema = z.object({ autonomyLevel: z.number().int().min(1).max(5) });

publishingRouter.patch(
  "/autonomy-level",
  requireRole("ADMIN"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { autonomyLevel } = autonomySchema.parse(req.body);
      const current = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId },
      });

      if (autonomyLevel > current.autonomyLevel) {
        // Raising autonomy (especially to 4/5, which allows unattended
        // publishing) requires OWNER, not just ADMIN — checked directly
        // here rather than nesting middleware calls.
        const membership = await prisma.membership.findUnique({
          where: {
            userId_organizationId: { userId: req.user!.userId, organizationId: req.organizationId! },
          },
        });
        if (membership?.role !== "OWNER") {
          return res.status(403).json({ error: "ONLY_OWNER_CAN_RAISE_AUTONOMY_LEVEL" });
        }
      }

      const org = await prisma.organization.update({
        where: { id: req.organizationId },
        data: { autonomyLevel },
      });
      res.json(org);
    } catch (err) {
      next(err);
    }
  },
);

const createJobSchema = z.object({
  contentId: z.string().uuid(),
  socialAccountId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime(),
  approvalMode: z.enum(["AUTOMATIC", "HUMAN_APPROVAL"]).default("HUMAN_APPROVAL"),
});

publishingRouter.post("/", requireRole("EDITOR"), async (req: AuthedRequest, res, next) => {
  try {
    const input = createJobSchema.parse(req.body);
    const content = await prisma.content.findFirst({
      where: { id: input.contentId, brand: { organizationId: req.organizationId } },
    });
    if (!content) return res.status(404).json({ error: "NOT_FOUND" });

    const job = await prisma.publishingJob.create({
      data: {
        organizationId: req.organizationId!,
        contentId: input.contentId,
        socialAccountId: input.socialAccountId,
        scheduledFor: new Date(input.scheduledFor),
        approvalMode: input.approvalMode,
        status: "scheduled",
      },
    });

    await prisma.content.update({ where: { id: input.contentId }, data: { status: "SCHEDULED" } });

    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

publishingRouter.get("/pending-approval", requireRole("VIEWER"), async (req: AuthedRequest, res, next) => {
  try {
    const jobs = await prisma.publishingJob.findMany({
      where: { organizationId: req.organizationId, status: "scheduled", approvedAt: null },
      include: { socialAccount: true },
      orderBy: { scheduledFor: "asc" },
    });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

// Explicit human approval — required before an HUMAN_APPROVAL job (i.e. the
// vast majority, unless autonomyLevel >= 4) is ever published.
publishingRouter.post(
  "/:id/approve",
  requireRole("EDITOR"),
  async (req: AuthedRequest, res, next) => {
    try {
      const job = await prisma.publishingJob.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
      });
      if (!job) return res.status(404).json({ error: "NOT_FOUND" });

      const updated = await prisma.publishingJob.update({
        where: { id: job.id },
        data: { approvedAt: new Date() },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

publishingRouter.post(
  "/:id/cancel",
  requireRole("EDITOR"),
  async (req: AuthedRequest, res, next) => {
    try {
      const job = await prisma.publishingJob.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
      });
      if (!job) return res.status(404).json({ error: "NOT_FOUND" });

      await prisma.publishingJob.update({ where: { id: job.id }, data: { status: "failed", errorMessage: "CANCELLED_BY_USER" } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

void publishingQueue; // queue is driven by the worker's own repeatable job, not by this route file directly
