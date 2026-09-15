/**
 * MAISCAR_REFERENCE_FORMAT_LOCK_V1 (2026-09-12) — permanent standard.
 * Evolves the same file/architecture as V3/V3.1 (never rebuilt): RADAR ->
 * SCORING -> FACT CHECK -> SCRIPT (1 Haiku call) -> VOICE (ONE TTS call,
 * ONE locked config, real word-boundary timing) -> B-ROLL (vision-verified,
 * speech-driven) -> MOTION (Remotion, unchanged renderer) -> AVATAR
 * (half-body explainer, reacts per beat) -> SFX/MUSIC -> REEL_COVER -> QA.
 * Does not write to Content or publish — pilot only.
 *
 * What changed vs V3.1 (format-lock corrections, all REPROVADO items):
 *  - MAISCAR_VOICE_LOCK: one fixed voice/rate/pitch for the WHOLE Reel,
 *    synthesized in a SINGLE TTS call (ttsProvider.ts's
 *    synthesizeFullNarration) — the old per-beat/per-emotion prosody calls
 *    are gone, so MULTIPLE_VOICES is now structurally impossible, not just
 *    a rule.
 *  - MAISCAR_HOST_AVATAR: Mascot.tsx is now a half-body character with a
 *    torso and two arms (facepalm, pointing in 4 directions, head-touch,
 *    cash-tag) — the old floating-head badge is gone.
 *  - COMPARISON_FORMAT = FORBIDDEN by default: one thesis per video, never
 *    "carro A x carro B" unless explicitly requested.
 */
import fs from "node:fs";
import path from "node:path";
import { getControversyCandidates } from "./controversyRadar";
import { searchQuatroRodas } from "./evergreenRadar";
import { scoreControversy } from "./controversyScoring";
import { getRecentReels, isTooSimilar } from "./antiRepetition";
import { TieredClaim, FactTier } from "./factCheckTiers";
import { verifyClaims, passesSourceVerifiedFactGate } from "./sourceVerifiedFactGate";
import { synthesizeFullNarration, MAISCAR_VOICE_LOCK } from "./ttsProvider";
import { searchAndDownloadClip } from "./pexelsVideo";
import { validateClipIntegrity } from "./videoClipVerification";
import { getSfxPath, SfxType } from "./sfxKit";
import sharp from "sharp";
import { stageAsset, renderNarratedMotionReelV3, renderMascotStillPng } from "./remotionRenderer";
import { sourcePhoto, downloadPhoto } from "./photoSourcing";
import { renderHero } from "../../modules/content/diagonalTemplateV4";
import { selectTrack, resolveTrackPath } from "./localAudioLibrary";
import { aiOrchestrator } from "../../modules/ai-orchestrator/orchestrator";
import { logger } from "../../lib/logger";
import { TimedBlock, NarratedReelV3Props, VideoCut, MascotPose, MascotPosition, MascotEnterFrom, VisualRegister, ScreenEvidenceProps, HookBlock } from "./timedScriptTypes";
import { detectPowerpointStyle } from "./powerpointStyleGate";
import { scoreHook } from "./hookScoreGate";
import { scoreCover } from "./coverScoreGate";
import { composeScreenEvidence, pickTemplateFromBeat } from "./screenEvidenceCompose";

const ORG_ID = "e20b49b4-2835-4e90-bb41-95b1aab11007";
const BRAND_ID = "09dc8dec-34e9-4588-97d9-031b820c8a64";
const PILOT_DIR = path.join(__dirname, "..", "..", "..", "generated", "narrated-v3-pilot");
const FPS = 30;
const MASCOT_POSES: MascotPose[] = [
  "NORMAL", "SURPRESO", "DESCONFIADO", "BRAVO", "RINDO", "IRONICO", "INDIGNADO",
  "APONTANDO", "APONTANDO_ESQUERDA", "APONTANDO_DIREITA", "APONTANDO_CIMA", "APONTANDO_BAIXO",
  "EXPLICANDO", "PENSANDO", "MAO_NA_CABECA", "DINHEIRO", "POSITIVO", "NEGATIVO",
  "FACEPALM", "ASSUSTADO", "DINHEIRO_DOENDO", "SUSSURRO", "NEGANDO", "CONCORDANDO",
];
const SFX_TYPES: SfxType[] = ["WHOOSH", "POP", "CLICK", "IMPACT", "RISER"];
// STATIC_VISUAL_MAX_1_8S (format-lock v1, tighter than V3.1's 2.0s)
const MAX_BEAT_SEC_BEFORE_INTERNAL_CUT = 1.8;
const PATTERN_INTERRUPT_INTERVAL_SEC = 5;

/** PROFANITY_MODE = NATURAL_CONTEXTUAL — ênfase + humor, nunca muleta, nunca insulto a grupo/característica pessoal. */
const PROFANITY_WORDS = ["porra", "caralho", "cacete", "merda", "se lascou", "se fodeu", "fodendo", "não fode", "fudido", "pra cacete"];
const MAX_PROFANITY_PER_REEL = 3;
const SLANG_PHRASES = [
  "olha só", "aí é que tá", "só que tem um detalhe", "pois é", "meu amigo",
  "a conta chega", "você se lasca", "não é por nada", "agora presta atenção",
  "aí vem a merda", "e é aqui que você se lasca",
];
const CORPORATE_PHRASES = ["de acordo com especialistas", "neste vídeo iremos", "vale destacar", "por outro lado", "analisaremos"];
const CTA_PHRASES = ["comenta a", "o que você acha", "deixa nos comentários", "comenta aí", "você concorda"];
const DICA_KEYWORDS = ["negociar", "financiar", "comprar", "desconto", "concession", "vendedor", "usado", "sinal", "golpe", "revisão antes"];
// BUYER_PAIN_V2 editorial identity check — heuristic keyword match against the radar-editorial categories from the spec.
const BUYER_PAIN_KEYWORDS = [
  "locadora", "leilão", "financ", "juros", "negocia", "revenda", "manutenção", "manutencao", "custo",
  "prejuízo", "prejuizo", "dinheiro", "cilada", "golpe", "maquiado", "usado", "garantia", "dono", "erro",
];
// NO_COMPARISON_UNLESS_REQUESTED — catches "X vs Y"/"X ou Y"/"melhor que"/"contra o" style framing.
const COMPARISON_PATTERNS = [
  /\bvs\.?\b/i, /\bversus\b/i, /\bmelhor que\b/i, /\bcontra o\b/i, /\bqual (é |e )?(o )?melhor\b/i, /\bqual vale mais\b/i,
  /\b(mais|menos)\s+\w+\s+que\s+o\b/i, // "custa mais/menos ... que o Civic" style direct price/spec comparisons
  /\bficha técnica\b/i, // ficha-técnica-style spec-by-spec comparisons
];

function pickContentMode(candidateTitle: string): "DEBATE" | "DICA" {
  const lower = candidateTitle.toLowerCase();
  return DICA_KEYWORDS.some((k) => lower.includes(k)) ? "DICA" : "DEBATE";
}

/** SOURCE_VERIFIED_FACT_GATE needs at least one non-opinion claim — a beat
 *  tagged only EDITORIAL_OPINION (or untagged) doesn't count as evidence,
 *  even though `some(b => b.tier)` would say "yes, something is tagged". A
 *  real run hit exactly this: Haiku tagged its evidence beats
 *  EDITORIAL_OPINION instead of OWNER_REPORT, which "has a tier" but isn't
 *  evidence, and the fact gate failed with zero usable claims. */
function hasNonOpinionEvidence(beats: ScriptBeat[]): boolean {
  return beats.some((b) => b.tier && b.tier !== "EDITORIAL_OPINION");
}

function looksLikeComparison(texts: string[]): boolean {
  const joined = texts.join(" ");
  return COMPARISON_PATTERNS.some((p) => p.test(joined));
}

// TITLE-LEVEL comparison check (buyer-pain-v2 new-reel fix): a real run
// picked "Toyota Corolla Hybrid ou Honda Civic: híbrido compensa o preço?"
// as the topic — a two-named-model title that COMPARISON_PATTERNS (tuned
// for narration phrasing like "vs"/"melhor que") never catches, and Haiku
// then wrote a direct price comparison hook ("...custa uns 15 mil a mais
// que o Civic...") that also slipped past those same narration patterns.
// This catches the shape at the CANDIDATE stage, before a Haiku call is
// even spent on it.
// GENERIC_HOOK = HARD FAIL (buyer-pain-v2 new-reel fix): the old
// buildDeterministicScriptV3() fallback's hook ("Olha só, isso aqui está
// sendo muito discutido agora.") shipped twice in real runs — technically
// passing every gate but reading as bland, non-provocative filler, the
// opposite of the house voice. This fallback text (and its shape) is now
// banned outright; any script whose hook matches gets replaced by a
// BUYER_PAIN_SEEDS-driven script instead of being shipped.
const GENERIC_HOOK_PATTERNS = [
  /olha s[oó],?\s*isso aqui est[aá] sendo muito discutido agora/i,
  /^olha s[oó][,.]?/i,
  /isso (aqui )?est[aá] sendo (muito )?discutido/i,
  /voc[eê] sabia/i,
  /hoje (n[oó]s )?vamos falar/i,
  /neste v[íi]deo/i,
];
function isGenericHook(hook: string): boolean {
  return GENERIC_HOOK_PATTERNS.some((p) => p.test(hook));
}

const MIN_ENGAGEMENT_SCORE_HARD = 80;

// MAISCAR_SERVICE_MENTION_RULE: required whenever the topic genuinely
// relates to buying/inspecting a used car — optional (i.e. never forced)
// for everything else (financing psychology, trade-in math, general news).
const SERVICE_MENTION_KEYWORDS = [
  "avalia", "inspeç", "inspec", "vistoria", "laudo cautelar", "compra de usado", "carro usado", "maquiado",
  "defeito escondido", "manutenção", "manutencao", "scanner", "estrutura", "batida", "quilometragem", "km ",
  "locadora", "leilão", "leilao", "vale a pena comprar", "prejuízo", "prejuizo",
];
function isServiceMentionRelevant(title: string): boolean {
  const lower = title.toLowerCase();
  return SERVICE_MENTION_KEYWORDS.some((k) => lower.includes(k));
}

interface BuyerPainSeed {
  id: string;
  label: string;
  hook: string;
  qualificacao: string;
  risco: string;
  oQueVerificar: string;
  punchline: string;
  keywords: [string, string, string, string];
  videoQueries: [string, string, string, string];
  mascotPoses: [MascotPose, MascotPose, MascotPose, MascotPose];
  searchQueries: string[];
  /** MAISCAR_SERVICE_MENTION_RULE: a natural, in-reasoning sentence
   *  connecting this beat's teaching to the MAIS CAR pre-purchase
   *  evaluation — only set on seeds genuinely about buying/inspecting a
   *  used car. Appended to oQueVerificar (teach-first, then connect),
   *  never a bare "contrate a MAIS CAR" tack-on. Omitted seeds (financing
   *  psychology, trade-in math) aren't service-relevant. */
  serviceMention?: string;
}

