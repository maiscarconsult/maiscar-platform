# Mais.car Editorial — Design System v2

Criado em 2026-09-01 após revisão visual do primeiro carrossel publicado
(`https://www.instagram.com/p/DcwEXWSFmUX/`). Este é o padrão novo, oficial,
usado pelo pipeline automático a partir de agora
(`packages/backend/src/modules/content/imageComposer.ts`).

## Por que o v1 falhava
Todo slide usava exatamente a mesma composição: foto desaturada + barra
horizontal translúcida cortando o meio do quadro + texto centralizado + barra
preta de rodapé full-width. Sem hierarquia, sem ritmo, sem capa de impacto,
identidade reduzida a duas linhas âmbar decorativas. Lia como template
genérico gerado em massa.

## Formato
1080×1350px (4:5). Zona segura de 64px em toda a borda — nada essencial
(texto, número, CTA, marca) encosta na margem.

## Cores
| Token | Hex | Uso |
|---|---|---|
| `ink` | `#0B1420` | painéis escuros, scrims, texto sobre paper |
| `accent` | `#F0A500` | destaque único — kicker, badge, pill de CTA, marca |
| `accentDeep` | `#B97600` | kicker sobre card claro (mais contraste) |
| `paper` | `#F6F1E7` | card claro (variant "card") |
| `textOnDark` | `#FFFFFF` | texto principal sobre foto/scrim |
| `textOnDarkMuted` | `#B7C2CC` | subtítulo/handle sobre foto |

Uma cor dominante (ink), uma de destaque (accent), uma neutra clara (paper) —
sem paleta concorrente.

## Tipografia
Uma família: **Segoe UI** (fallback Arial). Escala:
- Kicker/eyebrow: 24px, weight 700, letter-spacing 3, uppercase, sempre `accent`
- Título/gancho (capa): 62px, weight 800
- Título (CTA): 54px, weight 800
- Corpo (variant bottom/side): 38–40px, weight 700
- Corpo (variant card): 34px, weight 600, cor `textOnPaper`
- Índice "03/08": 18px, weight 600
- Marca (wordmark): 24px weight 700 + 18px weight 400 (subtítulo/handle)

## Grid / arquétipos de slide (`SlideVariant`)
Cada slide escolhe um layout — nunca o mesmo em sequência, para dar ritmo:

- **cover** — foto full-bleed, scrim de baixo pra cima, kicker + título grande
  ancorados embaixo à esquerda, badge de índice, "DESLIZE →". Único slide com
  linha de destaque no topo (6px).
- **bottom** — explicativo padrão: scrim inferior (56% do quadro pra baixo),
  kicker + corpo. Usado para a maioria dos slides de processo.
- **side** — painel sólido `ink` ocupando 40% esquerdo (texto), foto nos 60%
  direitos, linha de destaque vertical na divisa. Dá variedade de composição.
- **card** — card `paper` flutuante (raio 20px, borda esquerda accent 8px)
  sobre a foto, usado para conteúdo tipo checklist/nota.
- **cta** — scrim mais forte, título de fechamento + pill amber clicável
  visualmente ("Chama no direct →"). Único slide com botão.

Todo slide carrega: badge de índice (`0N/0N`, canto superior direito) e
lockup de marca discreto (círculo amber + check, "Mais.car" + subtítulo +
@mais.car — nunca uma barra preta full-width).

## Fotografia (geração de imagem)
Provider: Pollinations, `model=flux` (não `turbo` — flux é muito mais
coerente para veículos), **sem** `enhance=true` (produziu resultados
distorcidos em teste — ver `content-review/bg-tests/`), gerado direto em
1080×1350 (não mais 1024×1024 recortado, que cortava a composição de forma
arbitrária).

Regras de prompt validadas em teste (`content-review/bg-tests/*.jpg`):
- Especificar tipo de veículo genérico (sedan/hatchback), nunca marca real.
- Evitar linguagem "dramática"/"dusk"/silhueta — colapsa o carro em uma
  mancha escura sem detalhe. Preferir "daylight" / "soft daylight" / "bright
  clean workshop".
- Especificar ângulo (front three-quarter / rear three-quarter / side /
  close-up de componente).
- Terminar sempre com "photorealistic, sharp focus".

## Regra de precisão para modelo específico
Este pool de temas (ver `themePool.ts`) é sobre PROCESSO, não sobre um
veículo real nomeado — por isso usar um sedan/hatchback genérico é seguro.
Se um tema futuro precisar retratar um modelo real específico, a regra do
`generate.ts` (nunca afirmar fato não verificável) se aplica também à
imagem: usar foto real teria que ser fornecida, não gerada por IA.
