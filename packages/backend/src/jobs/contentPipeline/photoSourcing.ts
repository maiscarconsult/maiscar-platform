import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import sharp from "sharp";
import { cache } from "./cache";
import { logger } from "../../lib/logger";
import { verifyPhoto, passesPhotoGate, PhotoVerification } from "./photoVerification";

// LOCAL_VISUAL_PRE_FILTER decision (rule 13 of the hardening pass, 2026-09-03):
// evaluated adding a free/local ML pre-filter (CLIP/OpenCLIP embeddings,
// perceptual hashing, OpenCV blur/quality checks) between candidate search
// and the Claude Vision call. Decision: NOT implemented for now — the
// existing zero-cost filters already do the job at this pipeline's actual
// scale (a handful of candidates per cycle, at most a couple of cycles a
// day): MIN_USABLE_DIMENSION strips broken/tiny images, VEHICLE_ASSET_CACHE
// means a repeat model is never re-searched or re-verified at all, and
// MAX_VISION_CALLS=2 already caps the worst case to 2 API calls regardless
// of how many raw candidates a provider returns. A CLIP-style semantic
// pre-filter would help with "is this even plausibly a car" screening, but
// that's not the bottleneck here — dimension/dedupe/cache already keep
// vision-call volume low, and adding an embeddings model would trade a
// zero-cost dependency for a heavier one (model download, inference time,
// another failure mode) to solve a problem this pipeline doesn't have yet.
// Revisit if candidate volume per cycle grows materially (e.g. once
// multiple manufacturer press feeds are scraped in parallel).
export type PhotoCategory = "EXACT_VEHICLE" | "CONTEXTUAL" | "DOCUMENTARY";

export interface PhotoCandidate {
  imageUrl: string;
  provider: string;
  category: PhotoCategory;
  /** 0-1: how confident the provider is this actually shows the named vehicle (only meaningful for EXACT_VEHICLE attempts). */
  confidence: number;
  license: string;
  sourcePage: string;
  /** Rights bookkeeping (rule 15) — never assume "downloadable" means "usable". */
  sourceType?: "official-press" | "editorial-cc" | "stock-license" | "unknown";
  licenseStatus?: string;
  attributionRequired?: boolean;
  attributionText?: string;
  commercialUseAllowed?: boolean;
}

export interface PhotoQuery {
  /** Set when the copy names a specific model — forces the search toward EXACT_VEHICLE providers first. */
  namedVehicle?: string;
  /** Free-text topic, used for CONTEXTUAL/DOCUMENTARY search when namedVehicle is unset (or as the query for press-site search when it is). */
  topic: string;
  /**
   * Explicit, per-call exception (2026-09-09) — Pexels normally never
   * returns EXACT_VEHICLE candidates ("near-zero coverage of exact car
   * trims" is the default assumption). Set true only when a human has
   * decided, for this one search, that Pexels is worth trying anyway
   * (e.g. another provider is rate-limited) — a Pexels hit still has to
   * pass the same strict EXACT_VEHICLE verification as any other source,
   * this flag only lets it into the candidate pool.
   */
  allowPexelsForNamedVehicle?: boolean;
  /** PHOTO_CONTENT_MATCH_GATE (2026-09-10) — what THIS specific use of the photo needs to depict, beyond just matching the search query. Required for contextual/slide-purpose searches to actually validate relevance, not just "a result came back". */
  contentMatchDescription?: string;
  /** MODERNITY_GATE (2026-09-10) — set when the narrative presents this as a current model; an old/different generation photo fails even if the badge matches. */
  expectedModelYear?: string;
  /** MARKET_VERSION_GATE (2026-09-10) — checks the photographed version is recognizable as what's sold in Brazil, not an unrelated market-specific variant. */
  checkBrazilMarketVersion?: boolean;
  /** CURRENCY_CONTEXT_GATE (2026-09-10) — set when the copy is denominated in BRL/R$: rejects candidates showing clearly identifiable foreign currency (caught a real bug: a "money" contextual photo showed US dollar bills next to R$ prices). */
  requireNoForeignCurrency?: boolean;
}

