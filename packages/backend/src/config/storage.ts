/**
 * MAIS CAR — cloud object storage (R2 / S3-compatible), 2026-09-15.
 * Uploads finished MP4s and covers to a public R2 bucket, returns the
 * public URL the Meta Graph API can ingest as `video_url`. Replaces the
 * GitHub-release-based media bridge in autonomousReelCycle.ts once R2
 * is configured — the bridge stays as a fallback until then.
 *
 * Cloudflare R2 has no egress fees, so the Meta ingest step + any
 * viewer downloads are free. 10 GB storage + 1M reads/mo are free tier;
 * a typical Reel is ~5-25 MB so free tier holds ~400+ Reels before we
 * pay $0.015/GB-mo for the excess.
 */
import fs from "node:fs";
import path from "node:path";
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "./logger";

const client = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

const BUCKET = process.env.R2_BUCKET ?? "maiscar-media";
const PUBLIC_URL_BASE = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");

export interface UploadedAsset {
  key: string;
  publicUrl: string;
  bytes: number;
  contentType: string;
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".mp4": "video/mp4",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".mp3": "audio/mpeg",
      ".json": "application/json",
    }[ext] || "application/octet-stream"
  );
}

/**
 * Upload one file. Keys are laid out as `reels/<reelId>/<filename>` so a
 * cleanup job can wipe an aborted run by prefix. Sets a 7-day
 * cache-control so viewers don't refetch mid-play.
 */
export async function uploadAsset(
  reelId: string,
  localPath: string,
  filename?: string,
): Promise<UploadedAsset> {
  if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID) {
    throw new Error("R2_NOT_CONFIGURED");
  }
  const stat = fs.statSync(localPath);
  const key = `reels/${reelId}/${filename ?? path.basename(localPath)}`;
  const contentType = contentTypeFor(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fs.createReadStream(localPath),
      ContentLength: stat.size,
      ContentType: contentType,
      CacheControl: "public, max-age=604800, immutable",
    }),
  );
  const publicUrl = `${PUBLIC_URL_BASE}/${key}`;
  logger.info({ key, publicUrl, bytes: stat.size, contentType }, "R2 upload OK");
  return { key, publicUrl, bytes: stat.size, contentType };
}

export async function deleteAsset(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch((err) => {
    logger.warn({ err, key }, "R2 delete failed (non-fatal)");
  });
}

/**
 * Validate that the URL Meta will ingest is actually reachable + byte-exact,
 * mirroring the check in autonomousReelCycle.ts's `validatePublicVideoUrl`
 * but skipping the GitHub-release round-trip.
 */
export async function validateR2Video(publicUrl: string, localPath: string): Promise<void> {
  const expectedBytes = fs.statSync(localPath).size;
  const res = await fetch(publicUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`R2_UNREACHABLE http=${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== expectedBytes) {
    throw new Error(`R2_SIZE_MISMATCH expected=${expectedBytes} got=${buf.length}`);
  }
}

/** Cheap ready-check used by cloud-smoke-test.ts. */
export async function ping(): Promise<void> {
  await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: ".ping" })).catch(() => {
    /* .ping key may not exist — 404 is fine, the point is: did the
       endpoint answer at all? A DNS/creds failure would throw a
       different error type. */
  });
}
