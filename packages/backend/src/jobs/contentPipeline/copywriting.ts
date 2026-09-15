import { aiOrchestrator } from "../../modules/ai-orchestrator/orchestrator";
import { logger } from "../../lib/logger";
import { DefectClaimTier } from "./gates";

export interface SlideCopy {
  kicker: string;
  headline: string[]; // 1-2 short lines
  complement?: string;
  microCaption?: string;
  captionLong: string; // full Instagram caption — facts, sources, CTA
}

const BRAND_VOICE = `Marca: Mais.Car. Postura: investigador cético — nunca vendedor, nunca alarmista sem fato. Tom: direto, tecnicamente preciso, cirurgicamente calmo. A manchete pode ser provocativa mas NUNCA mais conclusiva que a evidência: distinga relato/petição de defeito crônico comprovado; recall e reconhecimento oficial da fabricante são os únicos níveis que sustentam uma alegação categórica de defeito.`;

const FORMAT_RULES = `Regras de formato OBRIGATÓRIAS (o render não aceita texto fora disso):
- "kicker": 1-2 palavras, editoria (ex: MERCADO, ALERTA, PREÇO, PESQUISA).
- "headline": array de 1 a 2 linhas, cada linha com NO MÁXIMO 26 caracteres, MAIÚSCULO não necessário (o render capitaliza), linguagem de capa/manchete, nunca frase de parágrafo.
- "complement" (opcional): NO MÁXIMO 26 caracteres, uma frase curta que complementa a manchete.
- "microCaption" (opcional, alternativa ao complement pra uma pergunta/CTA curta): NO MÁXIMO 30 caracteres.
- Use complement OU microCaption, não os dois.
- "captionLong": a legenda completa do Instagram — fatos, fonte, e uma pergunta de CTA no fim. Aqui pode ser longo e detalhado.`;

// DEFECT_CLAIM_TIER ceiling (rule 11 of the hardening pass) — the copy must
// never assert a stronger category of defect than what gates.ts's
// classifyDefectClaim() actually found in the source text. "75 relatos" is
// MULTIPLE_REPORTS, not CHRONIC_DEFECT_CONFIRMED, and the copy can't blur
// that line even for a punchier headline.
const DEFECT_TIER_INSTRUCTIONS: Record<DefectClaimTier, string> = {
  OWNER_REPORT: "A matéria só documenta relato(s) pontual(is) de proprietário. NÃO generalize como defeito do modelo — use linguagem de caso isolado/relato, nunca \"defeito crônico\" ou \"todos os X têm esse problema\".",
  MULTIPLE_REPORTS: "A matéria documenta múltiplos relatos, mas NÃO é recall nem reconhecimento oficial da fabricante. Pode dizer \"vários donos relatam\", mas NÃO \"defeito crônico comprovado\" nem \"a fabricante reconhece\".",
  PUBLIC_PETITION: "Existe uma petição pública documentada — pode citar isso como fato (\"motoristas abriram petição\"), mas isso não é reconhecimento oficial da fabricante nem recall.",
  OFFICIAL_RECALL: "Há recall oficial — pode afirmar categoricamente que existe um defeito reconhecido, citando o recall.",
  MANUFACTURER_ACKNOWLEDGED: "A fabricante reconheceu o problema em declaração — pode afirmar isso como fato, citando a fonte.",
  TECHNICAL_BULLETIN: "Existe boletim técnico da fabricante — pode afirmar que a fabricante orienta oficinas sobre o problema, mas isso não é o mesmo peso de um recall público.",
  CHRONIC_DEFECT_CONFIRMED: "A matéria comprova um defeito crônico já estabelecido — pode usar essa linguagem categórica.",
  NOT_A_DEFECT_STORY: "Este post não é sobre um defeito — ignore esta instrução.",
};