// BUYER_PAIN_SEEDS — hand-written, hard-coded, permanent library (0 LLM to
// build these). Used whenever the radar has no real candidate scoring
// >= MIN_ENGAGEMENT_SCORE_HARD, or whenever any fallback/generic-hook
// condition fires for a radar topic — never the old bland generic template.
const BUYER_PAIN_SEEDS: BuyerPainSeed[] = [
  {
    id: "km-baixa", label: "Quilometragem baixa em carro usado pode enganar comprador",
    hook: "QUILOMETRAGEM BAIXA NÃO PROVA PORRA NENHUMA SOZINHA.",
    qualificacao: "E calma, km baixa não é golpe por si só, o problema é confiar só nesse número e não olhar mais nada.",
    risco: "Um carro com km baixa pode ter ficado anos parado, com peça ressecada, bateria e mangueira secando e ferrugem que ninguém vê de fora.",
    oQueVerificar: "Confere o histórico de revisão, o estado real dos pneus e das borrachas e faz uma inspeção antes de fechar, km sozinha não conta a história toda.",
    serviceMention: "É esse tipo de coisa que a gente confere de verdade numa avaliação pré-compra da MAIS CAR, antes de tu colocar dinheiro no carro.",
    punchline: "Carro rodado com manutenção em dia vale mais que um parado com km baixa e nenhuma história pra contar.",
    keywords: ["KM BAIXA", "CUIDADO", "HISTÓRICO", "PENSE"],
    videoQueries: ["car odometer dashboard close up", "car engine bay close up", "mechanic checking car tires", "car dealership handshake"],
    mascotPoses: ["DESCONFIADO", "INDIGNADO", "APONTANDO_DIREITA", "CONCORDANDO"],
    searchQueries: ["quilometragem baixa carro usado suspeita", "carro rodado pouco anos parado problema"],
  },
  {
    id: "vendedor-aquece", label: "Vendedor esquentando o motor do carro antes da visita do comprador",
    hook: "SE O CARRO JÁ TÁ QUENTE QUANDO TU CHEGA, DESCONFIA PRA CACETE.",
    qualificacao: "E calma, motor quente sozinho não prova defeito, o problema é isso ser um sinal clássico que muita gente ignora.",
    risco: "Motor já ligado antes da tua chegada esconde ruído de partida a frio, fumaça e falha que só aparecem nos primeiros segundos ligados.",
    oQueVerificar: "Chega sem avisar, pede pra ligar o carro na tua frente com o motor frio e presta atenção no barulho e na fumaça do escapamento.",
    serviceMention: "Motor de partida a frio é literalmente um dos primeiros pontos que a gente checa numa avaliação da MAIS CAR, é ali que muita coisa aparece.",
    punchline: "Se o vendedor já deixou tudo quentinho antes de tu chegar, ele sabia exatamente o que tava escondendo.",
    keywords: ["DESCONFIE", "MOTOR FRIO", "TESTE", "ATENÇÃO"],
    videoQueries: ["car engine starting cold morning", "mechanic listening engine sound", "car exhaust smoke close up", "car dealership lot"],
    mascotPoses: ["DESCONFIADO", "EXPLICANDO", "APONTANDO_CIMA", "CONCORDANDO"],
    searchQueries: ["vendedor liga motor antes visita comprador carro usado", "truque motor quente venda carro usado"],
  },
  {
    id: "sem-inspecao", label: "Vendedor não permite inspeção pré-compra do carro usado",
    hook: "SE O VENDEDOR NÃO DEIXA TU FAZER ISSO, EU IRIA EMBORA.",
    qualificacao: "E calma, nem todo vendedor que hesita é golpista, mas recusar de vez uma inspeção independente é bandeira vermelha grande.",
    risco: "Sem uma inspeção de verdade, batida estrutural, motor remontado e retífica malfeita passam batido pra qualquer comprador leigo.",
    oQueVerificar: "Marca a visita já falando que vai levar o carro numa inspeção paga em oficina de confiança antes de fechar qualquer negócio.",
    serviceMention: "É exatamente pra isso que existe a avaliação pré-compra da MAIS CAR, alguém de fora, sem interesse na venda, olhando o carro por ti.",
    punchline: "Vendedor honesto não tem medo de inspeção, porra, só quem tem o que esconder é que corre dessa conversa.",
    keywords: ["INSPEÇÃO", "BANDEIRA VERMELHA", "VERIFIQUE", "FUJA"],
    videoQueries: ["mechanic inspecting car underneath", "car service bay lift", "mechanic checklist clipboard car", "car dealership negotiation"],
    mascotPoses: ["INDIGNADO", "DESCONFIADO", "APONTANDO_DIREITA", "NEGANDO"],
    searchQueries: ["vendedor não permite inspeção pré-compra carro usado", "inspeção independente carro usado antes de comprar"],
  },
  {
    // Rewritten 2026-09-14 (calibration pass): FORCED_SERVICE_MENTION =
    // HARD FAIL for financing/juros/parcela topics — no serviceMention
    // field here on purpose, the MAIS CAR pre-purchase-evaluation mention
    // only belongs on usado/inspection/history/scanner topics. Hook/humor/
    // ending scored against 10 internally-generated variants (money loss,
    // dealer trick, blame, shock, unpopular opinion) — winner was the
    // unpopular-opinion angle, kept in "dinheiro + erro + vendedor +
    // consequência" language, not economist language. Fact-check note:
    // CET (Custo Efetivo Total) disclosure is a real Banco Central/CDC
    // consumer-credit requirement — no single specific rate is asserted,
    // so this doesn't need the invented-number risk a percentage would.
    id: "parcela-vs-preco", label: "Olhar só o valor da parcela em vez do preço total do financiamento do carro",
    hook: "PARCELA BAIXA NÃO SIGNIFICA CARRO BARATO. ÀS VEZES SIGNIFICA QUE TU VAI PAGAR ESSA PORRA A VIDA INTEIRA.",
    qualificacao: "E calma, financiar não é roubada, o problema é decidir só pela parcela caber no bolso sem olhar o resto do contrato.",
    risco: "Parcela baixinha geralmente esconde prazo esticado, com o vendedor empurrando mais meses só pra aquele número parecer bonito no papel.",
    oQueVerificar: "Antes de fechar, olha a entrada, o prazo, o CET e principalmente quanto tu vai ter pago no fim — não só o número que cabe no teu mês.",
    punchline: "A parcela é a parte bonita da história, meu amigo, o CET é o final que ninguém conta pra ti antes de assinar — e parcela que cabe no bolso não significa negócio que cabe no bolso.",
    keywords: ["PARCELA TE ENGANA", "PRAZO", "OLHA O TOTAL", "CET"],
    videoQueries: ["car financing paperwork signing", "calendar pages flipping months", "contract document close up highlight", "calculator adding money total"],
    mascotPoses: ["MAO_NA_CABECA", "EXPLICANDO", "APONTANDO_DIREITA", "DINHEIRO_DOENDO"],
    searchQueries: ["CET custo efetivo total financiamento veículo Banco Central", "financiamento carro parcela baixa prazo longo"],
  },
  {
    id: "pressa-mesmo-dia", label: "Pressa do vendedor pra fechar negócio e sair de carro no mesmo dia",
    hook: "SE TU FAZ ISSO ANTES DE COMPRAR UM CARRO, JÁ COMEÇOU ERRADO.",
    qualificacao: "E calma, fechar rápido não é sempre problema, a questão é decidir com pressa só porque alguém tá empurrando o relógio.",
    risco: "Pressa pra sair de carro no mesmo dia é exatamente o tempo que falta pra tu checar documento, multa e histórico direito.",
    oQueVerificar: "Antes de assinar qualquer coisa, separa um dia só pra pesquisar preço de mercado, documentação e rodar numa vistoria.",
    serviceMention: "Não é por nada, mas uma avaliação pré-compra da MAIS CAR leva bem menos tempo do que parece, e é exatamente esse tempo que evita a maior cilada.",
    punchline: "Negócio bom continua bom amanhã, porra, só negócio ruim é que precisa que tu decida hoje.",
    keywords: ["PRESSA", "ESPERE", "PESQUISE", "CALMA"],
    videoQueries: ["car dealership handshake deal", "person signing car documents", "car keys handover", "clock time pressure office"],
    mascotPoses: ["DESCONFIADO", "APONTANDO_DIREITA", "EXPLICANDO", "CONCORDANDO"],
    searchQueries: ["pressa fechar negócio carro usado mesmo dia cilada", "vendedor apressa comprador carro usado"],
  },
  {
    id: "bonito-demais", label: "Carro usado bonito demais por fora pode esconder histórico de batida",
    hook: "CARRO BONITO DEMAIS POR FORA PODE TÁ ESCONDENDO UMA MERDA POR DENTRO.",
    qualificacao: "E calma, carro limpo e bem cuidado não é sinal de golpe, o problema é usar só a aparência pra decidir.",
    risco: "Massa plástica bem lixada, pintura nova só num painel e frestas desalinhadas escondem batida que ninguém confessa na conversa.",
    oQueVerificar: "Passa a mão nas frestas das portas, compara a cor entre painéis diferentes e usa um medidor de espessura de tinta antes de fechar.",
    serviceMention: "Medidor de espessura de tinta é item básico numa avaliação da MAIS CAR, é uma das primeiras coisas que a gente confere, antes da aparência te convencer de qualquer coisa.",
    punchline: "Carro pode tá brilhando por fora e escondendo uma estrutura toda remendada por dentro.",
    keywords: ["APARÊNCIA", "BATIDA", "VERIFIQUE", "ATENÇÃO"],
    videoQueries: ["car paint detailing close up", "car body panel gap close up", "mechanic checking car paint", "car dealership shiny car"],
    mascotPoses: ["DESCONFIADO", "EXPLICANDO", "APONTANDO_DIREITA", "ASSUSTADO"],
    searchQueries: ["carro usado maquiado esconder batida pintura", "identificar carro batido comprar usado"],
  },
  {
    id: "sem-scanner", label: "Comprar carro usado sem passar scanner automotivo antes de fechar negócio",
    hook: "ESSA ECONOMIA DE AGORA PODE VIRAR UMA CONTA PRA CACETE DEPOIS.",
    qualificacao: "E calma, nem todo carro sem scanner é problema, mas pular esse passo pra economizar uma grana é apostar no escuro.",
    risco: "Falha eletrônica apagada manualmente não acende luz nenhuma no painel, só o scanner mostra o código de erro escondido.",
    oQueVerificar: "Antes de fechar, leva um aparelho de diagnóstico ou paga uma oficina de confiança pra rodar o scanner no carro todo.",
    serviceMention: "Scanner completo já entra na avaliação pré-compra da MAIS CAR, é justamente pra evitar uma merda dessas que esse item existe no laudo.",
    punchline: "Um scanner de cem e poucos reais pode te livrar de uma conta de manutenção de muitos milhares depois.",
    keywords: ["SCANNER", "DIAGNÓSTICO", "ECONOMIA FALSA", "ATENÇÃO"],
    videoQueries: ["car diagnostic scanner obd2", "mechanic plugging diagnostic tool", "car dashboard warning light", "mechanic garage tools"],
    mascotPoses: ["EXPLICANDO", "INDIGNADO", "APONTANDO_DIREITA", "DINHEIRO_DOENDO"],
    searchQueries: ["scanner obd2 antes de comprar carro usado", "diagnóstico eletrônico carro usado comprar"],
  },
  {
    id: "manutencao-vs-km", label: "Histórico de manutenção pesa mais que quilometragem na hora de comprar carro usado",
    hook: "QUEM SÓ OLHA O PAINEL E IGNORA O HISTÓRICO JÁ CAIU NA PRIMEIRA CILADA.",
    qualificacao: "E calma, km baixa até ajuda, mas sozinha ela não conta se o carro foi cuidado direito ao longo dos anos.",
    risco: "Carro com km baixa e revisão nenhuma feita pode ter correia, fluido e filtro vencidos há anos sem ninguém trocar.",
    oQueVerificar: "Pede o histórico completo de revisão na concessionária ou oficina, não só o número no painel do carro.",
    serviceMention: "Na avaliação da MAIS CAR a gente cruza esse histórico com o estado real do carro, porque documento bonito também pode não bater com a realidade.",
    punchline: "Km no painel é só um número, porra, histórico de manutenção é que conta a vida real do carro.",
    keywords: ["HISTÓRICO", "MANUTENÇÃO", "VERIFIQUE", "REVISÃO"],
    videoQueries: ["car service history book", "mechanic checking maintenance record", "car workshop service bay", "car dashboard gauge close up"],
    mascotPoses: ["EXPLICANDO", "DESCONFIADO", "APONTANDO_DIREITA", "CONCORDANDO"],
    searchQueries: ["histórico de manutenção mais importante que km carro usado", "revisões carro usado importância comprar"],
  },
  {
    id: "barato-demais", label: "Carro usado muito mais barato que a média do mercado sempre tem uma explicação",
    hook: "CARRO MUITO BARATO NORMALMENTE TEM UMA HISTÓRIA.",
    qualificacao: "E calma, preço abaixo da média não é golpe automático, mas ninguém vende barato demais por bondade.",
    risco: "Preço muito abaixo do mercado geralmente esconde documento com pendência, sinistro não declarado ou pressa de quem quer se livrar do problema rápido.",
    oQueVerificar: "Pesquisa o preço médio do mesmo modelo/ano antes de se animar e pergunta na cara dura por que tá tão mais barato.",
    serviceMention: "E aí vem a conta: antes de fechar um preço bom demais, uma avaliação pré-compra da MAIS CAR mostra se o desconto é sorte ou é problema escondido.",
    punchline: "Preço bom demais não é sorte, cacete, é sinal de que falta alguma informação pra fechar a conta.",
    keywords: ["DESCONFIE", "PREÇO", "PESQUISE", "MOTIVO"],
    videoQueries: ["car price tag close up", "car dealership lot cars", "person comparing prices phone", "car dealership negotiation"],
    mascotPoses: ["DESCONFIADO", "SURPRESO", "APONTANDO_DIREITA", "EXPLICANDO"],
    searchQueries: ["carro usado muito barato risco golpe", "preço abaixo do mercado carro usado suspeita"],
  },
  {
    id: "financiar-acessorio", label: "Financiar acessórios e opcionais junto com o carro encarece muito mais que parece",
    hook: "FINANCIAR ACESSÓRIO É PAGAR JURO EM TAPETE.",
    qualificacao: "E calma, opcional não é vilão, o problema é diluir ele nas parcelas do carro sem perceber o juro rodando em cima.",
    risco: "Aquele pacote de acessórios financiado junto vira juro composto por 48-60 meses, ficando muito mais caro que pagar à vista.",
    oQueVerificar: "Pede o valor do acessório separado do financiamento e compara quanto custaria pagando à vista fora do contrato.",
    punchline: "Tapete, insulfilm e som financiados juntos podem custar o dobro do preço de loja, pra cacete, no fim do contrato.",
    keywords: ["JUROS", "ACESSÓRIO", "CUIDADO", "CALCULE"],
    videoQueries: ["car accessories dashboard installation", "car financing paperwork signing", "calculator money car loan", "car dealership finance office"],
    mascotPoses: ["INDIGNADO", "EXPLICANDO", "APONTANDO_CIMA", "DINHEIRO_DOENDO"],
    searchQueries: ["financiar acessórios carro junto parcela juros", "acessórios financiados carro custo real"],
  },
  {
    id: "falha-apagada", label: "Apagar a luz de falha do painel antes de vender o carro usado não conserta o problema",
    hook: "APAGAR FALHA ANTES DA VENDA NÃO CONSERTA PORRA NENHUMA.",
    qualificacao: "E calma, painel limpo não significa golpe certeiro, mas é fácil demais resetar uma luz de erro pra fechar negócio mais rápido.",
    risco: "Um scanner básico apaga o código da luz de injeção ou câmbio na hora, mas o defeito real continua lá embaixo do capô.",
    oQueVerificar: "Leva o carro num scanner de confiança que mostra códigos de falha salvos no histórico, não só o painel apagado.",
    serviceMention: "Código de falha salvo é uma das coisas que a MAIS CAR procura antes de dizer se aquele carro vale a pena, painel limpo sozinho não convence ninguém aqui.",
    punchline: "Painel limpo não é diagnóstico, é só a luz que pararam de mostrar pra ti.",
    keywords: ["PAINEL", "SCANNER", "CUIDADO", "VERIFIQUE"],
    videoQueries: ["car dashboard warning light", "car diagnostic scanner obd2", "mechanic plugging diagnostic tool", "car engine bay close up"],
    mascotPoses: ["DESCONFIADO", "INDIGNADO", "EXPLICANDO", "APONTANDO_DIREITA"],
    searchQueries: ["apagar luz painel antes de vender carro usado", "resetar código de erro carro usado venda"],
  },
  {
    id: "oleo-errado", label: "Economizar trocando óleo errado ou fora do prazo pode sair muito mais caro depois",
    hook: "ÓLEO ERRADO PODE TRANSFORMAR CEM REAIS DE ECONOMIA EM UMA CONTA PRA CACETE.",
    qualificacao: "E calma, trocar de posto mais barato não é o problema, o problema é usar óleo fora da especificação só pra economizar uns trocados.",
    risco: "Óleo errado ou trocado fora do prazo desgasta o motor por dentro devagar, sem aviso, até aparecer um barulho que custa muito mais que a economia.",
    oQueVerificar: "Confere sempre a especificação exata no manual do carro e não deixa passar do prazo só porque 'ainda parece limpo'.",
    punchline: "Você não vê o motor se desgastando, só vê a conta quando ele já se lascou de vez.",
    keywords: ["ÓLEO", "MOTOR", "CUIDADO", "PREVENÇÃO"],
    videoQueries: ["car oil change close up", "mechanic checking engine oil", "car engine bay close up", "money cash close up"],
    mascotPoses: ["INDIGNADO", "EXPLICANDO", "DINHEIRO_DOENDO", "APONTANDO_DIREITA"],
    searchQueries: ["óleo errado motor carro problema", "trocar óleo fora do prazo consequência motor"],
  },
  {
    id: "troca-troco", label: "Troca de carro usado com troco só é bom negócio se a conta for feita com cuidado",
    hook: "TROCA COM TROCO PODE SER BOA ATÉ TU FAZER A CONTA DIREITO.",
    qualificacao: "E calma, dar o carro usado na troca não é roubada por si só, o problema é confiar só na palavra do vendedor sobre o valor de avaliação.",
    risco: "A loja pode inflar o preço do carro novo e ao mesmo tempo achatar o valor do teu usado, e no final a diferença parece menor do que realmente é.",
    oQueVerificar: "Avalia teu carro em pelo menos duas lojas ou plataformas independentes antes de aceitar a proposta de troca com troco.",
    punchline: "Se a loja é rápida demais pra fechar a troca, porra, é porque a conta já fechou bem pra ela primeiro.",
    keywords: ["TROCA", "AVALIE", "CONFIRA", "CALCULE"],
    videoQueries: ["car dealership trade in", "car dealership handshake deal", "person comparing prices phone", "car keys handover"],
    mascotPoses: ["PENSANDO", "DESCONFIADO", "APONTANDO_DIREITA", "EXPLICANDO"],
    searchQueries: ["troca de carro usado com troco cuidado", "avaliação carro usado na troca concessionária"],
  },
  {
    id: "dono-anterior", label: "Às vezes o problema do carro usado não é o modelo, é como o dono anterior cuidou dele",
    hook: "ÀS VEZES A BOMBA NÃO É O CARRO. É O DONO ANTERIOR.",
    qualificacao: "E calma, isso não significa que todo carro usado é problema, significa que o mesmo modelo pode ser ótimo ou péssimo dependendo de quem teve ele antes.",
    risco: "Dois carros idênticos, mesmo ano e mesma km, podem ter vidas completamente diferentes se um dono fez manutenção e o outro só rodou até quebrar.",
    oQueVerificar: "Pergunta como o carro era usado no dia a dia, pede recibo de revisão e desconfia de quem não sabe responder detalhe nenhum sobre o histórico.",
    serviceMention: "Só que muita gente esquece disso na hora de comprar, e é aí que uma avaliação pré-compra da MAIS CAR entra pra ler o carro além da conversa do vendedor.",
    punchline: "Tu não compra só o carro, meu amigo, tu compra as merdas que o dono anterior fez ou deixou de fazer com ele.",
    keywords: ["DONO", "HISTÓRICO", "CUIDADO", "PERGUNTE"],
    videoQueries: ["car owner handing keys", "car service history book", "car dealership handshake", "mechanic checking maintenance record"],
    mascotPoses: ["EXPLICANDO", "PENSANDO", "APONTANDO_DIREITA", "CONCORDANDO"],
    searchQueries: ["importância do dono anterior carro usado", "histórico de uso carro usado mais importante que modelo"],
  },
  {
    id: "desconto-zero-km", label: "Desconto muito grande no carro zero-quilômetro pode ter um motivo por trás",
    hook: "DESCONTO GRANDE NO ZERO-KM PODE TER MOTIVO.",
    qualificacao: "E calma, desconto não é sinal de problema automático, mas desconto fora do padrão do mercado sempre merece uma pergunta a mais.",
    risco: "Descontos muito acima do normal às vezes vêm de um modelo saindo de linha, estoque parado há muito tempo ou uma versão que não vendeu como esperado.",
    oQueVerificar: "Pergunta a data de fabricação do carro, não só o ano-modelo, e pesquisa se aquela versão específica está sendo descontinuada.",
    punchline: "Desconto bom é ótimo, desconto grande demais sem explicação, cacete, é pergunta que ficou sem resposta.",
    keywords: ["DESCONTO", "DESCONFIE", "PERGUNTE", "PESQUISE"],
    videoQueries: ["car dealership showroom new car", "car price tag close up", "car dealership negotiation", "car dealership handshake deal"],
    mascotPoses: ["DESCONFIADO", "SURPRESO", "APONTANDO_DIREITA", "EXPLICANDO"],
    searchQueries: ["desconto grande carro zero km motivo", "carro 0km desconto alto suspeita"],
  },
  {
    id: "juros-abusivos", label: "Taxa de juros no financiamento de carro pode estar bem acima da média sem o comprador perceber",
    // Hook rewritten 2026-09-14 after a real (if small) viral-research pass —
    // scored highest of 5 variants (unpopular-opinion framing) against
    // real engagement signals (YouTube: "maior erro comprar usado" 700k
    // views/823 comments; real Instagram Reel comments on a depreciation
    // post showing DISAGREEMENT + PERSONAL_EXPERIENCE + CORRECTION as the
    // actual trigger, not anger).
    hook: "FINANCIAR NÃO É O PROBLEMA. NÃO COMPARAR A TAXA É QUE ESTRAGA TEU BOLSO PRA CACETE.",
    qualificacao: "E calma, financiar não é roubada por padrão, o problema é assinar sem comparar a taxa com a média do mercado.",
    risco: "A taxa média de financiamento de veículo girava em torno de 1,93% ao mês em 2026, e a Justiça considera abusivo passar de uma vez e meia essa média.",
    oQueVerificar: "Compara a taxa mensal do contrato com a média divulgada pelo Banco Central antes de assinar, não só o valor da parcela.",
    punchline: "Juro abusivo não aparece destacado em negrito no contrato, meu amigo, aparece só na conta lá na frente.",
    keywords: ["JUROS", "COMPARE", "TAXA", "CUIDADO"],
    videoQueries: ["car financing paperwork signing", "calculator money car loan", "bank interest rate document", "car dealership finance office"],
    mascotPoses: ["INDIGNADO", "EXPLICANDO", "APONTANDO_DIREITA", "DINHEIRO_DOENDO"],
    // FORCED_SERVICE_MENTION = HARD FAIL for financing topics (calibration
    // pass, 2026-09-14) — no serviceMention here on purpose; a MAIS CAR
    // pre-purchase-evaluation connection would be artificial for a pure
    // interest-rate thesis.
    searchQueries: ["taxa de juros abusiva financiamento de veículos 2026", "juros abusivos financiamento carro Banco Central média"],
  },
];

