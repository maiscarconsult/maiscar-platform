# Status do projeto — Content Intelligence Platform

Última atualização: 2026-08-12

## Como subir o ambiente local

```bash
cd content-intelligence-platform/platform
docker compose up -d postgres redis
npm run dev:backend    # -> http://localhost:4000
npm run dev:frontend   # -> http://localhost:3000
```

No Windows, se `Start-Process npm` der erro "não é um aplicativo Win32 válido", rode via `cmd /c npm run ...` (npm é um `.cmd`, precisa passar pelo cmd.exe).

Se o Postgres demorar muito pra aceitar conexão depois de um restart do Windows/Docker: é porque o volume de dados do container fica dentro da pasta sincronizada pelo OneDrive, e o disco fica mais lento durante um recovery (`fsync`). É normal levar 2-3 min nesse caso específico; depois disso, sobe rápido.

## Conta real

- Login: `vitor-flavio@hotmail.com` (senha definida pelo próprio usuário — não fica registrada aqui).
- Organização/marca: **Mais.car** (`organizationId e20b49b4-2835-4e90-bb41-95b1aab11007`, `brandId 09dc8dec-34e9-4588-97d9-031b820c8a64`).
- 8 concorrentes já cadastrados nessa marca (todos via Instagram, `dataSource: user_provided`): Autonow, Carro Perfeito, RB Consultoria Automotiva, Marcelo Toledo, Verificar BH, VISTCAR, OMEGA Consultoria Automotiva, Perito Automotivo Brasília. Assim que a conexão Meta for aprovada, `POST /api/competitors/:id/sync-instagram` já puxa os posts reais de cada um sem precisar recadastrar nada.
- Ainda existe uma organização de teste separada ("QA Org" / "QA Brand", login `qa-test@example.com`) usada só pra validar os endpoints antes de criar a conta real — pode ser ignorada ou apagada quando quiser.

## O que já funciona (testado ao vivo)

- **Backend + Frontend + Postgres (pgvector) + Redis**: rodando localmente sem erros.
- **Autenticação** (`/api/auth/register`, `/api/auth/login`) com JWT.
- **Geração de ideias de conteúdo** (`POST /api/content/generate-ideas`): usa Anthropic (Claude) como provider de texto — funcionando, com fallback automático se o provider preferido falhar.
- **Geração de imagem** (`POST /api/content/:id/generate-image`): usa **Pollinations.ai** (gratuito, sem chave) como provider padrão. Testado, gera JPEG real.
- **Geração de vídeo** (`POST /api/content/:id/generate-video`): implementado com Replicate (modelo `kwaivgi/kling-v1.6-standard`), mas cai no mock até o `REPLICATE_API_TOKEN` ser configurado.
- **Inteligência de concorrentes**: `instagramDiscovery.ts` usa a API oficial de Business Discovery da Meta pra ler posts públicos de concorrentes (sem precisar autorização deles) — depende da própria conta Meta estar conectada (ver bloqueio abaixo).
- **Métricas da própria conta** (`metaAdapter`): lê followers/reach/impressions/profile views via Graph API Insights — mesma dependência da conexão Meta.

## Bloqueios em aberto

### 1. Conexão com a conta Meta (`@mais.car`)
- Precisa de uma verificação de identidade aprovada no Portfólio Empresarial "Mais.car" pra poder conectar o app e gerar um token de sistema.
- **Duas tentativas rejeitadas** (PDF, depois JPG) — causa provável identificada: o campo "Nome" do portfólio estava incompleto ("Vitor Flavio", faltando "Cabral de Siqueira"). **Corrigido em 2026-08-13** e uma **terceira submissão já enviada** (Identificação `2180848612645691`) — está "Em análise", resposta em até 48h.
- Não existe canal de suporte humano acessível dentro do `business.facebook.com` pra essa conta (só autoatendimento). O único canal real é `developers.facebook.com/support/` (ticket, responde em 2 dias úteis) — mas esse domínio não pode ser aberto por automação (Claude in Chrome bloqueia), só manualmente pelo usuário. Qualquer "telefone de suporte da Meta" em busca no Google **é golpe**.
- Ao aprovar: conectar app `1374821967399920` ao portfólio `312650138599188` → criar Usuário do Sistema → gerar token → preencher `META_APP_ID`/`META_APP_SECRET`/token no `.env`.

### 2. Geração de vídeo por IA (Replicate)
- Falta criar conta em replicate.com e gerar um `REPLICATE_API_TOKEN`.
- Uma tentativa anterior de cadastro (via GitHub) deu erro "Unable to sign up" (possível checagem antifraude por conta nova) — não confirmado se já resolveu.

### 3. Créditos OpenAI
- A chave da OpenAI é válida mas a conta está sem crédito (`credit_balance_exhausted`). Não bloqueia nada (Pollinations cobre imagem, Anthropic cobre texto), só limita usar o modelo `gpt-image-1` da OpenAI especificamente se quiser qualidade superior no futuro.

