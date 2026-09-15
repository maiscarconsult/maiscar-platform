/**
 * NARRATION_REQUIRED (2026-09-10 -> 2026-09-11/12, V1 -> V3.1 ->
 * MAISCAR_REFERENCE_FORMAT_LOCK_V1) — real text-to-speech, zero cost, zero
 * new authorization needed: the Microsoft Edge "Read Aloud" neural voice
 * service (via the `msedge-tts` package), the same free, keyless,
 * automatable service many open-source tools use. No paid TTS provider
 * (ElevenLabs, OpenAI TTS, etc.) was contracted.
 *
 * MAISCAR_VOICE_LOCK (format-lock v1): the earlier per-beat/per-emotion
 * rate+pitch variation is GONE. One fixed {voice, rate, pitch} config for
 * the entire Reel, and — critically — the WHOLE script is synthesized in a
 * single TTS call (synthesizeFullNarration), not N separate per-beat
 * calls. MULTIPLE_VOICES is now a hard structural impossibility, not just
 * a rule: there is no code path left that could call TTS more than once
 * per Reel or with a different config mid-video.
 *
 * Per-beat timing (needed to sync B-roll/avatar/kinetic-text) now comes
 * from the SAME single call's real word-boundary metadata (msedge-tts's
 * wordBoundaryEnabled), not from N separate audio file durations —
 * sentence-boundary detection was tested first and rejected: it silently
 * merged short sentences together (confirmed empirically), which would
 * have misaligned beat timing. Word boundaries are granular enough that
 * counting words per beat and walking the boundary list in order gives
 * real, ffprobe-grade start/end timestamps without ever re-calling TTS.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import ffmpegPath from "ffmpeg-static";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffprobeStatic = require("ffprobe-static") as { path: string };

const execFileAsync = promisify(execFile);

/** MAISCAR_VOICE_LOCK — the one, permanent voice config for every Reel, start to finish. Change here, never per-call.
 *  buyer-pain-v2 polish: rate lowered from +35% (measured 202-229 wpm across real runs, over the
 *  190-200 target) — rate/prosody only, pitch and voiceId stay untouched. */
export const MAISCAR_VOICE_LOCK = {
  voice: "pt-BR-AntonioNeural",
  rate: "+17%",
  pitch: undefined as string | undefined, // "+0Hz" default — locked flat, no per-emotion pitch shifts anymore
};

/** VOICE_FLUENCY hard ceilings (buyer-pain-v2 polish). */
// Target slightly under the 350ms gate (not exactly 0.35) — the gate check
// is a strict <=, and floating-point drift through the trim/concat/ffprobe
// round-trip previously landed a real measured pause at 0.350000000014s,
// failing the gate by a rounding hair. 0.33 leaves real headroom.
const MAX_NORMAL_PAUSE_SEC = 0.33;

export interface NarratedSegmentAudio {
  path: string;
  durationSec: number;
}

async function getAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobeStatic.path, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
  const seconds = parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`TTS_DURATION_PROBE_FAILED: ${filePath}`);
  return seconds;
}

interface WordBoundaryEntry {
  text: string;
  offsetSec: number;
  durationSec: number;
}

interface RawMetadata {
  Metadata: Array<{ Type: string; Data: { Offset: number; Duration: number; text: { Text: string } } }>;
}

/** hns (100-nanosecond ticks, the SSML/SAPI standard unit) -> seconds. */
const HNS_PER_SEC = 1e7;

function parseWordBoundaries(metadataFilePath: string): WordBoundaryEntry[] {
  const raw = JSON.parse(fs.readFileSync(metadataFilePath, "utf8")) as RawMetadata;
  return raw.Metadata.filter((m) => m.Type === "WordBoundary").map((m) => ({
    text: m.Data.text.Text,
    offsetSec: m.Data.Offset / HNS_PER_SEC,
    durationSec: m.Data.Duration / HNS_PER_SEC,
  }));
}

export interface BeatTiming {
  startSec: number;
  durationSec: number;
}

