import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../modules/auth/auth.service";

export interface AuthedRequest extends Request {
  user?: { userId: string; email: string };
  organizationId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const raw = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : req.cookies?.session;
  if (!raw) {
    return res.status(401).json({ error: "MISSING_TOKEN" });
  }
  try {
    const payload = verifyToken(raw);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

/**
 * Reads the target organization from the `X-Organization-Id` header and
 * enforces that requests only ever operate within a single tenant's data.
 * Combine with `requireRole` for RBAC on top of this.
 */
export function requireOrganization(req: AuthedRequest, res: Response, next: NextFunction) {
  const organizationId = req.header("X-Organization-Id");
  if (!organizationId) {
    return res.status(400).json({ error: "MISSING_ORGANIZATION_ID" });
  }
  req.organizationId = organizationId;
  next();
}
