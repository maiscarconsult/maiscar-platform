import { aiOrchestrator } from "../../modules/ai-orchestrator/orchestrator";
import { logger } from "../../lib/logger";

export interface PhotoVerification {
  showsNamedVehicle: boolean | null; // null when the check wasn't about a specific model
  editorialQuality: number; // 0-10 — composition, lighting, "would a photo editor pick this"
  authenticity: number; // 0-10 — 10 = clearly a real photo; low = looks AI-generated/fake (wrong badges, impossible geometry, plastic-looking surfaces)
  stockCliche: boolean; // "advertising stock photo" red flag (staged smiles, key handover, pointing at engine, etc.)
  /** PHOTO_CONTENT_MATCH_GATE (2026-09-10): does the photo specifically depict what THIS slide is explaining — not just "a car exists" or "the search query matched". Query match != content match. */
  contentMatches: boolean;
  /** MODERNITY_GATE — only meaningful when expectedModelYear is given: false if the vehicle/scene looks like an old/different generation being passed off as current. */
  modernityOk: boolean;
  /**
   * Contextual "wrong vehicle" check (2026-09-10, corrected same day —
   * replaces the old blanket unrelatedVehicleDetected, which failed real
   * current-gen photos just because OTHER cars were visible in the
   * background at a motor show/dealership/lot). Four sub-signals, combined
   * by passesPhotoGate: PRIMARY_SUBJECT_MATCH=true + VISUAL_AMBIGUITY=false
   * passes even with background vehicles present.
   */
  primarySubjectMatch: boolean; // the main/foreground vehicle IS the named model
  backgroundVehiclesPresent: boolean; // informational only — never fails the gate by itself
  foregroundConflict: boolean; // a DIFFERENT vehicle shares/dominates the foreground, genuinely confusable with the subject
  visualAmbiguity: boolean; // a reasonable viewer could not confidently tell which car is the subject
  /** MARKET_VERSION_GATE (2026-09-10) — does this look like the version actually sold in Brazil (not a market-specific variant with different badge/grille/trim that a Brazilian buyer wouldn't recognize)? Only meaningful when checked (marketContext requested). */
  marketVersionOk: boolean;
  /** CURRENCY_CONTEXT_GATE (2026-09-10) — true if the photo shows clearly identifiable foreign currency (USD, EUR, or other non-Brazilian banknotes/coins) — caught a real bug: a "money" contextual photo for a BRL-priced piece showed US dollar bills. Always evaluated (cheap, no extra prompt branch needed); only enforced by passesPhotoGate when the caller opts in. */
  foreignCurrencyVisible: boolean;
  reasoning: string;
}

/**
 * The actual, automated PHOTO_EDITORIAL_GATE / SEMANTIC_PHOTO_GATE /
 * PHOTO_CONTENT_MATCH_GATE / MARKET_VERSION_GATE check — a real
 * vision-model call (Anthropic, via aiOrchestrator.analyzeImage), not a
 * keyword heuristic.
 */
