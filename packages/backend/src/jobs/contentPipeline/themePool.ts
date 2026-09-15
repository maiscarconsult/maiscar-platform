/**
 * Curated theme pool for the @mais.car autonomous content pipeline.
 *
 * riskTier controls what the pipeline is allowed to auto-publish without a
 * human in the loop:
 *   - "low": general process/checklist/educational content. No claims about
 *     specific named vehicle models. Safe to auto-publish — nothing here can
 *     be factually wrong about a real product.
 *   - "verifiable_but_generic": mentions categories of technical facts (fuel
 *     consumption ranges, typical maintenance costs) only in general terms
 *     ("carros desse porte"), never a specific asserted number for a named
 *     model. Still auto-publishable.
 *
 * Themes about a SPECIFIC named model's chronic defects, recalls, exact
 * specs, or safety ratings are deliberately NOT in this pool. This project
 * has no wired integration to an external fact source (SENATRAN, Inmetro,
 * Latin NCAP, manufacturer databases) that an unattended script could call
 * to verify such claims before publishing — and an LLM re-checking its own
 * output is not real verification. Until a real source integration exists,
 * that category stays out of the autonomous pool; see generate.ts's lint
 * step for the automated backstop that enforces this even if a prompt
 * drifts into naming a specific defect.
 */

export type Pillar =
  | "EDUCACAO"
  | "ALERTA"
  | "ANALISE"
  | "COMPARACAO"
  | "CURIOSIDADE"
  | "TENDENCIA"
  | "ENGAJAMENTO"
  | "AUTORIDADE"
  | "CONVERSAO";

export interface Theme {
  id: string;
  pillar: Pillar;
  riskTier: "low" | "verifiable_but_generic";
  title: string;
  brief: string;
  preferredFormat: "CAROUSEL" | "POST";
}

export const PILLAR_DESCRIPTIONS: Record<Pillar, string> = {
  EDUCACAO: "Ensinar algo útil e prático sobre comprar/avaliar carros",
  ALERTA: "Ajudar a evitar prejuízo, golpe ou erro comum",
  ANALISE: "Como avaliar um veículo/processo de compra de forma técnica",
  COMPARACAO: "Comparar caminhos, decisões ou tipos de compra (não marcas específicas com claims técnicos)",
  CURIOSIDADE: "Fato interessante e evergreen sobre o universo automotivo",
  TENDENCIA: "Assunto de época/sazonal do mercado automotivo (época do ano, fim de ano, IPVA, etc.)",
  ENGAJAMENTO: "Pergunta ou enquete para gerar comentários e interação",
  AUTORIDADE: "Mostrar o processo/metodologia da Mais.car, bastidores da consultoria",
  CONVERSAO: "CTA direto para contratar a consultoria de avaliação",
};

