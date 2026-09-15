import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { encrypt } from "../../lib/crypto";
import {
  verifyState,
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  fetchInstagramProfile,
} from "./meta-oauth";

// Public route (no requireAuth) — Instagram redirects the browser here
// directly with ?code=&state=, it never carries our own Bearer token.
export const metaCallbackRouter = Router();

metaCallbackRouter.get("/instagram/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<string, string | undefined>;

  if (error) {
    return res.status(400).json({ error: "INSTAGRAM_AUTHORIZATION_DENIED", detail: error_description ?? error });
  }
  if (!code || !state) {
    return res.status(400).json({ error: "MISSING_CODE_OR_STATE" });
  }

  try {
    const { organizationId, brandId } = verifyState(state);

    const shortLived = await exchangeCodeForShortLivedToken(code);
    const longLived = await exchangeForLongLivedToken(shortLived.access_token);
    const profile = await fetchInstagramProfile(longLived.access_token);

    const apiKey = await prisma.apiKey.create({
      data: {
        organizationId,
        provider: "meta_instagram",
        encryptedValue: encrypt(longLived.access_token),
      },
    });

    // SocialAccount has no unique constraint on (brandId, platform, handle)
    // to use Prisma's upsert() directly, so look up then branch instead.
    const existing = await prisma.socialAccount.findFirst({
      where: { brandId, platform: "instagram", handle: profile.user_id },
    });
    const socialAccount = existing
      ? await prisma.socialAccount.update({
          where: { id: existing.id },
          data: { accessTokenRef: apiKey.id },
        })
      : await prisma.socialAccount.create({
          data: { brandId, platform: "instagram", handle: profile.user_id, accessTokenRef: apiKey.id },
        });

    logger.info(
      { organizationId, brandId, igUsername: profile.username, socialAccountId: socialAccount.id },
      "Instagram account connected via Instagram Login",
    );

    res.json({
      connected: true,
      instagramUsername: profile.username,
      socialAccountId: socialAccount.id,
      tokenExpiresInDays: Math.round(longLived.expires_in / 86400),
    });
  } catch (err) {
    logger.error({ err }, "Instagram OAuth callback failed");
    res.status(500).json({
      error: "INSTAGRAM_OAUTH_FAILED",
      detail: err instanceof Error ? err.message : "UNKNOWN_ERROR",
    });
  }
});