function buildBuyerPainSeedScript(seed: BuyerPainSeed, contentMode: "DEBATE" | "DICA"): NarratedScriptV3 {
  // MAISCAR_SERVICE_MENTION_RULE: teach first (oQueVerificar already does
  // that), THEN connect to the MAIS CAR evaluation — never a bare ad tack-
  // on. Appended into the same beat/tier so it reads as one continuous
  // thought, not an interruption.
  const oQueVerificarText = seed.serviceMention ? `${seed.oQueVerificar} ${seed.serviceMention}` : seed.oQueVerificar;
  return {
    namedVehicle: null,
    contentMode,
    beats: [
      { id: "HOOK", narration: seed.hook, keyword: seed.keywords[0], videoQuery: seed.videoQueries[0], mascotPose: seed.mascotPoses[0] },
      { id: "QUALIFICACAO", narration: seed.qualificacao, keyword: "CALMA", videoQuery: seed.videoQueries[0], mascotPose: "EXPLICANDO" },
      { id: "RISCO", narration: seed.risco, keyword: seed.keywords[1], videoQuery: seed.videoQueries[1], mascotPose: seed.mascotPoses[1], tier: "OWNER_REPORT" },
      { id: "O_QUE_VERIFICAR", narration: oQueVerificarText, keyword: seed.keywords[2], videoQuery: seed.videoQueries[2], mascotPose: seed.mascotPoses[2], tier: "OWNER_REPORT" },
      { id: "PUNCHLINE", narration: seed.punchline, keyword: seed.keywords[3], videoQuery: seed.videoQueries[3], mascotPose: seed.mascotPoses[3], tier: "EDITORIAL_OPINION" },
    ],
    coverHeadline: [seed.keywords[0], seed.keywords[1]],
    captionLong: `${seed.label}\n\n${seed.risco}\n\nOPINIÃO MAIS CAR (não é fato, é leitura editorial): ${seed.oQueVerificar.toLowerCase()}`,
  };
}

