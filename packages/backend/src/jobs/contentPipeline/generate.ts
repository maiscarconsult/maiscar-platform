import { aiOrchestrator } from "../../modules/ai-orchestrator/orchestrator";
import { logger } from "../../lib/logger";
import { Theme } from "./themePool";

export interface SlideDraft {
  title: string;
  text: string;
  visual: string;
}

export interface CarouselDraft {
  format: "CAROUSEL" | "POST";
  hook: string;
  slides: SlideDraft[];
  caption: string;
  hashtags: string[];
  cta: string;
  musicSuggestion: string;
}

const SYSTEM_PROMPT = `Você é o redator-chefe do Instagram da @mais.car, uma consultoria automotiva premium
(avaliação técnica de carros usados antes da compra). Tom de voz: direto, confiável, especialista,
sem ser arrogante. Público: pessoas prestes a comprar um carro usado, com medo de serem enganadas.

REGRA INEGOCIÁVEL SOBRE FATOS: você NUNCA afirma como fato absoluto uma informação técnica específica
sobre uma marca/modelo de carro nomeado (defeito crônico específico, recall, potência exata, consumo
exato, nota de segurança). Este pipeline roda de forma autônoma e não tem como verificar esse tipo de
afirmação numa fonte oficial antes de publicar. Fale sempre em termos gerais de PROCESSO e CRITÉRIO
("o que verificar", "sinais de alerta", "como avaliar") em vez de veredito técnico sobre um carro
específico. Se um tema tocar nesse tipo de assunto, aborde do ângulo "como o comprador pode verificar
isso sozinho", nunca "o carro X tem o problema Y".

Responda SOMENTE com um JSON válido, sem markdown, sem texto fora do JSON, no formato:
{
  "format": "CAROUSEL" ou "POST",
  "hook": "gancho forte de 1 linha para a capa",
  "slides": [ { "title": "...", "text": "texto curto do slide, max 140 caracteres", "visual": "descrição da arte/foto para gerar" }, ... ],
  "caption": "legenda completa pronta para postar, gancho + desenvolvimento + CTA, português natural, sem hashtags dentro",
  "hashtags": ["hashtag1", "hashtag2", ...],
  "cta": "chamada para ação curta",
  "musicSuggestion": "estilo/clima de áudio sugerido, 1 frase"
}
Para CAROUSEL: entre 6 e 10 slides. Slide 1 é sempre a capa (gancho forte). Último slide é sempre o CTA.
Para POST: array "slides" com exatamente 1 item.

REGRAS PARA "title" DE CADA SLIDE (usado como selo/kicker visual no design, não como legenda):
curto (2-6 palavras), MAIÚSCULO por convenção visual mas escreva normal, idealmente no formato
"ETAPA N · PALAVRA-CHAVE" para slides de processo (ex: "ETAPA 2 · CARROCERIA"), ou uma palavra de
categoria para capa/CTA (ex: "BASTIDOR DA AVALIAÇÃO", "MAIS.CAR"). Nunca repita o texto do slide.

REGRAS PARA "visual" DE CADA SLIDE (usado para gerar a foto de fundo via IA — sem controle de marca real):
descreva UMA cena concreta e fotografável, sempre com: tipo de veículo genérico (nunca marca/modelo
real) OU cena sem carro quando o passo for sobre pessoa/documento/tela; ângulo específico (frontal
3/4, traseira 3/4, lateral, interior, detalhe de componente); iluminação SEMPRE "daylight" ou "soft
daylight" — nunca "dramático", "dusk", "silhueta", "noturno" (isso faz a IA gerar carros
desfigurados/manchas escuras sem detalhe). Varie o ângulo/cena entre slides consecutivos — nunca a
mesma composição duas vezes.`;

function buildUserPrompt(theme: Theme, recentTitles: string[]): string {
  const avoidList = recentTitles.length
    ? `\n\nNÃO repita estes temas/ganchos já usados recentemente:\n${recentTitles.map((t) => `- ${t}`).join("\n")}`
    : "";
  return `Tema: ${theme.title}
Contexto/brief: ${theme.brief}
Formato preferido: ${theme.preferredFormat}
Pilar de conteúdo: ${theme.pillar}${avoidList}

Crie o post completo agora, seguindo o formato JSON exigido.`;
}

export interface LintResult {
  ok: boolean;
  reasons: string[];
}

const HIGH_RISK_PATTERNS = [
  /\brecall\b/i,
  /problema\s+cr[oô]nico\s+(do|da|no|na)\s+[A-ZÁÉÍÓÚ][\wçãõéáíóú]+/i, // "problema crônico do <ModelName>"
  /\d+\s*(cv|hp|cavalos)\b/i, // specific horsepower figure
  /\d+([.,]\d+)?\s*km\/l\b/i, // specific consumption figure
];

/**
 * Automated quality/risk gate that replaces human review for autonomous
 * publishing. Not external fact-checking (this pipeline has no wired
 * integration to an official source) — it structurally blocks the pipeline
 * from ever shipping an unhedged specific factual claim about a named model,
 * plus basic format/legibility/caption sanity checks.
 */
export function lintDraft(draft: CarouselDraft): LintResult {
  const reasons: string[] = [];

  if (draft.format === "CAROUSEL" && (draft.slides.length < 6 || draft.slides.length > 10)) {
    reasons.push(`CAROUSEL deve ter 6-10 slides, veio ${draft.slides.length}`);
  }
  if (draft.format === "POST" && draft.slides.length !== 1) {
    reasons.push(`POST deve ter exatamente 1 slide, veio ${draft.slides.length}`);
  }
  for (const [i, slide] of draft.slides.entries()) {
    if (!slide.text || slide.text.trim().length === 0) reasons.push(`slide ${i + 1} sem texto`);
    if (slide.text && slide.text.length > 160) reasons.push(`slide ${i + 1} texto longo demais (${slide.text.length} chars) — risco de corte/ilegibilidade`);
  }
  if (!draft.caption || draft.caption.trim().length < 20) reasons.push("legenda vazia ou curta demais");
  if (!draft.hashtags || draft.hashtags.length < 3 || draft.hashtags.length > 15) {
    reasons.push(`quantidade de hashtags fora do razoável (${draft.hashtags?.length ?? 0})`);
  }
  if (!draft.cta || draft.cta.trim().length === 0) reasons.push("CTA ausente");

  const fullText = [draft.hook, draft.caption, ...draft.slides.map((s) => `${s.title} ${s.text}`)].join(" ");
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(fullText)) {
      reasons.push(`afirmação factual de alto risco não verificável detectada (padrão: ${pattern})`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/** Generates a draft for a theme and lints it, retrying with the same theme
 * once before the caller should give up on this theme and try another. */
export async function generateAndLint(
  theme: Theme,
  recentTitles: string[],
  organizationId: string,
): Promise<{ draft: CarouselDraft; lint: LintResult } | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { text } = await aiOrchestrator.generateText(
      { system: SYSTEM_PROMPT, prompt: buildUserPrompt(theme, recentTitles), maxTokens: 2000 },
      { organizationId, quality: "final" },
    );

    let draft: CarouselDraft;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      draft = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (err) {
      logger.warn({ theme: theme.id, attempt, err }, "content pipeline: failed to parse generated JSON");
      continue;
    }

    const lint = lintDraft(draft);
    if (lint.ok) return { draft, lint };
    logger.warn({ theme: theme.id, attempt, reasons: lint.reasons }, "content pipeline: draft failed lint");
  }
  return null;
}
