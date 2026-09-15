# MAIS CAR — Photo/Editorial Rules (source of truth, 2026-09-10)

Regras permanentes de conteúdo fotográfico e editorial pra comparações ROUTE 3.
Implementadas em código (`comparisonCarousel.ts`, `photoVerification.ts`,
`duplicatePhotoGate.ts`, `headlineClaimGate.ts`, `editorialPresentationGate.ts`)
e testadas em `chaos-tests-photo-editorial.ts`. Não depende desta conversa —
qualquer sessão futura lê este arquivo e o código, não repete o prompt.

## Por que isso existe

Um teste real (Compass x Corolla, 2026-09-09/10) passou por todos os gates
existentes na época e ainda assim usou uma foto de Corolla geração E70
(1979-1983) pra representar o modelo 2026 — a checagem de então só validava
"é um Corolla de verdade?", não "é a geração/ano certos?". Esse é o tipo de
erro que estas regras existem pra bloquear em código, não confiar em revisão
manual depois do fato.

## Taxonomia de função de slide → categoria de foto permitida

| Função | Categorias aceitas |
|---|---|
| COVER_COMPARISON | `EXACT_VEHICLE_A` + `EXACT_VEHICLE_B` (os dois carros reais, reconhecíveis) |
| PRICE | compra/concessionária/negociação/dinheiro/chaves/showroom |
| RUNNING_COST (combustível) | posto/bomba/abastecimento |
| RUNNING_COST (elétrico) | recarga/carregador/estação de recarga |
| MAINTENANCE | oficina/mecânico/elevador/serviço de motor/ferramentas |
| WARRANTY | pós-venda/central de serviço/atendimento/documento de garantia |
| PERFORMANCE | motor/condução dinâmica/aceleração/estrada de performance — **não** aceitar estrada genérica sem comunicar desempenho |
| SPACE (porta-malas) | porta-malas/bagagem/carga — preferir com objetos visíveis que comuniquem espaço |
| REAL_USE | rodovia/trânsito urbano/viagem/estacionamento |
| RESALE | pátio de seminovos/negociação de usado |
| VERDICT | posse/garagem/estilo de vida de condução/decisão, ou nova composição dos veículos |

Ver `slidePhotoTopics.ts` (`SLIDE_PHOTO_TOPIC` = query de busca,
`SLIDE_CONTENT_MATCH_DESCRIPTION` = o que a foto precisa DE FATO mostrar).

## Gates (código, não convenção)

- **`PHOTO_CONTENT_MATCH_GATE`** (`photoVerification.ts`, campo `contentMatches`) —
  Vision verifica se a foto realmente ilustra o assunto do slide, não só se
  bateu na busca. Query match != content match.
- **`UNRELATED_VEHICLE_DETECTED`** (mesmo arquivo) — Vision procura
  badge/emblema/modelo diferente do esperado; se achar, `FAIL` mesmo que o
  resto pareça bom.
- **`MODERNITY_GATE`** (campo `modernityOk`) — só roda quando o slide
  apresenta um veículo como modelo atual (`expectedModelYear` informado);
  bloqueia geração antiga/datada sendo passada como atual.
- **`NO_DUPLICATE_PHOTO_GATE`** (`duplicatePhotoGate.ts`) — perceptual hash
  (8x8 average hash, distância de Hamming ≤6) entre TODAS as fotos do
  carrossel, não só comparação de URL — pega recorte/reescala da mesma foto.
- **`HEADLINE_CLAIM_GATE`** (`headlineClaimGate.ts`) — se a capa afirma
  "mesmo dinheiro/orçamento/preço", a diferença real de preço precisa ser
  ≤10%; senão, `FAIL` e a headline precisa virar algo factual.
- **`EDITORIAL_PRESENTATION_GATE`** (`editorialPresentationGate.ts`) — capa
  nomeia os dois modelos, nenhuma foto repetida (checagem por identidade de
  URL, complementar ao perceptual hash acima), todo slide interno tem
  explicação real (não é só uma pergunta solta).

Tudo isso roda **antes** do render — `buildComparisonCarousel()` só produz
PNGs se passar em tudo; senão retorna `{ready:false, reason:"HELD_FOR_FIX",
failures:[...]}` com a lista exata do que falhou.

## MAISCAR_NEGATIVE_VISUAL_EXAMPLES (regression tests permanentes)

Ver `chaos-tests-photo-editorial.ts` — cada um roda direto contra a função
do gate, sem precisar de rede/Vision ao vivo:

1. Carro errado (ex: Mercedes C180 numa peça Compass x Corolla) → `BLOCK`.
2. Mesma foto repetida em 2+ slides → `BLOCK`.
3. Foto contextual errada (ex: posto de gasolina ilustrando garantia) → `BLOCK`.
4. Foto antiga/datada representando modelo atual → `BLOCK`.
5. Headline "mesmo dinheiro" com diferença de preço material (>10%) → `BLOCK`.
6. Slide interno só com pergunta, sem explicação → `BLOCK`.
7. Contexto correto (oficina numa slide de manutenção) → `PASS` (controle positivo).

## O que isto NÃO cobre (limite honesto)

- Verificação de fatos (preço/versão/consumo) continua exigindo WebSearch,
  que só existe em sessão interativa — o scheduler headless não roda isso
  sozinho.
- Cobertura de foto contextual depende de `PEXELS_API_KEY` configurada
  (Wikimedia sozinho raramente tem cena genérica boa).
- `MODERNITY_GATE` depende do Vision de fato conseguir perceber a geração
  pela imagem — não é uma verificação de metadado/EXIF, é julgamento visual,
  então pode errar em casos ambíguos (mesma prudência de qualquer check por
  Vision: fail-closed no erro, não fail-open).