/**
 * SILENCE_NORMALIZATION (buyer-pain-v2 polish) — msedge-tts's own
 * punctuation-driven pausing isn't controllable to an exact millisecond
 * (no custom SSML <break> injection here, by design — too high-risk to the
 * whole synthesis for this pass), so any gap between two words longer than
 * MAX_NORMAL_PAUSE_SEC gets deterministically shortened by cutting real
 * audio out of that specific silence window — never cutting into a word.
 * 0 LLM: pure ffmpeg atrim+concat, sample-accurate. Word offsets are
 * shifted afterward by exactly how much was removed before each word, so
 * beat timing (and everything downstream) stays in sync with the edited
 * file, not the original.
 */
async function normalizeSilences(
  audioPath: string,
  words: WordBoundaryEntry[],
  durationSec: number,
): Promise<{ path: string; words: WordBoundaryEntry[]; durationSec: number }> {
  if (!ffmpegPath) throw new Error("FFMPEG_BINARY_NOT_FOUND");
  const cuts: Array<{ afterWordIndex: number; removeSec: number }> = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].offsetSec - (words[i - 1].offsetSec + words[i - 1].durationSec);
    if (gap > MAX_NORMAL_PAUSE_SEC) cuts.push({ afterWordIndex: i - 1, removeSec: gap - MAX_NORMAL_PAUSE_SEC });
  }
  if (cuts.length === 0) return { path: audioPath, words, durationSec };

  // Build keep-segments [start,end) covering the whole file, skipping the
  // excess portion of each over-long gap (removed from the START of the
  // gap, so the natural lead-in right before the next word is preserved).
  const segments: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const cut of cuts) {
    const gapStart = words[cut.afterWordIndex].offsetSec + words[cut.afterWordIndex].durationSec;
    segments.push({ start: cursor, end: gapStart });
    cursor = gapStart + cut.removeSec; // skip the excess
  }
  segments.push({ start: cursor, end: durationSec });

  const outPath = audioPath.replace(/\.mp3$/i, "-normalized.mp3");
  const filterParts: string[] = [];
  segments.forEach((seg, i) => {
    filterParts.push(`[0:a]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[s${i}]`);
  });
  const concatInputs = segments.map((_, i) => `[s${i}]`).join("");
  filterParts.push(`${concatInputs}concat=n=${segments.length}:v=0:a=1[out]`);

  await execFileAsync(ffmpegPath as string, ["-i", audioPath, "-filter_complex", filterParts.join(";"), "-map", "[out]", "-y", outPath], {
    maxBuffer: 1024 * 1024 * 50,
  });

  // Shift every word's offset backward by the total excess already removed
  // before it, so timing stays correct against the NEW (shorter) audio.
  let totalRemoved = 0;
  let nextCutIdx = 0;
  const adjustedWords: WordBoundaryEntry[] = words.map((w, i) => {
    while (nextCutIdx < cuts.length && cuts[nextCutIdx].afterWordIndex < i) {
      totalRemoved += cuts[nextCutIdx].removeSec;
      nextCutIdx++;
    }
    return { ...w, offsetSec: w.offsetSec - totalRemoved };
  });
  const newDurationSec = await getAudioDuration(outPath);
  return { path: outPath, words: adjustedWords, durationSec: newDurationSec };
}

export interface FullNarrationResult {
  path: string;
  durationSec: number;
  /** One entry per input beat, in order — real timing derived from word-boundary metadata, not an estimate. */
  beatTimings: BeatTiming[];
  /** Real longest gap between two consecutive words, measured from the same word-boundary stream (VOICE_FLUENCY check) — not estimated. */
  maxPauseSec: number;
}

/**
 * MAISCAR_VOICE_LOCK entry point: synthesizes the ENTIRE Reel's narration
 * (all beats concatenated) in ONE TTS call with ONE fixed voice config, and
 * derives real per-beat start/end times from the real word-boundary
 * stream by walking it in lockstep with each beat's own word count. This
 * is the only narration path — there is no per-beat synthesis anymore.
 */
