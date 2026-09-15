/**
 * MAISCAR_FULL_AUTONOMOUS_AVATAR_REEL_MASTER — the production runner for
 * both a manual "publish now" request and the scheduled 09:00/19:00 jobs
 * (see enable-autopublish.ps1 at the repo root). Not a throwaway script —
 * this is what the OS Task Scheduler actually invokes, unattended, with
 * no Claude Code session open.
 *
 * CREATE -> QA (already enforced inside runNarratedMotionReelV3Pilot) ->
 * PUBLISH (via the GitHub media-bridge — see
 * docs/MAISCAR_FULL_AUTONOMOUS_AVATAR_REEL_MASTER.md for why: R2 was
 * never actually configured, Meta's resumable-upload API rejected this
 * account's Instagram-Login setup) -> log.
 *
 * If AUTO_PUBLISH is off, still generates+QAs a Reel (nothing wasted) but
 * stops before the publish step and leaves the file for manual review —
 * this file being disabled is a real, deliberate account-owner decision
 * (see autopublishConfig.ts), never something this script overrides.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runNarratedMotionReelV3Pilot } from "../src/jobs/contentPipeline/narratedMotionReelV3Cycle";
import { isAutopublishEnabled } from "../src/jobs/contentPipeline/autopublishConfig";
import { publishReelToInstagram } from "../src/modules/social-accounts/meta-oauth";
import { prisma } from "../src/lib/prisma";
import { decrypt } from "../src/lib/crypto";
import { env } from "../src/config/env";
import { logger } from "../src/lib/logger";

const execFileAsync = promisify(execFile);
const MEDIA_BRIDGE_REPO = "maiscarconsult/maiscar-media-bridge";
const MAX_ATTEMPTS = 2; // 1 try + 1 retry on a gate/render failure, per the master's hard-gate policy

async function uploadToMediaBridge(localVideoPath: string): Promise<{ tag: string; url: string }> {
  const tag = `reel-${Date.now()}`;
  await execFileAsync("gh", [
    "release", "create", tag,
    "--repo", MEDIA_BRIDGE_REPO,
    "--title", "Temp Reel Asset",
    "--notes", "Temporary asset for Instagram Graph API ingestion. Deleted after publish.",
    localVideoPath,
  ]);
  const { stdout } = await execFileAsync("gh", [
    "api", `repos/${MEDIA_BRIDGE_REPO}/releases/tags/${tag}`,
    "--jq", ".assets[0].browser_download_url",
  ]);
  const url = stdout.trim();
  if (!url.startsWith("http")) throw new Error(`MEDIA_BRIDGE_NO_URL: ${stdout}`);
  return { tag, url };
}

async function validatePublicVideoUrl(url: string, localVideoPath: string): Promise<void> {
  const expectedBytes = fs.statSync(localVideoPath).size;
  const tmpPath = path.join(path.dirname(localVideoPath), `.bridge-verify-${Date.now()}.mp4`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`MEDIA_BRIDGE_URL_UNREACHABLE: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmpPath, buf);
  try {
    if (buf.length !== expectedBytes) {
      throw new Error(`MEDIA_BRIDGE_SIZE_MISMATCH: expected=${expectedBytes} got=${buf.length}`);
    }
    const ffmpegPath = (await import("ffmpeg-static")).default as unknown as string;
    await execFileAsync(ffmpegPath, ["-v", "error", "-i", tmpPath, "-f", "null", "-"]);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

async function deleteFromMediaBridge(tag: string): Promise<void> {
  await execFileAsync("gh", ["release", "delete", tag, "--repo", MEDIA_BRIDGE_REPO, "--yes", "--cleanup-tag"]);
}

async function publishPilotResult(videoPath: string, caption: string): Promise<{ mediaId: string; permalink?: string }> {
  const account = await prisma.socialAccount.findFirstOrThrow({ where: { platform: "instagram" } });
  if (!account.accessTokenRef) throw new Error("SOCIAL_ACCOUNT_NOT_CONNECTED");
  const apiKey = await prisma.apiKey.findUniqueOrThrow({ where: { id: account.accessTokenRef } });
  const accessToken = decrypt(apiKey.encryptedValue);

  const { tag, url } = await uploadToMediaBridge(videoPath);
  try {
    await validatePublicVideoUrl(url, videoPath);
    const result = await publishReelToInstagram(account.handle, accessToken, url, caption);
    const permalinkRes = await fetch(
      `https://graph.instagram.com/${env.META_GRAPH_API_VERSION}/${result.mediaId}?fields=permalink&access_token=${accessToken}`,
    );
    const permalinkData = (await permalinkRes.json().catch(() => ({}))) as { permalink?: string };
    return { mediaId: result.mediaId, permalink: permalinkData.permalink };
  } finally {
    await deleteFromMediaBridge(tag).catch((err) => logger.warn({ err, tag }, "AUTONOMOUS_REEL_CYCLE: failed to delete media-bridge asset (non-fatal, repo will accumulate a stale release)"));
  }
}

async function main() {
  let lastReason = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await runNarratedMotionReelV3Pilot({ lowQualityPreview: false });
    if (result.status !== "PILOT_READY") {
      lastReason = result.reason ?? result.status;
      logger.warn({ attempt, reason: lastReason }, "AUTONOMOUS_REEL_CYCLE: pilot did not clear its own gates, retrying" + (attempt < MAX_ATTEMPTS ? "" : " (out of attempts)"));
      continue;
    }

    console.log(JSON.stringify(result, null, 2));

    // P0 hard-gate enforcement (2026-09-15). autonomousReelCycle.ts is the
    // publish decision point — every gate below must be green or the run
    // is HELD_FOR_FIX and left on disk for creative review. Order matches
    // the account owner's canonical publish checklist.
    const q = result.qa ?? {};
    const hardGateFailures: string[] = [];
    if (q.POWERPOINT_STYLE_FALSE === false) hardGateFailures.push(`POWERPOINT_STYLE=TRUE reasons=${(result.powerpointStyleReasons ?? []).join("|")}`);
    if (q.REGISTER_COUNT_OK === false) hardGateFailures.push(`REGISTER_COUNT=${result.registerCount ?? 0}<4`);
    if (q.HOOK_SCORE_OK === false) hardGateFailures.push(`HOOK_SCORE=${result.hookScore ?? 0}<88 hardFail=${result.hookScoreHardFail ?? false} reasons=${(result.hookScoreReasons ?? []).join("|")}`);
    if (q.COVER_GATE === false) hardGateFailures.push(`COVER weak score=${result.coverScore ?? 0} reasons=${(result.coverScoreReasons ?? []).join("|")}`);
    if (q.SOURCE_VERIFIED_FACTS === false) hardGateFailures.push(`FACT_GATE`);
    if (q.VOICE_FLUENCY === false) hardGateFailures.push(`VOICE_FLUENCY`);
    if (q.NO_COMPARISON_UNLESS_REQUESTED === false) hardGateFailures.push(`COMPARISON`);
    if (q.HOST_TEXT_COLLISION_ZERO === false) hardGateFailures.push(`AVATAR_COLLISIONS`);
    if (q.STATIC_VISUAL_MAX_1_8S === false) hardGateFailures.push(`LONGEST_STATIC>1.8`);
    if (hardGateFailures.length > 0) {
      lastReason = "HARD_GATE_FAIL: " + hardGateFailures.join("; ");
      logger.warn({ attempt, hardGateFailures }, "AUTONOMOUS_REEL_CYCLE: hard gates failed — NOT PUBLISHING, will retry once" + (attempt < MAX_ATTEMPTS ? "" : " (out of attempts)"));
      console.log("HARD_GATE_FAIL:", JSON.stringify(hardGateFailures));
      continue;
    }

    const enabled = isAutopublishEnabled();
    if (!enabled) {
      console.log("AUTO_PUBLISH_DISABLED — Reel generated and QA-passed, left on disk for manual review:", result.videoPath);
      return;
    }

    const caption = `${result.topic}\n\n${result.hook}`; // deterministic, 0 LLM — the scheduled job never calls Haiku for captioning
    const published = await publishPilotResult(result.videoPath!, caption);
    console.log("PUBLISHED:", JSON.stringify(published));
    return;
  }
  throw new Error(`AUTONOMOUS_REEL_CYCLE_FAILED_AFTER_RETRY: ${lastReason}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("AUTONOMOUS_REEL_CYCLE_FATAL:", err);
    process.exit(1);
  });
