# Registro de Decisões — Mais.car Content Engine

Consultar antes de re-perguntar/re-pesquisar algo já decidido.

## Imagem (fotografia)
**Current:** sem ferramenta fixa — Pexels (real) ou IA externa (Pollinations e outras) conforme o briefing de cada tarefa. Usuário pode pedir explicitamente qualquer uma; a última instrução dele vence sem precisar de reconfirmação.
**Previous (2026-09-02, cedo):** priorizava só Pexels, banindo geração por IA — motivado pela rodada V3 (100% Pollinations lida como "robotizado"). Usuário revogou essa trava (2026-09-02, tarde): teste anterior é dado de aprendizado pra melhorar prompt/técnica, não proibição permanente.
**Quando usar IA de imagem:** melhorar prompt (lente, iluminação, composição, negative prompting) em vez de assumir que vai sair ruim de novo.

## Composição/texto sobre a foto
**Current (2026-09-03, Visual Lock — MASTER DIAGONAL):** uma única família de produção (a antiga HERO), EDITORIAL/DATA/SPLIT desativadas no dispatcher — ver `diagonalTemplateV4.ts` e `docs/MAISCAR_EDITORIAL_DESIGN_SYSTEM.md`. Única variação controlada permitida: `flip`.
**Motivo da mudança:** o usuário identificou que 4 famílias livres produziam peças reconhecíveis como "templates diferentes" em vez de uma identidade — para a Mais.Car, consistência visual passou a ter prioridade sobre variedade de layout. Também corrigiu 2 bugs reais de overflow horizontal encontrados em produção (legenda DATA e campo `data` do SPLIT nunca validavam largura) — mas a causa raiz foi resolvida desativando os caminhos problemáticos, não só corrigindo o wrap.
**Previous (2026-09-02, "Identidade Editorial" v4, 4 famílias):** ainda no arquivo como referência/rollback, não usar em posts novos.
**Invariante novo:** `assertPhotoDominant()` bloqueia a exportação se a foto cair abaixo de 65% da área (`VisualIdentityError`) — a geometria do painel tem teto fixo, não cresce pra acomodar mais texto.

## Tipografia
**Current (2026-09-03):** tamanhos CONGELADOS, sem auto-scale — `TITLE_SIZE=76px`, `BODY_SIZE=66px` (proporção ~15:13 pedida pelo usuário), microcaption `BODY_SIZE×0.85`. Se não couber: `HeadlineOverflowError` na hora, sem janela de redução.
**Previous (v4 original):** `resolveTierSize()` reduzia dentro de uma janela (alvo→piso) antes de lançar erro.
**Motivo da mudança:** usuário baniu explicitamente qualquer auto-scale — "os tamanhos ficam FIXOS... se não couber, reescreva o título".
**Manchete:** Bebas Neue Bold, caixa alta — fonte instalada localmente (SIL OFL).
**Labels/kicker/folio:** Bahnschrift SemiBold — texto de utilidade, fora da hierarquia de 2 níveis.

## Formato
1080×1350px (4:5). Proporção foto:texto varia por família (HERO/EDITORIAL ~70-78% foto; DATA/SPLIT sem foto, tipografia + espaço negativo centralizado).

## Cor de marca
**Current (desde v3, mantido no v4):** vermelho `#A00223`, amostrado direto do logo oficial Mais.Car — funciona como *accent* editorial (manchete, palavra-chave, número), nunca bloco de preenchimento grande.
**Fundo (novo no v4):** off-white editorial `#F6F4EF`, não branco puro — testado lado a lado, off-white lê como papel premium em vez de apresentação corporativa.

## Pesquisa/fact-check
**Ferramenta:** WebSearch (nativo), 2-3 buscas direcionadas por afirmação factual — nunca inventar número/estudo/dado.

## Publicação
**Ferramenta:** pipeline próprio do projeto (Prisma + BullMQ worker + Graph API do Instagram via catbox.moe para upload público). Sem custo de IA — é infraestrutura já construída.