interface PhotoProvider {
  name: string;
  /** Only attempts a search when it's actually applicable — a press provider with no registry entry for the brand returns []. */
  search(query: PhotoQuery): Promise<PhotoCandidate[]>;
}

// ---------------------------------------------------------------------------
// Tier 1: OfficialPressProvider — known manufacturer newsroom/media-center
// pages. Static HTML fetch + generic image/alt-text matching (no JS
// execution, so SPA-heavy newsrooms will legitimately return nothing —
// that's an honest miss, not a bug to paper over; it falls through to the
// next tier). Registry is seeded with the manufacturers this project has
// actually dealt with; extend as new brands come up.
// ---------------------------------------------------------------------------
const PRESS_REGISTRY: Record<string, string[]> = {
  peugeot: ["https://media.stellantis.com/br-pt/peugeot"],
  citroen: ["https://media.stellantis.com/br-pt/citroen"],
  jeep: ["https://media.stellantis.com/br-pt/jeep"],
  fiat: ["https://media.stellantis.com/br-pt/fiat"],
  ram: ["https://media.stellantis.com/br-pt/ram"],
  "omoda": ["https://www.omodajaecoo.com.br/imprensa"],
  "jaecoo": ["https://www.omodajaecoo.com.br/imprensa"],
  "toyota": ["https://www.toyotacomunica.com.br/noticias/"],
};

function brandFromNamedVehicle(namedVehicle: string): string | undefined {
  const lower = namedVehicle.toLowerCase();
  return Object.keys(PRESS_REGISTRY).find((brand) => lower.includes(brand));
}

async function genericPressPageSearch(pageUrl: string, namedVehicle: string, providerName: string): Promise<PhotoCandidate[]> {
  try {
    // Resilience (rule 17): a slow/hung newsroom page must not stall the
    // whole cycle — bounded timeout, and any failure here is a graceful
    // miss (falls through to the next tier), never a crash.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MaisCarRadar/1.0)" }, signal: controller.signal }).finally(() =>
      clearTimeout(timeout),
    );
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const modelWords = namedVehicle.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const candidates: PhotoCandidate[] = [];
    $("img").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
      const alt = ($(el).attr("alt") || "").toLowerCase();
      const context = alt + " " + ($(el).closest("figure,a,div").text() || "").toLowerCase().slice(0, 200);
      if (!src) return;
      const matchedWords = modelWords.filter((w) => context.includes(w));
      if (matchedWords.length >= Math.max(1, modelWords.length - 1)) {
        candidates.push({
          imageUrl: src.startsWith("http") ? src : new URL(src, pageUrl).toString(),
          provider: providerName,
          category: "EXACT_VEHICLE",
          confidence: matchedWords.length / modelWords.length,
          license: "press-kit-editorial-use",
          sourcePage: pageUrl,
          sourceType: "official-press",
          licenseStatus: "Press kit — uso editorial autorizado pelo fabricante para imprensa/mídia",
          attributionRequired: false,
          commercialUseAllowed: true,
        });
      }
    });
    return candidates;
  } catch (err) {
    logger.warn({ err, pageUrl }, "press page search failed, treating as no results");
    return [];
  }
}

const OfficialPressProvider: PhotoProvider = {
  name: "OfficialPressProvider",
  async search({ namedVehicle }) {
    if (!namedVehicle) return [];
    const brand = brandFromNamedVehicle(namedVehicle);
    if (!brand) return [];
    const cacheKey = `press:${brand}:${namedVehicle}`;
    const cached = cache.getSubkey<{ fetchedAt: string; result: PhotoCandidate[] }>("PHOTO_QUERY_CACHE", cacheKey);
    if (cache.isFresh(cached?.fetchedAt, 7 * 24 * 60 * 60 * 1000)) return cached!.result;

    const pages = PRESS_REGISTRY[brand];
    const results = (await Promise.all(pages.map((p) => genericPressPageSearch(p, namedVehicle, "OfficialPressProvider")))).flat();
    cache.setSubkey("PHOTO_QUERY_CACHE", cacheKey, { fetchedAt: new Date().toISOString(), result: results });
    return results;
  },
};

