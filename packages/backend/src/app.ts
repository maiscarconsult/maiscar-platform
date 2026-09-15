import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import path from "path";
import { logger } from "./lib/logger";
import { apiRouter } from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { env } from "./config/env";

export function createApp() {
  const app = express();

  const allowedOrigins = env.CORS_ORIGINS.split(",").map((origin) => origin.trim());

  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true, // frontend session relies on the httpOnly cookie
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  // Basic global rate limit (section 29). Per-org/per-key limits can be
  // layered on top once billing/plans are defined.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Locally-composited carousel slides (see modules/content/imageComposer.ts)
  // — served until real object storage (S3_*) is configured.
  app.use("/generated", express.static(path.join(process.cwd(), "generated")));

  app.use("/api", apiRouter);

  app.use(errorHandler);

  return app;
}
