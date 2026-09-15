# Mais.Car — MASTER DIAGONAL (Visual Lock, 2026-09-03)

Fonte de verdade das decisões de design. Implementação:
[`diagonalTemplateV4.ts`](../packages/backend/src/modules/content/diagonalTemplateV4.ts).
Ligado ao pipeline automático via `imageComposer.ts`. v3 (`diagonalTemplate.ts`)
permanece no repo como rollback.

**Visual Lock:** depois de 4 famílias de composição (HERO/EDITORIAL/DATA/SPLIT)
produzirem peças reconhecíveis demais como "templates diferentes" em vez de
uma identidade única, o sistema foi travado numa única assinatura visual de
produção — o MASTER DIAGONAL (a família antes chamada HERO). EDITORIAL/DATA/
SPLIT ficam desativadas no dispatcher (`renderSlideV4` lança
`VisualIdentityError` para qualquer família que não seja `hero`); o código
continua no arquivo só como referência histórica/rollback. Referência visual
aprovada: [`content-review/MAISCAR_GOLDEN_MASTER.png`](../content-review/MAISCAR_GOLDEN_MASTER.png).

## Canvas / grid

- 1080×1350px (4:5). Margem de conteúdo `MARGIN_X = 76px`. Frame inset `30px`.
- Logo oficial: 168px de largura, canto superior — lado oposto ao bloco de
  texto, mesma posição em toda publicação.
- Folio (`01/07`): canto inferior direito, sempre. Contraste adaptativo
  (amostra a região embaixo da imagem e escolhe claro/escuro) — nunca vermelho.
- Moldura: cantos em L duplos (filete 3px + filete 1px a 55% opacidade),
  não um retângulo fechado. Marcação técnica (ticks) na costura da diagonal
  e no eixo central do SPLIT.

## Tipografia — tamanhos CONGELADOS

- **Título (`TITLE_SIZE = 76px`):** Bebas Neue, vermelho de marca, caixa alta.
- **Complemento (`BODY_SIZE = 66px`):** Bebas Neue, tinta escura — a proporção
  título:complemento é fixa em ~1,15 (equivalente ao par 15:13 especificado
  pelo usuário), preservada visualmente na calibração acima. Nunca "título
  enorme + texto secundário minúsculo".
- **Microcaption (CTA/pergunta de apoio, quando existe):** `BODY_SIZE × 0.85`
  (~56px) — só levemente menor que o complemento, nunca um terceiro nível
  muito menor.
- **Kicker / folio:** Bahnschrift SemiBold, 21px — texto de utilidade
  (categoria, número da página), fora da hierarquia de 2 níveis acima.
- Nunca serifada. Nunca reticências.

**Sem auto-scale.** `TITLE_SIZE`/`BODY_SIZE` não crescem nem encolhem para
acomodar copy — são constantes de marca. Se uma linha não cabe no tamanho
congelado, `renderHero` lança `HeadlineOverflowError` imediatamente (sem
janela de redução): a copy tem que ser reescrita mais curta, nunca o design
system amassado pra caber. Título: 1–2 linhas. Complemento/microcaption:
1 linha curta.

## Cor

- Vermelho de marca `#A00223` (amostrado do logo oficial) — **accent
  editorial**: manchete, palavra-chave, número, marcador, tensão. Nunca
  bloco de preenchimento grande.
- Fundo dos slides sem foto: off-white editorial `#F6F4EF` (testado contra
  branco puro — o off-white lê como papel premium; puro lia como slide
  corporativo). Nunca cinza sujo, nunca bege.
- Tinta: `#181614`.

## Composição — uma identidade, uma variação controlada

Não existem mais "famílias" livres. Toda peça de feed usa o **MASTER
DIAGONAL** (foto full-bleed embaixo, painel diagonal em cima com o texto).
A única variação permitida é `flip` (espelha o lado do texto/logo e o
sentido da diagonal) — nunca um terceiro layout inventado. Um carrossel varia
foto, conteúdo e crop; a geometria (moldura, logo, proporção, diagonal,
escala tipográfica) tem que continuar idêntica em todos os slides.

## Proporção foto/texto — invariante geométrico

`assertPhotoDominant()` calcula a altura média do painel de texto (trapézio
da diagonal) e bloqueia a exportação (`VisualIdentityError`) se a foto cair
abaixo de **65%** da área da arte. Alvo: **68–75% foto, 25–32% texto**. A
geometria (`PANEL_RIGHT_DEFAULT`/`PANEL_RIGHT_MAX`) já é calibrada pra nunca
ultrapassar esse teto sozinha — o painel não "cresce" pra caber mais copy;
se o conteúdo for grande demais, o overflow de texto dispara primeiro.

