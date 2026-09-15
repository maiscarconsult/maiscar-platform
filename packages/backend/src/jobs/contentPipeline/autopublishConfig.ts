/**
 * AUTO_PUBLISH kill switch (2026-09-10). Deliberately NOT something Claude
 * sets — this file only reads a local flag that the user toggles themselves
 * via enable-autopublish.ps1 / disable-autopublish.ps1 (repo root scripts/).
 * Publishing to a real public account, unattended, is a standing decision
 * only the account owner can make — this is the mechanical enforcement of
 * that boundary: the scheduler always runs the full pipeline up to
 * PREPARED_AWAITING_PUBLISH, and only calls the Graph API publish step when
 * this flag file says the user turned it on.
 */
import fs from "node:fs";
import path from "node:path";

const FLAG_PATH = path.join(__dirname, "..", "..", "..", ".cache", "autopublish.flag.json");

export interface AutopublishFlag {
  enabled: boolean;
  enabledAt?: string;
  enabledBy?: string;
}

export function isAutopublishEnabled(): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(FLAG_PATH, "utf8")) as AutopublishFlag;
    return data.enabled === true;
  } catch {
    return false; // missing/corrupt file = disabled, fail closed
  }
}

export function readAutopublishFlag(): AutopublishFlag {
  try {
    return JSON.parse(fs.readFileSync(FLAG_PATH, "utf8"));
  } catch {
    return { enabled: false };
  }
}
