/**
 * R2_VIDEO_STORAGE — replaces catbox.moe as the public host used to hand
 * Reel MP4s to the Instagram Graph API's `video_url`. catbox was
 * permanently discarded after repeatedly returning HTTP 200 with an empty
 * body for video uploads (confirmed by direct curl testing — not a
 * video-format issue, catbox itself was unreliable). Uses the S3-compatible
 * credentials already in `.env` (Cloudflare R2 or any S3-compatible store).
 *
 * Flow: PutObject -> HeadObject (byte-count sanity check) -> presigned GET
 * URL (time-limited, so no bucket-level "public" ACL is required) -> caller
 * hands that URL to Graph API -> deleteReelUpload() once media_publish is
 * confirmed, so nothing accumulates in the bucket long-term.
 */
import fs from "node:fs";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";

const REEL_PREFIX = "reels/";
const PRESIGNED_URL_TTL_SEC = 6 * 60 * 60; // 6h — enough for Graph API container processing + retries

function getClient(): S3Client {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_BUCKET) {
    throw new Error("R2_NOT_CONFIGURED: missing S3_ENDPOINT/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_BUCKET in .env");
  }
  return new S3Client({
    region: env.S3_REGION || "auto",
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

export interface UploadedReelVideo {
  key: string;
  url: string;
  bytes: number;
}

/**
 * Uploads a local MP4 to R2 and returns a presigned public HTTPS URL.
 * Validates the upload by re-fetching the object's ContentLength via
 * HeadObject and comparing it against the local file size (catches
 * truncated/partial uploads the way catbox's silent-empty-body failure
 * never surfaced until a real GET was attempted).
 */
export async function uploadReelVideo(localPath: string): Promise<UploadedReelVideo> {
  const client = getClient();
  const bytes = fs.statSync(localPath).size;
  const key = `${REEL_PREFIX}${Date.now()}-${path.basename(localPath)}`;

  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: fs.createReadStream(localPath),
      ContentType: "video/mp4",
      ContentLength: bytes,
    }),
  );

  const head = await client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  if (head.ContentLength !== bytes) {
    await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key })).catch(() => {});
    throw new Error(`R2_UPLOAD_SIZE_MISMATCH: local=${bytes} remote=${head.ContentLength}`);
  }
  if (head.ContentType !== "video/mp4") {
    throw new Error(`R2_UPLOAD_WRONG_CONTENT_TYPE: ${head.ContentType}`);
  }

  const getCmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
  const url = await getSignedUrl(client, getCmd, { expiresIn: PRESIGNED_URL_TTL_SEC });
  logger.info({ key, bytes }, "R2_VIDEO_STORAGE: uploaded reel video");
  return { key, url, bytes };
}

/**
 * Verifies the presigned URL actually serves the right bytes before handing
 * it to a third party (Graph API) — the exact check catbox silently failed:
 * HTTP 200 with Content-Length 0. Ranged GET avoids downloading the whole
 * file just to confirm it's really there.
 */
export async function validatePublicVideoUrl(url: string, expectedBytes: number): Promise<void> {
  const res = await fetch(url, { headers: { Range: "bytes=0-1" } });
  if (!res.ok && res.status !== 206) {
    throw new Error(`R2_PUBLIC_URL_UNREACHABLE: HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type");
  if (contentType !== "video/mp4") {
    throw new Error(`R2_PUBLIC_URL_WRONG_CONTENT_TYPE: ${contentType}`);
  }
  const contentRange = res.headers.get("content-range"); // "bytes 0-1/<total>"
  const total = contentRange ? Number(contentRange.split("/")[1]) : NaN;
  if (!Number.isFinite(total) || total !== expectedBytes) {
    throw new Error(`R2_PUBLIC_URL_SIZE_MISMATCH: expected=${expectedBytes} got=${total}`);
  }
  const body = await res.arrayBuffer();
  if (body.byteLength === 0) {
    throw new Error("R2_PUBLIC_URL_EMPTY_BODY");
  }
}

/** Deletes one uploaded reel object — call once Graph API has confirmed media_publish. */
export async function deleteReelUpload(key: string): Promise<void> {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  logger.info({ key }, "R2_VIDEO_STORAGE: deleted reel upload after publish");
}

/**
 * Housekeeping: deletes any reels/ object older than maxAgeMs, in case a
 * run crashed after upload but before the post-publish delete ran. Call
 * this opportunistically (e.g. at the start of each publish attempt) —
 * cheap (one ListObjectsV2 call) and keeps the bucket from accumulating
 * orphaned video files across FULL_AUTONOMOUS_REEL runs.
 */
export async function cleanupOldReelUploads(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const client = getClient();
  const list = await client.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: REEL_PREFIX }));
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;
  for (const obj of list.Contents ?? []) {
    if (obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff) {
      await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: obj.Key }));
      deleted++;
    }
  }
  if (deleted > 0) logger.info({ deleted }, "R2_VIDEO_STORAGE: cleaned up stale reel uploads");
  return deleted;
}