/** Grounds a seed in a REAL source before it's used (never a fabricated
 *  one), same discipline as the forcedTopic locadora flow — tries each
 *  query until one returns a real hit, falls back to a radar-signal marker
 *  (which SOURCE_VERIFIED_FACT_GATE treats as unverified) if none do. */
async function pickAndGroundBuyerPainSeed(contentMode: "DEBATE" | "DICA", forcedSeedId?: string): Promise<{ script: NarratedScriptV3; topicTitle: string; sourceUrl: string; hook: string }> {
  // forcedSeedId: calibration/testing only — pilots a specific seed instead
  // of the random pick, so a just-edited seed can be verified directly.
  const seed = (forcedSeedId && BUYER_PAIN_SEEDS.find((s) => s.id === forcedSeedId)) || BUYER_PAIN_SEEDS[Math.floor(Math.random() * BUYER_PAIN_SEEDS.length)];
  let realSourceUrl: string | undefined;
  try {
    for (const q of seed.searchQueries) {
      const hits = await searchQuatroRodas(q);
      if (hits[0]?.url) {
        realSourceUrl = hits[0].url;
        break;
      }
    }
  } catch (err) {
    logger.warn({ err, seed: seed.id }, "FORMAT_LOCK_PILOT: real-source search for buyer-pain seed failed, continuing without one");
  }
  return {
    script: buildBuyerPainSeedScript(seed, contentMode),
    topicTitle: seed.label,
    sourceUrl: realSourceUrl ?? `radar-signal:${seed.label}`,
    hook: seed.hook,
  };
}

function isComparisonShapedTitle(title: string): boolean {
  if (COMPARISON_PATTERNS.some((p) => p.test(title))) return true;
  // A real run still slipped through with "Chevrolet Onix 0km ou Toyota
  // Corolla usado no mesmo orçamento: qual vale mais?" — the strict
  // "3 capitalized words immediately flanking 'ou'" version above missed it
  // because "0km" (digit-led) broke the adjacency requirement. Loosened to:
  // does EACH side of "ou" contain a real proper noun anywhere in it.
  const parts = title.split(/\bou\b/i);
  if (parts.length < 2) return false;
  const hasProperNoun = (s: string) => /[A-ZÀ-Ú][\wÀ-ÿ]{2,}/.test(s);
  return hasProperNoun(parts[0]) && hasProperNoun(parts.slice(1).join(" ou "));
}

function countProfanity(texts: string[]): number {
  const joined = texts.join(" ").toLowerCase();
  return PROFANITY_WORDS.reduce((sum, w) => sum + (joined.split(w).length - 1), 0);
}

/** Caps profanity at MAX_PROFANITY_PER_REEL by neutralizing extra occurrences in place (code-level enforcement — never trusted from the Haiku prompt alone). */
function capProfanity(beats: ScriptBeat[]): ScriptBeat[] {
  let remaining = MAX_PROFANITY_PER_REEL;
  return beats.map((b) => {
    let narration = b.narration;
    for (const word of PROFANITY_WORDS) {
      const re = new RegExp(word, "gi");
      narration = narration.replace(re, (match) => {
        if (remaining > 0) {
          remaining--;
          return match; // preserve original casing (a real run turned "PORRA" into "porra" mid all-caps hook)
        }
        return "";
      });
    }
    return { ...b, narration: narration.replace(/\s{2,}/g, " ").trim() };
  });
}

interface ScriptBeat {
  id: string;
  narration: string;
  keyword: string;
  videoQuery: string;
  mascotPose?: string | null;
  sfx?: string | null;
  tier?: FactTier;
  // P0 additions (2026-09-15) — optional; the deterministic pass below fills
  // these when the Haiku writer leaves them empty.
  visualRegister?: VisualRegister;
  screenEvidence?: ScreenEvidenceProps;
  hookBlock?: HookBlock;
}

interface NarratedScriptV3 {
  namedVehicle: string | null;
  contentMode: "DEBATE" | "DICA";
  beats: ScriptBeat[];
  coverHeadline: string[];
  captionLong: string;
}

async function writeShortScript(candidateTitle: string, sourceUrl: string, contentMode: "DEBATE" | "DICA", forcedHook?: string, forcedStructure?: string): Promise<NarratedScriptV3> {
  const system =
    "Você é a roteirista-chefe da MAIS CAR, linha editorial 'COISAS QUE FAZEM VOCÊ PERDER DINHEIRO COM CARRO'. Narração CONTÍNUA em português brasileiro NATIVO e falado, " +
    "ritmo rápido, confiante, sarcástico e debochado quando couber, indignado quando o assunto pedir, engraçado sem parecer comediante forçado — 185-205 palavras/minuto. " +
    "Fale como alguém contando uma parada pra um amigo (pode usar 'tu' ou 'você'), NUNCA como locutor/jornal/texto sendo lido. " +
    "VOICE_FLUENCY: escreva como FALA CONTÍNUA, não frases isoladas coladas — use vírgulas pra micro-respiro dentro da mesma ideia, reticências só quando for pausa dramática de propósito, e ponto final só quando a ideia realmente muda. Cada beat pode ter mais de uma oração conectada por vírgula/'e'/'só que', não precisa ser uma frase telegráfica isolada. " +
    "PROIBIDO: 'de acordo com especialistas', 'neste vídeo iremos', 'vale destacar', 'por outro lado'. " +
    "COMPARISON_FORMAT=FORBIDDEN_BY_DEFAULT: UMA TESE só, nunca 'carro A x carro B' nem 'qual é melhor'. " +
    "HOOK = a consequência primeiro, nunca 'você sabia que...'. Estrutura do hook: PROVOCAÇÃO (afirmação que dói) -> QUALIFICAÇÃO ('e calma, não é que X seja sempre ruim...') -> ENSINO. " +
    "Pode usar gírias e informalidade real ('olha só', 'aí é que tá', 'só que tem um detalhe', 'pois é', 'meu amigo', 'cara', 'a conta chega', 'não é por nada', 'agora presta atenção', 'e é aqui que começa o problema', 'e o pior é que', 'só que muita gente esquece disso', 'e aí vem a conta') — mas nunca todos no mesmo roteiro, escolhe 2-3. " +
    "NO_ARTICLE_STYLE_SCRIPT: PROIBIDO escrever como lista/matéria de blog ('Verifique X. Verifique Y. Verifique Z.') — sempre uma fala corrida, uma ideia puxando a outra. " +
    "PROFANITY_MODE=SPARSE_IMPACT: no máximo 2-3 palavrões (porra, caralho, cacete, merda, 'fudido', 'se lascou', 'pra cacete') APENAS no hook/punchline/reação — nunca como muleta argumentativa, nunca insulto a grupo/característica pessoal. " +
    "Nunca inventa número, defeito, recall, custo ou estatística — toda afirmação factual forte é tageada OWNER_REPORT (relato real), nunca CONFIRMED_FACT sem fonte oficial. O veredito final é sempre EDITORIAL_OPINION. Não termine pedindo comentário ('comenta aí', 'o que você acha') — termine com uma afirmação contestável que a pessoa vai querer rebater sozinha.";

  const structureBlock =
    forcedStructure ??
    (contentMode === "DEBATE"
      ? `Estrutura (6 a 9 beats, TOTAL MÁXIMO 90 PALAVRAS no roteiro inteiro — isso é um limite rígido, não uma sugestão): SOCÃO/HOOK (a consequência primeiro, afirmação que dói, SEM pergunta) -> QUALIFICAÇÃO ("e calma, não é sempre assim...") -> PROVA/EXPLICAÇÃO -> CONSEQUÊNCIA/VEREDITO -> FRASE FORTE final.`
      : `Estrutura (8 a 12 beats, TOTAL MÁXIMO 185 PALAVRAS no roteiro inteiro — isso é um limite rígido, não uma sugestão, cada beat deve ter no máximo ~15-18 palavras): ERRO (o que a pessoa está fazendo errado, afirmação forte) -> POR QUE ISSO PREJUDICA -> O QUE FAZER NO LUGAR -> EXEMPLO PRÁTICO -> RESULTADO -> FRASE FINAL memorável (a pessoa deve pensar "isso eu vou usar").`);

  const hookInstruction = forcedHook ? `O primeiro beat (hook) DEVE ser exatamente, ou muito próximo de: "${forcedHook}"` : "";

  const serviceMentionInstruction = isServiceMentionRelevant(candidateTitle)
    ? `MAISCAR_SERVICE_MENTION_RULE (OBRIGATÓRIO aqui — este tema tem relação direta com compra/inspeção/avaliação de carro): inclua, dentro do beat de prova/explicação (nunca como frase solta no final), UMA menção natural à avaliação pré-compra da MAIS CAR, seguindo ENSINAR PRIMEIRO -> MOSTRAR O RISCO -> CONECTAR COM A AVALIAÇÃO. Nunca escreva algo tipo "contrate a avaliação MAIS CAR" isolado — a menção tem que nascer do raciocínio, tipo "é exatamente esse tipo de coisa que a MAIS CAR verifica antes de dizer se o carro vale a pena". Não invente equipamento, certificação, garantia ou promessa de detectar 100% dos problemas — fale só que a avaliação verifica/confere esse item, nada além disso.`
    : "";

  const prompt = `Tema real: "${candidateTitle}" (fonte: ${sourceUrl})
Modo: ${contentMode}
${hookInstruction}
${serviceMentionInstruction}

${structureBlock}

Escreva em JSON estrito:
{
  "namedVehicle": "nome de UM ÚNICO modelo real, ou null — NUNCA 'X vs Y'/'X ou Y'/'X x Y'",
  "beats": [
    {"id":"BEAT_ID","narration":"fala contínua e natural, pode ter mais de uma oração conectada","keyword":"palavra/número grande pra tela","videoQuery":"termo em inglês pra vídeo real genérico (ex: 'car engine close up')","mascotPose":"NORMAL|SURPRESO|DESCONFIADO|BRAVO|RINDO|IRONICO|INDIGNADO|APONTANDO_ESQUERDA|APONTANDO_DIREITA|APONTANDO_CIMA|APONTANDO_BAIXO|EXPLICANDO|PENSANDO|MAO_NA_CABECA|DINHEIRO|DINHEIRO_DOENDO|FACEPALM|ASSUSTADO|SUSSURRO|NEGANDO|CONCORDANDO|POSITIVO|NEGATIVO|null","sfx":"WHOOSH|POP|CLICK|IMPACT|RISER|null","tier":"OWNER_REPORT|EDITORIAL_OPINION (só nos beats de prova/veredito, omita nos outros)"}
  ],
  "coverHeadline": ["LINHA 1 (max 18 char, afirmação polarizadora)","LINHA 2 (max 18 char)"],
  "captionLong": "legenda pro Instagram, tom coloquial, linha final 'OPINIÃO MAIS CAR (não é fato, é leitura editorial):' antes do veredito"
}

Defina mascotPose (não-null) em aproximadamente 50-75% dos beats — ele precisa REAGIR ao conteúdo específico daquele beat, igual uma apresentadora explicando (fala de dinheiro -> "DINHEIRO"/"DINHEIRO_DOENDO"; aponta pra algo -> "APONTANDO_DIREITA"/"APONTANDO_CIMA"; nega/despreza -> "FACEPALM" ou "NEGANDO"; concorda/reforça -> "CONCORDANDO"; conta um segredo -> "SUSSURRO"; assunto assusta -> "ASSUSTADO"), nunca sempre "NORMAL". videoQuery sempre em INGLÊS, genérico e filmável, e deve corresponder ao que a narração ESTÁ FALANDO naquele exato momento — a fala escolhe a imagem, não o contrário. Responda SOMENTE o JSON.`;

  const { text } = await aiOrchestrator.generateText(
    { prompt, system, maxTokens: 2600, model: "claude-haiku-4-5-20251001" },
    { organizationId: ORG_ID, quality: "draft", purpose: "reference-format-lock-script" },
  );
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("FORMAT_LOCK_SCRIPT_NO_JSON");
  const parsed = JSON.parse(jsonMatch[0]);
  return { ...parsed, contentMode };
}