// ---------------------------------------------------------------------------
// Tier 2: EditorialPhotoProvider — Wikimedia Commons. Free, public API, no
// key required, and frequently hosts real manufacturer/press photography
// under CC licenses (uploaded by users, automotive outlets, or manufacturers
// themselves) — a genuinely usable automated source for EXACT_VEHICLE, and
// also the broadened fallback for CONTEXTUAL/DOCUMENTARY topics.
// ---------------------------------------------------------------------------
interface WikimediaHit {
  title: string;
  url: string;
  descriptionUrl: string;
  width: number;
  height: number;
  licenseShortName: string;
  artist: string;
  attributionRequired: boolean;
}

async function wikimediaSearch(query: string, limit = 8): Promise<WikimediaHit[]> {
  const searchRes = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=${limit}&format=json&srsearch=${encodeURIComponent(query)}`,
    { headers: { "User-Agent": "MaisCarRadar/1.0 (editorial photo sourcing)" } },
  );
  if (!searchRes.ok) throw new Error(`WIKIMEDIA_SEARCH_FAILED: ${searchRes.status}`);
  const searchData = (await searchRes.json()) as { query?: { search?: Array<{ title: string }> } };
  const titles = (searchData.query?.search ?? []).map((r) => r.title);
  if (titles.length === 0) return [];

  // iiprop includes size (cheap dimension pre-filter, no download needed)
  // and extmetadata (real per-file license — rule 16: never presume every
  // file has the same condition).
  const infoRes = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join("|"))}&prop=imageinfo&iiprop=url|size|extmetadata&format=json`,
    { headers: { "User-Agent": "MaisCarRadar/1.0 (editorial photo sourcing)" } },
  );
  if (!infoRes.ok) throw new Error(`WIKIMEDIA_IMAGEINFO_FAILED: ${infoRes.status}`);
  const infoData = (await infoRes.json()) as {
    query?: {
      pages?: Record<
        string,
        { title: string; imageinfo?: Array<{ url: string; descriptionurl: string; width: number; height: number; extmetadata?: Record<string, { value: string }> }> }
      >;
    };
  };
  const pages = Object.values(infoData.query?.pages ?? {});
  return pages
    .filter((p) => p.imageinfo?.[0]?.url)
    .map((p) => {
      const info = p.imageinfo![0];
      const meta = info.extmetadata ?? {};
      const licenseShortName = meta.LicenseShortName?.value ?? "unknown";
      // Public-domain / CC0 licenses don't require attribution; everything
      // else on Commons practically does.
      const attributionRequired = !/public domain|cc0/i.test(licenseShortName);
      return {
        title: p.title,
        url: info.url,
        descriptionUrl: info.descriptionurl,
        width: info.width,
        height: info.height,
        licenseShortName,
        artist: (meta.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim(),
        attributionRequired,
      };
    });
}

const MIN_USABLE_DIMENSION = 500; // rule 13: cheap deterministic filter before any vision call

// Cheap, zero-cost pre-Vision relevance filter (2026-09-10) — title/filename
// text only, no download/API call. Two jobs: (a) deprioritize candidates
// whose title names an old year (old-generation press photos get uploaded
// to Commons with era-appropriate filenames far more often than not), (b)
// deprioritize obvious non-exterior/irrelevant close-ups (gauges, badges,
// interior details) that answer a different question than "what does the
// current car look like". This runs BEFORE the MAX_VISION_CALLS budget is
// spent, so Vision only ever sees the most plausible candidates.
const IRRELEVANT_TITLE_KEYWORDS = ["gauge", "dashboard", "cluster", "badge", "emblem", "interior", "engine bay", "wheel", "logo"];
function cheapRelevanceScore(title: string, expectedModelYear?: string): number {
  const lower = title.toLowerCase();
  let score = 0.5;
  if (IRRELEVANT_TITLE_KEYWORDS.some((k) => lower.includes(k))) score -= 0.4;
  const yearMatch = title.match(/(19|20)\d{2}/);
  if (yearMatch) {
    const year = Number(yearMatch[0]);
    const targetYear = expectedModelYear ? Number(expectedModelYear.match(/\d{4}/)?.[0]) : undefined;
    if (targetYear && !Number.isNaN(targetYear)) {
      // Within ~4 years of the target = plausible same generation; older = penalized hard.
      if (Math.abs(targetYear - year) <= 4) score += 0.3;
      else score -= 0.35;
    } else if (year < new Date().getFullYear() - 6) {
      score -= 0.2; // no explicit target year, but this one still reads as old
    }
  }
  return score;
}