export const THEME_POOL: Theme[] = [
  {
    id: "sinais-carro-esconde-problema",
    pillar: "ALERTA",
    riskTier: "low",
    title: "5 sinais de que o carro 'impecável' esconde um problema",
    brief:
      "Sinais visuais e comportamentais (frestas desalinhadas, pintura casca-de-laranja, cheiro forte, pneus desgastados de forma desigual, documentação sem histórico) que indicam batida/mau uso, sem citar nenhum modelo específico.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "checklist-antes-fechar-negocio",
    pillar: "EDUCACAO",
    riskTier: "low",
    title: "Checklist rápido antes de fechar negócio em um carro usado",
    brief:
      "Passo a passo prático: teste de rua, verificação de documentação (CRLV, multas, restrição financeira), histórico no Detran, inspeção de funilaria, checagem de fluidos.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "golpes-comuns-compra-carro",
    pillar: "ALERTA",
    riskTier: "low",
    title: "3 golpes comuns na compra de carro usado (e como evitar)",
    brief:
      "Golpe do documento clonado, golpe do carro de leilão não declarado, golpe do anúncio fantasma com pagamento antecipado. Como se proteger de cada um.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "financiar-ou-a-vista",
    pillar: "COMPARACAO",
    riskTier: "low",
    title: "Financiar ou comprar à vista? O que pesa mais na decisão",
    brief:
      "Trade-offs gerais entre financiamento e compra à vista para carro usado: fluxo de caixa, juros, poder de negociação, depreciação — sem citar taxas específicas de banco.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "carro-usado-vs-seminovo-vs-0km",
    pillar: "COMPARACAO",
    riskTier: "low",
    title: "Usado, seminovo ou 0km: qual realmente compensa pro seu momento",
    brief:
      "Comparação de custo-benefício por perfil de comprador (primeira compra, upgrade, uso profissional), sem citar preços ou modelos específicos.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "documentos-conferir-antes-comprar",
    pillar: "EDUCACAO",
    riskTier: "low",
    title: "Os 4 documentos que você TEM que conferir antes de comprar",
    brief: "CRLV, laudo de vistoria, comprovante de quitação de multas/IPVA, histórico de leilão/sinistro no Detran.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "manutencao-preventiva-economiza",
    pillar: "EDUCACAO",
    riskTier: "verifiable_but_generic",
    title: "Por que manutenção preventiva custa menos que corretiva (na prática)",
    brief:
      "Explicação geral (não ligada a um modelo específico) de como pequenos itens negligenciados viram reparos caros — troca de óleo, correia, pastilhas de freio.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "por-que-carro-desvaloriza-rapido",
    pillar: "CURIOSIDADE",
    riskTier: "low",
    title: "Por que alguns carros desvalorizam muito mais rápido que outros",
    brief:
      "Fatores gerais de depreciação: categoria do veículo, custo de manutenção percebido, disponibilidade de peças, reputação de confiabilidade da marca em geral — sem apontar modelo específico como exemplo de defeito.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "melhor-epoca-comprar-carro",
    pillar: "TENDENCIA",
    riskTier: "low",
    title: "A melhor época do ano para comprar (ou vender) um carro usado",
    brief: "Sazonalidade do mercado: fim/início de ano, período de troca de placa, IPVA, lançamento de novos modelos pressionando preço dos usados.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "enquete-compraria-esse-carro",
    pillar: "ENGAJAMENTO",
    riskTier: "low",
    title: "Enquete: você compraria um carro sem test-drive?",
    brief: "Post de engajamento direto — pergunta simples com CTA para comentar, sem necessidade de roteiro longo.",
    preferredFormat: "POST",
  },
  {
    id: "pergunta-pior-experiencia",
    pillar: "ENGAJAMENTO",
    riskTier: "low",
    title: "Qual foi a pior surpresa que você já teve comprando um carro?",
    brief: "Pergunta aberta para gerar comentários e histórias dos seguidores — conecta com a dor que a consultoria resolve.",
    preferredFormat: "POST",
  },
  {
    id: "como-funciona-avaliacao-mais-car",
    pillar: "AUTORIDADE",
    riskTier: "low",
    title: "Como funciona uma avaliação da Mais.car por dentro",
    brief:
      "Bastidores do processo real da consultoria: o que é checado, quanto tempo leva, o que o cliente recebe no laudo — reforça autoridade mostrando processo, não vendendo diretamente.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "erro-numero-1-compradores-primeira-vez",
    pillar: "ALERTA",
    riskTier: "low",
    title: "O erro nº 1 de quem compra o primeiro carro sozinho",
    brief: "Confiar só na aparência/anúncio e pular a inspeção técnica independente — o gancho natural para o serviço.",
    preferredFormat: "CAROUSEL",
  },
  {
    id: "cta-agende-avaliacao",
    pillar: "CONVERSAO",
    riskTier: "low",
    title: "Antes de assinar qualquer coisa, fale com quem entende",
    brief: "CTA direto: apresentação curta do serviço de consultoria automotiva premium e como agendar.",
    preferredFormat: "POST",
  },
];

/** Simple keyword-overlap check against recent topics/hooks to avoid repeats. */
export function isTooSimilarToRecent(theme: Theme, recentTexts: string[]): boolean {
  const themeWords = new Set(
    `${theme.title} ${theme.brief}`
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, "")
      .split(/\s+/)
      .filter((w) => w.length > 4),
  );
  for (const text of recentTexts) {
    const words = text
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, "")
      .split(/\s+/)
      .filter((w) => w.length > 4);
    const overlap = words.filter((w) => themeWords.has(w)).length;
    if (overlap >= 4) return true;
  }
  return false;
}
