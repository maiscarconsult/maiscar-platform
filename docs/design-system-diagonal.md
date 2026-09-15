# Sistema Visual Mais.Car — "Corte Diagonal" (v3)

Padrão fixo a partir de 2026-09-02. Substitui o v2 ("Mais.car Editorial", 5
variants rotativos) por decisão explícita do usuário: menos variação de
layout entre slides, mais moldura reconhecível e consistente.

Implementação de referência: [`diagonalTemplate.ts`](../packages/backend/src/modules/content/diagonalTemplate.ts).
Usada tanto em posts manuais quanto pelo pipeline automático diário (via
`imageComposer.ts`, que agora só delega para este template).

## Estrutura

- Corte diagonal separa duas áreas: **texto no topo** (menor), **foto embaixo**
  (maior, protagonista). Diagonal mais alta à esquerda, mais baixa à direita
  (`panelLeftY`/`panelRightY`, padrão 470/310 em canvas 1080×1350 — a foto
  ocupa ~70-75% da arte).
- Toda foto passa por uma grade de cor fixa (leve dessaturação + mais
  contraste) — mesma assinatura visual independente da foto de origem.
- Moldura: filete vermelho fino inset 22px + segunda linha mais fina 30px,
  cantos retos (sem arredondar) — acabamento limpo, sem ouro/dourado, sem
  poluição.
- Costura da diagonal reforçada com um traço vermelho + um traço mais fino
  paralelo (detalhe tipo pinstripe automotivo).
- Assinatura de marca: "MAIS.CAR" pequeno, canto inferior esquerdo sobre a
  foto (halo branco pra legibilidade); contador de página "01/06" no canto
  inferior direito, mesma lógica.

## Tipografia

- **Manchete:** Bebas Neue Bold, caixa alta, vermelho de marca. Curta (1-3
  linhas, poucas palavras) — estrutura de manchete, nunca parágrafo.
- **Kicker/apoio:** Bahnschrift SemiBold, letter-spacing largo, tinta escura
  (`#181614`) — nunca vira badge/pill, é só texto.
- **Subtítulo (opcional):** Bahnschrift, menor, mesma tinta escura a 72% de
  opacidade. Tem auto-ajuste de tamanho/truncamento pra nunca vazar pra cima
  da foto (a diagonal fica mais estreita à direita) — mesmo assim, prefira
  escrever subtítulos curtos (~40 caracteres) na hora de gerar o post.
- **Sem serifada** neste sistema (Cambria, usado no sistema anterior, foi
  descontinuado aqui).

## Cor

`MAISCAR_RED = #A00223` — amostrado diretamente do vermelho do logo oficial
(`avalia-carro/public/maiscar-logo-full.png`). Único destaque de cor; todo o
resto é branco/preto/foto.

## Proporção

Foto sempre maior que o bloco de texto (~70-75% vs ~25-30% da altura). A foto
é a protagonista — o texto é manchete de apoio, não a peça central.

## O que este sistema não usa

Cards, pills, badges, botões falsos, blocos empilhados, gradientes/scrims
pesados sobre a foto inteira (era o padrão do v2) — o texto agora vive num
painel branco sólido, não sobre a foto.

## Reaproveitamento

- **Pipeline automático:** `imageComposer.ts` → `composeSlideImage()` chama
  `renderDiagonalSlide()` para toda imagem gerada por `contentPipeline/generate.ts`
  e `run.ts`, sem mudança de assinatura — nenhum outro arquivo do pipeline
  precisou mudar.
- **Posts manuais/ciclos:** importar `renderDiagonalSlideToFile` de
  `diagonalTemplate.ts` diretamente (ver `demo-diagonal.ts` como referência).
- Fonte Bebas Neue instalada localmente (per-user, `%LOCALAPPDATA%\Microsoft\Windows\Fonts`,
  SIL Open Font License) — necessária pra esse template renderizar em
  qualquer máquina nova.