## Personalidade de marca / motor de ciclos
Ver `docs/editorial-engine-system-prompt.md` e `docs/brand-personality-maiscar.md` — não redefinir a cada ciclo, só referenciar.

## ROUTE 3 — Visual Storytelling + Explicação + Música (regra permanente, 2026-09-09)

Aplica a TODA publicação daqui pra frente (ROUTE 1/2/3, as duas execuções diárias), sem precisar ser repetida. Fonte de verdade: esta seção + `comparisonCarousel.ts` + `musicSelection.ts`.

**Narrativa visual**: capa = protagonista/conflito (em comparação: os dois veículos juntos, nunca um por slide na abertura). Slides internos = fotografia CONTEXTUAL/DOCUMENTARY relacionada ao assunto específico daquele slide (dinheiro/concessionária para preço, posto/tomada para custo de uso, oficina/elevador para manutenção, estrada/trânsito para uso real, pátio de seminovos para revenda) — nunca o mesmo carro repetido em todos os slides. `EXACT_VEHICLE` só quando o texto nomeia um veículo específico e a foto mostra aquele veículo; caso contrário `CONTEXTUAL`/`DOCUMENTARY`. Mapeamento de tópico por função de slide vive em `slidePhotoTopics.ts`.

**Copy explicativa**: slide interno nunca é só pergunta ("qual gasta menos?"). Estrutura: título curto → comparação direta (número quando confirmado) → 1-3 frases explicando a diferença. Pergunta de engajamento vem DEPOIS de entregar valor, não no lugar dele. Dado sem fonte confirmada não entra — vira comparação qualitativa (nunca número inventado).

**Música — máquina de estados** (`musicSelection.ts`): `MUSIC_SELECTED` e `MUSIC_ATTACHED` são campos DISTINTOS, nunca confundidos; nunca declarar `PUBLISH_COMPLETE`/"publicado com música" com `MUSIC_ATTACHED=false`.
- **Correção (2026-09-09, mesmo dia)**: a premissa anterior ("Instagram não tem música nenhuma pra PHOTO/CAROUSEL") estava ERRADA. `MUSIC_SUPPORTED_IN_INSTAGRAM = true` pra todos os formatos que este pipeline produz (PHOTO/CAROUSEL/REEL) — o Instagram permite adicionar música manualmente no app pra qualquer um deles. O limite real é mais estreito: `MUSIC_API_AUTOMATION = false` — a automação via Graph API deste projeto não consegue selecionar/anexar áudio da biblioteca do Instagram pra nenhum formato (não existe endpoint pra isso no Content Publishing API, e nenhuma engine real de trending audio está integrada).
- Por isso, `MUSIC_STATUS = MANUAL_FINALIZATION_REQUIRED` é o estado correto e permanente pra toda publicação real: o scheduler prepara arte + legenda + CTA + registra o motivo, mas NUNCA cria `PublishingJob` nem chama `runPublishingJob` — o `Content` fica em status `REVIEW`. Publicação real exige um humano abrir o app, anexar música, e publicar por lá. Só depois disso `MUSIC_ATTACHED = true`.
- `daily-cycle-and-publish.ts` (rodando via Task Scheduler às 09:00/19:00) reflete isso: prepara o conteúdo e para — não publica sozinho. "Nenhuma publicação Mais.Car sem música" é a regra, e ela é aplicada removendo o auto-publish, não fingindo que a música foi anexada.

**Automação real vs. curada**: ROUTE 1/2 (posts de notícia/evergreen, foto única) e ROUTE 3 simples (engagement, foto única) continuam 100% automáticos nas execuções das 09:00/19:00. O carrossel "Duelo" rico (5-7 slides, fatos comparativos verificados: preço/custo por km/garantia) depende de fact-check via busca na web, que só existe numa sessão interativa — o scheduler headless não pode verificar preço/consumo/tarifa sozinho sem uma API de dados automotivos real. Até essa API existir, comparações ricas continuam sendo curadas manualmente (como Dolphin x Onix, 2026-09-09) e não fabricadas automaticamente pelo cron.

