/**
 * REAL_BROLL content-relevance gate (2026-09-11) — closes a real, confirmed
 * bug: generic Pexels Video search sometimes returns completely unrelated
 * footage (a woman's eyelash/makeup, a feather/dried-flower still life, an
 * upside-down book page, skin-texture close-ups) for vague English queries
 * like "money cash close up" or "car service bay". photoSourcing.ts already
 * has this exact class of gate for photos (verifyPhoto/passesPhotoGate) —
 * this is the video equivalent: extract one representative frame from the
 * downloaded clip and run the same kind of vision relevance check before
 * accepting it, instead of trusting the search query blindly.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { aiOrchestrator } from "../../modules/ai-orchestrator/orchestrator";
import { logger } from "../../lib/logger";

const execFileAsync = promisify(execFile);
// ffprobe-static ships no type declarations — require() keeps this a plain
// runtime lookup instead of fighting the compiler over an untyped module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffprobePath: string = require("ffprobe-static").path;

export interface ClipVerification {
  relevant: boolean;
  foreignCurrencyVisible: boolean;
  reasoning: string;
}

function ff(): string {
  if (!ffmpegPath) throw new Error("FFMPEG_BINARY_NOT_FOUND");
  return ffmpegPath as string;
}

/** Grabs one representative JPEG frame from roughly the middle of the clip. */
export async function extractMidFrame(videoPath: string, durationSec: number): Promise<{ base64: string; mediaType: "image/jpeg" } | null> {
  const framePath = videoPath.replace(/\.mp4$/i, "-frame.jpg");
  const atSec = Math.max(0.2, Math.min(durationSec * 0.4, durationSec - 0.2));
  try {
    await execFileAsync(ff(), ["-ss", atSec.toFixed(2), "-i", videoPath, "-frames:v", "1", "-q:v", "3", "-y", framePath], { maxBuffer: 1024 * 1024 * 20 });
    if (!fs.existsSync(framePath)) return null;
    const base64 = fs.readFileSync(framePath).toString("base64");
    fs.unlinkSync(framePath);
    return { base64, mediaType: "image/jpeg" };
  } catch (err) {
    logger.warn({ err, videoPath }, "REAL_BROLL_GATE: frame extraction failed, treating as unverifiable");
    return null;
  }
}

/**
 * BROLL_INTEGRITY_GATE — two real runs crashed Remotion mid-render with
 * "No frame found at position <huge frame number>" on downloaded Pexels
 * clips, even after this gate's ffprobe+decode check passed. Root cause
 * isn't a truncated download: some source files carry a variable frame
 * rate (VFR) container, and Remotion's compositor computes a frame index
 * from wall-clock time using the container's own (inconsistent) timebase —
 * a mismatch there produces a frame number that doesn't exist in the
 * decoded stream, regardless of how short the actual seek offset is.
 * Fix: re-encode every accepted clip to a clean constant-frame-rate (CFR)
 * H.264 file before Remotion ever sees it — this is ffmpeg's/Remotion's own
 * documented remedy for "No frame found at position" on flaky source
 * video, and removes the VFR ambiguity entirely rather than guessing at
 * safe seek offsets.
 */
export async function validateClipIntegrity(videoPath: string): Promise<{ ok: boolean; realDurationSec: number; normalizedPath?: string }> {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath],
      { maxBuffer: 1024 * 1024 * 5 },
    );
    const realDurationSec = parseFloat(stdout.trim());
    if (!Number.isFinite(realDurationSec) || realDurationSec < 0.5) {
      return { ok: false, realDurationSec: 0 };
    }
    // Decode probe: force-read the last ~0.3s of real frames. A truncated/
    // corrupted file throws here even when ffprobe's metadata still looked fine.
    const probeAt = Math.max(0, realDurationSec - 0.3);
    await execFileAsync(
      ff(),
      ["-v", "error", "-ss", probeAt.toFixed(2), "-i", videoPath, "-frames:v", "1", "-f", "null", "-"],
      { maxBuffer: 1024 * 1024 * 5 },
    );

    // CFR normalization — always re-encode, never trust the source container.
    const normalizedPath = videoPath.replace(/\.mp4$/i, "-cfr.mp4");
    await execFileAsync(
      ff(),
      ["-y", "-v", "error", "-i", videoPath, "-r", "30", "-vsync", "cfr", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", normalizedPath],
      { maxBuffer: 1024 * 1024 * 20 },
    );
    if (!fs.existsSync(normalizedPath) || fs.statSync(normalizedPath).size === 0) {
      return { ok: false, realDurationSec: 0 };
    }
    const { stdout: normStdout } = await execFileAsync(
      ffprobePath,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", normalizedPath],
      { maxBuffer: 1024 * 1024 * 5 },
    );
    const normalizedDurationSec = parseFloat(normStdout.trim());
    return {
      ok: true,
      realDurationSec: Number.isFinite(normalizedDurationSec) && normalizedDurationSec > 0 ? normalizedDurationSec : realDurationSec,
      normalizedPath,
    };
  } catch (err) {
    logger.warn({ err, videoPath }, "BROLL_INTEGRITY_GATE: clip failed ffprobe/decode/normalize validation, rejecting");
    return { ok: false, realDurationSec: 0 };
  }
}

/**
 * Real vision-model relevance check (Anthropic, via aiOrchestrator.analyzeImage)
 * — not a keyword heuristic. Fails closed (relevant:false) on any error, same
 * discipline as photoVerification.ts's verifyPhoto.
 */
export async function verifyClipFrame(imageBase64: string, mediaType: "image/jpeg", topic: string, keyword: string, organizationId: string): Promise<ClipVerification> {
  const question =
    `Você está revisando UM frame de um clipe de vídeo real (B-roll) pra um Reel automotivo brasileiro no Instagram. ` +
    `Tema geral do Reel: "${topic}". Palavra-chave deste trecho específico: "${keyword}". ` +
    `Marque relevant:true SOMENTE se o frame plausivelmente se relaciona a carros, direção, oficina, concessionária, estrada, painel/dashboard, dinheiro/finanças em contexto de compra de carro, ou à palavra-chave dada. ` +
    `Marque relevant:false pra qualquer coisa sem nexo com isso — rosto/olho/maquiagem de pessoa em close, still-life de flor/pena/objeto decorativo, página de livro, textura de pele, roupa, ou qualquer cena claramente não-automotiva. ` +
    `Marque foreignCurrencyVisible:true se aparecer moeda claramente não-brasileira (dólar, euro, peso, etc). ` +
    `Responda SOMENTE JSON: {"relevant": true|false, "foreignCurrencyVisible": true|false, "reasoning": "uma frase curta"}.`;

  try {
    const { text } = await aiOrchestrator.analyzeImage(
      { imageBase64, mediaType, question },
      { organizationId, quality: "draft", purpose: "broll-clip-relevance-vision" },
    );
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("NO_JSON_IN_VISION_RESPONSE");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      relevant: Boolean(parsed.relevant),
      foreignCurrencyVisible: Boolean(parsed.foreignCurrencyVisible),
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch (err) {
    logger.warn({ err }, "REAL_BROLL_GATE: vision verification call failed — treating as unverified, not as a pass");
    return { relevant: false, foreignCurrencyVisible: false, reasoning: "verification call failed" };
  }
}
