/**
 * LOCAL_LICENSED_AUDIO_LIBRARY (2026-09-10) — the only audio source
 * FULL_AUTONOMOUS_REEL is allowed to mux into a video for API publishing.
 * Pixabay was evaluated and ruled out: its public API only covers Search
 * Images and Search Videos, no Music/Audio endpoint exists (confirmed
 * directly against https://pixabay.com/api/docs/, 2026-09-10) — there is
 * nothing to integrate there. This reads a local, human-curated manifest
 * instead. Selection is pure code (no LLM): filter by mood/energy, then pick
 * the least-used match to avoid repeating the same track across posts.
 */
import fs from "node:fs";
import path from "node:path";

const LIBRARY_DIR = path.join(__dirname, "..", "..", "..", "audio-library");
const MANIFEST_PATH = path.join(LIBRARY_DIR, "manifest.json");

export interface AudioTrack {
  id: string;
  file: string; // relative to audio-library/
  track: string;
  license: string;
  sourceUrl: string;
  /** Whether the track is registered in a rights-management/Content ID system. Prefer false. */
  contentId: boolean;
  mood: string;
  energy: string;
  usedCount: number;
}

function readManifest(): AudioTrack[] {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeManifest(tracks: AudioTrack[]) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(tracks, null, 2));
}

export function listTracks(): AudioTrack[] {
  return readManifest();
}

export interface SelectTrackOptions {
  mood?: string;
  energy?: string;
  /** Default true — excludes Content-ID-registered tracks unless explicitly allowed. */
  requireContentIdFalse?: boolean;
}

/**
 * Picks the least-used track matching the given criteria (no LLM — pure
 * filter + sort). Returns null, honestly, if the library has no match yet —
 * never fabricates a result.
 */
export function selectTrack(opts: SelectTrackOptions = {}): AudioTrack | null {
  const requireContentIdFalse = opts.requireContentIdFalse ?? true;
  const candidates = readManifest().filter((t) => {
    if (requireContentIdFalse && t.contentId) return false;
    if (opts.mood && t.mood !== opts.mood) return false;
    if (opts.energy && t.energy !== opts.energy) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.usedCount - b.usedCount);
  return candidates[0];
}

export function resolveTrackPath(track: AudioTrack): string {
  return path.join(LIBRARY_DIR, track.file);
}

export function recordUsage(trackId: string): void {
  const tracks = readManifest();
  const track = tracks.find((t) => t.id === trackId);
  if (!track) return;
  track.usedCount += 1;
  writeManifest(tracks);
}
