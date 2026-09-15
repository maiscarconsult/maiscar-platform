/**
 * Slide-purpose -> contextual photo search topic (2026-09-09 permanent
 * rule: "foto não é decoração" — every internal slide gets a photo tied to
 * what that specific slide explains, not the same car photo repeated).
 * These are CONTEXTUAL/DOCUMENTARY topics (scene, not a specific vehicle) —
 * sourcePhoto() already supports that via its generic `topic` search.
 */
export type SlidePurpose =
  | "PRICE" | "RUNNING_COST" | "MAINTENANCE" | "WARRANTY"
  | "REAL_USE" | "RESALE" | "SAFETY" | "MECHANICAL_PROBLEM"
  | "PERFORMANCE" | "SPACE";

// Simple English keywords — Pexels' index matches these far better than
// compound Portuguese phrases (confirmed 2026-09-09: "car dealership",
// "gas station car" etc. returned thousands of relevant results; verbose
// Portuguese queries like "concessionária venda carro chave negociação"
// returned irrelevant candidates — traffic underpasses, metro trains —
// that correctly failed the semantic-match gate rather than passing).
export const SLIDE_PHOTO_TOPIC: Record<SlidePurpose, string> = {
  // 2026-09-10: PRICE/PERFORMANCE/WARRANTY queries tightened — the original
  // broad terms ("car dealership", "car driving road", "car dealership
  // service") kept surfacing content that matched the QUERY but not the
  // actual topic (an aerial lot shot, a Waymo, a dealership building
  // exterior) — narrower, single-concept queries give PHOTO_CONTENT_MATCH_GATE
  // better candidates to actually pass.
  // 2026-09-10 (2nd pass): "car keys handover" and "car service advisor
  // customer" kept returning well-matched but visibly staged/generic stock
  // shots (stockCliche:true, otherwise passing every other check) — swapped
  // for less overtly "stock photo" phrasing. "car accelerating motion blur"
  // kept returning shots dominated by an identifiable other-brand car
  // (foregroundConflict) — swapped to an interior tachometer framing, which
  // the content-match description already accepts and avoids exterior
  // brand cues entirely.
  // 6th pass: every posed people+car interaction (handshake, keys, desk
  // paperwork) kept reading as stockCliche:true despite matching content —
  // shifted to a money/financing object shot (calculator + car), which the
  // content-match description already accepts as a valid PRICE angle and
  // sidesteps the posed-interaction cliché pattern entirely.
  // 2026-09-10, corrected again: the cached PRICE_CONTEXT_EXCEPTION asset
  // showed US dollar bills next to R$ headlines — invalidated (see
  // CURRENCY_CONTEXT_GATE in photoVerification.ts). No physical-money
  // requirement anymore; priority 1 per user spec: car key + contract/docs.
  // priority 1 ("car key contract documents") found a near-perfect content
  // match (key handover + contract on clipboard) but stockCliche:true;
  // priority 2 per user spec: dealership negotiation.
  PRICE: "car dealership negotiation contract",
  RUNNING_COST: "gas station car",
  // 2026-09-10: narrowed to an engine-bay/tools close-up specifically to
  // stay visually distinct from WARRANTY's under-car lift shot (both slides
  // are service-context photos — NO_DUPLICATE_PHOTO_GATE needs them to
  // actually look different, not just come from different URLs).
  MAINTENANCE: "mechanic tools engine bay close up",
  // 2nd pass (caught by manually viewing the render, not by the gate): the
  // approved candidate for "mechanic talking to customer car repair" was
  // actually a cinematic/editorial stock shot of a mechanic with his own
  // young daughter next to a vintage classic car — matched the description
  // text well enough to pass Vision, but is not a real modern after-sales
  // scene. Narrowed to explicitly exclude that failure mode.
  // 3rd pass: posed technician+clipboard shots kept reading as
  // stockCliche:true despite matching content — shifted to an
  // object/location-focused shot (car on a lift in a service bay), which the
  // description already accepts as "an authorized service bay" without a
  // posed human interaction.
  WARRANTY: "car on lift service bay garage",
  REAL_USE: "car driving highway",
  RESALE: "used car lot",
  SAFETY: "car driving highway",
  MECHANICAL_PROBLEM: "car engine repair",
  // 2026-09-10, corrected: the cached tachometer photo turned out to be
  // titled "retro car dashboard" on Pexels and carried a shop decal
  // ("911 Retroworks") visible in frame — wrong brand association, caught by
  // the user reviewing the contact sheet. Explicitly modern this time.
  PERFORMANCE: "modern car dashboard gauge close up",
  SPACE: "car trunk open empty",
};