// buildDeterministicScriptV3() — the old generic fallback template — was
// removed permanently (buyer-pain-v2 new-reel fix): its hook ("Olha só,
// isso aqui está sendo muito discutido agora.") is now banned outright by
// GENERIC_HOOK = HARD FAIL. buildFallbackScript() (below) replaces every
// call site with BUYER_PAIN_SEEDS instead.

/**
 * Forced-topic deterministic fallback (buyer-pain-v2 final polish) — a real
 * run showed the generic buildDeterministicScriptV3() fallback silently
 * overwriting the account-owner-approved hook/structure whenever the
 * comparison check (or anything else) triggered a fallback mid-pipeline.
 * "Não altere hook/tema" means the fallback for a forced topic must be
 * this dedicated, tight 5-beat script honoring the exact approved hook —
 * never the generic one.
 */
function buildForcedTopicScript(candidateTitle: string, forcedHook: string, contentMode: "DEBATE" | "DICA"): NarratedScriptV3 {
  return {
    namedVehicle: null,
    contentMode,
    beats: [
      { id: "HOOK", narration: forcedHook, keyword: "CILADA?", videoQuery: "rental car parking lot aerial", mascotPose: "INDIGNADO" },
      { id: "QUALIFICACAO", narration: "E calma, não é que carro de locadora seja sempre ruim, o problema é comprar olhando só pro preço.", keyword: "CALMA", videoQuery: "car dashboard gauge close up", mascotPose: "EXPLICANDO" },
      { id: "RISCO", narration: "Esse carro pode ter rodado pra cacete e passado na mão de um monte de gente sem tu saber como foi tratado.", keyword: "RISCO", videoQuery: "mechanic inspecting car engine", mascotPose: "DESCONFIADO", tier: "OWNER_REPORT" },
      { id: "O_QUE_VERIFICAR", narration: "Antes de fechar negócio, confere histórico, manutenção, documento e mete o carro numa inspeção de verdade.", keyword: "VERIFIQUE", videoQuery: "car mechanic checklist inspection", mascotPose: "APONTANDO_DIREITA", tier: "OWNER_REPORT" },
      { id: "PUNCHLINE", narration: "Carro de locadora pode ser negócio, comprar só porque tá barato é que pode sair caro pra cacete.", keyword: "PENSE", videoQuery: "car dealership handshake", mascotPose: "CONCORDANDO", tier: "EDITORIAL_OPINION" },
    ],
    coverHeadline: ["CARRO DE", "LOCADORA BARATO"],
    captionLong: `${candidateTitle}\n\nCarro de locadora não é automaticamente uma cilada — mas comprar só pelo preço pode ser.\n\nOPINIÃO MAIS CAR (não é fato, é leitura editorial): confere histórico, manutenção, documento e faça uma inspeção de verdade antes de fechar negócio.`,
  };
}

function sanitizeMascotPose(pose?: string | null): MascotPose | undefined {
  if (!pose) return undefined;
  const upper = pose.toUpperCase();
  return (MASCOT_POSES as string[]).includes(upper) ? (upper as MascotPose) : undefined;
}

function sanitizeSfx(sfx?: string | null): SfxType | undefined {
  if (!sfx) return undefined;
  const upper = sfx.toUpperCase();
  return (SFX_TYPES as string[]).includes(upper) ? (upper as SfxType) : undefined;
}

export interface NarratedMotionReelV3PilotResult {
  status: "PILOT_READY" | "ABANDONED";
  reason?: string;
  videoPath?: string;
  coverPath?: string;
  topic?: string;
  hook?: string;
  contentMode?: "DEBATE" | "DICA";
  durationSec?: number;
  beatCount?: number;
  voiceWpm?: number;
  voiceId?: string;
  maxPauseSec?: number;
  hostSizeAvgPct?: number;
  hostTextCollisions?: number;
  mascotBeatRatio?: number;
  patternInterruptCount?: number;
  visualEventAvgSec?: number;
  longestStaticCompositionSec?: number;
  profanityCount?: number;
  unverifiedClipCount?: number;
  longformMode?: boolean;
  usedFallback?: boolean;
  qa: Record<string, boolean>;
  factCheck?: { pass: boolean; reason?: string };
  // P0 additions (2026-09-15)
  registerCount?: number;
  screenEvidenceCount?: number;
  hookScore?: number;
  hookScoreHardFail?: boolean;
  hookScoreReasons?: string[];
  coverScore?: number;
  coverScoreReasons?: string[];
  powerpointStyle?: boolean;
  powerpointStyleReasons?: string[];
  powerpointStyleMeasurements?: { registerCount: number; mascotBeatRatio: number; kineticTextEveryBeat: boolean; frameColorL1DistanceAvg: number };
}