// ROUTE 3 (CONTROVERSY/ENGAGEMENT) voice — tuned 2026-09-09 for real
// polarization, not lukewarm content. Goal: make the reader take a side
// ("eu discordo", "eu compraria o outro", "por esse preço eu iria de
// usado"). Still same brand discipline as news copy — never invent a
// defect/cost/recall/reputation/data point; when the claim is opinion or
// popular perception (not a documented fact), the caption must say so
// explicitly (OPINIÃO/DEBATE/ANÁLISE), never dressed up as fact.
const ENGAGEMENT_BRAND_VOICE = `Marca: Mais.Car. Formato ROUTE 3: comparação/pergunta/opinião pra gerar debate real — NÃO é notícia, é convite a tomar partido. Busque CONFLITO com dois lados defensáveis (elétrico x combustão, zero x usado premium, tecnologia x confiabilidade, preço baixo x manutenção, status x custo, reputação popular x dados reais) envolvendo dinheiro/decisão de compra — nunca um tema de resposta óbvia. Headline curta, direta, do tipo "QUAL VOCÊ LEVARIA?", "BOMBA OU INJUSTIÇADO?", "VALE TUDO ISSO?", "ZERO OU USADO PREMIUM?", "VOCÊ TERIA CORAGEM?" — crie a headline específica pro assunto, não copie esses exemplos literalmente. Pode ser duro ("SUPERVALORIZADO?", "COMPRA RUIM?", "BOMBA?") mas precisa sustentar a discussão. Acusação popular sobre marca/modelo vira PERGUNTA investigativa (reputação vs. dados), nunca afirmação de fato sem prova. Termina SEMPRE com um CTA que obriga escolha (ex: "qual você levaria com R$150 mil?", "você compraria mesmo sabendo disso?", "essa má fama é justa?") — nunca só "comente aí". Proibido: inventar defeito, custo, recall, dado, reputação ou experiência de dono; ataque baseado em nacionalidade da marca.`;

export async function writeCopy(
  article: { title: string; text: string; url: string },
  namedVehicle: string | null,
  organizationId: string,
  defectTier?: DefectClaimTier,
  engagementMode = false,
): Promise<SlideCopy> {
  const prompt = `${engagementMode ? ENGAGEMENT_BRAND_VOICE : BRAND_VOICE}

Matéria/tópico fonte (título: "${article.title}", ${article.url}):
${article.text.slice(0, 3000)}

${namedVehicle ? `O post é especificamente sobre: ${namedVehicle}. A manchete pode nomear esse modelo — teremos uma foto real dele.` : "O post é sobre um assunto genérico de mercado — NÃO nomeie um modelo específico na manchete, já que a foto não será de um carro específico."}

${engagementMode ? "microCaption = a pergunta/CTA de escolha forçada (ver regra de CTA acima). captionLong: monte os dois lados do conflito (2-3 frases cada) e rotule explicitamente OPINIÃO/DEBATE/ANÁLISE quando não for fato documentado — nunca apresente percepção popular como fato apurado." : ""}

${defectTier && defectTier !== "NOT_A_DEFECT_STORY" ? `LIMITE DE ALEGAÇÃO (obrigatório, classificado pelo gate de fatos como ${defectTier}): ${DEFECT_TIER_INSTRUCTIONS[defectTier]}` : ""}

${FORMAT_RULES}

Responda SOMENTE com um objeto JSON: {"kicker":"...","headline":["...","..."],"complement":"..."|null,"microCaption":"..."|null,"captionLong":"..."}`;

  // See editorialScoring.ts — maxTokens must cover extended-thinking tokens,
  // not just the final answer, or claude-sonnet-5 can burn the whole budget
  // "thinking" and return empty text. temperature omitted: unsupported by
  // this model (confirmed via direct API error) and not forwarded by
  // AnthropicProvider anyway.
  const { text } = await aiOrchestrator.generateText(
    { prompt, maxTokens: 4000 },
    { organizationId, quality: "final", purpose: "copywriting" },
  );
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("COPYWRITING_PARSE_FAILED");
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    kicker: String(parsed.kicker ?? "Mercado"),
    headline: Array.isArray(parsed.headline) ? parsed.headline.map(String) : [String(parsed.headline ?? "")],
    complement: parsed.complement ? String(parsed.complement) : undefined,
    microCaption: parsed.microCaption ? String(parsed.microCaption) : undefined,
    captionLong: String(parsed.captionLong ?? ""),
  };
}

/** One retry with an explicit "too long" correction — never more than one, per the fallback budget (rule 36: max 3 intelligent attempts, then change approach — here: 2 total attempts, then ABANDON this pauta). */
export async function writeCopyWithRetry(
  article: { title: string; text: string; url: string },
  namedVehicle: string | null,
  organizationId: string,
  validate: (copy: SlideCopy) => string | null, // returns an error message, or null if OK
  defectTier?: DefectClaimTier,
  engagementMode = false,
): Promise<SlideCopy | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const copy = await writeCopy(article, namedVehicle, organizationId, defectTier, engagementMode);
    const error = validate(copy);
    if (!error) return copy;
    logger.warn({ attempt, error, copy }, "copy failed fit validation, retrying once");
  }
  return null;
}
