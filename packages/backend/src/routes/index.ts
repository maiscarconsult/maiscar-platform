import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes";
import { organizationsRouter } from "../modules/organizations/organizations.routes";
import { brandsRouter } from "../modules/brands/brands.routes";
import { productsRouter } from "../modules/products/products.routes";
import { competitorsRouter } from "../modules/competitors/competitors.routes";
import { contentRouter } from "../modules/content/content.routes";
import { publishingRouter } from "../modules/publishing/publishing.routes";
import { analyticsRouter } from "../modules/analytics/analytics.routes";
import { apiKeysRouter } from "../modules/apikeys/apikeys.routes";
import { socialAccountsRouter } from "../modules/social-accounts/socialaccounts.routes";
import { metaCallbackRouter } from "../modules/social-accounts/meta-callback.routes";

export const apiRouter = Router();

// Public — Instagram redirects here directly after the user authorizes,
// no Bearer token on that request. Must be mounted before /social-accounts
// so it isn't shadowed, though the path itself doesn't overlap either way.
apiRouter.use("/social-accounts", metaCallbackRouter);

apiRouter.use("/auth", authRouter);
apiRouter.use("/organizations", organizationsRouter);
apiRouter.use("/brands", brandsRouter);
apiRouter.use("/products", productsRouter);
apiRouter.use("/competitors", competitorsRouter);
apiRouter.use("/content", contentRouter);
apiRouter.use("/publishing", publishingRouter);
apiRouter.use("/analytics", analyticsRouter);
apiRouter.use("/api-keys", apiKeysRouter);
apiRouter.use("/social-accounts", socialAccountsRouter);
