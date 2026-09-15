/**
 * POWERPOINT_STYLE detector (P0-4, 2026-09-15). The account owner has
 * repeatedly flagged pilots as "looking like a PowerPoint" even when every
 * individual mechanical gate (VISUAL_EVENT_AVG, LONGEST_STATIC, cut count)
 * passes. The individual axes never captured the composite the viewer
 * actually perceives: same visual register beat after beat, mascot present
 * in every beat, near-identical color palette between adjacent beats, and
 * kinetic text laid over the same image with no real change of subject.
 *
 * This module is a pure heuristic — no LLM, no Vision — that combines
 * those four signals into a single boolean the QA gate can block on.
 *
 * The frame-color-histogram distance is intentionally cheap: ffmpeg pulls
 * a 256-bin luma histogram at each beat's midpoint via the signalstats
 * filter, and we compare adjacent beats' histograms with an L1 distance
 * normalized to [0, 1]. Low variance between adjacent frames == same
 * subject, same palette == slideshow.
 */
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { logger } from "../../lib/logger";
import type { VisualRegister } from "../../../remotion/types";

const execFileAsync = promisify(execFile);

export interface PowerpointStyleInput {
  /** Per-beat metadata: what the cycle emitted. */
  beats: Array<{
    id: string;
    visualRegister?: VisualRegister;
    hasMascotPose: boolean;
    hasKineticText: boolean;
    startSec: number;
    durationSec: number;
  }>;
  /** Absolute path to the assembled MP4 the pipeline just rendered. */
  videoPath: string;
}

export interface PowerpointStyleResult {
  powerpointStyle: boolean;
  score: number; // 0..10; >=5 fails
  reasons: string[];
  measurements: {
    registerCount: number;
    mascotBeatRatio: number;
    kineticTextEveryBeat: boolean;
    frameColorL1DistanceAvg: number;
  };
}

const FFMPEG_STATIC_MODULE = "ffmpeg-static";

async function extractLumaHistogram(videoPath: string, atSec: number): Promise<number[] | null> {
  try {
    // Load the ffmpeg binary path the same way the rest of the pipeline does.
    const ffmpegPath = (await import(FFMPEG_STATIC_MODULE)).default as unknown as string;
    // signalstats YAVG only gives us the average luma per frame; for a 256-bin
    // histogram we use the histogram filter and dump the video's own values
    // at a single frame near `atSec`. To keep this cheap we pull a single
    // 128x128 grayscale frame and count luma bins in-process instead.
    const tmpPng = path.join(path.dirname(videoPath), `.pp-hist-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pgm`);
    await execFileAsync(ffmpegPath, [
      "-v", "error",
      "-ss", String(Math.max(0, atSec)),
      "-i", videoPath,
      "-vframes", "1",
      "-vf", "scale=128:128,format=gray",
      "-y",
      tmpPng,
    ]);
    const buf = fs.readFileSync(tmpPng);
    fs.unlinkSync(tmpPng);
    // PGM header is text: "P5\n<w> <h>\n<maxval>\n" followed by raw bytes.
    const headerEnd = (() => {
      let i = 0, newlines = 0;
      while (i < buf.length && newlines < 3) { if (buf[i] === 0x0a) newlines++; i++; }
      return i;
    })();
    const bins = new Array(256).fill(0);
    for (let i = headerEnd; i < buf.length; i++) bins[buf[i]] += 1;
    const total = bins.reduce((a, b) => a + b, 0) || 1;
    return bins.map((v) => v / total);
  } catch (err) {
    logger.warn({ err, videoPath, atSec }, "POWERPOINT_STYLE_GATE: luma histogram extraction failed, treating this pair as maximum distance (safe)");
    return null;
  }
}

function l1(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  // Two probability vectors' L1 distance is in [0, 2]; normalize to [0, 1].
  return Math.min(1, sum / 2);
}

export async function detectPowerpointStyle(input: PowerpointStyleInput): Promise<PowerpointStyleResult> {
  const beats = input.beats;
  const registers = beats.map((b) => b.visualRegister).filter((r): r is VisualRegister => !!r);
  const registerCount = new Set(registers).size;
  const mascotBeatRatio = beats.length ? beats.filter((b) => b.hasMascotPose).length / beats.length : 0;
  const kineticTextEveryBeat = beats.length > 0 && beats.every((b) => b.hasKineticText);

  // Pull one histogram per beat at its midpoint, compare adjacent.
  const hists: (number[] | null)[] = [];
  for (const b of beats) {
    const midSec = b.startSec + b.durationSec / 2;
    hists.push(await extractLumaHistogram(input.videoPath, midSec));
  }
  const distances: number[] = [];
  for (let i = 1; i < hists.length; i++) {
    const a = hists[i - 1], c = hists[i];
    if (a && c) distances.push(l1(a, c));
    else distances.push(1); // Missing histogram counted as maximum distance — we don't punish a run for a failed ffmpeg call.
  }
  const frameColorL1DistanceAvg = distances.length ? distances.reduce((a, b) => a + b, 0) / distances.length : 1;

  let score = 0;
  const reasons: string[] = [];
  if (registerCount < 3) { score += 3; reasons.push(`register_count=${registerCount} < 3`); }
  if (mascotBeatRatio > 0.75) { score += 2; reasons.push(`mascot_beat_ratio=${mascotBeatRatio.toFixed(2)} > 0.75`); }
  if (kineticTextEveryBeat && frameColorL1DistanceAvg < 0.15) { score += 2; reasons.push(`kinetic_text_on_every_beat_over_flat_palette (adj_l1_avg=${frameColorL1DistanceAvg.toFixed(3)})`); }
  if (frameColorL1DistanceAvg < 0.10) { score += 3; reasons.push(`adjacent_beats_visually_identical (adj_l1_avg=${frameColorL1DistanceAvg.toFixed(3)})`); }
  else if (frameColorL1DistanceAvg < 0.15) { score += 2; reasons.push(`adjacent_beats_low_variance (adj_l1_avg=${frameColorL1DistanceAvg.toFixed(3)})`); }

  const powerpointStyle = score >= 5;
  return { powerpointStyle, score, reasons, measurements: { registerCount, mascotBeatRatio, kineticTextEveryBeat, frameColorL1DistanceAvg } };
}
