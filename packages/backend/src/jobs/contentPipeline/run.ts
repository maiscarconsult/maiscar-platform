import fs from "node:fs";
import path from "node:path";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { getNewsRadar, getNewsRadarExpanded, deepReadArticle, preFilterCandidates } from "./newsRadar";
import { getEvergreenCandidates } from "./evergreenRadar";
import { getComparisonDebateCandidates } from "./comparisonDebateRadar";
import { passesSpecificityGate } from "./specificityGate";
import { scoreCandidates, EditorialScore } from "./editorialScoring";
import { duplicateCheckGate, editorialRelevanceGate, engagementGate, factCheckGate, classifyDefectClaim } from "./gates";
import { sourcePhoto, downloadPhoto, SourcingResult } from "./photoSourcing";
import { writeCopyWithRetry, SlideCopy } from "./copywriting";
import { logCycle } from "./observability";
import { renderHero, fitsAtSize, TITLE_SIZE, BODY_SIZE, BEBAS_GLYPH_FACTOR, HeadlineOverflowError, VisualIdentityError, SemanticPhotoMismatchError } from "../../modules/content/diagonalTemplateV4";

const GENERATED_DIR = path.join(__dirname, "..", "..", "..", "generated");
const TMP_PHOTO_DIR = path.join(__dirname, "..", "..", "..", ".cache", "sourced-photos");

export interface AutonomousCycleResult {
  status: "PRODUCED" | "ABANDONED";
  contentId?: string;
  renderPath?: string;
  selectedTopic?: string;
  score?: EditorialScore;
  photo?: SourcingResult;
  copy?: SlideCopy;
  reason?: string;
}

/**
 * MASTER DIAGONAL SYSTEM ORCHESTRATOR — the real pipeline, replacing the old
 * theme-pool + AI-generated-image flow. Sequence (each step is a gate: a
 * failure moves to the next candidate, never patches the current one by
 * lowering a standard):
 *
 *   news radar (fast scan, cached)
 *     -> editorial scoring (LLM, ranks ALL candidates at once)
 *     -> for each candidate, best score first:
 *          EDITORIAL_RELEVANCE_GATE -> DUPLICATE_CHECK_GATE -> deep read
 *          -> FACT_CHECK_GATE -> PHOTO_SOURCING (multi-provider + vision
 *             verification) -> COPYWRITING (fit-validated, 2 attempts)
 *          -> RENDER (renderHero's own inline invariants: HAS_LOGO,
 *             HAS_FRAME, HAS_DIAGONAL, PHOTO_RATIO>=0.68, frozen type
 *             scale, SEMANTIC_PHOTO_MATCH, CLEAN_EXPORT)
 *     -> first candidate that survives every gate wins; if none do, the
 *        whole cycle is ABANDONED (rule: never force bad content to hit a
 *        schedule).
 *
 * dryRun=true (the only mode currently wired) writes the PNG + a log entry
 * and does NOT touch PublishingJob/Instagram — see dry-run-pipeline.ts.
 */