**EDITORIAL_PRESENTATION_GATE** (`editorialPresentationGate.ts`, 2026-09-09, correção no mesmo dia) — catálogo de erros amadores que passou a ser bloqueado em código, não só evitado por instrução: capa precisa nomear os dois modelos; nenhum slide DATA pode repetir a foto de outro (nem reusar a foto dupla da capa); todo slide DATA precisa de uma explicação real (prosa, não só uma pergunta solta). Falhou = `HELD_FOR_FIX`, nunca entregue com fallback silencioso.

**`comparisonCarousel.ts` ficou estrito**: `buildComparisonCarousel()` busca uma foto contextual REAL e DISTINTA por slide DATA antes de renderizar qualquer coisa; se `CONTEXTUAL_PHOTO_REQUIRED` falhar pra qualquer slide (ou vier repetida), a função inteira retorna `{ready:false, reason:"HELD_FOR_FIX", failures}` — nunca cai de volta pra foto dupla dos carros como solução preguiçosa. Na prática (2026-09-09), sem `PEXELS_API_KEY` configurada, isso significa que a maioria dos carrosséis ricos vai legitimamente `HELD_FOR_FIX` até a chave existir — é o comportamento correto, não um bug.

**Música sempre selecionada** (`musicSelection.ts`): `curateMusic(track, artist, whyItFits, contentType)` — usado em sessão interativa, sempre com faixa real e específica, `musicSelected=true`. `noAutomaticSelectionAvailable()` — usado só pelo scheduler headless, `musicSelected=false` de propósito (não inventa faixa), deixando claro que falta curadoria manual antes de finalizar.

**Photo/Editorial hardening (2026-09-10)**: ver `docs/MAISCAR_PHOTO_EDITORIAL_RULES.md` — fonte de verdade completa pra `PHOTO_CONTENT_MATCH_GATE`, `UNRELATED_VEHICLE_DETECTED`, `MODERNITY_GATE`, `NO_DUPLICATE_PHOTO_GATE` (perceptual hash), `HEADLINE_CLAIM_GATE`, e os 7 exemplos negativos permanentes em `chaos-tests-photo-editorial.ts`. Motivo: uma foto de Corolla geração E70 (1979-1983) passou pelos gates antigos numa comparação com modelo 2026 — os gates antigos validavam "é o carro certo?" mas não "é a geração certa?" nem "essa foto especificamente explica este slide?".

## FULL_AUTONOMOUS_MOTION_REEL (2026-09-10) — regra permanente

**O que é**: pipeline completo `RADAR → SCORING → FACT CHECK → HOOK → ROTEIRO → ASSET SOURCING → MOTION → ÁUDIO → QA → GRAPH API → INSIGHTS`, implementado em `debateReelCycle.ts` e invocado por `daily-cycle-and-publish.ts` (09:00/19:00) e `sync-insights.ts` (a cada hora). Produz Reels (vídeo vertical com ffmpeg, música embutida, capa própria) em vez de carrossel estático, com pauta de **debate/controvérsia real** em vez de comparativo frio de ficha técnica.

**AUTO_PUBLISH é uma decisão do dono da conta, não do Claude** (`autopublishConfig.ts`): o pipeline SEMPRE roda até `PREPARED_AWAITING_PUBLISH`; só chama a Graph API de publicação de verdade quando `packages/backend/.cache/autopublish.flag.json` tem `enabled:true` — arquivo que só é escrito por `scripts/enable-autopublish.ps1` (executado pelo usuário, no computador dele). `scripts/disable-autopublish.ps1` desliga a qualquer momento. Claude nunca roda esses scripts sozinho — publicar em conta pública real, sem revisão, pra sempre, é uma autorização permanente que só o dono pode dar, mesmo quando pedido explicitamente numa mensagem só.

**RADAR** (`controversyRadar.ts`, 0 LLM): sinais reais via busca pública do Reddit (`reddit.com/search.json`, sem chave) + cache existente de `comparisonDebateRadar.ts`. Não é exaustivo — é uma semente de sinais reais, não uma promessa de cobertura total do mercado.

