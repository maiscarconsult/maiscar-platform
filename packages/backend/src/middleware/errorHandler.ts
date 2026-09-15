import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";

const knownErrorStatus: Record<string, number> = {
  EMAIL_ALREADY_REGISTERED: 409,
  INVALID_CREDENTIALS: 401,
  NOT_FOUND: 404,
  INSUFFICIENT_ROLE: 403,
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({ error: "VALIDATION_ERROR", issues: err.flatten() });
  }

  if (err instanceof Error) {
    const status = knownErrorStatus[err.message] ?? 500;
    if (status === 500) {
      logger.error({ err, path: req.path }, "Unhandled error");
      return res.status(500).json({ error: "INTERNAL_ERROR" });
    }
    return res.status(status).json({ error: err.message });
  }

  logger.error({ err, path: req.path }, "Unknown error shape");
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}
