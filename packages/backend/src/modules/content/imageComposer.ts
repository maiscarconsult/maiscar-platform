import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { renderHero, TITLE_SIZE } from "./diagonalTemplateV4";
// v3 (diagonalTemplate.ts) kept in the repo, untouched — rollback path if v4
// ever needs to be reverted: swap this import back to `renderDiagonalSlide`
// from "./diagonalTemplate" and nothing else in this file needs to change.

// Absolute path anchored to this file's location, not process.cwd() — the
// content pipeline can run as a standalone script (scripts/daily-content-
// pipeline.ts, cwd = platform/) as well as inside the backend server (cwd =
// packages/backend/), and both must resolve to the exact same folder that
// app.ts serves statically at /generated.
const GENERATED_DIR = path.join(__dirname, "..", "..", "..", "generated");

/**
 * MASTER DIAGONAL (Visual Lock, 2026-09-03) — this is the ONLY production
 * template. Renders every slide through renderHero: full-bleed photo,
 * diagonal text panel, fixed title/complement scale, mandatory logo/frame.
 * EDITORIAL/DATA/SPLIT are disabled at the dispatcher level in
 * diagonalTemplateV4.ts — see that file's docstring and
 * platform/docs/MAISCAR_EDITORIAL_DESIGN_SYSTEM.md for the full rule set.
 * v3 (diagonalTemplate.ts) is untouched in the repo as a rollback path.
 */
const WIDTH = 1080;
const HEIGHT = 1350;

export type SlideVariant = "cover" | "bottom" | "side" | "card" | "cta"; // kept for call-site compatibility; no longer changes the layout — the diagonal frame is fixed for every variant.

export interface ComposeSlideInput {
  /** Raw background image bytes (photo — real photography, not AI-generated). */
  background: Buffer;
  /** Main slide message. Auto-wrapped into a short 1–3 line Bebas Neue headline. */
  slideText: string;
  /** Small eyebrow label above the headline (e.g. "MERCADO", "ETAPA 2"). */
  kicker?: string;
  /** Optional smaller support line under the headline (auto-shrinks/truncates to fit). */
  subhead?: string;
  /** Unused since v3 (kept for call-site compatibility — the frame no longer varies by variant). */
  variant?: SlideVariant;
  ctaLabel?: string;
  /** 1-based slide position, paired with totalSlides to render "02/08". Omit either to hide the page label. */
  slideIndex?: number;
  totalSlides?: number;
  width?: number;
  height?: number;
  /**
   * SEMANTIC_IMAGE_MATCH attestation, forwarded to renderHero — required,
   * no default. Neither current caller of composeSlideImage (the fully
   * automatic daily pipeline, or the AI-image-generation route) has a human
   * reviewing the photo before this runs, so both currently pass `false`
   * deliberately: this gate fails closed until photo sourcing on those
   * paths is redesigned to either use a human-reviewed real photo or a
   * real automated relevance check. See MAISCAR_EDITORIAL_DESIGN_SYSTEM.md.
   */
  semanticMatchReviewed: boolean;
  /** Forwarded to renderHero — see diagonalTemplateV4.ts. Both current callers pass "CONTEXTUAL" with semanticMatchReviewed:false (this path fails closed either way); set properly once this pipeline sources real, reviewed, model-specific photography. */
  photoCategory?: "EXACT_VEHICLE" | "CONTEXTUAL" | "DOCUMENTARY";
  namedVehicle?: string;
}

export interface ComposeSlideOutput {
  url: string;
  filePath: string;
}

// Bebas Neue is condensed — narrower per character than a normal sans, so it
// gets its own (smaller) average-glyph-width factor rather than reusing a
// generic wrap heuristic.
function wrapHeadline(text: string, fontSize: number, maxWidthPx: number, maxLines = 3): string[] {
  const avgGlyph = fontSize * 0.42;
  const maxChars = Math.max(6, Math.floor(maxWidthPx / avgGlyph));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

/**
 * Renders one carousel slide through the fixed "Corte Diagonal" brand
 * template. Same signature as the v2 composer so contentPipeline/generate.ts
 * and run.ts don't need call-site changes — only the frame underneath it.
 */
export async function composeSlideImage(input: ComposeSlideInput): Promise<ComposeSlideOutput> {
  const width = input.width ?? WIDTH;
  const height = input.height ?? HEIGHT;

  const headline = wrapHeadline(input.slideText, TITLE_SIZE, width - 76 - 60, 2);
  const pageLabel =
    input.slideIndex && input.totalSlides
      ? `${String(input.slideIndex).padStart(2, "0")}/${String(input.totalSlides).padStart(2, "0")}`
      : undefined;

  const composited = await renderHero({
    photoPath: input.background,
    kicker: input.kicker ?? "MAIS.CAR",
    headline,
    microCaption: input.subhead ?? input.ctaLabel,
    pageLabel,
    semanticMatchReviewed: input.semanticMatchReviewed,
    photoCategory: input.photoCategory ?? "CONTEXTUAL",
    namedVehicle: input.namedVehicle,
  });

  await mkdir(GENERATED_DIR, { recursive: true });
  const fileName = `${randomUUID()}.png`;
  const filePath = path.join(GENERATED_DIR, fileName);
  await writeFile(filePath, composited);

  return { url: `/generated/${fileName}`, filePath };
}
