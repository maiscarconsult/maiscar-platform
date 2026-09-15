import sharp from "sharp";

/**
 * NO_DUPLICATE_PHOTO_GATE (2026-09-10) — zero-cost perceptual hash (8x8
 * grayscale average hash) so two DIFFERENT source URLs that are the same
 * (or near-identical, e.g. a recrop/rescale of the same shot) photo still
 * get caught, not just exact URL matches. Hamming distance <= threshold
 * counts as a duplicate.
 */
const HASH_SIZE = 8;
const DUPLICATE_THRESHOLD = 6; // out of 64 bits — small differences (recompression) tolerated, same photo still caught

export async function perceptualHash(imagePathOrBuffer: string | Buffer): Promise<string> {
  const { data } = await sharp(imagePathOrBuffer)
    .resize(HASH_SIZE, HASH_SIZE, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
  let bits = "";
  for (const v of data) bits += v >= avg ? "1" : "0";
  return bits;
}

function hammingDistance(a: string, b: string): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++;
  return dist;
}

export interface DuplicateCheckResult {
  pass: boolean;
  duplicatePairs: Array<{ a: string; b: string; distance: number }>;
}

/** Checks a set of {name, hash} entries pairwise — used across an entire carousel's slide photos before render. */
export function checkNoDuplicates(entries: Array<{ name: string; hash: string }>): DuplicateCheckResult {
  const duplicatePairs: Array<{ a: string; b: string; distance: number }> = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const distance = hammingDistance(entries[i].hash, entries[j].hash);
      if (distance <= DUPLICATE_THRESHOLD) {
        duplicatePairs.push({ a: entries[i].name, b: entries[j].name, distance });
      }
    }
  }
  return { pass: duplicatePairs.length === 0, duplicatePairs };
}
