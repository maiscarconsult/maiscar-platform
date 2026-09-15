import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { registerUser, loginUser, signToken, verifyToken } from "./auth.service";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

export const authRouter = Router();

// Tighter than the global limit (app.ts) — mitigates password brute-forcing
// and mass account creation against these two specific endpoints.
const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const SESSION_COOKIE = "session";
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  organizationName: z.string().min(1),
});

authRouter.post("/register", authRateLimit, async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const user = await registerUser(input);
    const token = signToken({ userId: user.id, email: user.email });
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      organization: user.memberships[0]?.organization,
    });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", authRateLimit, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await loginUser(email, password);
    const token = signToken({ userId: user.id, email: user.email });
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
      })),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
  res.status(204).send();
});

authRouter.get("/me", async (req, res, next) => {
  try {
    const raw = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length)
      : req.cookies?.[SESSION_COOKIE];
    if (!raw) return res.status(401).json({ error: "MISSING_TOKEN" });

    const payload = verifyToken(raw);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { memberships: { include: { organization: true } } },
    });
    if (!user) return res.status(401).json({ error: "INVALID_TOKEN" });

    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
      })),
    });
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
});
