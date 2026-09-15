/**
 * SFX kit (2026-09-11, MAISCAR_NARRATED_MOTION_REEL_V3) — five short,
 * discreet sound effects (WHOOSH, POP, CLICK, IMPACT, RISER), synthesized
 * once with ffmpeg's built-in signal generators (sine/noise + envelope),
 * not downloaded from any third-party SFX pack — zero licensing ambiguity,
 * zero cost, zero new service. Generated once into .cache/sfx/ and reused
 * from then on (rule: economia de tokens/recursos — nunca regenerar asset
 * já aprovado).
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);
const SFX_DIR = path.join(__dirname, "..", "..", "..", ".cache", "sfx");

export type SfxType = "WHOOSH" | "POP" | "CLICK" | "IMPACT" | "RISER";

function ff(): string {
  if (!ffmpegPath) throw new Error("FFMPEG_BINARY_NOT_FOUND");
  return ffmpegPath as string;
}

const SFX_FILTERS: Record<SfxType, { durationSec: number; filterComplex: string }> = {
  WHOOSH: { durationSec: 0.4, filterComplex: "anoisesrc=color=pink:duration=0.4[n];[n]highpass=f=800,lowpass=f=6000,afade=t=in:d=0.05,afade=t=out:st=0.25:d=0.15,volume=0.6[out]" },
  POP: { durationSec: 0.12, filterComplex: "sine=frequency=900:duration=0.12[n];[n]afade=t=out:st=0.03:d=0.09,volume=0.7[out]" },
  CLICK: { durationSec: 0.06, filterComplex: "sine=frequency=1800:duration=0.06[n];[n]afade=t=out:st=0.01:d=0.05,volume=0.6[out]" },
  IMPACT: { durationSec: 0.35, filterComplex: "anoisesrc=color=brown:duration=0.35[n];[n]lowpass=f=300,afade=t=out:st=0.05:d=0.3,volume=0.9[out]" },
  RISER: { durationSec: 0.8, filterComplex: "sine=frequency=200:duration=0.8[n];[n]asetrate=44100*1.8,afade=t=in:d=0.1,afade=t=out:st=0.6:d=0.2,volume=0.5[out]" },
};

/** Generates (if not already cached) and returns the absolute path of one synthetic SFX file. */
export async function getSfxPath(type: SfxType): Promise<string> {
  fs.mkdirSync(SFX_DIR, { recursive: true });
  const outPath = path.join(SFX_DIR, `${type.toLowerCase()}.mp3`);
  if (fs.existsSync(outPath)) return outPath;

  const { filterComplex } = SFX_FILTERS[type];
  await execFileAsync(ff(), ["-filter_complex", filterComplex, "-map", "[out]", "-y", outPath], { maxBuffer: 1024 * 1024 * 20 });
  return outPath;
}

export async function getAllSfx(): Promise<Record<SfxType, string>> {
  const types: SfxType[] = ["WHOOSH", "POP", "CLICK", "IMPACT", "RISER"];
  const entries = await Promise.all(types.map(async (t) => [t, await getSfxPath(t)] as const));
  return Object.fromEntries(entries) as Record<SfxType, string>;
}
