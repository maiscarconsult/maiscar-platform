/**
 * REAL_VIDEO sourcing (2026-09-10/11, MAISCAR_NARRATED_MOTION_REEL_V1 ->
 * V3.1) — the "não quero mais slideshow" requirement needs actual moving
 * footage per narration segment, not another static photo. Pexels Video
 * (same PEXELS_API_KEY already on file, no new service/authorization) has
 * real portrait 1080x1920 clips for generic automotive B-roll (engine,
 * garage, money, road, dashboard, hands). Never used for an EXACT named
 * vehicle (Pexels has near-zero coverage of specific current-model
 * Brazilian-market cars — same limitation documented in photoSourcing.ts
 * for photos).
 *
 * REAL_BROLL content-relevance gate (2026-09-11): confirmed real bug across
 * 3 pilots — a plain keyword search sometimes returns completely unrelated
 * footage (a woman's eyelash close-up, a dried-flower still life, an
 * upside-down book page, skin-texture macro shots) for vague queries. Now
 * checks the top few candidates with a real vision call
 * (videoClipVerification.ts) before accepting one — same discipline as
 * photoSourcing.ts's verifyPhoto/passesPhotoGate, not a keyword heuristic.
 */
import fs from "node:fs";
import path from "node:path";
import { logger } from "../../lib/logger";
import { extractMidFrame, verifyClipFrame } from "./videoClipVerification";

interface PexelsVideoFile {
  quality: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideoItem {
  id: number;
  width: number;
  height: number;
  duration: number;
  video_files: PexelsVideoFile[];
}

export interface SourcedClip {
  path: string;
  durationSec: number;
  sourceUrl: string;
  /** false when no candidate passed the vision relevance check and this is a best-effort fallback (e.g. vision was unreachable, or every candidate was rejected) — never silently claimed as verified. */
  verified: boolean;
}

const MAX_CANDIDATES_TO_CHECK = 4;

/** Picks the portrait file closest to 1080x1920 without going below it (falls back to the largest available). */
function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
  const portrait = files.filter((f) => f.height > f.width);
  const pool = portrait.length > 0 ? portrait : files;
  const atLeastHD = pool.filter((f) => f.width >= 720);
  const candidates = atLeastHD.length > 0 ? atLeastHD : pool;
  return candidates.sort((a, b) => a.width - b.width)[0];
}

async function downloadItem(item: PexelsVideoItem, outPath: string): Promise<boolean> {
  const file = pickBestFile(item.video_files);
  if (!file) return false;
  const videoRes = await fetch(file.link);
  if (!videoRes.ok) return false;
  const buffer = Buffer.from(await videoRes.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  return true;
}

/** `topic`/`keyword` drive the REAL_BROLL relevance check — pass the Reel's overall theme and this beat's specific keyword so an off-topic clip (however well it matched the search string) gets rejected. */
export async function searchAndDownloadClip(
  query: string,
  outDir: string,
  fileBaseName: string,
  relevance?: { topic: string; keyword: string; organizationId: string },
): Promise<SourcedClip | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    logger.warn("PEXELS_API_KEY not configured, cannot source real video clips");
    return null;
  }
  try {
    const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait`, {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { videos?: PexelsVideoItem[] };
    const items = (data.videos ?? []).slice(0, MAX_CANDIDATES_TO_CHECK);
    if (items.length === 0) return null;

    fs.mkdirSync(outDir, { recursive: true });
    const finalPath = path.join(outDir, `${fileBaseName}.mp4`);
    // Each candidate downloads to its OWN temp path — downloadItem()
    // overwrites whatever path it's given, so reusing one shared path
    // across the loop would silently corrupt an earlier candidate kept as
    // `fallback` (its metadata would point at a since-overwritten file).
    let fallback: { tempPath: string; durationSec: number; sourceUrl: string } | null = null;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const tempPath = path.join(outDir, `${fileBaseName}-cand${i}.mp4`);
      if (!(await downloadItem(item, tempPath))) continue;
      const sourceUrl = `https://www.pexels.com/video/${item.id}/`;

      if (!relevance) {
        // No relevance context given (caller doesn't care, e.g. a generic
        // secondary cut) — accept the first downloadable candidate as before.
        fs.renameSync(tempPath, finalPath);
        return { path: finalPath, durationSec: item.duration, sourceUrl, verified: false };
      }

      const frame = await extractMidFrame(tempPath, item.duration);
      if (!frame) {
        if (!fallback) fallback = { tempPath, durationSec: item.duration, sourceUrl };
        else fs.unlinkSync(tempPath);
        continue;
      }
      const verification = await verifyClipFrame(frame.base64, frame.mediaType, relevance.topic, relevance.keyword, relevance.organizationId);
      if (verification.relevant && !verification.foreignCurrencyVisible) {
        if (fallback) fs.unlinkSync(fallback.tempPath);
        fs.renameSync(tempPath, finalPath);
        return { path: finalPath, durationSec: item.duration, sourceUrl, verified: true };
      }
      logger.warn({ query, sourceUrl, reasoning: verification.reasoning }, "REAL_BROLL_GATE: clip rejected as irrelevant/foreign-currency, trying next candidate");
      if (!fallback) fallback = { tempPath, durationSec: item.duration, sourceUrl };
      else fs.unlinkSync(tempPath);
    }

    if (fallback) {
      logger.warn({ query }, "REAL_BROLL_GATE: no candidate passed relevance verification — using best-effort fallback (unverified)");
      fs.renameSync(fallback.tempPath, finalPath);
      return { path: finalPath, durationSec: fallback.durationSec, sourceUrl: fallback.sourceUrl, verified: false };
    }
    return null;
  } catch (err) {
    logger.warn({ err, query }, "PEXELS_VIDEO: search/download failed, treating as no result");
    return null;
  }
}