**SCORING** (`controversyScoring.ts`, 0 LLM): heurística determinística nas 7 dimensões pedidas (`POLARIZATION`, `COMMENT_POTENTIAL`, `PERSONAL_RELEVANCE`, `FINANCIAL_CONSEQUENCE`, `OWNER_PAIN`, `CURIOSITY`, `SHAREABILITY`) a partir de sinais baratos (nº de fontes, menção a modelo específico, menção a dinheiro, padrão recorrente). `MIN_ENGAGEMENT_POTENTIAL = 80`. Sem 2ª fonte de sinal ainda pros fallbacks completos (`BREAKING → OWNER_PAIN → EVERGREEN → UNPOPULAR → MYTH`) — hoje, se nada bate 80, o pipeline segue com o melhor candidato disponível e registra um aviso, em vez de abandonar o ciclo.

**FACT CHECK** (`factCheckTiers.ts`, 0 LLM): toda claim usada no roteiro carrega uma tag — `CONFIRMED_FACT`, `OWNER_REPORT`, `OFFICIAL_RECALL` ou `EDITORIAL_OPINION`. `passesFactCheckGate()` exige pelo menos 1 claim que não seja opinião pura, e que o veredito final esteja SEMPRE marcado `EDITORIAL_OPINION` (nunca disfarçado de fato). Reclamação de internet não vira "defeito comprovado" automaticamente — vira `OWNER_REPORT`, rotulado como tal na legenda.

