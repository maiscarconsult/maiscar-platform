/**
 * ROUTE 3 comparison carousel builder — permanent visual-storytelling rule
 * (2026-09-09, tightened same day per explicit "não maqueie o problema"
 * correction). Cover = both real vehicles together (dual-photo composite,
 * via composeSideBySide — renderHero never knows the difference from a
 * single photo, so the Golden Master invariants stay untouched). Every
 * internal (DATA) slide REQUIRES its own distinct contextual photo tied to
 * what that slide explains (dinheiro/posto/oficina/estrada — see
 * slidePhotoTopics.ts) — reusing the cover's dual photo, or repeating a
 * photo across two DATA slides, is a HARD FAILURE (`CONTEXTUAL_PHOTO_REQUIRED`),
 * not a silent fallback. A carousel that can't get real distinct contextual
 * photos for its slides comes back `HELD_FOR_FIX`, never delivered anyway.
 *
 * IMPORTANT OPERATIONAL LIMIT: fact verification (WebSearch) only exists in
 * an interactive Claude Code session — the unattended 09:00/19:00
 * Task Scheduler run has no web-search tool wired in, so rich comparison
 * carousels stay a manually-curated production path (see run.ts/
 * daily-cycle-and-publish.ts, which only produce single-photo posts
 * automatically). Also: contextual photo coverage currently depends on
 * PEXELS_API_KEY being configured (Wikimedia alone rarely has usable
 * generic scene photos like "oficina mecânica") — until that key is set,
 * expect HELD_FOR_FIX to be the honest, common outcome here, not a bug.
 */
import fs from "node:fs";
import path from "node:path";
import { renderHero, HeroInput } from "../../modules/content/diagonalTemplateV4";
import { composeSideBySide } from "./photoComposer";
import { sourcePhoto, downloadPhoto } from "./photoSourcing";
import { SlidePurpose, SLIDE_PHOTO_TOPIC, SLIDE_CONTENT_MATCH_DESCRIPTION, CONCLUSION_PHOTO_TOPIC, CONCLUSION_CONTENT_MATCH_DESCRIPTION } from "./slidePhotoTopics";
import { evaluatePresentationGate, PresentationSlideInput } from "./editorialPresentationGate";
import { perceptualHash, checkNoDuplicates } from "./duplicatePhotoGate";
import { checkHeadlineClaim } from "./headlineClaimGate";

const TMP_PHOTO_DIR = path.join(__dirname, "..", "..", "..", ".cache", "sourced-photos");

export interface VerifiedVehicle {
  name: string; // real model name, e.g. "BYD Dolphin"
  priceLabel?: string; // e.g. "R$ 119.990" — ONLY if confirmed, omit otherwise
}

export interface ComparisonSlideSpec {
  slide: "COVER" | "DATA" | "CONCLUSION";
  /** Required for slide:"DATA" — drives which contextual photo this slide needs. */
  purpose?: SlidePurpose;
  input: Omit<HeroInput, "photoPath">;
  /** Caption paragraph explaining THIS slide's comparison — required for DATA slides, checked by EDITORIAL_PRESENTATION_GATE. Not rendered on the art itself (art stays short per Golden Master); assembled into captionLong by the caller. */
  explanation?: string;
}

export type CarouselBuildResult =
  | { ready: true; pngs: Buffer[]; photoReport: Record<string, string> }
  | { ready: false; reason: "HELD_FOR_FIX"; failures: string[]; photoReport: Record<string, string> };

/**
 * Sources every slide's photo first (cover composite + one distinct real
 * contextual photo per DATA slide), runs EDITORIAL_PRESENTATION_GATE, and
 * only renders if everything passes. No fallback path — a missing/repeated
 * contextual photo or a bare-question slide returns HELD_FOR_FIX instead of
 * a worse carousel.
 */
