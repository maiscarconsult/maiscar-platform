/**
 * SCREEN_EVIDENCE composition (P0-2, 2026-09-15). Turns a beat's claim +
 * tier into the deterministic props for <ScreenEvidence />
 * (remotion/ScreenEvidence.tsx). Never composes a real screenshot of a
 * real service — every value is either an obvious fake, a number the
 * caller supplied, or the beat's own narration fragment.
 *
 * The point is register variety on screen — the viewer sees a phone-frame
 * with a plausible page — not a functional simulator.
 */
import type { ScreenEvidenceProps, ScreenEvidenceTemplate } from "../../../remotion/types";

export interface ComposeInput {
  template: ScreenEvidenceTemplate;
  /** Free-form values the beat wants to show on the fake screen. Never a
   *  real URL, never a real phone number, never a real CPF/CNPJ. */
  values: Record<string, string>;
  highlight?: string[];
}

const DEFAULTS: Record<ScreenEvidenceTemplate, Record<string, string>> = {
  FINANCING_QUOTE: {
    car: "Carro dos sonhos",
    parcela: "1.847",
    n: "60",
    cet: "31,4%",
    total: "110.820",
    entrada: "20.000",
  },
  LISTING_PAGE: {
    car: "Sedan 2020",
    km: "48.900 km",
    price: "R$ 89.900",
    location: "SP - São Paulo",
    seller: "vendedor particular",
  },
  WHATSAPP_THREAD: {
    seller: "Vendedor",
    line1: "manda o pix que eu tiro do site",
    line2: "sem test-drive, tá reservado",
    line3: "só faz vistoria depois de fechar",
  },
  PIX_RECEIPT: {
    amount: "89.900,00",
    to: "auto center do zé",
    date: new Date().toLocaleDateString("pt-BR"),
    status: "concluído",
  },
  INVOICE: {
    service: "revisão + correia dentada",
    total: "R$ 4.180",
    parts: "R$ 2.640",
    labor: "R$ 1.540",
    date: new Date().toLocaleDateString("pt-BR"),
  },
};

export function composeScreenEvidence(input: ComposeInput): ScreenEvidenceProps {
  const merged = { ...DEFAULTS[input.template], ...(input.values ?? {}) };
  return {
    template: input.template,
    values: merged,
    highlight: input.highlight,
  };
}

/**
 * Convenience picker: given a beat's tier + a keyword, pick the most
 * appropriate template. The cycle can call this when a beat is emitted
 * with visualRegister: "SCREEN_EVIDENCE" but no explicit template.
 */
export function pickTemplateFromBeat(kw: string, tier?: string): ScreenEvidenceTemplate {
  const k = kw.toLowerCase();
  if (/parcela|financia|cet|entrada|juros/.test(k)) return "FINANCING_QUOTE";
  if (/anuncio|anúncio|olx|webmotors|listagem/.test(k)) return "LISTING_PAGE";
  if (/pix|transfer/.test(k)) return "PIX_RECEIPT";
  if (/whats|zap|mensagem|vendedor/.test(k)) return "WHATSAPP_THREAD";
  if (/nota|invoice|servi|manuten|oficina/.test(k)) return "INVOICE";
  return tier === "OWNER_REPORT" ? "WHATSAPP_THREAD" : "LISTING_PAGE";
}
