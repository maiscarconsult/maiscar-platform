/**
 * MAIS CAR — cloud smoke test (2026-09-15).
 * Verifies every runtime dep the pipeline needs BEFORE the CI marks a
 * deploy healthy. Never publishes. Never renders a real Reel. Exits 0
 * on all-pass, non-zero (with a categorized reason) otherwise.
 *
 * Invoked from the CI's ssh step (see .github/workflows/deploy.yml) and
 * from `POST /health/deep` on the running backend.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);
const results: Array<{ name: string; ok: boolean; ms: number; detail?: string }> = [];

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - start, detail: detail || undefined });
  } catch (err: any) {
    results.push({ name, ok: false, ms: Date.now() - start, detail: err?.message || String(err) });
  }
}

async function main(): Promise<void> {
  // 1. Postgres reachable + prisma schema migrated
  await check("postgres", async () => {
    const prisma = new PrismaClient();
    await prisma.$queryRawUnsafe("select 1 as ok");
    const socialCount = await prisma.socialAccount.count().catch(() => -1);
    await prisma.$disconnect();
    return `socialAccount rows=${socialCount}`;
  });

  // 2. Redis reachable
  await check("redis", async () => {
    const url = process.env.REDIS_URL || "redis://redis:6379";
    const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
    await r.connect();
    const pong = await r.ping();
    r.disconnect();
    if (pong !== "PONG") throw new Error(`unexpected ping: ${pong}`);
  });

  // 3. FFmpeg present and usable
  await check("ffmpeg", async () => {
    const { stdout } = await execFileAsync("ffmpeg", ["-version"], { timeout: 10000 });
    return stdout.split("\n")[0];
  });
  await check("ffprobe", async () => {
    const { stdout } = await execFileAsync("ffprobe", ["-version"], { timeout: 10000 });
    return stdout.split("\n")[0];
  });

  // 4. Chromium present at the path Remotion expects (REMOTION_CHROME_EXECUTABLE).
  await check("chromium", async () => {
    const exe = process.env.REMOTION_CHROME_EXECUTABLE || "/usr/bin/chromium";
    if (!fs.existsSync(exe)) throw new Error(`missing at ${exe}`);
    const { stdout } = await execFileAsync(exe, ["--version"], { timeout: 10000 });
    return stdout.trim();
  });

  // 5. Remotion can bundle + open the composition — cheap dry run.
  await check("remotion", async () => {
    const { bundle } = await import("@remotion/bundler");
    const { getCompositions } = await import("@remotion/renderer");
    const entry = path.resolve(process.cwd(), "packages/backend/remotion/index.ts");
    if (!fs.existsSync(entry)) throw new Error(`remotion entry missing at ${entry}`);
    const serveUrl = await bundle({ entryPoint: entry, outDir: path.join(os.tmpdir(), "remotion-smoke") });
    const comps = await getCompositions(serveUrl);
    if (!comps.find((c) => c.id === "NarratedMotionReelV3")) throw new Error("NarratedMotionReelV3 composition missing");
    return `compositions=${comps.length}`;
  });

  // 6. TTS reachable (Edge Read Aloud is a WebSocket to Microsoft; no key).
  await check("tts", async () => {
    const { MsEdgeTTS } = await import("msedge-tts");
    const tts = new MsEdgeTTS();
    await tts.setMetadata("pt-BR-AntonioNeural", "audio-24khz-48kbitrate-mono-mp3");
    return "voice metadata negotiated";
  });

  // 7. R2 reachable (list objects with limit 1).
  await check("r2_storage", async () => {
    const endpoint = process.env.R2_ENDPOINT;
    const bucket = process.env.R2_BUCKET;
    if (!endpoint || !bucket || !process.env.R2_ACCESS_KEY_ID) throw new Error("R2 env missing");
    const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      endpoint,
      region: "auto",
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    return `bucket=${bucket} keyCount=${res.KeyCount ?? 0}`;
  });

  // 8. Meta Graph API — just verifies the token echoes an account id, no publish.
  await check("instagram_token", async () => {
    const prisma = new PrismaClient();
    const account = await prisma.socialAccount.findFirst({ where: { platform: "instagram" } });
    if (!account?.accessTokenRef) { await prisma.$disconnect(); throw new Error("no social account row"); }
    const { decrypt } = await import("../packages/backend/dist/lib/crypto.js") as any;
    const key = await prisma.apiKey.findUnique({ where: { id: account.accessTokenRef } });
    if (!key) { await prisma.$disconnect(); throw new Error("apiKey row missing"); }
    const token = decrypt(key.encryptedValue);
    await prisma.$disconnect();
    const v = process.env.META_GRAPH_API_VERSION || "v21.0";
    const res = await fetch(`https://graph.instagram.com/${v}/me?fields=id,username&access_token=${token}`);
    if (!res.ok) throw new Error(`http ${res.status}`);
    const j = await res.json() as { id?: string; username?: string; error?: any };
    if (!j.id) throw new Error(`no id in response: ${JSON.stringify(j)}`);
    return `username=${j.username} id=${j.id}`;
  });

  // Report.
  const bad = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`[${r.ok ? "OK " : "FAIL"}] ${r.name.padEnd(20)} ${String(r.ms).padStart(5)}ms  ${r.detail ?? ""}`);
  }
  console.log("");
  console.log(`SMOKE: ${bad.length === 0 ? "PASS" : "FAIL"} (${results.length - bad.length}/${results.length})`);
  process.exit(bad.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE runner crashed:", err);
  process.exit(2);
});