export async function runAutonomousCycle(params: {
  organizationId: string;
  brandId: string;
  dryRun: boolean;
}): Promise<AutonomousCycleResult> {
  const { organizationId, brandId, dryRun } = params;

  // SINGLE_COLLECTION_PASS (2026-09-09, cost rule): gather ALL three
  // deterministic sources (today's radar, the broader 48h-style sweep,
  // HIGH_INTEREST_EVERGREEN search) up front — every one of them is script/
  // cache, zero LLM cost — merge + dedupe, run them through the
  // SPECIFICITY_GATE (blocks generic pautas like "sintomas de câmbio
  // automático com defeito" before they ever reach Haiku), then locally
  // pre-rank and keep only the top 3 overall. Exactly ONE Haiku scoring
  // call per cycle now, no matter how many sources contributed candidates.
  const [radarResult, expandedResult, evergreenResult] = await Promise.allSettled([
    getNewsRadar(),
    getNewsRadarExpanded(),
    getEvergreenCandidates(),
  ]);
  const merged: ReturnType<typeof preFilterCandidates> = [];
  const seenUrls = new Set<string>();
  for (const settled of [radarResult, expandedResult, evergreenResult]) {
    if (settled.status !== "fulfilled") {
      logger.warn({ reason: settled.reason }, "SINGLE_COLLECTION_PASS: one source failed, continuing with the others");
      continue;
    }
    for (const item of settled.value) {
      if (seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);
      merged.push(item);
    }
  }

  if (merged.length === 0) {
    logCycle(baseLog({ publishStatus: "ABANDONED", reason: "all sources returned nothing" }));
    return { status: "ABANDONED", reason: "NEWS_RADAR_EMPTY" };
  }

  const specific = merged.filter((c) => passesSpecificityGate(c.title).pass);
  const droppedGeneric = merged.length - specific.length;
  if (droppedGeneric > 0) {
    logger.info({ droppedGeneric }, "SPECIFICITY_GATE: dropped generic candidates before scoring");
  }
  if (specific.length === 0) {
    logCycle(baseLog({ publishStatus: "ABANDONED", reason: "no candidate had a concrete anchor (SPECIFICITY_GATE)" }));
    return { status: "ABANDONED", reason: "NO_STRONG_TOPIC_FOUND" };
  }

  const shortlist = preFilterCandidates(specific, 3);

  let scores: EditorialScore[];
  try {
    scores = await scoreCandidates(shortlist, organizationId);
  } catch (err) {
    logCycle(baseLog({ publishStatus: "ERROR", reason: `scoring failed: ${(err as Error).message}` }));
    return { status: "ABANDONED", reason: "EDITORIAL_SCORING_FAILED" };
  }
  const ranked = scores.sort((a, b) => b.total - a.total);

  const pass = await processCandidates(ranked, organizationId, brandId, dryRun, editorialRelevanceGate, false);
  if (pass.result) return pass.result;

  // ROUTE 3 (CONTROVERSY/ENGAGEMENT, own radar since 2026-09-09) — only
  // when ROUTE 1+2 found nothing clearing the NEWS bar. Uses its OWN
  // deterministic source (comparisonDebateRadar: "Carro A x Carro B mesmo
  // orçamento" / "má fama ou injustiça?" pairings, real-search-grounded,
  // never the single-vehicle news feed) and its OWN scoring call — ROUTE 3
  // must work even on a day with zero breaking news. Still capped at 3
  // candidates -> 1 Haiku call, same cost discipline as ROUTE 1/2.
  let route3Result: AutonomousCycleResult | null = null;
  let route3AnyPassed = false;
  let route3Ranked: EditorialScore[] = [];
  try {
    const comparisonCandidates = await getComparisonDebateCandidates();
    const comparisonSpecific = comparisonCandidates.filter((c) => passesSpecificityGate(c.title).pass);
    if (comparisonSpecific.length > 0) {
      const scores3 = await scoreCandidates(comparisonSpecific.slice(0, 3), organizationId);
      route3Ranked = scores3.sort((a, b) => b.total - a.total);
      const route3 = await processCandidates(route3Ranked, organizationId, brandId, dryRun, engagementGate, true);
      route3Result = route3.result;
      route3AnyPassed = route3.anyPassedRelevance;
    } else {
      logger.info("ROUTE 3: comparisonDebateRadar found no specific-enough candidates today");
    }
  } catch (err) {
    logCycle(baseLog({ publishStatus: "ERROR", reason: `ROUTE 3 scoring failed: ${(err as Error).message}` }));
  }
  if (route3Result) return route3Result;

  // Distinguish "editorially nothing was strong enough" (rule 2: this is a
  // GOOD outcome, not a failure — silêncio > conteúdo irrelevante) from
  // "something scored well but died later" (photo/fact/render gates) so the
  // dry-run report can be honest about which case happened.
  const anyPassed = pass.anyPassedRelevance || route3AnyPassed;
  const strongCount =
    ranked.filter((c) => editorialRelevanceGate(c).pass).length + route3Ranked.filter((c) => engagementGate(c).pass).length;
  const reason = !anyPassed
    ? "NO_STRONG_TOPIC_FOUND"
    : strongCount === 1
      ? "ONLY_1_STRONG_TOPIC_FOUND_BUT_FAILED_LATER_GATES"
      : "NO_CANDIDATE_SURVIVED_ALL_GATES";
  logCycle(baseLog({ publishStatus: "ABANDONED", reason }));
  return { status: "ABANDONED", reason };
}

