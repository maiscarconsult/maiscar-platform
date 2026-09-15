/**
 * MAISCAR_NARRATED_MOTION_REEL_V1 renderer (2026-09-10) — real video clips,
 * hard cuts synced to narration segment boundaries, big on-screen keywords.
 * Deliberately built as N small ffmpeg renders + a concat demuxer join
 * instead of one giant filter_complex — same discipline as the rest of this
 * pipeline (small, verifiable steps) and much easier to debug on the first
 * real end-to-end run. 0 LLM.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const TEXT_FADE_SEC = 0.25;

const IMPACT_FONT = "C:\\Windows\\Fonts\\impact.ttf";
const ARIALBD_FONT = "C:\\Windows\\Fonts\\arialbd.ttf";
function keywordFont(): string {
  return fs.existsSync(IMPACT_FONT) ? IMPACT_FONT : ARIALBD_FONT;
}

function ff(): string {
  if (!ffmpegPath) throw new Error("FFMPEG_BINARY_NOT_FOUND");
  return ffmpegPath as string;
}

function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export interface NarratedSegmentInput {
  /** Real video clip path (already downloaded). */
  videoPath: string;
  /** Real duration (seconds) of the source clip, before any loop/trim. */
  clipDurationSec: number;
  /** Target on-screen duration — matches this segment's real narration audio duration. */
  targetDurationSec: number;
  /** Big on-screen keyword shown for this segment (e.g. "CORREIA", "PREJUÍZO"). Empty string = no overlay. */
  keyword: string;
}

/** Renders one segment's video-only clip: real footage, cover-cropped to 1080x1920, keyword burst, hard-cut length == its narration's real duration. */
async function renderSegmentClip(input: NarratedSegmentInput, outPath: string): Promise<void> {
  const needsLoop = input.clipDurationSec < input.targetDurationSec + 0.2;
  const args: string[] = [];
  if (needsLoop) args.push("-stream_loop", "-1");
  args.push("-i", input.videoPath, "-t", input.targetDurationSec.toFixed(2));

  const filters = [`scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`, `crop=${WIDTH}:${HEIGHT}`];
  if (input.keyword.trim()) {
    const d = input.targetDurationSec;
    const alphaExpr = `if(lt(t\\,${TEXT_FADE_SEC})\\,t/${TEXT_FADE_SEC}\\,if(gt(t\\,${(d - TEXT_FADE_SEC).toFixed(2)})\\,(${d.toFixed(2)}-t)/${TEXT_FADE_SEC}\\,1))`;
    filters.push(
      `drawtext=fontfile='${keywordFont().replace(/\\/g, "/")}':text='${escapeDrawtext(input.keyword.toUpperCase())}':fontsize=108:fontcolor=white:borderw=8:bordercolor=black@0.9:x=(w-text_w)/2:y=(h-text_h)/2:alpha='${alphaExpr}'`,
    );
  }
  filters.push("format=yuv420p");

  args.push("-vf", filters.join(","), "-r", String(FPS), "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-y", outPath);
  await execFileAsync(ff(), args, { maxBuffer: 1024 * 1024 * 100 });
}

async function concatVideoClips(clipPaths: string[], outPath: string, listFilePath: string): Promise<void> {
  const list = clipPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
  fs.writeFileSync(listFilePath, list);
  await execFileAsync(ff(), ["-f", "concat", "-safe", "0", "-i", listFilePath, "-c", "copy", "-y", outPath], { maxBuffer: 1024 * 1024 * 100 });
}

async function concatAudioSegments(audioPaths: string[], outPath: string, listFilePath: string): Promise<void> {
  const list = audioPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
  fs.writeFileSync(listFilePath, list);
  await execFileAsync(ff(), ["-f", "concat", "-safe", "0", "-i", listFilePath, "-c", "copy", "-y", outPath], { maxBuffer: 1024 * 1024 * 100 });
}

export interface RenderNarratedReelOptions {
  segments: NarratedSegmentInput[];
  narrationAudioPaths: string[]; // same order/length as segments
  musicPath?: string;
  musicVolume?: number; // default 0.12 — narration must stay dominant
  workDir: string;
  outPath: string;
}

export async function renderNarratedReel(opts: RenderNarratedReelOptions): Promise<string> {
  if (opts.segments.length !== opts.narrationAudioPaths.length) throw new Error("SEGMENT_AUDIO_COUNT_MISMATCH");
  fs.mkdirSync(opts.workDir, { recursive: true });
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });

  const segClipPaths: string[] = [];
  for (let i = 0; i < opts.segments.length; i++) {
    const segPath = path.join(opts.workDir, `seg-${i}.mp4`);
    await renderSegmentClip(opts.segments[i], segPath);
    segClipPaths.push(segPath);
  }

  const videoConcatPath = path.join(opts.workDir, "video-concat.mp4");
  await concatVideoClips(segClipPaths, videoConcatPath, path.join(opts.workDir, "video-list.txt"));

  const narrationFullPath = path.join(opts.workDir, "narration-full.mp3");
  await concatAudioSegments(opts.narrationAudioPaths, narrationFullPath, path.join(opts.workDir, "audio-list.txt"));

  let finalAudioPath = narrationFullPath;
  if (opts.musicPath) {
    const volume = opts.musicVolume ?? 0.12;
    finalAudioPath = path.join(opts.workDir, "audio-mixed.m4a");
    await execFileAsync(
      ff(),
      [
        "-i", narrationFullPath,
        "-i", opts.musicPath,
        "-filter_complex", `[1:a]volume=${volume}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
        "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-y", finalAudioPath,
      ],
      { maxBuffer: 1024 * 1024 * 100 },
    );
  }

  await execFileAsync(
    ff(),
    ["-i", videoConcatPath, "-i", finalAudioPath, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-y", opts.outPath],
    { maxBuffer: 1024 * 1024 * 100 },
  );

  return opts.outPath;
}
