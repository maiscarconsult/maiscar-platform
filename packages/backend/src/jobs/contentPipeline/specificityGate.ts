/**
 * SPECIFICITY_GATE (2026-09-09) — deterministic, zero-cost, runs BEFORE any
 * Haiku call. Blocks generic pautas like "sintomas de câmbio automático com
 * defeito" that name no concrete referent at all. A title passes if it
 * contains at least one of: a real brand/model name, "recall", a hard data
 * point (any digit — km/%/R$/ano), or a named formal process (petição,
 * processo, boletim técnico, lei, multa, FIPE, PROCON, INMETRO). This is
 * deliberately NOT the same job as editorial scoring — a specific-but-weak
 * headline (e.g. a plain year mention) still passes here and gets filtered
 * by score/WHO_CARES/CONSEQUENCE downstream; this gate only catches "no
 * concrete anchor whatsoever".
 */
const ANCHOR_BRAND_MODEL = [
  "fiat", "chevrolet", "gm", "volkswagen", "vw", "hyundai", "toyota", "jeep",
  "renault", "nissan", "honda", "ford", "peugeot", "citroën", "citroen",
  "bmw", "audi", "mercedes", "stellantis", "volvo", "byd", "caoa", "omoda",
  "jaecoo", "ram", "mitsubishi",
  "onix", "hb20", "t-cross", "compass", "argo", "mobi", "uno", "kwid", "polo",
  "virtus", "tracker", "creta", "nivus", "tera", "pulse", "renegade", "tucson",
  "spin", "cronos", "versa", "kicks", "duster", "sandero", "logan", "corolla",
  "hilux", "kaicene",
];
const ANCHOR_FORMAL = [
  "recall", "petição", "processo", "boletim técnico", "lei ", "multa",
  "legislação", "fipe", "procon", "inmetro",
];

export function passesSpecificityGate(title: string): { pass: boolean; reason?: string } {
  const lower = title.toLowerCase();
  const hasDigitAnchor = /\d/.test(title);
  const hasNamedAnchor = ANCHOR_BRAND_MODEL.some((t) => lower.includes(t)) || ANCHOR_FORMAL.some((t) => lower.includes(t));
  if (hasDigitAnchor || hasNamedAnchor) return { pass: true };
  return { pass: false, reason: "sem âncora concreta (modelo/marca, recall, dado numérico, ou processo formal) — pauta genérica" };
}