export async function buildComparisonCarousel(
  specs: ComparisonSlideSpec[],
  organizationId: string,
  photoPathA: string,
  photoPathB: string,
  opts: { priceA?: number; priceB?: number } = {},
): Promise<CarouselBuildResult> {
  // COVER gets the dual-vehicle composite (both real cars together). The
  // CONCLUSION/veredito slide does NOT reuse it (2026-09-10, explicit
  // requirement — "não repetir foto da capa") — it sources its own real
  // contextual photo instead, same discipline as any DATA slide.
  const compositeCover = await composeSideBySide(photoPathA, photoPathB);
  const photoReport: Record<string, string> = {};
  const photoBySlide = new Map<string, string | Buffer>();
  const failures: string[] = [];
  const usedContextualUrls = new Set<string>();

  for (const spec of specs) {
    if (spec.slide === "COVER") {
      photoBySlide.set(spec.input.headline.join("|"), compositeCover);
      photoReport[spec.slide] = "dual-composite (capa)";
      continue;
    }

    if (spec.slide === "CONCLUSION") {
      const result = await sourcePhoto(
        { topic: CONCLUSION_PHOTO_TOPIC, contentMatchDescription: CONCLUSION_CONTENT_MATCH_DESCRIPTION, requireNoForeignCurrency: true },
        organizationId,
      );
      if (result.status !== "FOUND") {
        failures.push(`CONTEXTUAL_PHOTO_REQUIRED falhou pro slide "CONCLUSION" (tópico: "${CONCLUSION_PHOTO_TOPIC}") — ${result.reason}`);
        photoReport.CONCLUSION = `FALTOU — ${result.reason}`;
        continue;
      }
      if (usedContextualUrls.has(result.candidate!.imageUrl)) {
        failures.push(`foto contextual repetida: "CONCLUSION" usaria a mesma imagem de um slide anterior`);
        continue;
      }
      usedContextualUrls.add(result.candidate!.imageUrl);
      fs.mkdirSync(TMP_PHOTO_DIR, { recursive: true });
      const localPath = path.join(TMP_PHOTO_DIR, `comparison-CONCLUSION-${Date.now()}.jpg`);
      let downloaded = false;
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3 && !downloaded; attempt++) {
        try {
          await downloadPhoto(result.candidate!, localPath);
          downloaded = true;
        } catch (err) {
          lastErr = err;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      if (!downloaded) {
        failures.push(`download falhou pro slide "CONCLUSION" após 3 tentativas — ${(lastErr as Error)?.message}`);
        photoReport.CONCLUSION = `FALTOU — download falhou após retry`;
        continue;
      }
      photoBySlide.set(spec.input.headline.join("|"), localPath);
      photoReport.CONCLUSION = `${result.candidate!.provider}: ${CONCLUSION_PHOTO_TOPIC}`;
      continue;
    }

    // DATA slide — a real, distinct contextual photo is mandatory.
    if (!spec.purpose) {
      failures.push(`slide DATA "${spec.input.kicker}" sem "purpose" definido — não dá pra saber qual foto contextual buscar`);
      continue;
    }
    const topic = SLIDE_PHOTO_TOPIC[spec.purpose];
    const contentMatchDescription = SLIDE_CONTENT_MATCH_DESCRIPTION[spec.purpose];
    // CURRENCY_CONTEXT_GATE (2026-09-10): this pipeline's copy is always
    // BRL/R$ — a contextual photo showing clearly identifiable foreign
    // currency (caught in practice on the PRICE slide: US dollar bills)
    // must be rejected, always, for every DATA slide.
    const result = await sourcePhoto({ topic, contentMatchDescription, requireNoForeignCurrency: true }, organizationId);
    if (result.status !== "FOUND") {
      failures.push(`CONTEXTUAL_PHOTO_REQUIRED falhou pro slide "${spec.purpose}" (tópico: "${topic}") — ${result.reason}`);
      photoReport[spec.purpose] = `FALTOU — ${result.reason}`;
      continue;
    }
    if (usedContextualUrls.has(result.candidate!.imageUrl)) {
      failures.push(`foto contextual repetida: "${spec.purpose}" usaria a mesma imagem de um slide anterior`);
      continue;
    }
    usedContextualUrls.add(result.candidate!.imageUrl);

    fs.mkdirSync(TMP_PHOTO_DIR, { recursive: true });
    const localPath = path.join(TMP_PHOTO_DIR, `comparison-${spec.purpose}-${Date.now()}.jpg`);
    // Transient rate limits (Wikimedia 429s observed in practice) shouldn't
    // sink an otherwise-successful search — same retry discipline as run.ts.
    let downloaded = false;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3 && !downloaded; attempt++) {
      try {
        await downloadPhoto(result.candidate!, localPath);
        downloaded = true;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (!downloaded) {
      failures.push(`download falhou pro slide "${spec.purpose}" após 3 tentativas — ${(lastErr as Error)?.message}`);
      photoReport[spec.purpose] = `FALTOU — download falhou após retry`;
      continue;
    }
    photoBySlide.set(spec.input.headline.join("|"), localPath);
    photoReport[spec.purpose] = `${result.candidate!.provider}: ${topic}`;
  }

  // EDITORIAL_PRESENTATION_GATE — capa forte, sem foto repetida, cada slide
  // com explicação real. Checked even if photo sourcing already failed
  // above, so the report shows every problem at once, not one at a time.
  const presentationInputs: PresentationSlideInput[] = specs.map((s) => ({
    name: s.purpose ?? s.slide,
    photoSource: typeof photoBySlide.get(s.input.headline.join("|")) === "string" ? (photoBySlide.get(s.input.headline.join("|")) as string) : "COMPOSITE",
    headline: s.input.headline,
    explanation: s.explanation,
    isCover: s.slide === "COVER",
    isConclusion: s.slide === "CONCLUSION",
  }));
  const gate = evaluatePresentationGate(presentationInputs);
  if (!gate.pass) failures.push(...gate.failures);

  // NO_DUPLICATE_PHOTO_GATE — perceptual hash across every slide's actual
  // photo (not just URL identity, which the loop above already checked for
  // contextual slides — this also catches the composite being reused where
  // it shouldn't, or two different URLs that are the same underlying shot).
  // COVER and CONCLUSION now use genuinely different composites (mirrored
  // left/right, see compositeCover/compositeConclusion above), so both are
  // run through this check like every other slide — no exemption needed.
  if (failures.length === 0) {
    const hashEntries = await Promise.all(
      specs.map(async (s) => {
        const p = photoBySlide.get(s.input.headline.join("|"))!;
        return { name: s.purpose ?? s.slide, hash: await perceptualHash(p) };
      }),
    );
    const dup = checkNoDuplicates(hashEntries);
    if (!dup.pass) {
      for (const pair of dup.duplicatePairs) failures.push(`NO_DUPLICATE_PHOTO_GATE falhou: "${pair.a}" e "${pair.b}" usam a mesma foto (distância ${pair.distance})`);
    }
  }

  // HEADLINE_CLAIM_GATE — "mesmo dinheiro" etc. must actually be true given confirmed prices.
  const coverSpec = specs.find((s) => s.slide === "COVER");
  if (coverSpec) {
    const coverText = [...coverSpec.input.headline, coverSpec.input.microCaption, coverSpec.input.complement].filter(Boolean).join(" ");
    const claim = checkHeadlineClaim(coverText, opts.priceA, opts.priceB);
    if (!claim.pass) failures.push(`HEADLINE_CLAIM_GATE falhou: ${claim.reason}`);
  }

  if (failures.length > 0) {
    return { ready: false, reason: "HELD_FOR_FIX", failures, photoReport };
  }

  const pngs: Buffer[] = [];
  for (const spec of specs) {
    const photoPath = photoBySlide.get(spec.input.headline.join("|"))!;
    const category = spec.slide === "COVER" ? "CONTEXTUAL" : "DOCUMENTARY";
    pngs.push(await renderHero({ ...spec.input, photoPath, photoCategory: category }));
  }
  return { ready: true, pngs, photoReport };
}