export async function synthesizeFullNarration(beatTexts: string[], outDir: string, fileBaseName: string): Promise<FullNarrationResult> {
  fs.mkdirSync(outDir, { recursive: true });
  const fullText = beatTexts.join(" ");

  const tts = new MsEdgeTTS();
  await tts.setMetadata(MAISCAR_VOICE_LOCK.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
  const prosody: { rate: string; pitch?: string } = { rate: MAISCAR_VOICE_LOCK.rate };
  if (MAISCAR_VOICE_LOCK.pitch) prosody.pitch = MAISCAR_VOICE_LOCK.pitch;
  const { audioFilePath, metadataFilePath } = await tts.toFile(outDir, fullText, prosody);

  const rawPath = path.join(outDir, `${fileBaseName}-raw.mp3`);
  fs.renameSync(audioFilePath, rawPath);
  const rawDurationSec = await getAudioDuration(rawPath);

  const rawWords = metadataFilePath ? parseWordBoundaries(metadataFilePath) : [];
  if (metadataFilePath && fs.existsSync(metadataFilePath)) fs.unlinkSync(metadataFilePath);

  // SILENCE_NORMALIZATION — deterministic, 0 LLM (see normalizeSilences doc).
  const normalized = await normalizeSilences(rawPath, rawWords, rawDurationSec);
  const finalPath = path.join(outDir, `${fileBaseName}.mp3`);
  if (normalized.path !== rawPath) {
    fs.renameSync(normalized.path, finalPath);
    fs.unlinkSync(rawPath);
  } else {
    fs.renameSync(rawPath, finalPath);
  }
  const words = normalized.words;
  const durationSec = normalized.durationSec;

  // VOICE_FLUENCY (buyer-pain-v2): real max inter-word gap AFTER
  // normalization, not a claim — this is what "frases coladas"/segmented-
  // sounding narration actually looks like in the data (a gap far bigger
  // than natural comma/period breathing room).
  let maxPauseSec = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].offsetSec - (words[i - 1].offsetSec + words[i - 1].durationSec);
    if (gap > maxPauseSec) maxPauseSec = gap;
  }

  const beatTimings: BeatTiming[] = [];
  let wordCursor = 0;
  let cumulativeStart = 0;
  for (let i = 0; i < beatTexts.length; i++) {
    const wordCount = beatTexts[i].trim().split(/\s+/).filter(Boolean).length;
    const sliceEnd = Math.min(wordCursor + wordCount, words.length);
    const lastWord = words[sliceEnd - 1];
    const beatEnd = lastWord ? lastWord.offsetSec + lastWord.durationSec : durationSec;
    beatTimings.push({ startSec: cumulativeStart, durationSec: Math.max(0.3, beatEnd - cumulativeStart) });
    cumulativeStart = beatEnd;
    wordCursor = sliceEnd;
  }
  // The last beat absorbs any trailing audio (silence, or a word-count
  // mismatch between our naive split and the engine's own tokenization) so
  // the timeline always ends exactly at the real audio duration.
  if (beatTimings.length > 0) {
    const last = beatTimings[beatTimings.length - 1];
    last.durationSec = Math.max(0.3, durationSec - last.startSec);
  }

  return { path: finalPath, durationSec, beatTimings, maxPauseSec };
}

/**
 * Legacy per-segment synthesis — kept only for the superseded V1 orchestrator
 * (narratedMotionReelCycle.ts), which the format-locked V3.1+ pipeline no
 * longer uses. Uses the same MAISCAR_VOICE_LOCK config (no per-emotion
 * variation), just one call per segment instead of one call for the whole
 * script — fine for a retired code path, not used by anything current.
 */
export async function synthesizeSegment(text: string, outDir: string, fileBaseName: string): Promise<NarratedSegmentAudio> {
  const result = await synthesizeFullNarration([text], outDir, fileBaseName);
  return { path: result.path, durationSec: result.durationSec };
}
