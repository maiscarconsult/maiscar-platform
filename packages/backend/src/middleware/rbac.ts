import { NextFunction, Response } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthedRequest } from "./auth";

const roleRank: Record<Role, number> = {
  VIEWER: 0,
  ANALYST: 1,
  EDITOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

/**
 * Ensures the authenticated user belongs to req.organizationId with at least
 * `minRole`, and enforces data isolation between organizations (section 29:
 * multi-tenancy, isolamento de dados por organização).
 */
export function requireRole(minRole: Role) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.organizationId) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }

    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: req.user.userId,
          organizationId: req.organizationId,
        },
      },
    });

    if (!membership) {
      return res.status(403).json({ error: "NOT_A_MEMBER_OF_ORGANIZATION" });
    }

    if (roleRank[membership.role] < roleRank[minRole]) {
      return res.status(403).json({ error: "INSUFFICIENT_ROLE" });
    }

    next();
  };
}
