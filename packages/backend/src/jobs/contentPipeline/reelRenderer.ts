/**
 * FULL_AUTONOMOUS_REEL MVP (2026-09-10) — converts N already-approved slide
 * PNGs (the exact same Design System renders used for PHOTO/CAROUSEL) into a
 * vertical (1080x1920) MP4: each slide gets a subtle Ken Burns zoom/pan, with
 * a short crossfade between slides. Optionally muxes in a licensed audio
 * track. Does NOT touch the carousel pipeline, gates, facts, or copy — this
 * only re-encodes existing, already-approved images as video.
 *
 * Audio licensing note: this renderer will mux in ANY audio file path it's
 * given — it has no opinion on licensing. The caller is responsible for only
 * passing a track that's actually cleared for commercial use/embedding in a
 * distributed video (see AI_DECISIONS.md — no track was sourced yet for the
 * 2026-09-10 MVP test, pending a licensed-audio API key).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

const WIDTH = 1080;
const HEIGHT = 1920;
const SECONDS_PER_SLIDE = 3;
const XFADE_DURATION = 0.5;
const FPS = 30;
// MAIS CAR official background (matches the Design System's page background
// — diagonalTemplateV4's off-white kicker/headline zone) — used to fill the
// letterbox bars instead of black, 2026-09-10.
const BRAND_BACKGROUND = "0xF6F4EF";

export interface RenderReelOptions {
  slidePngPaths: string[];
  outPath: string;
  /** Path to a licensed/royalty-free audio file. Omit for a silent render. */
  audioPath?: string;
  /** Seconds each slide holds before crossfading to the next. Default 3 (matches the original 7-slide/18.5s test). */
  secondsPerSlide?: number;
}

/** Builds one Ken-Burns input clip per slide (zoom+pan on a still image), then crossfades them together. */
export async function renderReel(opts: RenderReelOptions): Promise<string> {
  if (!ffmpegPath) throw new Error("FFMPEG_BINARY_NOT_FOUND");
  if (opts.slidePngPaths.length < 2) throw new Error("REEL_NEEDS_AT_LEAST_2_SLIDES");

  const secondsPerSlide = opts.secondsPerSlide ?? SECONDS_PER_SLIDE;
  const inputs: string[] = [];
  const filterParts: string[] = [];

  opts.slidePngPaths.forEach((p, i) => {
    // BUG FIX (2026-09-10): a static-image loop input decodes at a default
    // framerate unless told otherwise — combined with zoompan's `d` (which
    // multiplies per INCOMING frame, not per clip), that produced a ~14x too
    // long render (4:39 instead of ~19s) on the first test. Standard fix:
    // force the loop input to exactly FPS raw frames/sec via `-framerate`,
    // and set zoompan's d=1 (one output frame per input frame) so overall
    // clip length is controlled purely by `-t` × the input framerate.
    inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(secondsPerSlide + XFADE_DURATION), "-i", p);
    // CROP FIX (2026-09-10): source slides are 1080x1350 (4:5) — narrower
    // than the 1080x1920 (9:16) Reel canvas. The old "cover crop" (scale to
    // fill, crop overflow) cut off the logo/kicker on the sides. Fixed to
    // "contain" instead: scale to fit fully inside the canvas at full,
    // uncropped resolution, then pad the remaining top/bottom with the MAIS
    // CAR brand background color (not black) — the whole slide (logo,
    // headline, photo) is always fully visible, nothing duplicated or cropped.
    const zoomExpr = "zoom+0.0006";
    const panX = i % 2 === 0 ? "iw/2-(iw/zoom/2)+20" : "iw/2-(iw/zoom/2)-20";
    filterParts.push(
      `[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${BRAND_BACKGROUND},` +
        `zoompan=z='${zoomExpr}':x='${panX}':y='ih/2-(ih/zoom/2)':d=1:s=${WIDTH}x${HEIGHT}:fps=${FPS},` +
        `format=yuv420p[v${i}]`,
    );
  });

  // Chain xfade transitions: v0+v1->vx1, vx1+v2->vx2, ...
  let lastLabel = "v0";
  let offset = secondsPerSlide - XFADE_DURATION;
  for (let i = 1; i < opts.slidePngPaths.length; i++) {
    const outLabel = i === opts.slidePngPaths.length - 1 ? "vout" : `vx${i}`;
    filterParts.push(`[${lastLabel}][v${i}]xfade=transition=fade:duration=${XFADE_DURATION}:offset=${offset}[${outLabel}]`);
    lastLabel = outLabel;
    offset += secondsPerSlide - XFADE_DURATION;
  }

  const filterComplex = filterParts.join(";");
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });

  // BUG FIX (2026-09-10): all `-i` inputs must come before any `-map` — the
  // audio `-i` was being appended AFTER the video `-map [vout]`, which
  // ffmpeg's CLI parser rejects ("Option map ... cannot be applied to input
  // url ... you are trying to apply an input option to an output file or
  // vice versa"). Fixed order: every `-i` first, then filter_complex, then
  // every `-map`, then codec/output options, then the output path.
  if (opts.audioPath) inputs.push("-i", opts.audioPath);
  const args = [...inputs, "-filter_complex", filterComplex, "-map", "[vout]"];
  if (opts.audioPath) {
    args.push("-map", `${opts.slidePngPaths.length}:a`, "-shortest", "-c:a", "aac", "-b:a", "192k");
  }
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", opts.outPath);

  await execFileAsync(ffmpegPath as string, args, { maxBuffer: 1024 * 1024 * 50 });
  return opts.outPath;
}