## Decisões de produto já tomadas (não mudar sem confirmar de novo)
- Roteamento de IA: texto rascunho prioriza OpenAI, texto final prioriza Anthropic.
- Imagem: Pollinations como padrão (grátis) até decisão em contrário.
- Não fazer scraping de seguidores/audiência de concorrentes — só usar dados públicos via API oficial (Business Discovery), nunca estimar audiência de contas de terceiros.
- **Estratégia de conteúdo (2026-08-12)**: **carrosséis de fotos** (gerados via Pollinations, grátis) em vez de vídeo com avatar de IA (HeyGen) — decisão consciente pra economizar no início. Rodapé usa só a marca "MAISCAR CONSULTORIA AUTOMOTIVA" (sem foto pessoal, por decisão do usuário). HeyGen (Avatar V, treina com 15s de vídeo seu) fica como próximo passo se quiser escalar pra vídeo com você como personagem — custo estimado ~US$0,05-0,07/segundo gerado.
- **Cadência**: 2 posts/dia, ajustando pelos resultados. Linha editorial mistura autoridade técnica, diferenciação, case real, prova social e notícia/polêmica do setor (recall, fraude) — sempre com fonte citada.
- **Identidade visual (2026-08-13)**: cor de destaque fixa âmbar/dourado (`#F0A500`) aplicada em toda imagem gerada (barra superior, rodapé, faixa lateral do painel de texto) + um tratamento de cor uniforme (dessaturação leve + tint azulado-escuro) sobre qualquer foto de fundo gerada, pra manter uma identidade visual consistente entre os posts mesmo com fundos de IA completamente diferentes. Formato 1080x1350 (proporção 4:5, padrão nativo do feed/carrossel do Instagram).

## Compositor de imagem (implementado em 2026-08-13)

- `packages/backend/src/modules/content/imageComposer.ts` — sobrepõe o texto do slide + rodapé de marca numa imagem de fundo já gerada, usando `sharp` + SVG. Serve os arquivos localmente em `/generated` (Express static) até `S3_*` ser configurado.
- **Bug encontrado e corrigido**: `sharp` aplica `.tint()`/`.modulate()` no output final inteiro no momento da codificação, não por camada na ordem das chamadas — mesmo com `.composite()` vindo depois no código, a camada de texto/SVG ficava sendo re-tintada junto. Corrigido rodando o tint num pipeline separado (gera os bytes do fundo já tratado primeiro, depois um segundo `sharp()` só pra compor o SVG por cima).
- `POST /api/content/:id/generate-image` aceita `slideText` opcional — quando presente, compõe o carrossel; sem ele, continua funcionando como geração de imagem simples de antes.
- Script `packages/backend/generate-all-carousels.ts` gera as 36 imagens dos 7 carrosséis de uma vez (1 fundo por carrossel, reaproveitado em todos os slides daquele carrossel pra manter coerência visual) — resultado em `Desktop/Claude/carrosseis/<slug>/slide-N.png` + `manifest.json`.

## Estratégia de conteúdo: carrosséis inspirados nos concorrentes (não copiados)

Cada carrossel é baseado no padrão do post de melhor desempenho de um concorrente (gancho, estrutura, CTA), mas com texto e ângulo originais — nunca copiado verbatim. Roteiros completos em `roteiros-concorrentes.md` (nesta pasta e em `Desktop/Claude/`). Os 36 slides já renderizados estão em `Desktop/Claude/carrosseis/` — prontos pra você postar manualmente hoje; publicação automática aguarda a aprovação do Meta.

## Frontend: sessão real + tela de revisão de conteúdo (implementado em 2026-08-13)

Antes disso, o frontend só tinha uma tela de analytics com "autenticação" via token na URL (`/dashboard?token=...`) — nada de sessão de verdade, nenhuma tela pra ver/aprovar o que a IA gera. Implementado:

- **Sessão via cookie httpOnly**: `POST /api/auth/login` e `/register` agora também setam um cookie `session` (httpOnly, `sameSite=lax`, 7 dias). `requireAuth` aceita `Authorization: Bearer` OU o cookie. Novo `GET /api/auth/me` (retorna usuário + orgs a partir da sessão) e `POST /api/auth/logout`.
- **`/login`**: formulário de email/senha (client component), faz login com `credentials: "include"` pra gravar o cookie no navegador.
- **`/content`**: tela de revisão (server component) — lista todo `Content` da organização com suas `ContentAsset` (mostra a imagem), badge de status, e botões **Aprovar**/**Rejeitar** (Server Actions que chamam `PATCH /api/content/:id/status` → `APPROVED`/`ARCHIVED`). Como server components não recebem cookies automaticamente em fetch cross-origin, o cookie da requisição é repassado manualmente (`headers().get("cookie")` → `Cookie` header na chamada pro backend).
- `GET /api/content` agora inclui `assets` (antes só trazia `performance`) — sem isso a tela não teria como mostrar as imagens.
- **36 slides dos carrosséis populados como registros reais** (`Content` status `REVIEW` + `ContentAsset`) via `packages/backend/seed-carousel-content.ts`, pra tela já nascer com conteúdo de verdade pra revisar.
- Testado ponta a ponta (login → cookie → `/content` renderizando imagens + botão Aprovar) — **atenção**: `Invoke-WebRequest` do PowerShell não envia o header `Cookie` corretamente quando setado manualmente via `-Headers` (usa só `-WebSession`/`-SessionVariable` de verdade) — isso mascarou um "bug" que não existia. Testar auth com cookie manual sempre via `node -e "fetch(...)"` ou `curl`, nunca via `-Headers @{Cookie=...}` do PowerShell.
- **Falta ainda**: página de login/senha continua sem "esqueci minha senha", cadastro de concorrentes ainda só via API, e o botão Aprovar não dispara nenhuma publicação (correto — só existe `PublishingJob`/token quando o Meta aprovar).
