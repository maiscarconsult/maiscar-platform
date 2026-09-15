/**
 * HOOK_SCORE gate (P0-5, 2026-09-15). Rederives the hook score from the
 * hook block itself rather than trusting the number the Haiku writer
 * puts in the JSON — the writer routinely returns 85-92 regardless of
 * quality. This heuristic scores the ACTUAL hook block on the axes the
 * account owner has repeatedly flagged.
 *
 * A hook score >= 90 clears the P0-5 gate. Lower than 90 is not by
 * itself a hard fail here — the pipeline uses this score to compare
 * candidate hooks and to warn on regressions.
 */
import type { HookBlock } from "../../../remotion/types";

export interface HookScoreInput {
  narration: string;          // beat[0].narration
  hookBlock?: HookBlock;
  firstWordLatencyMs?: number; // measured on the assembled MP3, if available
}

export interface HookScoreResult {
  score: number;               // 0..100
  reasons: string[];
  hardFail: boolean;           // GENERIC_HOOK / cold-silence — never allowed regardless of overall score
}

const BANNED_OPENERS = [
  /^voc[eê] sabia/i,
  /^hoje vamos falar/i,
  /^olha s[oó][,.]/i,
  /^isso est[aá] sendo discutido/i,
  /^voc[eê] j[aá] parou pra pensar/i,
  /^muita gente n[aã]o sabe/i,
];

const CONSEQUENCE_VERBS = [/fude[uy]|fodido/i, /perde[uy]|prejuizo|preju[íi]zo/i, /paga(?:r|ndo)? (?:a )?mais/i, /vai doer/i, /sair caro/i, /ciladas?/i, /armadilha/i, /engan[ao]/i, /rasgando/i, /jogando fora/i];
const MONEY_MARKER = /(r\$|\d+\s*mil|\d+%|\d+k\b|milh[oõ]es?)/i;

export function scoreHook(input: HookScoreInput): HookScoreResult {
  const reasons: string[] = [];
  let score = 50; // start neutral
  let hardFail = false;

  const text = (input.narration ?? "").trim();
  if (!text) {
    return { score: 0, reasons: ["empty_hook"], hardFail: true };
  }

  if (BANNED_OPENERS.some((re) => re.test(text))) {
    hardFail = true;
    reasons.push("generic_opener_banned");
  }

  if (input.hookBlock?.firstOnScreenText && input.hookBlock.firstOnScreenText.split(/\s+/).length >= 3 && input.hookBlock.firstOnScreenText.split(/\s+/).length <= 6) {
    score += 15;
    reasons.push("hook_block_first_on_screen_text_present_3_6_words");
  } else {
    score -= 20;
    reasons.push("missing_or_wrong_length_first_on_screen_text");
  }

  if (typeof input.firstWordLatencyMs === "number") {
    if (input.firstWordLatencyMs <= 200) { score += 10; reasons.push(`first_word_latency=${input.firstWordLatencyMs}ms<=200`); }
    else if (input.firstWordLatencyMs > 500) { hardFail = true; reasons.push(`cold_silence_${input.firstWordLatencyMs}ms>500ms`); }
    else { score -= 5; reasons.push(`first_word_latency=${input.firstWordLatencyMs}ms`); }
  }

  if (CONSEQUENCE_VERBS.some((re) => re.test(text))) { score += 15; reasons.push("consequence_verb_present"); }
  if (MONEY_MARKER.test(text)) { score += 10; reasons.push("money_marker_present"); }
  if (/^\s*se (?:tu|voc[eê])/i.test(text)) { score += 5; reasons.push("second_person_opening"); }
  if (text.length > 220) { score -= 10; reasons.push(`hook_length_${text.length}>220`); }
  if (/\b(?:vs\.?|ou|melhor que|versus)\b/i.test(text) && /(carro|modelo)\b/i.test(text)) {
    hardFail = true;
    reasons.push("comparison_shape_in_hook");
  }

  const clamped = Math.max(0, Math.min(100, score));
  return { score: clamped, reasons, hardFail };
}
