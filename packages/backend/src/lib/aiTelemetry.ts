import fs from "node:fs";
import path from "node:path";

const LOG_FILE = path.join(__dirname, "..", "..", ".cache", "ai-telemetry.jsonl");

export interface AiCallTelemetry {
  timestamp: string;
  purpose: string;
  provider: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  thinkingTokens?: number;
  latencyMs: number;
  status: "completed" | "failed";
}

/** Per-call AI cost telemetry — model/tokens/latency/purpose only, NEVER prompt content (rule: audit asked for real per-call telemetry without logging full prompts). */
export function logAiCall(entry: AiCallTelemetry) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}

export function readRecentAiCalls(limit = 50): AiCallTelemetry[] {
  try {
    const lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