**HOOK/ROTEIRO** (`debateReelCycle.ts`'s `writeScript()`): exatamente **1 chamada de Haiku** (`quality:"draft"`) por Reel, que transforma o sinal real do radar num roteiro estruturado (hook afirmativo, conflito, claims taggeadas, contraponto, veredito). Zero chamadas de Vision/Sonnet nesta etapa.

**CENAS CONTEXTUAIS REUTILIZÁVEIS**: `car on lift service bay garage`, `mechanic tools engine bay close up`, `car dealership negotiation contract` e `open road driving sunset` — já aprovadas e cacheadas (0 Vision) desde o Reel Compass x Corolla e o Reel Onix — funcionam como um pequeno banco de "cenas documentais" reutilizável pra qualquer novo debate, sem gastar Vision de novo. Só o veículo nomeado (quando houver) pode precisar de 1 verificação de Vision nova.

**MOTION**: `reelRenderer.ts` (ffmpeg puro, 0 LLM) — zoom/pan Ken Burns por cena, crossfade entre cenas, fundo `#F6F4EF` (nunca preto) pra completar o canvas 9:16 sem cortar nada do slide 4:5. `secondsPerSlide` é parametrizável. **Limitação honesta**: hoje é motion sobre fotos estáticas, não composição de vídeo real (Pexels Video) nem animações Canva — isso fica como próximo passo, não implementado ainda.

**ÁUDIO**: `localAudioLibrary.ts`, seleção 100% por código (mood/energy/`usedCount` crescente, prioriza `contentId:false`) — nunca LLM. Sem fonte de música "trending verificada" conectada ainda; todo Reel usa a biblioteca local licenciada, e nenhuma faixa é declarada `TRENDING` sem evidência.

**ANTI-REPETIÇÃO** (`antiRepetition.ts`, 0 LLM): compara título do candidato com os últimos 5 Reels (overlap de palavras-chave) antes de produzir.

**INSIGHTS** (`insightsSync.ts`, rodando a cada hora via `sync-insights.ts`/`MaisCarInsightsSync`, 0 LLM): snapshot de reach/views/likes/comments/shares/saved/watch-time em +1h/+6h/+24h/+72h, gravado em `ContentVersion.metadata.insightsSnapshots`. Ainda não existe uma etapa de aprendizado automático que ajuste hooks/temas com base nesses dados — os dados ficam registrados, a análise/ajuste de estratégia continua manual por enquanto.

**Limite de publicação**: 2 posts/dia (`MAX_POSTS_PER_DAY`), sem compensar dias perdidos.

## SOURCE_VERIFIED_FACT_GATE (2026-09-10/11) — substitui o fact-check anterior, regra permanente

O `factCheckTiers.ts` original só checava se a claim carregava uma tag (`CONFIRMED_FACT`/`OWNER_REPORT`/...) e uma string em `sourceUrl` — não que a URL fosse real, nem que o conteúdo da fonte sustentasse o número específico. Isso permitiu que o Reel `DdIA1I-D9mF` publicasse "até 5 km/l a mais" e "R$ 15-25 mil mais caro" como `CONFIRMED_FACT` autoatribuído pelo Haiku, sourceUrl `"internal-radar-signal"` (placeholder, não uma fonte real). Auditoria confirmou que nenhum dos dois números tinha suporte real.

`sourceVerifiedFactGate.ts` (`verifyClaim`/`verifyClaims`/`passesSourceVerifiedFactGate`) corrige isso: toda claim é re-derivada do seu `sourceUrl` real, nunca da tag que o roteirista pediu. Sem URL real + parece número/preço/%/km/l/prazo específico → `UNVERIFIED`. URL de `reddit.com`/`reclameaqui.com.br` → forçado `OWNER_REPORT`, nunca fato geral. `CONFIRMED_FACT` só sobrevive se o texto bruto da própria fonte contiver os números (com unidade — número solto não conta) da claim; cacheado em `VERIFIED_FACT_CACHE` pra não buscar de novo. `UNVERIFIED` nunca é publicado como evidência — o ciclo derruba a claim (ou cai pro template determinístico) antes de tentar de novo. `controversyRadar.ts` agora carrega o `sourceUrl` real (permalink do Reddit, artigo da Quatro Rodas) até o roteiro, em vez do placeholder anterior.

**FULL RADAR completo**: `getControversyCandidates()` agora combina `BREAKING` (homepage real da Quatro Rodas, filtrada por palavra-chave) + `OWNER_PAIN` (Reddit) + `EVERGREEN_CONTROVERSY` (seeds curados, grounded em artigo real) + `UNPOPULAR_OPINION` (comparativos) + `AUTOMOTIVE_MYTH` (reclassificação por padrão "mito/vale a pena" dentro do evergreen) — cada fonte falha isoladamente sem esvaziar o radar inteiro.

## MAISCAR_NARRATED_MOTION_REEL_V3 (2026-09-11) — padrão permanente atual

**O que é**: substitui o formato slideshow (V1/V2, `debateReelCycle.ts`) como padrão de Reel. Narração contínua + vídeo real + microanimações + mascote recorrente + texto cinético, cortes a cada ~1-2s, pattern interrupt a cada 4-6s. Implementado em `narratedMotionReelV3Cycle.ts`. Alvo de duração 18-35s (curto, prioriza impacto/retenção sobre duração).

**Motor de motion**: `Remotion` (`remotion/`, código React/TSX — `Root.tsx`, `NarratedMotionReelV3.tsx`, `Mascot.tsx`, `KineticText.tsx`, `BRoll.tsx`) — timeline/cortes/texto cinético/mascote controlados por componente, nunca por LLM. ffmpeg (via `ffmpeg-static`, já usado no resto do pipeline) continua sendo o encoder por baixo do capô do próprio Remotion. **Nota de licenciamento**: a licença do Remotion exige licença paga da empresa acima de um limiar de receita/porte (remotion.dev/license) — não verificado ainda contra a situação da MAIS CAR, sinalizado aqui em vez de assumido como grátis pra sempre.

**Mascote**: `Mascot.tsx` — personagem circular "cara-de-farol" original (vermelho/off-white da marca), desenhado 100% em SVG/código, 11 poses (`NORMAL`, `SURPRESO`, `DESCONFIADO`, `BRAVO`, `RINDO`, `APONTANDO`, `EXPLICANDO`, `PENSANDO`, `MAO_NA_CABECA`, `POSITIVO`, `NEGATIVO`) via props, não 11 assets desenhados — 0 custo de geração de imagem. Não copia o personagem do vídeo de referência.

**Narração**: `ttsProvider.ts` — TTS gratuito, sem chave, via Microsoft Edge Read Aloud (`msedge-tts`), voz `pt-BR-AntonioNeural` fixa (a voz permanente da MAIS CAR). Nenhum provedor pago (ElevenLabs, OpenAI TTS) foi contratado. A duração real de cada segmento (medida via `ffprobe-static`) é a fonte de verdade do timing — não uma estimativa.

**B-ROLL real**: `pexelsVideo.ts` — mesma `PEXELS_API_KEY` já usada pra fotos, agora também pra vídeo. **Limitação real confirmada no piloto**: não existe filtro de relevância/orientação/moeda pra vídeo equivalente ao `contentMatchDescription`/`requireNoForeignCurrency` de `photoSourcing.ts`. O piloto rodado em 2026-09-11 trouxe pelo menos 1 clipe com nota argentina (moeda estrangeira) e 2 clipes claramente fora de tema/de cabeça pra baixo (página de livro, placa verde) — o pipeline publica a narração e o motion corretos, mas a busca de vídeo genérica às vezes retorna lixo visual. Isso precisa de um gate de relevância antes de rodar sem supervisão (próximo passo, não implementado ainda).

**SFX**: `sfxKit.ts` — 5 efeitos (`WHOOSH`, `POP`, `CLICK`, `IMPACT`, `RISER`) sintetizados uma vez via geradores de sinal do próprio ffmpeg (`sine`/`anoisesrc`), cacheados em `.cache/sfx/`. Não é um pacote de terceiros — zero questão de licenciamento.

**FACT CHECK**: mesmo `SOURCE_VERIFIED_FACT_GATE` acima, aplicado por beat.

**FALLBACK DETERMINÍSTICO** (`buildDeterministicScriptV3`): se a 1 chamada de Haiku falhar por qualquer motivo (inclusive uma falha de infraestrutura não relacionada ao provedor de IA — ver nota abaixo), o ciclo usa um template fixo em vez de abortar um sinal real de radar. Testado de verdade em 2026-09-11: com o Postgres local fora do ar, a chamada de Haiku falhou (o orquestrador de IA grava um `generationJob` no banco antes de cada chamada) e o fallback assumiu, produzindo um Reel real de ~25s.

**QA objetivo medido no piloto de 2026-09-11** (tema real: "Corolla Hybrid ou Civic, híbrido compensa?"): `DURATION=25.4s` (PASS ≤35s), `VISUAL_EVENT_AVG≈1.59s` (PASS ≤1.8s), `LONGEST_STATIC≈1.86s` (PASS ≤2s), `PATTERN_INTERRUPTS=4` (PASS), `MASCOT_RATIO=62.5%` (acima da faixa 30-50% pedida — o template determinístico não foi calibrado pra isso, o prompt do Haiku já pede 30-50% explicitamente). `VOICE_WPM≈142` (abaixo dos 170-200 pedidos — herda o ritmo natural da voz do Edge TTS no template fixo, não ajustado ainda).

**Limitação operacional real, não de código**: nesta sessão, o Postgres local (`docker-compose.yml`, serviço `postgres`) estava inacessível porque o próprio Docker Desktop respondia erro 500 no engine — `docker ps`/`docker compose up` falharam com "request returned 500 Internal Server Error". Isso não é algo que o Claude corrige sozinho (é a instalação do Docker Desktop da máquina do usuário) — precisa reiniciar o Docker Desktop (ou a máquina) antes do ciclo real (que grava `Content`/`generationJob` no Postgres) rodar de ponta a ponta com o roteiro do Haiku de verdade, não o fallback.

**Canva**: não usado neste piloto — o "Motion Kit" foi construído em código (componentes Remotion) porque o modelo de página do Canva não encaixa bem em sincronização quadro-a-quadro de mascote+texto cinético+B-roll; regra 11 do pedido também proíbe "criar 7 páginas → animar → exportar". Fica como decisão registrada, não como limitação a esconder.

## MAISCAR_NARRATED_MOTION_REEL_V3_1 (2026-09-11) — evolução de personalidade/voz/avatar/pauta

Mesma arquitetura do V3 (Remotion, B-roll real, cortes rápidos, kinetic text, SFX/música, `SOURCE_VERIFIED_FACT_GATE`) — V3.1 muda só o quê e como é dito, não o motor.

**MAISCAR_VOICE_PROFILE** (`ttsProvider.ts`): perfil sonoro permanente — `pt-BR-AntonioNeural` com `baseRate:"+30%"` e deltas de rate/pitch por emoção (`NORMAL`/`SURPRESO`/`INDIGNADO`/`IRONICO`/`EXPLICANDO`/`PENSANDO`) escolhidos por beat. Isso é ajuste de prosódia, não clonagem de personalidade — um TTS não atua, só varia velocidade/tom. **Bug real encontrado e corrigido**: `msedge-tts` faz `{...new ProsodyOptions(), ...options}`; passar `pitch: undefined` explicitamente (quando a emoção não define pitch) sobrescrevia o default `"+0Hz"` com `undefined`, virando `pitch="undefined"` no SSML e derrubando o stream de síntese ("Stream closed before the synthesis completed"). Corrigido incluindo a chave `pitch` só quando ela existe de verdade. `VOICE_WPM` real medido: 179 (alvo 180-210, chegou perto mesmo no fallback determinístico).

**PROFANITY_MODE=SPARSE_CONTEXTUAL**: no máximo 2 palavrões leves (`porra`/`cacete`/`merda`/`caramba`) por Reel, aplicado por código (`capProfanity`) — nunca confiado só no prompt do Haiku. Nunca insulto a grupo/característica pessoal.

**Avatar MAIS CAR expandido** (`Mascot.tsx`): de 11 pra 17 poses (`+IRONICO`, `+INDIGNADO`, `+APONTANDO_ESQUERDA/DIREITA/CIMA`, `+DINHEIRO`), e agora **participa** da cena em vez de ficar fixo no canto: alterna `BOTTOM_RIGHT`/`BOTTOM_LEFT` por beat, entra deslizando de um lado (`mascotEnterFrom`), e ocupa o `CENTER` da tela em escala maior (`mascotScale:1.5`) nos beats de pattern interrupt.

**Pauta DEBATE vs DICA**: `pickContentMode()` escolhe entre estrutura de debate (afirmação forte → prova → consequência → contraponto/veredito) e estrutura de dica prática (erro comum → por que prejudica → o que fazer → exemplo → resultado) por heurística de palavra-chave no título do candidato do radar (negociar/financiar/desconto/concessionária/etc → DICA). `EXCEPTIONAL_LONGFORM_MODE`: permitido passar de 35s só quando `contentMode==="DICA"` e a duração real (medida, não estimada) ultrapassar o teto — nunca alonga artificialmente.

**Limitação honesta desta rodada de teste**: com o Postgres local ainda fora do ar (mesmo problema de Docker Desktop já registrado na seção V3), a chamada de Haiku falhou de novo nas duas rodadas de teste e o pipeline usou o `DETERMINISTIC_FALLBACK` (conservador de propósito — 0 palavrão, tom mais neutro) em ambas. Ou seja: a arquitetura (avatar participando, voz mais rápida, DEBATE/DICA, gates novos) foi validada de ponta a ponta, mas a escrita "debochada/indignada/irônica" de verdade do Haiku ainda não foi vista rodando — só o template de segurança. Precisa rodar de novo com o Postgres no ar pra avaliar a personalidade real do roteiro.

**B-roll segue com o mesmo gap já registrado no V3**: sem filtro de relevância pra vídeo — este piloto trouxe de novo clipes fora de tema (textura de pele, still-life de flor sobre rosto) nas mesmas queries genéricas do template determinístico.