## Overflow (regra dura)

Tamanho fixo, sem janela de redução (ver Tipografia acima). Se uma linha não
cabe em `TITLE_SIZE`/`BODY_SIZE`, `renderHero` lança `HeadlineOverflowError`
na hora. Não existe truncamento automático nem encolhimento — reescreva a
frase mais curta.

## Fotografia — obrigatória, sem exceção

Toda publicação de feed exige fotografia real e semanticamente relacionada
ao conteúdo — **não existe mais peça só-tipográfica** (a família DATA, que
permitia isso, está desativada). Se não existir foto legítima do componente
específico da pauta (ex.: o painel exato de um modelo), a solução é uma foto
de contexto real e correta (o carro por fora, uma cena relacionada ao
problema, um detalhe genérico do sistema/categoria) — nunca fingir que uma
foto de outro veículo é o modelo em pauta, e nunca substituir a foto por um
card tipográfico.

- Fotografia real sempre que possível (Pexels ou fonte licenciada
  equivalente); nunca Pollinations/IA generativa para "evidência" de um
  componente específico.
- **Relevância semântica obrigatória**: a foto tem que ajudar a contar a
  matéria (ex.: pauta de frenagem automática → sensor/ADAS/trânsito/alerta
  no painel — nunca "uma foto bonita de carro" sem relação com o tema).
- **Imagem específica > imagem genérica**: se a pauta fala de um modelo
  específico, priorizar fotografia daquele modelo (press kit oficial, fonte
  licenciada). Nunca apresentar componente de outro veículo como se fosse do
  modelo citado.
- Grade de cor fixa em toda foto (leve dessaturação + contraste) — mesma
  assinatura visual independente da fonte.

## Visual Identity Gate (bloqueia a publicação)

Antes de qualquer export, os seguintes invariantes têm que ser todos
verdadeiros — qualquer falha impede a publicação, sem exceção:

`HAS_LOGO` · `HAS_FRAME` · `HAS_PHOTO` · `HAS_DIAGONAL` · `PHOTO_DOMINANT`
(≥65%) · `TITLE_SCALE`/`BODY_SCALE` fixos · `SEMANTIC_IMAGE_MATCH` (revisão
visual) · `CLEAN_EXPORT`.

`HAS_LOGO`/`HAS_FRAME`/`HAS_DIAGONAL` são estruturais (sempre desenhados pelo
`renderHero`, não há caminho de código que os pule). `HAS_PHOTO` e
`PHOTO_DOMINANT` são checados em runtime (`VisualIdentityError`).
`SEMANTIC_IMAGE_MATCH` é revisão humana/visual — abrir o arquivo renderizado
e confirmar antes de publicar, nunca confiar só no código.

## Editorial Relevance Gate (antes de escolher a pauta)

Notícia recente não é pauta automática. Antes de produzir qualquer conteúdo,
responder: **"Por que um dono, comprador ou apaixonado por carro no Brasil
se importaria com isso?"** Sem resposta forte → descartar.

Gerar internamente ≥5 candidatos e pontuar cada um (0–10):
`CONSUMER_RELEVANCE` · `CURIOSITY` · `CONTROVERSY` · `FINANCIAL_IMPACT` ·
`BUYING_DECISION_IMPACT` · `CURRENTNESS` · `SHARE_POTENTIAL`. Só avançar com
a pauta de maior justificativa editorial — não a matéria mais recente por
padrão. Quatro Rodas/Autoesporte/Motor1 são radar, não fila automática.
Prioridade: problemas/defeitos, manutenção/custo, recall, preço/custo-
benefício, desvalorização, usados, lançamentos relevantes, comparações,
decisões questionáveis de fabricante, equipamento retirado, promessa x
realidade, segurança, consumo, seguro, peças, "vale a pena comprar?".
Posicionamento: jornalismo automotivo + consultoria pra quem vai gastar
dinheiro num carro — nunca página de curiosidade solta.

## Photo Editorial Gate (antes do Visual Gate)

`semanticMatchReviewed: true` só pode ser marcado depois de confirmar, pra
cada foto escolhida: (1) é o veículo/componente correto; (2) representa
corretamente o assunto; (3) não induz interpretação errada; (4) tem
qualidade editorial (não parece banco de imagem genérico/clichê de
publicidade — sorriso com chave na mão, mecânico posando, etc.); (5)
funciona no crop diagonal (~70-75% foto, sem cortar farol/roda/logo de
forma acidental); (6) é coerente com a identidade Mais.Car. Prioridade de
fonte: 1) press kit oficial do modelo certo, 2) fotografia editorial real
legítima, 3) documental/contextual real, 4) banco de imagens só se parecer
autêntica, 5) IA só como último recurso e nunca como "evidência" de um
componente específico. Rejeitar automaticamente: cena visivelmente encenada
("stock advertising look"), e qualquer sinal de IA (emblema errado, roda
deformada, geometria impossível).

