import fs from "node:fs";
import path from "node:path";

const LOG_FILE = path.join(__dirname, "..", "..", "..", ".cache", "pipeline-log.jsonl");

export interface CycleLog {
  timestamp: string;
  selectedTopic: string | null;
  topicScore: number | null;
  photoSource: string | null;
  photoScore: { authenticity: number; editorialQuality: number } | null;
  gates: Record<string, "PASS" | "FAIL" | "SKIPPED">;
  tokenMode: "SCRIPT" | "API_LLM" | "ABANDONED_NO_TOKENS";
  publishStatus: "DRY_RUN" | "PUBLISHED" | "ABANDONED" | "ERROR";
  reason?: string;
  // Hardening-pass fields (2026-09-03) — kept optional so older log lines
  // remain valid CycleLog values.
  tier?: "A" | "B" | "C";
  brazilRelevant?: boolean;
  whoCaresPass?: boolean;
  consequencePass?: boolean;
  factStatus?: "CONFIRMED" | "PARTIALLY_CONFIRMED" | "UNCONFIRMED";
  defectClaimTier?: string;
  publishable?: boolean;
}

export function logCycle(entry: CycleLog) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}

export function readRecentCycles(limit = 20): CycleLog[] {
  try {
    const lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