const EditorialPhotoProvider: PhotoProvider = {
  name: "EditorialPhotoProvider (Wikimedia Commons)",
  async search({ namedVehicle, topic, expectedModelYear }) {
    // Generation/year-aware query (2026-09-10 fix) — searching just the bare
    // model name reliably surfaces whatever generation has the most photos
    // on Commons, which is often an older one, not the current model.
    const query = namedVehicle ? [namedVehicle, expectedModelYear?.match(/\d{4}/)?.[0]].filter(Boolean).join(" ") : topic;
    const cacheKey = `wikimedia:${query}`;
    const cached = cache.getSubkey<{ fetchedAt: string; result: PhotoCandidate[] }>("PHOTO_QUERY_CACHE", cacheKey);
    if (cache.isFresh(cached?.fetchedAt, 7 * 24 * 60 * 60 * 1000)) return cached!.result;

    try {
      const results = await wikimediaSearch(query);
      const candidates: PhotoCandidate[] = results
        .filter((r) => r.width >= MIN_USABLE_DIMENSION && r.height >= MIN_USABLE_DIMENSION) // cheap filter, zero API cost
        .map((r) => ({
          imageUrl: r.url,
          provider: "EditorialPhotoProvider",
          category: namedVehicle ? "EXACT_VEHICLE" : "CONTEXTUAL",
          // Cheap textual relevance score (title/filename only) — pushes
          // obviously-old or off-topic candidates to the back before any
          // Vision call is spent on them; still just a heuristic, so
          // Vision remains the real gate, not this score.
          confidence: cheapRelevanceScore(r.title, namedVehicle ? expectedModelYear : undefined),
          license: r.licenseShortName,
          sourcePage: r.descriptionUrl,
          sourceType: "editorial-cc",
          licenseStatus: r.licenseShortName,
          attributionRequired: r.attributionRequired,
          attributionText: r.attributionRequired ? `${r.artist || "Wikimedia Commons"} (${r.licenseShortName})` : undefined,
          commercialUseAllowed: !/nc\b|noncommercial/i.test(r.licenseShortName),
        }));
      cache.setSubkey("PHOTO_QUERY_CACHE", cacheKey, { fetchedAt: new Date().toISOString(), result: candidates });
      return candidates;
    } catch (err) {
      logger.warn({ err, query }, "wikimedia search failed, treating as no results");
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Tier 3: PexelsProvider — optional, real photos, but never authoritative
// for a specific named model (Pexels has near-zero coverage of exact car
// trims) — only used for CONTEXTUAL/DOCUMENTARY topics, and only when
// PEXELS_API_KEY is configured. No key configured = empty results, not an
// error; the pipeline does not depend on this provider to function.
// ---------------------------------------------------------------------------
const PexelsProvider: PhotoProvider = {
  name: "PexelsProvider",
  async search({ namedVehicle, topic, allowPexelsForNamedVehicle }) {
    if (namedVehicle && !allowPexelsForNamedVehicle) return []; // default: never claims to show a specific model
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) return [];
    const searchQuery = namedVehicle ?? topic;
    const category = namedVehicle ? ("EXACT_VEHICLE" as const) : ("CONTEXTUAL" as const);
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=8`, {
        headers: { Authorization: apiKey },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { photos?: Array<{ src: { large2x: string }; url: string }> };
      return (data.photos ?? []).map((p) => ({
        imageUrl: p.src.large2x,
        provider: "PexelsProvider",
        category,
        // Lower confidence for the EXACT_VEHICLE exception — Pexels isn't
        // an authoritative source for a specific trim, so it goes last in
        // the sort, and still has to pass real Vision verification.
        confidence: namedVehicle ? 0.2 : 0.5,
        license: "pexels-license",
        sourcePage: p.url,
        sourceType: "stock-license" as const,
        licenseStatus: "Pexels License — uso comercial e não comercial livre, sem atribuição obrigatória",
        attributionRequired: false,
        commercialUseAllowed: true,
      }));
    } catch (err) {
      logger.warn({ err, topic }, "pexels search failed, treating as no results");
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Tier 4: ConceptualFallbackProvider — broadens the Wikimedia query for
// purely generic/conceptual topics. Never returns EXACT_VEHICLE. AI image
// generation is deliberately NOT wired in here — see sourcePhoto()'s final
// ABANDON path below; generating a fake vehicle was the exact failure mode
// this whole gate system exists to prevent.
// ---------------------------------------------------------------------------
const ConceptualFallbackProvider: PhotoProvider = {
  name: "ConceptualFallbackProvider",
  async search({ topic }) {
    try {
      const results = await wikimediaSearch(`${topic} car automotive`, 6);
      return results
        .filter((r) => r.width >= MIN_USABLE_DIMENSION && r.height >= MIN_USABLE_DIMENSION)
        .map((r) => ({
          imageUrl: r.url,
          provider: "ConceptualFallbackProvider",
          category: "CONTEXTUAL" as const,
          confidence: 0.3,
          license: r.licenseShortName,
          sourcePage: r.descriptionUrl,
          sourceType: "editorial-cc" as const,
          licenseStatus: r.licenseShortName,
          attributionRequired: r.attributionRequired,
          attributionText: r.attributionRequired ? `${r.artist || "Wikimedia Commons"} (${r.licenseShortName})` : undefined,
          commercialUseAllowed: !/nc\b|noncommercial/i.test(r.licenseShortName),
        }));
    } catch {
      return [];
    }
  },
};

const PROVIDER_CHAIN: PhotoProvider[] = [OfficialPressProvider, EditorialPhotoProvider, PexelsProvider, ConceptualFallbackProvider];

export interface SourcingResult {
  status: "FOUND" | "ABANDON";
  candidate?: PhotoCandidate;
  triedProviders: string[];
  reason?: string;
  verification?: PhotoVerification;
}

/**
 * Multi-source automotive photo sourcing (rule: Pexels is one tool among
 * several, never the system). Tries providers in priority order; for a
 * named vehicle, ONLY EXACT_VEHICLE candidates are accepted — if none of the
 * providers produce one, the function returns ABANDON rather than silently
 * downgrading to a contextual/generic photo. The caller (run.ts) must
 * respond to ABANDON by discarding this pauta and moving to the next
 * candidate — never by rewriting the copy to fit whatever photo exists.
 */
export async function fetchAsBase64(imageUrl: string): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" } | null> {
  try {
    const res = await fetch(imageUrl, { headers: { "User-Agent": "MaisCarRadar/1.0" } });
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    // Wikimedia originals can be 20-50MB — Anthropic's vision API caps
    // base64 payloads at 10MB, and a full-resolution photo buys nothing for
    // a quality/authenticity check anyway. Downscale before encoding
    // (caught by a real 400 during the first dry run, 2026-09-03).
    const resized = await sharp(raw).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return { base64: resized.toString("base64"), mediaType: "image/jpeg" };
  } catch {
    return null;
  }
}

interface VehicleAsset {
  imageUrl: string;
  provider: string;
  category: PhotoCategory;
  license: string;
  sourcePage: string;
  sourceType?: PhotoCandidate["sourceType"];
  licenseStatus?: string;
  attributionRequired?: boolean;
  attributionText?: string;
  commercialUseAllowed?: boolean;
  visionVerified: true;
  modelMatch: string;
  qualityScore: number;
  approvedAt: string;
  lastUsed: string;
}

const ASSET_TTL_MS = 90 * 24 * 60 * 60 * 1000; // vision-approved assets are reusable for months, not re-checked every cycle

/** VEHICLE_ASSET_LIBRARY — a photo already vision-verified for this exact model doesn't go through Claude again (rule 14: CHEAP FIRST, CLAUDE LAST, applied at its strongest — zero cost on repeat). */
function getCachedAsset(namedVehicle: string): VehicleAsset | null {
  const asset = cache.getSubkey<VehicleAsset>("VEHICLE_ASSET_CACHE", namedVehicle.toLowerCase());
  if (!asset || !cache.isFresh(asset.approvedAt, ASSET_TTL_MS)) return null;
  return asset;
}

export function saveAsset(namedVehicle: string, candidate: PhotoCandidate, verification: PhotoVerification) {
  const asset: VehicleAsset = {
    imageUrl: candidate.imageUrl,
    provider: candidate.provider,
    category: candidate.category,
    license: candidate.license,
    sourcePage: candidate.sourcePage,
    sourceType: candidate.sourceType,
    licenseStatus: candidate.licenseStatus,
    attributionRequired: candidate.attributionRequired,
    attributionText: candidate.attributionText,
    commercialUseAllowed: candidate.commercialUseAllowed,
    visionVerified: true,
    modelMatch: namedVehicle,
    qualityScore: Math.round((verification.editorialQuality + verification.authenticity) / 2),
    approvedAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
  };
  cache.setSubkey("VEHICLE_ASSET_CACHE", namedVehicle.toLowerCase(), asset);
}

/**
 * Multi-source automotive photo sourcing (rule: Pexels is one tool among
 * several, never the system). CHEAP FIRST, CLAUDE LAST (rule 12): checks
 * the vision-verified asset library before any search; when it does search,
 * dimension filtering already happened provider-side (no API cost), and at
 * most MAX_VISION_CALLS candidates total (not per-provider) ever reach the
 * real vision-model call. For a named vehicle, ONLY a candidate the vision
 * check confirms as that exact model is accepted; if none clears the bar,
 * the function returns ABANDON rather than silently downgrading to a
 * contextual/generic photo. The caller (run.ts) must respond to ABANDON by
 * discarding this pauta and moving to the next candidate — never by
 * rewriting the copy to fit whatever photo exists.
 */
export async function sourcePhoto(
  query: PhotoQuery,
  organizationId: string,
  opts: { skipProviders?: string[]; maxVisionCalls?: number } = {},
): Promise<SourcingResult> {
  // Cache key: namedVehicle when present, otherwise the topic itself — a
  // contextual/documentary search (e.g. "oficina mecânica" for a
  // MAINTENANCE slide) is just as reusable as a named-vehicle photo once
  // verified once (2026-09-09: comparison carousels source a contextual
  // photo per slide, so this reuse matters for LOW TOKEN MODE — without
  // it, every "oficina"/"posto de combustível" slide would re-run Vision).
  const cacheKey = query.namedVehicle ?? query.topic;
  {
    const cached = getCachedAsset(cacheKey);
    if (cached) {
      cache.setSubkey("VEHICLE_ASSET_CACHE", cacheKey.toLowerCase(), { ...cached, lastUsed: new Date().toISOString() });
      logger.debug({ cacheKey }, "VEHICLE_ASSET_CACHE hit — skipping search and vision entirely");
      return {
        status: "FOUND",
        candidate: { ...cached, confidence: 1 },
        triedProviders: ["VEHICLE_ASSET_CACHE"],
      };
    }
  }

  const tried: string[] = [];
  // rule 12: total across the whole search, not per provider. Default 2 —
  // opts.maxVisionCalls is an explicit, narrow exception (2026-09-10) for
  // one-off sourcing of a specific hard-to-find asset; NOT a general dial,
  // never raised as a first resort (see the source-quality fixes above,
  // which are what actually reduce how many calls get wasted on bad candidates).
  const MAX_VISION_CALLS = opts.maxVisionCalls ?? 2;
  let visionCallsUsed = 0;

  for (const provider of PROVIDER_CHAIN) {
    if (opts.skipProviders?.includes(provider.name)) continue;
    if (visionCallsUsed >= MAX_VISION_CALLS) break;
    tried.push(provider.name);
    const candidates = await provider.search(query);
    const pool = query.namedVehicle ? candidates.filter((c) => c.category === "EXACT_VEHICLE") : candidates;
    const toCheck = pool.sort((a, b) => b.confidence - a.confidence).slice(0, MAX_VISION_CALLS - visionCallsUsed);

    for (const candidate of toCheck) {
      const fetched = await fetchAsBase64(candidate.imageUrl);
      if (!fetched) continue; // dead link — try the next candidate, doesn't cost a vision call
      visionCallsUsed++;
      const verification = await verifyPhoto(fetched.base64, fetched.mediaType, query, organizationId);
      if (passesPhotoGate(verification, query.namedVehicle, { requireNoForeignCurrency: query.requireNoForeignCurrency })) {
        const finalCandidate = { ...candidate, confidence: 1 };
        saveAsset(cacheKey, finalCandidate, verification);
        return { status: "FOUND", candidate: finalCandidate, triedProviders: tried, verification };
      }
      logger.debug({ provider: provider.name, imageUrl: candidate.imageUrl, verification }, "candidate rejected by photo gate");
      if (visionCallsUsed >= MAX_VISION_CALLS) break;
    }
  }
  return {
    status: "ABANDON",
    triedProviders: tried,
    reason: query.namedVehicle
      ? `Nenhum provider encontrou foto EXACT_VEHICLE de "${query.namedVehicle}" que passasse na verificação visual — pauta abandonada, não rebaixada para foto genérica.`
      : `Nenhum provider encontrou foto contextual aprovada pra "${query.topic}".`,
  };
}

// Wikimedia rate-limits full-resolution originals far harder than thumbnails
// (429 "please... use thumbnail images" — confirmed directly from their own
// error message, 2026-09-10). The canonical thumb URL/host (thumb.wikimedia.org,
// not upload.wikimedia.org/.../thumb/) and exact allowed width can only be
// obtained from Wikimedia's own imageinfo API — guessing a width returns 400.
async function resolveWikimediaThumbUrl(imageUrl: string, width = 1280): Promise<string | null> {
  // Candidate URLs carry a "?utm_source=..." query string (from the
  // Wikimedia API's own imageinfo response) — strip it before extracting
  // the filename, or the File: lookup below silently 404s and this falls
  // back to the (rate-limited) original URL, defeating the whole point of
  // this function (caught 2026-09-10: a 429 on a filename that still had
  // "?utm_source=..." stuck to the end of it).
  const pathOnly = imageUrl.split("?")[0];
  const filename = decodeURIComponent(pathOnly.split("/").pop() ?? "");
  if (!filename) return null;
  const api = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent("File:" + filename)}&prop=imageinfo&iiprop=url&iiurlwidth=${width}&format=json`;
  const res = await fetch(api, { headers: { "User-Agent": "MaisCarRadar/1.0" } });
  if (!res.ok) return null;
  const data = (await res.json()) as { query?: { pages?: Record<string, { imageinfo?: { thumburl?: string }[] }> } };
  const pages = data.query?.pages ?? {};
  const page = Object.values(pages)[0];
  return page?.imageinfo?.[0]?.thumburl ?? null;
}

export async function downloadPhoto(candidate: PhotoCandidate, destPath: string): Promise<string> {
  let fetchUrl = candidate.imageUrl;
  if (fetchUrl.includes("upload.wikimedia.org")) {
    fetchUrl = (await resolveWikimediaThumbUrl(fetchUrl)) ?? fetchUrl;
  }
  const res = await fetch(fetchUrl, { headers: { "User-Agent": "MaisCarRadar/1.0" } });
  if (!res.ok) throw new Error(`PHOTO_DOWNLOAD_FAILED: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return destPath;
}