## Gates de publicação (todos precisam passar)

`EDITORIAL_GATE = PASS` (Editorial Relevance Gate) →
`PHOTO_EDITORIAL_GATE = PASS` (Photo Editorial Gate acima) →
`VISUAL_GATE = PASS` (Visual Identity Gate, agora com checagem de pixel pra
logo/moldura/diagonal, não só estrutural) →
`PERFORMANCE_GATE = PASS` (QA visual final, abrir o arquivo renderizado). Se
qualquer um falhar: **não publicar**.

## Proibido

- Cards, pills, badges, botões falsos.
- "Deslize"/setas de continuação/paginação falsa em peça única (só em
  carrossel real com múltiplos slides).
- Qualquer crédito visual sobre a arte (nome de banco de imagem, IA,
  "gerado por", URL, watermark) — fonte vai na legenda do post, nunca na peça.
- Reticências ou encolhimento de fonte além do piso definido.
- Aparência de apresentação corporativa, template Canva, banner de
  concessionária ou IA generativa.

## Continuidade — só em carrossel real

"Deslize", "arraste", "continue", seta de continuidade ou qualquer indicação
de próximo slide só podem existir quando a publicação for de fato um
carrossel com mais de um slide. Post único: zero indicação de continuidade.
Em carrossel: só o folio (`01/07`) já definido acima, nada além disso — nunca
inventar um segundo elemento de paginação.

## Metadado de produção x informação editorial

Dois grupos que nunca se misturam:

- **Metadado de produção** (nunca aparece na arte): banco de imagem, nome de
  IA, fotógrafo, URL, prompt, caminho de arquivo local. Fica só nos arquivos
  de produção (`content-review/`, scripts, `sources/`), nunca na peça.
- **Informação editorial** (pode aparecer quando agrega valor jornalístico):
  preço, prazo, dado técnico, "Fonte: dados oficiais da fabricante" — sempre
  como texto editorial normal (kicker/caption/complemento), nunca em estilo
  watermark, nunca com mais destaque que o conteúdo principal. Preferência:
  registrar a fonte completa na legenda do post, não na arte.

## Clean Export Rule (validação automática)

`assertCleanExport()` roda dentro de `renderHero` (a única família ativa em
produção — ver Visual Lock) antes de montar o SVG final — varre todo texto que
vai pra dentro da arte (kicker, manchete, complemento, legendas, folio) contra
uma lista de termos banidos (`pexels`, `unsplash`, `gerado por`, `ai
generated`, `foto:`, `imagem:`, `fonte:`, `deslize`, `arraste`, `continue`,
etc.) e contra padrão de URL/caminho de arquivo. Se encontrar, lança
`CleanExportError` e **bloqueia a exportação** — não corrige nem edita
silenciosamente, quem chama tem que corrigir o texto. Ver
`diagonalTemplateV4.ts`.

## Quality Gate — critérios com nota mínima obrigatória

Além dos critérios gerais (identidade, tipografia, fotografia, hierarquia,
consistência, variação, legibilidade mobile, sofisticação, credibilidade —
meta ≥9/10), estes três têm **piso 10/10, sem exceção**, e qualquer falha
impede a publicação:

- **Fake Carousel Elements** — nenhuma continuidade falsa (ver regra acima).
- **Clean Image Export** — nenhum texto residual/crédito sobre a foto.
- **Production Metadata Leakage** — nenhum metadado de produção vazando pra
  peça (a `Clean Export Rule` automatiza a checagem, mas a revisão visual
  final continua obrigatória antes de publicar).

## Música (Instagram)

Verificado 2026-09-03: a Content Publishing API do Instagram (container →
`media_publish`, usada por `jobs/publishing.ts`) **não expõe anexo de áudio
para PHOTO nem CAROUSEL** — trilha sonora selecionável só existe em Reels
(vídeo), e mesmo lá não é exposta de forma confiável via Graph API pra apps
de terceiro. `MUSIC_ATTACHED` é estruturalmente `false` pra todo post de
feed publicado por este pipeline; não é uma etapa que falta implementar, é
uma limitação da própria API para este tipo de conteúdo. Se o formato do
post algum dia virar Reels, reavaliar.

## Uso nas próximas publicações

MASTER DIAGONAL é a única família de produção. A variação vem de foto,
conteúdo, crop e `flip` — nunca de um layout novo. Só alterar o Design
System quando dado real ou problema real justificar (ver Seção 20 do
Performance Engine), nunca por preferência estética do momento.