export async function verifyPhoto(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  opts: { namedVehicle?: string; topic: string; contentMatchDescription?: string; expectedModelYear?: string; checkBrazilMarketVersion?: boolean },
  organizationId: string,
): Promise<PhotoVerification> {
  const modernityClause = opts.expectedModelYear
    ? ` This vehicle is being presented as a current ${opts.expectedModelYear} model — if the photo shows an older/different generation (different body shape, badges, or clearly dated styling), set modernityOk to false.`
    : "";
  const contentMatchClause = opts.contentMatchDescription
    ? ` This photo will illustrate a slide specifically about: "${opts.contentMatchDescription}". Set contentMatches to true ONLY if the photo actually depicts that — not just "a car" or "a road" in general. A photo that merely matched the search keywords but doesn't specifically show this topic must get contentMatches:false.`
    : "";
  const marketClause = opts.checkBrazilMarketVersion
    ? ` This photo is for a Brazilian-market comparison piece. Set marketVersionOk to false ONLY if the vehicle shown is a market-specific variant a Brazilian buyer wouldn't recognize (e.g. a different-market grille/badge/trim package clearly distinct from the globally-common version) — a normal, unbadged-differently unit photographed abroad still counts as marketVersionOk:true; don't fail this just because the photo wasn't taken in Brazil.`
    : "";

  const question = opts.namedVehicle
    ? `You are a senior automotive photo editor evaluating a candidate photo of a "${opts.namedVehicle}" for a comparison piece.${modernityClause}${contentMatchClause}${marketClause} ` +
      `This photo may have OTHER vehicles visible in the background (a dealership lot, motor show, street) — that is normal and should NOT by itself cause rejection. Judge four separate things: ` +
      `(1) primarySubjectMatch: is the main/foreground vehicle actually a "${opts.namedVehicle}" (correct badge/model/design)? ` +
      `(2) backgroundVehiclesPresent: are other vehicles visible anywhere in the frame (informational only, does not by itself fail anything)? ` +
      `(3) foregroundConflict: does a DIFFERENT vehicle share or dominate the foreground/main framing in a way that genuinely competes with "${opts.namedVehicle}" for attention (not just incidentally visible in the back)? ` +
      `(4) visualAmbiguity: would a reasonable viewer be unsure WHICH car in this photo is supposed to be the "${opts.namedVehicle}"? ` +
      `Answer strictly as JSON: {"showsNamedVehicle": true|false, "editorialQuality": 0-10, "authenticity": 0-10, "stockCliche": true|false, "contentMatches": true|false, "modernityOk": true|false, "marketVersionOk": true|false, "primarySubjectMatch": true|false, "backgroundVehiclesPresent": true|false, "foregroundConflict": true|false, "visualAmbiguity": true|false, "foreignCurrencyVisible": true|false, "reasoning": "one sentence"}. ` +
      `authenticity should be low if the vehicle looks AI-generated (wrong badges, impossible geometry, deformed wheels, plastic-looking surface, inconsistent lighting). ` +
      `stockCliche should be true for staged advertising scenes (smiling person holding keys, pointing at engine, handshake, etc). Respond with ONLY the JSON, no other text.`
    : `You are a senior automotive photo editor reviewing a candidate photo for the topic: "${opts.topic}".${contentMatchClause} ` +
      `Set foregroundConflict true only if a clearly identifiable, specific make/model dominates the frame in a way that would confuse this generic/contextual slide; incidental background vehicles are fine. ` +
      `Also set foreignCurrencyVisible to true if the photo shows clearly identifiable foreign (non-Brazilian) currency — banknotes or coins from the US, Europe, or any country other than Brazil (e.g. a US dollar bill's distinct portrait/design, a Euro note). Brazilian Real notes/coins, or no currency at all, should be foreignCurrencyVisible:false. ` +
      `Answer strictly as JSON: {"showsNamedVehicle": null, "editorialQuality": 0-10, "authenticity": 0-10, "stockCliche": true|false, "contentMatches": true|false, "modernityOk": true, "marketVersionOk": true, "primarySubjectMatch": true, "backgroundVehiclesPresent": true|false, "foregroundConflict": true|false, "visualAmbiguity": false, "foreignCurrencyVisible": true|false, "reasoning": "one sentence"}. ` +
      `authenticity should be low if the image looks AI-generated. stockCliche should be true for staged advertising scenes. Respond with ONLY the JSON, no other text.`;

  try {
    const { text } = await aiOrchestrator.analyzeImage(
      { imageBase64, mediaType, question },
      { organizationId, quality: "draft", purpose: "photo-verification-vision" },
    );
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("NO_JSON_IN_VISION_RESPONSE");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      showsNamedVehicle: parsed.showsNamedVehicle ?? null,
      editorialQuality: Number(parsed.editorialQuality) || 0,
      authenticity: Number(parsed.authenticity) || 0,
      stockCliche: Boolean(parsed.stockCliche),
      contentMatches: opts.contentMatchDescription ? Boolean(parsed.contentMatches) : true,
      modernityOk: parsed.modernityOk === undefined ? true : Boolean(parsed.modernityOk),
      marketVersionOk: opts.checkBrazilMarketVersion ? Boolean(parsed.marketVersionOk) : true,
      primarySubjectMatch: parsed.primarySubjectMatch === undefined ? true : Boolean(parsed.primarySubjectMatch),
      backgroundVehiclesPresent: Boolean(parsed.backgroundVehiclesPresent),
      foregroundConflict: Boolean(parsed.foregroundConflict),
      visualAmbiguity: Boolean(parsed.visualAmbiguity),
      foreignCurrencyVisible: Boolean(parsed.foreignCurrencyVisible),
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch (err) {
    logger.warn({ err }, "photo verification failed — treating as rejected, not as a pass");
    // Fail closed: a verification error means "not confirmed", never "assume it's fine".
    return {
      showsNamedVehicle: opts.namedVehicle ? false : null,
      editorialQuality: 0,
      authenticity: 0,
      stockCliche: true,
      contentMatches: false,
      modernityOk: false,
      marketVersionOk: false,
      primarySubjectMatch: false,
      backgroundVehiclesPresent: false,
      foregroundConflict: false,
      visualAmbiguity: true,
      foreignCurrencyVisible: false,
      reasoning: "verification call failed",
    };
  }
}

export function passesPhotoGate(
  v: PhotoVerification,
  namedVehicle?: string,
  opts: { requireNoForeignCurrency?: boolean } = {},
): boolean {
  if (namedVehicle && v.showsNamedVehicle !== true) return false;
  if (v.stockCliche) return false;
  if (v.authenticity < 7) return false;
  if (v.editorialQuality < 6) return false;
  if (!v.contentMatches) return false;
  if (!v.modernityOk) return false;
  if (!v.marketVersionOk) return false;
  // Contextual wrong-vehicle check: background vehicles alone never fail
  // this — only a real foreground conflict or genuine ambiguity about
  // which car is the subject does.
  if (!v.primarySubjectMatch) return false;
  if (v.foregroundConflict) return false;
  if (v.visualAmbiguity) return false;
  // CURRENCY_CONTEXT_GATE (2026-09-10) — opt-in, not applied by default:
  // a copy denominated in BRL/R$ must not be illustrated with clearly
  // identifiable foreign currency (caught in practice: a "money" contextual
  // photo showed US dollar bills next to R$ headlines).
  if (opts.requireNoForeignCurrency && v.foreignCurrencyVisible) return false;
  return true;
}
