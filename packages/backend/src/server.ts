import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { env } from "./config/env";
import { createApp } from "./app";
import { logger } from "./lib/logger";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
});

// HTTPS on a separate port, used only for OAuth redirect callbacks (Meta's
// Instagram Login rejects a plain http://localhost redirect_uri) — the
// frontend and everything else keeps using the plain HTTP port above.
// Self-signed cert generated locally, gitignored (packages/backend/certs/).
const certDir = path.join(__dirname, "..", "certs");
const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  https
    .createServer(
      { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
      app,
    )
    .listen(env.HTTPS_PORT, () => {
      logger.info(`API also listening on https://localhost:${env.HTTPS_PORT} (OAuth callbacks)`);
    });
}
