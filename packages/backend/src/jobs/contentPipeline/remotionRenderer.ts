/**
 * MAISCAR_NARRATED_MOTION_REEL_V3 render engine (2026-09-11) — Remotion
 * (open source, https://remotion.dev) controls the timeline/motion (cuts,
 * kinetic text, mascot, pattern interrupts) and mixes narration + music +
 * SFX natively; ffmpeg-static is what Remotion itself calls for the final
 * encode. 0 LLM. Bundled once per process and reused (rule: economia de
 * recursos — nunca reprocessar o que já foi bundlado).
 *
 * LICENSING NOTE (disclose, don't hide): Remotion's own license requires a
 * paid company license once a company exceeds a revenue/headcount
 * threshold (see remotion.dev/license) — this is separate from any content
 * licensing and hasn't been checked against MAIS CAR's situation. Flagged
 * here, not silently assumed to be free forever.
 */
import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { NarratedReelV3Props, MascotPose } from "./timedScriptTypes";

const REMOTION_ENTRY = path.join(__dirname, "..", "..", "..", "remotion", "index.ts");
const REMOTION_PUBLIC_DIR = path.join(__dirname, "..", "..", "..", "remotion", "public");
const COMPOSITION_ID = "NarratedMotionReelV3";

/**
 * bundle() copies public/ into the webpack output ONCE, at bundle time —
 * and on Windows `symlinkPublicDir` has no effect (Remotion always copies
 * there), so a bundle cached across runs would never see assets a later
 * run stages via stageAsset(). Simplest correct fix: (re)bundle right
 * before every render, after assets for that run are already staged. A
 * few extra seconds of webpack build per render is a non-issue at 2
 * posts/day.
 */
async function getBundleUrl(): Promise<string> {
  // publicDir explicit: bundle() otherwise resolves the "Remotion root" by
  // walking up from the entry point to the nearest package.json — which is
  // packages/backend's own package.json, not the remotion/ subfolder — so
  // it was looking for packages/backend/public (doesn't exist) instead of
  // packages/backend/remotion/public (where stageAsset() actually writes).
  return bundle({ entryPoint: REMOTION_ENTRY, onProgress: () => {}, publicDir: REMOTION_PUBLIC_DIR });
}

/** Copies a per-run local asset into remotion/public/<runId>/... so it can be referenced via staticFile(). Returns the relative path to pass in TimedBlock. */
export function stageAsset(runId: string, absoluteSourcePath: string, fileName: string): string {
  const destDir = path.join(REMOTION_PUBLIC_DIR, "runs", runId);
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, fileName);
  fs.copyFileSync(absoluteSourcePath, destPath);
  return path.posix.join("runs", runId, fileName);
}

export interface RenderQualityOpts {
  /** 0-1, downscales the whole render (e.g. 0.5 = 540x960) — faster encode for a quick preview, never used for the real published asset. */
  scale?: number;
  /** Higher = smaller/faster/lower quality. h264 default ~23; 32+ is a fast low-quality preview. */
  crf?: number;
}

export async function renderNarratedMotionReelV3(
  props: NarratedReelV3Props,
  outPath: string,
  quality?: RenderQualityOpts,
): Promise<{ outPath: string; serveUrl: string }> {
  const serveUrl = await getBundleUrl();
  const onBrowserLog = (log: { text: string; type: string }) => console.log(`[REMOTION_BROWSER:${log.type}]`, log.text);
  // timeoutInMilliseconds bumped from the 28s default (2026-09-11): the
  // first OffthreadVideo frame extraction of a real downloaded clip can
  // take longer than that cold (native compositor + first-time file
  // access on Windows) — 28s was timing out even on a valid, playable file.
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props as unknown as Record<string, unknown>, onBrowserLog, timeoutInMilliseconds: 120000 });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation: outPath,
    inputProps: props as unknown as Record<string, unknown>,
    enforceAudioTrack: true,
    timeoutInMilliseconds: 120000,
    scale: quality?.scale,
    crf: quality?.crf,
  });
  return { outPath, serveUrl };
}

/**
 * MAISCAR_AVATAR_NARRATED_REEL_MASTER — renders one transparent-background
 * PNG of the host avatar (same Mascot.tsx used in the video) for
 * compositing onto the REEL_COVER, so the cover always shows the avatar
 * reacting rather than being a plain photo+headline card.
 *
 * `existingServeUrl` — REQUIRED reuse path: a real run hit an intermittent
 * Windows `EPERM: operation not permitted, symlink` bundling a SECOND time
 * for the cover-only still, which silently dropped the avatar from the
 * cover (caught, not crashed, but not what was asked for either). The
 * MascotStill composition needs no run-specific staged assets beyond what
 * the main video's bundle already copied, so reusing that exact serveUrl
 * eliminates the redundant second bundle (and its EPERM risk) entirely
 * instead of just tolerating the failure.
 */
export async function renderMascotStillPng(pose: MascotPose, size = 700, existingServeUrl?: string): Promise<Buffer> {
  const serveUrl = existingServeUrl ?? (await getBundleUrl());
  const composition = await selectComposition({
    serveUrl,
    id: "MascotStill",
    inputProps: { pose, size },
    timeoutInMilliseconds: 60000,
  });
  const stillPath = path.join(path.dirname(REMOTION_ENTRY), "..", "generated", `.mascot-still-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(stillPath), { recursive: true });
  await renderStill({
    serveUrl,
    composition,
    output: stillPath,
    inputProps: { pose, size },
    imageFormat: "png",
    // Frame 15, not 0 — Mascot.tsx's own entrance animation
    // (interpolate(frame, [0,8], [0,1])) makes frame 0 render invisible.
    frame: 15,
  });
  const buf = fs.readFileSync(stillPath);
  fs.unlinkSync(stillPath);
  return buf;
}