/** The per-candidate gate gauntlet (entry gate -> duplicate -> fact-check -> photo -> copy -> render). `entryGate` swaps between editorialRelevanceGate (ROUTE 1/2, NEWS threshold 80) and engagementGate (ROUTE 3, ENGAGEMENT_SCORE_MIN 65); `engagementMode` switches copywriting to the debate/opinion voice. Returns a result only on PRODUCED; otherwise null (list exhausted) plus whether anything cleared the entry gate. */
async function processCandidates(
  ranked: EditorialScore[],
  organizationId: string,
  brandId: string,
  dryRun: boolean,
  entryGate: (c: EditorialScore) => { pass: boolean; reason?: string },
  engagementMode: boolean,
): Promise<{ result: AutonomousCycleResult | null; anyPassedRelevance: boolean }> {
  let anyPassedRelevance = false;

  for (const candidate of ranked) {
    const gates: Record<string, "PASS" | "FAIL" | "SKIPPED"> = {};

    const relevance = entryGate(candidate);
    gates.EDITORIAL_RELEVANCE_GATE = relevance.pass ? "PASS" : "FAIL";
    if (!relevance.pass) {
      logger.info({ title: candidate.title, score: candidate.total, tier: candidate.tier, reason: relevance.reason }, "candidate rejected: below editorial bar");
      continue;
    }
    anyPassedRelevance = true;

    const dup = await duplicateCheckGate(brandId, candidate.title);
    gates.DUPLICATE_CHECK_GATE = dup.pass ? "PASS" : "FAIL";
    if (!dup.pass) {
      logger.info({ title: candidate.title, reason: dup.reason }, "candidate rejected: duplicate");
      continue;
    }

    let article;
    try {
      article = await deepReadArticle(candidate.url);
    } catch (err) {
      gates.FACT_CHECK_GATE = "FAIL";
      logger.warn({ err, url: candidate.url }, "deep read failed, trying next candidate");
      continue;
    }

    const fact = factCheckGate({ text: article.text, url: candidate.url });
    gates.FACT_CHECK_GATE = fact.pass ? "PASS" : "FAIL";
    if (!fact.pass) {
      logger.info({ title: candidate.title, factStatus: fact.factStatus, reason: fact.reason }, "candidate rejected: fact check did not reach CONFIRMED");
      continue;
    }

    // DEFECT_CLAIM_CLASSIFICATION (rule 11) — caps how strongly copywriting
    // is allowed to phrase any defect claim, based only on what the source
    // text itself evidences (never on the headline's own framing).
    const defectTier = classifyDefectClaim(article.text);

    const photoResult = await sourcePhoto({ namedVehicle: candidate.namedVehicle ?? undefined, topic: candidate.title }, organizationId);
    gates.PHOTO_EDITORIAL_GATE = photoResult.status === "FOUND" ? "PASS" : "FAIL";
    gates.SEMANTIC_PHOTO_GATE = photoResult.status === "FOUND" ? "PASS" : "FAIL";
    if (photoResult.status === "ABANDON") {
      logger.info({ title: candidate.title, reason: photoResult.reason }, "candidate rejected: no valid photo — trying next candidate, not swapping the topic");
      logCycle(
        baseLog({
          selectedTopic: candidate.title,
          topicScore: candidate.total,
          gates,
          publishStatus: "ABANDONED",
          reason: photoResult.reason,
        }),
      );
      continue;
    }

    const localPhotoPath = path.join(TMP_PHOTO_DIR, `${Date.now()}.jpg`);
    try {
      // Small intelligent retry (rule 36: max 3 attempts before changing
      // approach) — a source that was reachable seconds ago during
      // verification can still 429/timeout on the download itself (hit for
      // real against Wikimedia during back-to-back dry runs, 2026-09-03).
      let lastErr: unknown;
      let downloaded = false;
      for (let attempt = 1; attempt <= 3 && !downloaded; attempt++) {
        try {
          await downloadPhoto(photoResult.candidate!, localPhotoPath);
          downloaded = true;
        } catch (err) {
          lastErr = err;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      if (!downloaded) throw lastErr;
    } catch (err) {
      logger.warn({ err, title: candidate.title }, "photo download failed after retries — trying next candidate");
      continue;
    }

    const safeWidth = 1080 - 76 - 100;
    const copy = await writeCopyWithRetry(
      { title: article.title, text: article.text, url: candidate.url },
      candidate.namedVehicle,
      organizationId,
      (c) => {
        for (const line of c.headline) if (!fitsAtSize(line, TITLE_SIZE, safeWidth, BEBAS_GLYPH_FACTOR)) return `headline line too long: "${line}"`;
        if (c.complement && !fitsAtSize(c.complement, BODY_SIZE, safeWidth, BEBAS_GLYPH_FACTOR)) return `complement too long: "${c.complement}"`;
        return null;
      },
      defectTier,
      engagementMode,
    );
    gates.CLEAN_EXPORT_GATE = copy ? "PASS" : "FAIL"; // clean-export itself is re-checked inside renderHero; this is the "did we even get usable copy" pre-check
    if (!copy) {
      logger.warn({ title: candidate.title }, "copy failed to fit after retry — trying next candidate");
      continue;
    }

    // PUBLISHABILITY_GATE (rule 23) — every named sub-gate must already read
    // PASS at this point; this is an explicit composite check, not a new
    // source of truth, so a false here means one of the gates above was
    // wrongly marked PASS (a bug), not a legitimate rejection path.
    // ROUTE 3 uses its own bar (ENGAGEMENT_SCORE, not the 80-point NEWS
    // score, and no CONSEQUENCE_TEST requirement — that's a news-relevance
    // concept, not applicable to an opinion/debate post).
    const publishabilityChecks: Record<string, boolean> = engagementMode
      ? {
          ENGAGEMENT_SCORE: entryGate(candidate).pass,
          WHO_CARES: candidate.whoCaresPass,
          FACT_STATUS: fact.factStatus === "CONFIRMED",
          PHOTO_GATE: gates.PHOTO_EDITORIAL_GATE === "PASS",
          SEMANTIC_MATCH: gates.SEMANTIC_PHOTO_GATE === "PASS",
          DUPLICATE_GATE: gates.DUPLICATE_CHECK_GATE === "PASS",
          CLEAN_EXPORT_PRECHECK: gates.CLEAN_EXPORT_GATE === "PASS",
        }
      : {
          EDITORIAL_SCORE: candidate.total >= 80,
          WHO_CARES: candidate.whoCaresPass,
          CONSEQUENCE: candidate.consequencePass,
          FACT_STATUS: fact.factStatus === "CONFIRMED",
          PHOTO_GATE: gates.PHOTO_EDITORIAL_GATE === "PASS",
          SEMANTIC_MATCH: gates.SEMANTIC_PHOTO_GATE === "PASS",
          DUPLICATE_GATE: gates.DUPLICATE_CHECK_GATE === "PASS",
          CLEAN_EXPORT_PRECHECK: gates.CLEAN_EXPORT_GATE === "PASS",
        };
    const publishable = Object.values(publishabilityChecks).every(Boolean);
    gates.PUBLISHABILITY_GATE = publishable ? "PASS" : "FAIL";
    if (!publishable) {
      logger.warn({ title: candidate.title, publishabilityChecks }, "PUBLISHABILITY_GATE failed despite reaching render step — treating as a bug, abandoning this candidate");
      continue;
    }

    try {
      const png = await renderHero({
        photoPath: localPhotoPath,
        kicker: copy.kicker,
        headline: copy.headline,
        complement: copy.complement,
        microCaption: copy.microCaption,
        semanticMatchReviewed: true, // legitimate here: photoResult.verification already confirmed this via a real vision call, not a blind default
        photoCategory: candidate.namedVehicle ? "EXACT_VEHICLE" : "CONTEXTUAL",
        namedVehicle: candidate.namedVehicle ?? undefined,
      });
      gates.VISUAL_IDENTITY_GATE = "PASS";
      gates.PERFORMANCE_GATE = "PASS"; // structural checks (logo/frame/diagonal/ratio) already ran inline above

      fs.mkdirSync(GENERATED_DIR, { recursive: true });
      const renderPath = path.join(GENERATED_DIR, `autonomous-${Date.now()}.png`);
      fs.writeFileSync(renderPath, png);

      logCycle(
        baseLog({
          selectedTopic: candidate.title,
          topicScore: candidate.total,
          photoSource: photoResult.candidate!.provider,
          photoScore: photoResult.verification
            ? { authenticity: photoResult.verification.authenticity, editorialQuality: photoResult.verification.editorialQuality }
            : null,
          gates,
          publishStatus: dryRun ? "DRY_RUN" : "PUBLISHED",
          tier: candidate.tier,
          brazilRelevant: candidate.brazilRelevant,
          whoCaresPass: candidate.whoCaresPass,
          consequencePass: candidate.consequencePass,
          factStatus: fact.factStatus,
          defectClaimTier: defectTier,
          publishable,
        }),
      );

      if (dryRun) {
        return { result: { status: "PRODUCED", renderPath, selectedTopic: candidate.title, score: candidate, photo: photoResult, copy }, anyPassedRelevance };
      }

      // Live path intentionally not implemented yet — FULL_AUTONOMOUS_READY
      // requires the dry runs + chaos tests to pass first (see chaos-test /
      // dry-run scripts). When enabled, this creates Content/ContentVersion/
      // ContentAsset/PublishingJob the same way the manual schedule-*.js
      // scripts did this session.
      throw new Error("LIVE_PUBLISH_NOT_YET_ENABLED — auto-publish stays disabled until dry runs + chaos tests pass");
    } catch (err) {
      if (err instanceof HeadlineOverflowError || err instanceof VisualIdentityError || err instanceof SemanticPhotoMismatchError) {
        gates.VISUAL_IDENTITY_GATE = "FAIL";
        logger.warn({ err: err.message, title: candidate.title }, "render rejected by a visual gate — trying next candidate");
        logCycle(baseLog({ selectedTopic: candidate.title, topicScore: candidate.total, gates, publishStatus: "ABANDONED", reason: err.message }));
        continue;
      }
      throw err;
    }
  }

  return { result: null, anyPassedRelevance };
}

function baseLog(partial: Partial<Parameters<typeof logCycle>[0]>): Parameters<typeof logCycle>[0] {
  return {
    timestamp: new Date().toISOString(),
    selectedTopic: null,
    topicScore: null,
    photoSource: null,
    photoScore: null,
    gates: {},
    tokenMode: "API_LLM",
    publishStatus: "ERROR",
    ...partial,
  };
}
