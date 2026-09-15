import fs from "node:fs";
import path from "node:path";

/**
 * Delta-first cache (rule 13/14 of the Performance Engine directive): a flat
 * JSON file, not a DB table — this is process-local, cheap, inspectable
 * state for "did we already do this in the last N hours", not a system of
 * record. Real content/performance data still lives in Postgres via Prisma.
 */
const CACHE_DIR = path.join(__dirname, "..", "..", "..", ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "pipeline-cache.json");

interface CacheShape {
  LAST_NEWS_SCAN?: string; // ISO timestamp
  LAST_COMPETITOR_CHECK?: string;
  NEWS_CANDIDATES?: { fetchedAt: string; items: unknown[] };
  NEWS_CANDIDATES_EXPANDED?: { fetchedAt: string; items: unknown[] };
  EVERGREEN_CANDIDATES?: { fetchedAt: string; items: unknown[] };
  COMPARISON_DEBATE_CANDIDATES?: { fetchedAt: string; items: unknown[] };
  PHOTO_QUERY_CACHE?: Record<string, { fetchedAt: string; result: unknown }>;
  VEHICLE_ASSET_CACHE?: Record<string, { approvedAt: string; photoPath: string; source: string }>;
  MANUFACTURER_MEDIA_CACHE?: Record<string, { fetchedAt: string; imageUrls: string[] }>;
  PERFORMANCE_CACHE?: Record<string, unknown>;
  VERIFIED_FACT_CACHE?: Record<string, { verified: boolean; checkedAt: string }>;
}

function readCache(): CacheShape {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeCache(data: CacheShape) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

export const cache = {
  get<K extends keyof CacheShape>(key: K): CacheShape[K] | undefined {
    return readCache()[key];
  },
  set<K extends keyof CacheShape>(key: K, value: CacheShape[K]) {
    const data = readCache();
    data[key] = value;
    writeCache(data);
  },
  /** True if the given cache key's fetchedAt/timestamp is younger than maxAgeMs. */
  isFresh(timestampIso: string | undefined, maxAgeMs: number): boolean {
    if (!timestampIso) return false;
    return Date.now() - new Date(timestampIso).getTime() < maxAgeMs;
  },
  getSubkey<T = unknown>(key: keyof CacheShape, subkey: string): T | undefined {
    const bucket = readCache()[key] as Record<string, T> | undefined;
    return bucket?.[subkey];
  },
  setSubkey(key: keyof CacheShape, subkey: string, value: unknown) {
    const data = readCache();
    const bucket = (data[key] as Record<string, unknown> | undefined) ?? {};
    bucket[subkey] = value;
    (data as any)[key] = bucket;
    writeCache(data);
  },
};
