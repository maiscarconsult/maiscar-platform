/**
 * COVER scoring (P0-5, 2026-09-15). The cover is a separate product from the
 * Reel: it has to work in the feed with the sound off and the video not
 * playing. The account owner has repeatedly flagged covers that read as
 * PowerPoint bullet lists (title / subtitle separator, corporate voice)
 * even when the underlying video is fine.
 *
 * The pipeline generates three variants internally (SHOCK, CONFRONTATION,
 * MONEY_PAIN) and picks the top-scoring one. If none clears 80,
 * WEAK_COVER = true blocks publish.
 */
import type { MascotPose } from "../../../remotion/types";

export type CoverVariant = "SHOCK" | "CONFRONTATION" | "MONEY_PAIN";

export interface CoverScoreInput {
  variant: CoverVariant;
  headline: string;             // the on-cover text
  mascotPose: MascotPose;
  hasObjectContent: boolean;    // true if the cover shows a car / money / screenshot / part behind the mascot
}

export interface CoverScoreResult {
  score: number;                // 0..100
  reasons: string[];
  weakCover: boolean;           // true when score < 80
}

const CORPORATE_HEADLINE_TOKENS = [
  /\bavalia[çc][aã]o\b/i,
  /\bconsultori(a|as)\b/i,
  /\binspe[çc][aã]o\b/i,
  /\bservi[çc]o\b/i,
];

const SPOKEN_SHAPES = [
  /^tu\s/i,
  /^voc[eê]\s/i,
  /^n[aã]o\s/i,
  /^se\s/i,
  /doer/i,
  /^barato\s/i,
  /^cuidad/i,
  /^perigo/i,
  /^olha\b/i,
];

const CONFRONTATION_POSES: MascotPose[] = ["INDIGNADO", "DESCONFIADO", "APONTANDO", "APONTANDO_DIREITA", "APONTANDO_ESQUERDA", "MAO_NA_CABECA", "FACEPALM", "BRAVO"];
const MONEY_POSES: MascotPose[] = ["DINHEIRO", "DINHEIRO_DOENDO", "MAO_NA_CABECA", "FACEPALM"];
const SHOCK_POSES: MascotPose[] = ["SURPRESO", "MAO_NA_CABECA", "ASSUSTADO", "FACEPALM"];

export function scoreCover(input: CoverScoreInput): CoverScoreResult {
  const reasons: string[] = [];
  let score = 60;

  const headline = (input.headline ?? "").trim();

  // Word count 2-5 is the target — a slash separator or a two-line title is
  // the exact PowerPoint anti-pattern the owner flagged ("PARCELA TE ENGANA
  // / PRAZO").
  const words = headline.split(/\s+/).filter(Boolean);
  if (headline.includes("/")) { score -= 25; reasons.push("slash_separator_reads_as_powerpoint"); }
  if (words.length >= 2 && words.length <= 5) { score += 15; reasons.push(`headline_length_${words.length}`); }
  else { score -= 20; reasons.push(`headline_length_out_of_range_${words.length}`); }

  if (CORPORATE_HEADLINE_TOKENS.some((re) => re.test(headline))) {
    score -= 25; reasons.push("corporate_token_in_headline");
  }

  if (SPOKEN_SHAPES.some((re) => re.test(headline))) {
    score += 15; reasons.push("spoken_sentence_shape");
  }

  // Variant/pose match — a SHOCK variant with a NORMAL pose reads flat.
  const poseMatch: Record<CoverVariant, MascotPose[]> = {
    SHOCK: SHOCK_POSES,
    CONFRONTATION: CONFRONTATION_POSES,
    MONEY_PAIN: MONEY_POSES,
  };
  if (poseMatch[input.variant].includes(input.mascotPose)) {
    score += 15; reasons.push(`pose_matches_variant_${input.variant}`);
  } else {
    score -= 10; reasons.push(`pose_${input.mascotPose}_does_not_match_${input.variant}`);
  }

  if (input.hasObjectContent) { score += 10; reasons.push("object_content_present"); }
  else { score -= 15; reasons.push("no_object_content_behind_mascot"); }

  // ALL CAPS convention — a title-cased or sentence-cased line reads as a
  // corporate slide. Uppercase count > 60% of alpha chars = pass.
  const alphaChars = [...headline].filter((c) => /[A-Za-zÀ-ÿ]/.test(c));
  const upperRatio = alphaChars.length ? [...headline].filter((c) => c >= "A" && c <= "Z").length / alphaChars.length : 0;
  if (upperRatio >= 0.6) { score += 5; reasons.push(`caps_ratio_${upperRatio.toFixed(2)}`); }
  else { score -= 5; reasons.push(`sentence_case_headline_${upperRatio.toFixed(2)}`); }

  const clamped = Math.max(0, Math.min(100, score));
  return { score: clamped, reasons, weakCover: clamped < 80 };
}