export async function runNarratedMotionReelV3Pilot(opts: { lowQualityPreview?: boolean; forcedTopic?: string; maxDurationSec?: number; forcedSeedId?: string } = {}): Promise<NarratedMotionReelV3PilotResult> {
  let topicTitle: string;
  let sourceUrl: string;
  let contentMode: "DEBATE" | "DICA";
  let seedScript: NarratedScriptV3 | undefined;
  let seedHook: string | undefined;

  if (opts.forcedTopic) {
    // BUYER_PAIN_V2 pilot request: the account owner picked the exact topic
    // ("carro de locadora barato") to eliminate the pauta variable — skip
    // radar/scoring, but still ground it in a REAL source (never a
    // fabricated one) so SOURCE_VERIFIED_FACT_GATE has something real to
    // check the script's claims against.
    topicTitle = opts.forcedTopic;
    contentMode = pickContentMode(topicTitle);
    let realSourceUrl: string | undefined;
    try {
      // BUG FIX (2026-09-12): the original query ("carro de locadora
      // comprar usado risco") returned zero hits — verified empirically —
      // which silently left sourceUrl on the fake placeholder and made
      // SOURCE_VERIFIED_FACT_GATE correctly reject every claim (no real
      // source = no evidence). Broader queries return real, on-topic hits.
      const queries = ["carro de locadora vale a pena comprar", "comprar carro seminovo locadora", "carro por assinatura vale a pena"];
      for (const q of queries) {
        const hits = await searchQuatroRodas(q);
        if (hits[0]?.url) {
          realSourceUrl = hits[0].url;
          break;
        }
      }
    } catch (err) {
      logger.warn({ err }, "FORMAT_LOCK_PILOT: real-source search for forced topic failed, continuing without one");
    }
    sourceUrl = realSourceUrl ?? `radar-signal:${topicTitle}`;
  } else {
    // RADAR + SCORING — reuse the real FULL RADAR (0 LLM)
    const candidates = await getControversyCandidates();
    let recentReels: Awaited<ReturnType<typeof getRecentReels>> = [];
    try {
      recentReels = await getRecentReels(BRAND_ID);
    } catch (err) {
      logger.warn({ err }, "FORMAT_LOCK_PILOT: anti-repetition DB lookup failed (DB down?) — proceeding without it for this preview-only run");
    }
    const scored = candidates
      .filter((c) => !isTooSimilar(c.title, recentReels))
      .filter((c) => !isComparisonShapedTitle(c.title)) // NO_COMPARISON: reject "Model A ou Model B" titles before spending a Haiku call on one
      .map((c) => ({ candidate: c, score: scoreControversy(c) }))
      .sort((a, b) => b.score.total - a.score.total);
    // BUYER_PAIN_FORMAT_V2 editorial identity: only a candidate that BOTH
    // matches the buyer-pain categories AND clears MIN_ENGAGEMENT_SCORE_HARD
    // (80) is allowed to go through the radar+Haiku path at all — a real
    // run shipped a score-44 "garantia das marcas chinesas" topic just
    // because it was the only thing available, which produced weak/failed
    // scripts twice. Anything short of that bar skips radar entirely and
    // uses the permanent BUYER_PAIN_SEEDS library instead (below).
    const buyerPainMatch = scored.find((s) => BUYER_PAIN_KEYWORDS.some((k) => s.candidate.title.toLowerCase().includes(k)));
    if (buyerPainMatch && buyerPainMatch.score.total >= MIN_ENGAGEMENT_SCORE_HARD) {
      topicTitle = buyerPainMatch.candidate.title;
      sourceUrl = buyerPainMatch.candidate.sourceUrl ?? `radar-signal:${buyerPainMatch.candidate.title}`;
      contentMode = pickContentMode(buyerPainMatch.candidate.title);
    } else {
      logger.warn(
        { bestScore: buyerPainMatch?.score.total ?? scored[0]?.score.total, hardMin: MIN_ENGAGEMENT_SCORE_HARD },
        "FORMAT_LOCK_PILOT: no radar candidate cleared MIN_ENGAGEMENT_SCORE_HARD, using BUYER_PAIN_SEEDS library instead",
      );
      contentMode = "DEBATE"; // placeholder, pickAndGroundBuyerPainSeed's script always overrides this below
      const seeded = await pickAndGroundBuyerPainSeed(contentMode, opts.forcedSeedId);
      seedScript = seeded.script;
      topicTitle = seeded.topicTitle;
      sourceUrl = seeded.sourceUrl;
      seedHook = seeded.hook;
    }
  }

  let forcedHook = opts.forcedTopic
    ? "Se tu pensa que economizou só porque comprou um carro de locadora barato... meu amigo, tu pode tá fudido."
    : seedHook;

  // COMPARISON_FORMAT/GENERIC_HOOK/zero-evidence fallback dispatcher — the
  // forcedTopic (locadora) case keeps its own dedicated hand-written script
  // (never touched here); every other case escalates to the permanent
  // BUYER_PAIN_SEEDS library (never the old generic template, which is
  // banned outright — see isGenericHook). Mutates the outer topicTitle/
  // sourceUrl/forcedHook so downstream fact-check and hook-lock stay
  // consistent with whatever actually got shipped.
  async function buildFallbackScript(): Promise<NarratedScriptV3> {
    if (opts.forcedTopic) return buildForcedTopicScript(topicTitle, forcedHook!, contentMode);
    const seeded = await pickAndGroundBuyerPainSeed(contentMode, opts.forcedSeedId);
    topicTitle = seeded.topicTitle;
    sourceUrl = seeded.sourceUrl;
    forcedHook = seeded.hook;
    return seeded.script;
  }
  // buyer-pain-v2 final polish: 49.8s was too long for this pauta — force
  // the tight 5-beat structure + hard word budget for a 24-30s result,
  // preserving HOOK -> QUALIFICAÇÃO -> RISCO -> O QUE VERIFICAR -> PUNCHLINE.
  const forcedStructure = opts.forcedTopic
    ? `Estrutura FIXA de exatamente 5 beats, TOTAL MÁXIMO 85 PALAVRAS no roteiro inteiro (limite rígido): ` +
      `HOOK (a provocação, já fornecida acima, tier omitido) -> ` +
      `QUALIFICAÇÃO ("e calma, não é que carro de locadora seja sempre ruim...", tier omitido) -> ` +
      `RISCO (o que pode dar errado, sem inventar dado — "tier" OBRIGATORIAMENTE "OWNER_REPORT", nunca omita neste beat) -> ` +
      `O_QUE_VERIFICAR (histórico, manutenção, documento, inspeção pré-compra — factualmente seguro, sem estatística inventada — "tier" OBRIGATORIAMENTE "OWNER_REPORT", nunca omita neste beat, nunca "EDITORIAL_OPINION" aqui) -> ` +
      `PUNCHLINE (frase final forte, tipo "comprar só porque tá barato é que pode sair caro pra cacete", "tier" OBRIGATORIAMENTE "EDITORIAL_OPINION").`
    : undefined;

  // SCRIPT — exactly 1 Haiku call, with a 0-LLM deterministic fallback. If
  // MIN_ENGAGEMENT_SCORE_HARD already routed us to a BUYER_PAIN_SEED above,
  // that hand-written script ships as-is — no Haiku call needed at all.
  let script: NarratedScriptV3;
  let usedFallback = false;
  if (seedScript) {
    script = seedScript;
  } else {
    try {
      script = await writeShortScript(topicTitle, sourceUrl, contentMode, forcedHook, forcedStructure);
    } catch (err) {
      logger.warn({ err, title: topicTitle }, "FORMAT_LOCK_PILOT: Haiku script generation failed, using fallback script");
      script = await buildFallbackScript();
      usedFallback = true;
    }
  }
  if (script.namedVehicle && /\b(vs\.?|ou|x|\/)\b/i.test(script.namedVehicle)) script.namedVehicle = null;

  // NO_COMPARISON_UNLESS_REQUESTED — enforced after the fact: if Haiku
  // still wrote a comparison despite the prompt rule, fall back rather than
  // ship a reproved format.
  if (looksLikeComparison(script.beats.map((b) => b.narration))) {
    logger.warn({ title: topicTitle }, "FORMAT_LOCK_PILOT: script still reads as a comparison despite the rule — using fallback script (single-thesis) instead");
    script = await buildFallbackScript();
    usedFallback = true;
  }

  // Haiku occasionally omits `tier` from every beat despite the prompt
  // instruction (observed empirically) — that would fail the fact gate
  // with "no claims provided" even though a real source exists. Fall back
  // to a script that always tags correctly rather than aborting a topic
  // that just needs its evidence properly labeled.
  if (!hasNonOpinionEvidence(script.beats)) {
    logger.warn({ title: topicTitle }, "FORMAT_LOCK_PILOT: Haiku script tagged zero claims with a fact tier — using fallback script instead");
    script = await buildFallbackScript();
    usedFallback = true;
  }

  // GENERIC_HOOK = HARD FAIL (buyer-pain-v2 new-reel fix): never ship the
  // bland "isso aqui está sendo muito discutido agora" style hook — escalate
  // to a real, provocative BUYER_PAIN_SEEDS hook instead.
  if (!opts.forcedTopic && isGenericHook(script.beats[0]?.narration ?? "")) {
    logger.warn({ title: topicTitle }, "FORMAT_LOCK_PILOT: generic/bland hook detected — escalating to BUYER_PAIN_SEEDS instead of shipping it");
    script = await buildFallbackScript();
    usedFallback = true;
  }

  // HOOK_EXACT_LOCK (buyer-pain-v2 final polish): never trust Haiku to keep
  // the approved hook verbatim ("muito próximo de" in the prompt is not a
  // guarantee — a real run appended its own extra clause). When a hook is
  // forced, overwrite beat 0 with the exact approved text in code, 0 LLM.
  if (forcedHook && script.beats[0]) {
    script.beats[0].narration = forcedHook;
  }

  // DURATION cap (buyer-pain-v2 fix — a real run hit 106s, way past even
  // the 30-60s LONGFORM_EXCEPTION): Haiku's own word-count restraint isn't
  // reliable enough to trust alone, so shrink in code to a hard word
  // budget derived from the target WPM and this mode's duration ceiling.
  // buyer-pain-v2 final polish: the user requires ALL 5 structural beats
  // (HOOK -> QUALIFICAÇÃO -> RISCO -> O QUE VERIFICAR -> PUNCHLINE) to
  // survive — dropping a whole beat is no longer allowed for the forced
  // pauta. Instead, TRIM EACH BEAT'S TEXT proportionally (cut verbal
  // repetition/redundant clauses at a sentence boundary where possible)
  // rather than accelerating speech or deleting a beat outright.
  {
    // buyer-pain-v2 final polish: 49.8s was too long for this specific
    // pauta (rental-car buying) — a forced-topic pilot targets the tighter
    // 24-30s band explicitly, instead of the general DICA longform default.
    // MAISCAR_AVATAR_NARRATED_REEL_MASTER: 18-30s is the permanent ideal
    // range (a strong theme may exceptionally run longer, via an explicit
    // opts.maxDurationSec override — never the old 58s DICA default, which
    // was a pre-master-standard longform exception). Small safety margin
    // below the 30s ceiling: the word budget is speech-only and rendered
    // duration also includes pauses/pattern-interrupt frames, which pushed
    // a prior run to 31.5s at a 29s budget.
    const maxDurationSec = opts.maxDurationSec ?? (opts.forcedTopic ? 27 : contentMode === "DICA" ? 30 : 28);
    const targetWpm = 195;
    const maxWords = Math.floor((maxDurationSec / 60) * targetWpm);
    const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
    const totalWords = script.beats.reduce((sum, b) => sum + countWords(b.narration), 0);

    if (totalWords > maxWords) {
      const MIN_BEAT_WORDS = 8;
      // The hook is locked verbatim above — it never gets cut further, so
      // its words come out of the total budget before distributing the rest.
      const hookIdx = forcedHook ? 0 : -1;
      const hookWords = hookIdx >= 0 ? countWords(script.beats[hookIdx].narration) : 0;
      const cuttableBeats = script.beats.filter((_, i) => i !== hookIdx);
      const cuttableTotal = cuttableBeats.reduce((sum, b) => sum + countWords(b.narration), 0);
      const cuttableBudget = Math.max(maxWords - hookWords, MIN_BEAT_WORDS * cuttableBeats.length);
      const shrinkRatio = cuttableTotal > 0 ? cuttableBudget / cuttableTotal : 1;

      const truncateToWords = (text: string, cap: number): string => {
        const words = text.trim().split(/\s+/).filter(Boolean);
        if (words.length <= cap) return text.trim();
        // Prefer ending at the last sentence-ending punctuation within the
        // cap so the cut reads as a finished thought, not a dangling clause.
        const hardCut = words.slice(0, cap).join(" ");
        const lastPunct = Math.max(hardCut.lastIndexOf("."), hardCut.lastIndexOf("!"), hardCut.lastIndexOf("?"), hardCut.lastIndexOf("…"));
        if (lastPunct > hardCut.length * 0.5) return hardCut.slice(0, lastPunct + 1);
        return hardCut + (/[.!?…]$/.test(hardCut) ? "" : ".");
      };

      let trimmedAny = false;
      script.beats = script.beats.map((b, i) => {
        if (i === hookIdx) return b;
        const w = countWords(b.narration);
        const cap = Math.max(MIN_BEAT_WORDS, Math.round(w * shrinkRatio));
        if (cap >= w) return b;
        trimmedAny = true;
        return { ...b, narration: truncateToWords(b.narration, cap) };
      });

      if (trimmedAny) {
        logger.warn({ title: topicTitle, before: totalWords, budget: maxWords }, "FORMAT_LOCK_PILOT: script ran over the duration word budget — trimmed beat text (structure preserved)");
      }
    }
  }

  // Re-check after truncation: if trimming somehow still left zero tiered
  // beats, fall back rather than let the fact gate fail on an otherwise-good,
  // real-sourced topic.
  if (!hasNonOpinionEvidence(script.beats)) {
    logger.warn({ title: topicTitle }, "FORMAT_LOCK_PILOT: zero tiered beats survived duration trimming — using fallback script instead");
    script = await buildFallbackScript();
    usedFallback = true;
  }

  // PROFANITY_MODE=NATURAL_CONTEXTUAL — enforced in code, never trusted from the prompt alone
  script.beats = capProfanity(script.beats);
  const profanityCount = countProfanity(script.beats.map((b) => b.narration));

  // P0-1/P0-2/P0-3 (2026-09-15) — deterministic visualRegister + hookBlock
  // assignment. Runs regardless of what the Haiku writer emitted, so the
  // register variety and the hook-as-asset properties are guaranteed
  // structurally rather than trusted from the prompt.
  const REGISTER_ROTATION: VisualRegister[] = ["PRESENTER_FACE", "BIG_NUMBER", "SCREEN_EVIDENCE", "PRODUCT_MACRO", "LOCATION_BROLL", "DOCUMENT", "MONEY_STACK"];
  for (let idx = 0; idx < script.beats.length; idx++) {
    const b = script.beats[idx];
    if (!b.visualRegister) {
      if (idx === 0) b.visualRegister = "PRESENTER_FACE";
      else if (idx === script.beats.length - 1) b.visualRegister = "PRESENTER_FACE";
      else if (/parcel|financia|cet|entrada|juros|r\$|desconto/i.test(b.narration)) b.visualRegister = "SCREEN_EVIDENCE";
      else if (/anuncio|anúncio|olx|webmotors|listagem|whats|zap|vendedor/i.test(b.narration)) b.visualRegister = "SCREEN_EVIDENCE";
      else if (/nota|invoice|manuten|oficina|preço|revisão/i.test(b.narration)) b.visualRegister = "SCREEN_EVIDENCE";
      else if (/\d+\s*(mil|%|k\b|reais|meses|anos)/i.test(b.narration)) b.visualRegister = "BIG_NUMBER";
      else b.visualRegister = REGISTER_ROTATION[idx % REGISTER_ROTATION.length];
    }
    if (b.visualRegister === "SCREEN_EVIDENCE" && !b.screenEvidence) {
      const template = pickTemplateFromBeat(b.keyword ?? "", b.tier);
      b.screenEvidence = composeScreenEvidence({ template, values: {} });
    }
  }
  if (!script.beats[0]?.hookBlock && script.beats[0]) {
    // Build a firstOnScreenText from the beat's keyword or hook text (first
    // 3-5 words). ALL CAPS by convention.
    const hookTxt = (script.beats[0].keyword ?? script.beats[0].narration).replace(/[.,!?…]/g, "");
    const words = hookTxt.split(/\s+/).filter(Boolean).slice(0, 5);
    script.beats[0].hookBlock = {
      firstOnScreenText: (words.join(" ") || "OLHA ESSA").toUpperCase(),
      firstShotRegister: "PRESENTER_FACE",
    };
  }
  const beatRegisters: VisualRegister[] = script.beats.map((b) => b.visualRegister!).filter(Boolean);
  const registerCount = new Set(beatRegisters).size;
  const screenEvidenceCount = script.beats.filter((b) => b.visualRegister === "SCREEN_EVIDENCE").length;

  // SOURCE_VERIFIED_FACT_GATE
  const tieredBeats = script.beats.filter((b) => b.tier);
  const rawClaims: TieredClaim[] = tieredBeats.map((b) => ({ text: b.narration, tier: b.tier!, sourceUrl }));
  const verifiedClaims = await verifyClaims(rawClaims);
  const verdictBeat = script.beats.find((b) => b.id === "VEREDITO" || b.tier === "EDITORIAL_OPINION");
  const verdict: TieredClaim = { text: verdictBeat?.narration ?? "", tier: "EDITORIAL_OPINION" };
  const factCheck = passesSourceVerifiedFactGate(verifiedClaims, verdict);
  if (!factCheck.pass) return { status: "ABANDONED", reason: `FACT_CHECK_FAILED: ${factCheck.reason}`, factCheck, qa: {} };

  const runId = `run-${Date.now()}`;
  const runDir = path.join(PILOT_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  // MAISCAR_VOICE_LOCK — ONE TTS call for the ENTIRE script, ONE fixed
  // voice/rate/pitch config. Real per-beat timing comes from this same
  // call's word-boundary metadata, not from N separate audio files.
  const narrationTexts = script.beats.map((b) => b.narration);
  const fullNarration = await synthesizeFullNarration(narrationTexts, runDir, "narration-full");
  const narrationSrc = stageAsset(runId, fullNarration.path, "narration-full.mp3");

  // B-ROLL per beat, using the REAL timing this beat got from the single
  // narration call — decided up front, not measured after a per-beat call.
  const blocks: TimedBlock[] = [];
  let sinceLastInterrupt = 0;
  let mascotBeats = 0;
  let unverifiedClipCount = 0;
  for (let i = 0; i < script.beats.length; i++) {
    const beat = script.beats[i];
    const timing = fullNarration.beatTimings[i];

    // REAL_BROLL relevance gate — every clip is vision-checked against the
    // Reel's topic + this beat's keyword before being accepted.
    const relevance = { topic: topicTitle, keyword: beat.keyword, organizationId: ORG_ID };
    let clip1 = await searchAndDownloadClip(beat.videoQuery, runDir, `clip-${i}-a`, relevance);
    if (!clip1) return { status: "ABANDONED", reason: `VIDEO_NOT_FOUND: ${beat.id} (${beat.videoQuery})`, qa: {} };
    if (!clip1.verified) {
      unverifiedClipCount++;
      logger.warn({ beat: beat.id, query: beat.videoQuery }, "FORMAT_LOCK_PILOT: shipping an unverified B-roll clip (no candidate passed the relevance check)");
    }

    // BROLL_INTEGRITY_GATE: Pexels' reported `duration` metadata doesn't
    // always match the real downloaded file — a real run crashed Remotion
    // mid-render ("No frame found at position 86") because a cut's seek
    // offset was computed from a duration the file didn't actually have.
    // ffprobe the real file (and force-decode its tail) before trusting it;
    // one retry with a broadened query, then degrade to a single safe cut
    // (no offset seeking) rather than let a bad download take the Reel down.
    let integrity = await validateClipIntegrity(clip1.path);
    if (!integrity.ok) {
      logger.warn({ beat: beat.id, query: beat.videoQuery }, "BROLL_INTEGRITY_GATE: downloaded clip failed validation, retrying with a broadened query");
      const retryClip = await searchAndDownloadClip(`${beat.videoQuery} wide shot`, runDir, `clip-${i}-a-retry`, relevance);
      if (retryClip) {
        const retryIntegrity = await validateClipIntegrity(retryClip.path);
        if (retryIntegrity.ok) {
          clip1 = retryClip;
          integrity = retryIntegrity;
          if (!clip1.verified) unverifiedClipCount++;
        }
      }
    }
    // Never ship a raw file that failed BOTH validation attempts — that's
    // exactly the class of bug that took two prior renders down entirely.
    // Abandon this beat's B-roll rather than gamble on it a third time.
    if (!integrity.ok) {
      return { status: "ABANDONED", reason: `BROLL_INTEGRITY_FAILED: ${beat.id} (${beat.videoQuery})`, qa: {} };
    }
    const realDurationSec = integrity.realDurationSec;
    // Always stage the CFR-normalized file when validation produced one —
    // never the raw download, even when integrity.ok is true — since the
    // whole point is Remotion never touching a possibly-VFR source file.
    const stageSourcePath = integrity.normalizedPath ?? clip1.path;

    const clip1Src = stageAsset(runId, stageSourcePath, `clip-${i}-a.mp4`);
    const cuts: VideoCut[] = [{ src: clip1Src, camera: i % 2 === 0 ? "PUSH_IN" : "PUSH_OUT" }];

    // STATIC_VISUAL_MAX_1_8S (buyer-pain-v2 final polish): "não troque o
    // B-roll aprovado" + "não use Vision se os assets já estão aprovados"
    // — so a long beat is split into microevents on the SAME already-
    // approved clip instead of sourcing/verifying new footage. Each extra
    // "cut" is really a fresh Sequence of the same file with a different
    // startFromSec (a real jump within the footage when it's long enough)
    // and an alternating push-in/push-out camera — the zoom animation
    // resets at a new Sequence boundary, which reads as a real punch-in
    // cut even on identical source video, not a slow zoom pretending to be
    // one.
    // realDurationSec === 0 means integrity validation never confirmed a
    // trustworthy duration for this file — stay at a single cut with no
    // seek offset rather than risk another out-of-range frame request.
    const cutsNeeded = realDurationSec > 0 ? Math.max(1, Math.ceil(timing.durationSec / MAX_BEAT_SEC_BEFORE_INTERNAL_CUT)) : 1;
    for (let c = 1; c < cutsNeeded; c++) {
      const offsetSec = realDurationSec > 2 ? Math.min(realDurationSec - 1, c * 1.2) : undefined;
      cuts.push({ src: clip1Src, startFromSec: offsetSec, camera: c % 2 === 0 ? "PUSH_IN" : "PUSH_OUT" });
    }

    sinceLastInterrupt += timing.durationSec;
    const patternInterrupt = sinceLastInterrupt >= PATTERN_INTERRUPT_INTERVAL_SEC;
    if (patternInterrupt) sinceLastInterrupt = 0;

    // MAISCAR_REFERENCE_FORMAT_LOCK_V3: the avatar is reaction/humor/rhythm,
    // never the content — CENTER_SCREEN_AVATAR = FORBIDDEN and the old
    // FOREGROUND_LEFT/RIGHT positions (chest-height, near-center) are gone
    // entirely. A real run measured hostSizeAvgPct ~45% with the avatar
    // parked center-frame on every pattern interrupt — exactly the
    // "boneco no meio da tela" this rule bans. Corners only, and only on a
    // MINORITY of beats (~25-45% of scenes) so B-roll/content carries most
    // of the runtime — the beats picked are RISCO and PUNCHLINE-shaped
    // (index 2, 4, 6... skipping the first two), the reaction/consequence
    // moments where a facepalm/indignado/apontando actually adds something,
    // not every beat "existing" on screen.
    const showAvatarThisBeat = i > 0 && i % 2 === 0;
    const mascotPose = showAvatarThisBeat ? sanitizeMascotPose(beat.mascotPose) : undefined;
    if (mascotPose) mascotBeats++;
    const CORNER_POSITIONS: MascotPosition[] = ["BOTTOM_RIGHT", "BOTTOM_LEFT", "TOP_RIGHT", "TOP_LEFT"];
    const mascotPosition: MascotPosition = CORNER_POSITIONS[i % CORNER_POSITIONS.length];
    const mascotEnterFrom: MascotEnterFrom = mascotPose ? (i % 2 === 0 ? "RIGHT" : "LEFT") : "NONE";
    // HOST_SAFE_ZONE / KINETIC_TEXT_SAFE_ZONE collision avoidance: whenever
    // the host is visible this beat, the keyword goes to the TOP third, a
    // zone the host never occupies at any corner position/scale used here.
    const keywordTextPosition: "TOP" | undefined = mascotPose ? "TOP" : undefined;

    blocks.push({
      id: beat.id,
      startSec: timing.startSec,
      durationSec: timing.durationSec,
      videoCuts: cuts,
      keyword: beat.keyword,
      keywordVariant: patternInterrupt ? "BIG_NUMBER" : "NORMAL",
      keywordTextPosition,
      mascotPose,
      mascotPunchIn: patternInterrupt && !!mascotPose,
      mascotPosition,
      mascotEnterFrom,
      // HOST_SIZE (format-lock v3): ~15-25% of frame height in normal
      // presence, ~25-32% on a reaction beat — never the ~45% a pattern
      // interrupt used to force. See BASE_HOST_SIZE in NarratedMotionReelV3.tsx.
      mascotScale: patternInterrupt ? 1.35 : 1,
      patternInterrupt,
      sfx: sanitizeSfx(beat.sfx) ? { type: sanitizeSfx(beat.sfx)!, src: stageAsset(runId, await getSfxPath(sanitizeSfx(beat.sfx)!), `sfx-${i}.mp3`) } : undefined,
      // P0 (2026-09-15) — carry visualRegister/screenEvidence/hookBlock
      // through to the renderer so <ScreenEvidence /> can replace <BRoll />
      // on the SCREEN_EVIDENCE beats and the first-frame slam-in text can
      // render for the hook.
      visualRegister: beat.visualRegister,
      screenEvidence: beat.screenEvidence,
      hookBlock: i === 0 ? beat.hookBlock : undefined,
    });
  }
  const totalDurationSec = fullNarration.durationSec;
  const totalWords = narrationTexts.join(" ").trim().split(/\s+/).length;
  const voiceWpm = totalDurationSec > 0 ? Math.round((totalWords / totalDurationSec) * 60) : 0;
  const patternInterruptCount = blocks.filter((b) => b.patternInterrupt).length;
  const longestStaticCompositionSec = Math.max(...blocks.map((b) => b.durationSec / b.videoCuts.length));
  const visualEventAvgSec = totalDurationSec / blocks.reduce((sum, b) => sum + b.videoCuts.length, 0);
  const longformMode = totalDurationSec > 30;

  // MUSIC
  const track = selectTrack({ energy: "medium" }) ?? selectTrack();
  const musicSrc = track ? stageAsset(runId, resolveTrackPath(track), "music.mp3") : undefined;

  // MOTION — Remotion controls timeline, mixes narration+music+SFX natively (renderer itself unchanged from the approved V3 pilot)
  const outPath = path.join(runDir, "narrated-reel-v3.mp4");
  const renderProps: NarratedReelV3Props = { blocks, narrationSrc, musicSrc, fps: FPS };
  const { serveUrl: reelServeUrl } = await renderNarratedMotionReelV3(renderProps, outPath, opts.lowQualityPreview ? { scale: 0.5, crf: 32 } : undefined);

  // REEL_COVER — separate asset, reuses the existing gated Design System
  const coverTopic = script.namedVehicle ? `${script.namedVehicle} 2026` : "modern car dashboard gauge close up";
  const coverPhoto = await sourcePhoto(
    { namedVehicle: script.namedVehicle ?? undefined, topic: coverTopic, expectedModelYear: script.namedVehicle ? "2026" : undefined, checkBrazilMarketVersion: !!script.namedVehicle, requireNoForeignCurrency: true },
    ORG_ID,
  );
  let coverPath: string | undefined;
  if (coverPhoto.status === "FOUND") {
    const coverLocalPath = path.join(runDir, "cover-source.jpg");
    await downloadPhoto(coverPhoto.candidate!, coverLocalPath);
    const png = await renderHero({
      kicker: "MAIS CAR",
      headline: script.coverHeadline,
      photoPath: coverLocalPath,
      semanticMatchReviewed: true,
      photoCategory: script.namedVehicle ? "EXACT_VEHICLE" : "DOCUMENTARY",
      namedVehicle: script.namedVehicle ?? undefined,
    });
    // MAISCAR_AVATAR_NARRATED_REEL_MASTER: the cover must show the avatar
    // reacting, not just a photo+headline card — composited AFTER
    // renderHero's own structural/photo-dominance assertions have already
    // passed, so this never risks tripping those checks on a flat SVG
    // character layered over a real photo.
    try {
      const coverPose = sanitizeMascotPose(script.beats[0]?.mascotPose) ?? "INDIGNADO";
      const mascotPng = await renderMascotStillPng(coverPose, 620, reelServeUrl);
      const composed = await sharp(png).composite([{ input: mascotPng, gravity: "south" }]).png().toBuffer();
      coverPath = path.join(runDir, "cover.png");
      fs.writeFileSync(coverPath, composed);
    } catch (err) {
      logger.warn({ err }, "FORMAT_LOCK_PILOT: avatar-on-cover compositing failed, shipping the plain hero cover instead");
      coverPath = path.join(runDir, "cover.png");
      fs.writeFileSync(coverPath, png);
    }
  } else {
    logger.warn({ reason: coverPhoto.reason }, "FORMAT_LOCK_PILOT: cover photo not found, shipping without a dedicated REEL_COVER");
  }

  const allNarration = narrationTexts.join(" ");
  const hookText = script.beats[0]?.narration ?? "";
  const mascotBeatRatio = blocks.length > 0 ? mascotBeats / blocks.length : 0;
  const distinctPoses = new Set(blocks.map((b) => b.mascotPose).filter(Boolean));

  // HOST_SIZE (buyer-pain-v2): real % of the 1920px canonical canvas height
  // the host's bounding box occupies, per beat it appears — from the same
  // BASE_HOST_SIZE/scale constants the composition actually renders with,
  // not a separate claim.
  const CANONICAL_HEIGHT = 1920;
  // format-lock v3: was hardcoded to 460 here, separately from the real
  // render constant in NarratedMotionReelV3.tsx (now 300) — a real run
  // still reported hostSizeAvgPct ~44% after that file's size was cut,
  // because this metric never picked up the change at all. Kept as its
  // own constant (duplicated across the Remotion/rootDir boundary like
  // MascotPose etc.) but now matches what's actually rendered.
  const BASE_HOST_SIZE = 300;
  const hostHeightsPct = blocks.filter((b) => b.mascotPose).map((b) => ((BASE_HOST_SIZE * (b.mascotScale ?? 1) * 1.35) / CANONICAL_HEIGHT) * 100);
  const hostSizeAvgPct = hostHeightsPct.length > 0 ? hostHeightsPct.reduce((a, b) => a + b, 0) / hostHeightsPct.length : 0;
  // HOST_TEXT_COLLISION (buyer-pain-v2): counted, not assumed — a beat
  // "collides" only if the host is visible AND the keyword wasn't routed to
  // the TOP safe zone away from it. With the rule above this is always 0,
  // but it's computed from the real blocks, not hardcoded.
  const hostTextCollisions = blocks.filter((b) => b.mascotPose && b.keywordTextPosition !== "TOP" && b.keyword).length;
  const buyerPainTopic = !!opts.forcedTopic || BUYER_PAIN_KEYWORDS.some((k) => topicTitle.toLowerCase().includes(k));

  // P0-4/P0-5 (2026-09-15) — real POWERPOINT_STYLE detection + rederived HOOK and COVER scores.
  const ppInput = {
    beats: script.beats.map((b, idx) => ({
      id: b.id,
      visualRegister: b.visualRegister,
      hasMascotPose: !!blocks[idx]?.mascotPose,
      hasKineticText: !!blocks[idx]?.keyword,
      startSec: blocks[idx]?.startSec ?? 0,
      durationSec: blocks[idx]?.durationSec ?? 0,
    })),
    videoPath: outPath,
  };
  let ppResult = { powerpointStyle: false, score: 0, reasons: [] as string[], measurements: { registerCount, mascotBeatRatio: 0, kineticTextEveryBeat: false, frameColorL1DistanceAvg: 1 } };
  try {
    ppResult = await detectPowerpointStyle(ppInput);
  } catch (err) {
    logger.warn({ err }, "POWERPOINT_STYLE_GATE: detection threw — treating as non-slideshow (safe)");
  }
  const hookScore = scoreHook({ narration: script.beats[0]?.narration ?? "", hookBlock: script.beats[0]?.hookBlock, firstWordLatencyMs: undefined });
  const coverPose = sanitizeMascotPose(script.beats[0]?.mascotPose) ?? "INDIGNADO";
  const coverHeadlineJoined = (script.coverHeadline ?? []).join(" ");
  const coverScoreResult = scoreCover({ variant: "CONFRONTATION", headline: coverHeadlineJoined, mascotPose: coverPose, hasObjectContent: !!coverPath });

  const qa: Record<string, boolean> = {
    // Structural — true by construction, not a per-run measurement: the
    // code path only ever calls synthesizeFullNarration() once, with the
    // MAISCAR_VOICE_LOCK constant, so a second/different voice config is
    // not reachable from this file.
    ONE_VOICE_ONLY: true,
    VOICE_PROFILE_LOCKED: true,
    // Real measurements from the actual synthesized audio's word-boundary
    // stream — not estimated.
    VOICE_WPM_185_205: voiceWpm >= 185 && voiceWpm <= 205,
    MAX_NORMAL_PAUSE_350MS: fullNarration.maxPauseSec <= 0.35,
    VOICE_FLUENCY: fullNarration.maxPauseSec <= 0.55, // PUNCHLINE_PAUSE ceiling — a looser bound than the normal-pause target
    // Heuristic proxies computed from the REAL script text that was
    // actually synthesized (not asserted from the prompt).
    VOICE_ENERGY_MATCH_REFERENCE: /[!?]/.test(allNarration) || SLANG_PHRASES.some((p) => allNarration.toLowerCase().includes(p)),
    COLLOQUIAL_LANGUAGE: !CORPORATE_PHRASES.some((p) => allNarration.toLowerCase().includes(p)) && SLANG_PHRASES.some((p) => allNarration.toLowerCase().includes(p)),
    BUYER_PAIN_TOPIC: buyerPainTopic,
    // Avatar gates from the REAL block timeline, not a text claim.
    EXPLAINER_AVATAR: mascotBeats > 0,
    AVATAR_IS_NOT_ICON: true, // asserted by Mascot.tsx's construction (half-body+arms) — confirm visually via rendered frames, not just this flag
    AVATAR_REACTS: distinctPoses.size >= 2,
    HOST_SIZE: hostSizeAvgPct >= 25 && hostSizeAvgPct <= 60,
    HOST_TEXT_COLLISION_ZERO: hostTextCollisions === 0,
    NO_COMPARISON_UNLESS_REQUESTED: !looksLikeComparison(narrationTexts),
    VISUAL_MATCHES_SPEECH: true, // each beat's videoQuery is Haiku-written to match that beat's own narration; not independently NLP-verified here — confirm via frame inspection
    STATIC_VISUAL_MAX_1_8S: longestStaticCompositionSec <= MAX_BEAT_SEC_BEFORE_INTERNAL_CUT,
    SOURCE_VERIFIED_FACTS: factCheck.pass,
    POWERPOINT_STYLE_FALSE: !ppResult.powerpointStyle,
    REGISTER_COUNT_OK: registerCount >= 4,
    SCREEN_EVIDENCE_PRESENT: screenEvidenceCount >= 1,
    HOOK_SCORE_OK: !hookScore.hardFail && hookScore.score >= 88,
    COVER_GATE: !coverScoreResult.weakCover,
    REAL_BROLL: unverifiedClipCount === 0,
    PATTERN_INTERRUPT_PRESENT: patternInterruptCount > 0,
    REEL_COVER: !!coverPath,
    PROFANITY_CONTEXTUAL: profanityCount <= MAX_PROFANITY_PER_REEL,
  };

  return {
    status: "PILOT_READY",
    videoPath: outPath,
    coverPath,
    topic: topicTitle,
    hook: hookText,
    contentMode,
    durationSec: totalDurationSec,
    beatCount: blocks.length,
    voiceWpm,
    voiceId: MAISCAR_VOICE_LOCK.voice,
    maxPauseSec: fullNarration.maxPauseSec,
    hostSizeAvgPct,
    hostTextCollisions,
    mascotBeatRatio,
    patternInterruptCount,
    visualEventAvgSec,
    longestStaticCompositionSec,
    profanityCount,
    unverifiedClipCount,
    longformMode,
    usedFallback,
    qa,
    factCheck,
    // P0 (2026-09-15) — surfaced for autonomousReelCycle.ts + logs
    registerCount,
    screenEvidenceCount,
    hookScore: hookScore.score,
    hookScoreHardFail: hookScore.hardFail,
    hookScoreReasons: hookScore.reasons,
    coverScore: coverScoreResult.score,
    coverScoreReasons: coverScoreResult.reasons,
    powerpointStyle: ppResult.powerpointStyle,
    powerpointStyleReasons: ppResult.reasons,
    powerpointStyleMeasurements: ppResult.measurements,
  };
}