/**
 * PHOTO_CONTENT_MATCH_GATE (2026-09-10) — what the photo needs to actually
 * DEPICT for this slide, checked by Vision on top of the search query.
 * Query match != content match: a photo can rank for "car driving road"
 * without communicating performance/speed at all, and this description is
 * what the gate holds it to instead.
 */
export const SLIDE_CONTENT_MATCH_DESCRIPTION: Record<SlidePurpose, string> = {
  PRICE: "a car purchase/negotiation moment — handing over keys, signing paperwork, a modern showroom interior, or money/financing tied to a car — NOT just a dealership building exterior or an aerial lot shot with no purchase action visible",
  RUNNING_COST: "refueling or charging a car — a gas pump, fuel nozzle in a tank, or an EV charging cable/station",
  MAINTENANCE: "car maintenance/repair in progress — a mechanic, a car on a lift, tools, an open engine bay being serviced",
  // 2026-09-10, 4th pass (user-directed correction): human interaction is
  // NOT required for WARRANTY/AFTERSALES content-match anymore — a real car
  // on a lift/in a service bay, in a clear service/after-sales context, is
  // valid on its own (stockCliche/authenticity/modernity/quality still
  // apply in full). Human-interaction framings (advisor+customer,
  // technician+clipboard) remain valid too — this only widens what counts,
  // it doesn't require a person.
  WARRANTY:
    "a real, modern after-sales/service context — ANY of: a car on a lift or in a service bay, an authorized workshop, a technical inspection/revision scene, a service reception area, a technician with a vehicle, a service advisor with a customer, or warranty/service paperwork, involving a current-model everyday car — NOT just a dealership building exterior, and NOT a vintage/classic/antique car",
  REAL_USE: "a car actually being driven or used day-to-day — on a highway, in city traffic, or parked in a real urban setting",
  RESALE: "a used-car lot or resale negotiation — multiple cars for sale, price tags, or a used-car dealership",
  SAFETY: "a driving safety context — braking, sensors, a car on the road in traffic",
  MECHANICAL_PROBLEM: "a specific mechanical repair — an engine, transmission, or component being worked on",
  PERFORMANCE: "a real car actively conveying speed/acceleration/dynamic performance — motion blur, dynamic cornering, a tachometer/rev counter, or an engine bay — NOT an autonomous/self-driving vehicle (e.g. Waymo), a slow/static car, an empty generic road, a retro/vintage/classic car dashboard, or any visible shop/brand decal, sticker, or logo unrelated to Compass/Corolla",
  SPACE: "a car trunk/boot specifically showing cargo capacity — an open trunk, ideally with luggage or visible empty space communicating size, not an unrelated car part",
};

/**
 * CONCLUSION slide (comparison carousels only, 2026-09-10) — the "veredito"
 * slide must NOT reuse the cover's dual-vehicle composite; it needs its own
 * real contextual photo about choice/decision/the open road, distinct from
 * every other slide's photo.
 */
export const CONCLUSION_PHOTO_TOPIC = "open road driving sunset";
export const CONCLUSION_CONTENT_MATCH_DESCRIPTION =
  "a car on an open road, ideally at sunset/golden hour, conveying a personal choice/journey/decision moment — NOT a dealership, NOT a specific identifiable make/model dominating the frame, NOT the same framing as a generic highway traffic shot";
