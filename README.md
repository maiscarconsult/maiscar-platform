# Content Intelligence + Autonomous Content Generation Platform

## Visão geral do fluxo
Pesquisa → Coleta de dados → Análise → Inteligência → Estratégia → Geração →
Publicação → Métricas → Aprendizado → Nova geração.

## Arquitetura (MVP → alvo)

```
                         ┌───────────────────┐
                         │     Frontend       │  Next.js + TS + Tailwind
                         │  (Dashboard/Chat)  │
                         └─────────┬──────────┘
                                   │ HTTPS (JWT)
                         ┌─────────▼──────────┐
                         │    API Gateway      │  Express (rate limit, auth,
                         │   (backend/src)     │  RBAC, audit log)
                         └─────────┬──────────┘
                                   │
        ┌──────────────────────────┼───────────────────────────┐
        │                          │                            │
┌───────▼───────┐        ┌─────────▼─────────┐         ┌────────▼────────┐
│ Domain Modules │        │  AI Orchestrator   │         │  Job Queues      │
│ Org/Brand/     │        │  (Task Router →    │         │  (BullMQ+Redis)  │
│ Product/       │        │   AIProvider impls)│         │  generation,     │
│ Competitor/    │        │  text/image/video/  │         │  publishing,     │
│ Content/       │        │  embed              │         │  metrics-sync    │
│ Analytics      │        └─────────┬─────────┘         └────────┬────────┘
└───────┬───────┘                  │                              │
        │                          │                              │
        └──────────────┬───────────┴──────────────┬───────────────┘
                        │                          │
               ┌────────▼────────┐        ┌────────▼─────────┐
               │   PostgreSQL     │        │  Object Storage    │
               │  (Prisma ORM)    │        │  (S3-compatible)   │
               │  + pgvector      │        │  media assets      │
               │  (RAG/embeddings)│        └────────────────────┘
               └──────────────────┘
```

## Por que esta stack
- **Node.js/TypeScript** ponta a ponta: um único tipo compartilhado entre API e
  frontend (via `packages/shared` no futuro), menor superfície de bugs de
  serialização em um domínio com muitos DTOs (Content, Performance, Scores).
- **PostgreSQL + pgvector**: evita operar um vector DB separado (Pinecone/
  Weaviate) só para RAG no MVP; dá para migrar depois sem reescrever o schema
  relacional, que é o coração do produto (atribuição, séries temporais).
- **Prisma**: migrations versionadas e tipagem gerada — importante porque o
  schema (45+ entidades) vai evoluir por módulo.
- **BullMQ/Redis**: geração de imagem/vídeo e coleta de métricas são
  assíncronas por natureza (latência de provedores externos); precisamos de
  retry/backoff nativos.
- **AI Orchestrator com interface `AIProvider`**: nenhuma parte do domínio
  chama um SDK de IA diretamente — sempre passa pelo orquestrador, que decide
  o provider pelo `TaskRouter` (custo/latência/qualidade) e registra
  `AIGenerationLog` (request_id, prompt_version, custo, latência).

## Regras inegociáveis (seção 37/44 da spec)
1. Nenhum módulo pode inserir métricas/vendas fictícias no banco fora de
   `seed`/testes explicitamente marcados como mock.
2. Todo dado vindo de fonte externa carrega `source` e `confidence`.
3. Endpoints de insight devem retornar `insufficientData: true` quando a
   amostra for pequena, em vez de forçar uma conclusão.
4. Publicação automática só ocorre se `AutonomyLevel >= 4` E
   `approvalMode === 'AUTOMATIC'` explicitamente configurado pelo usuário.

## Ordem de implementação (seguida neste MVP)
1. Auth + Organization (multi-tenant, RBAC)
2. Brand + Product + Competitor
3. Content + ContentPerformance (banco central)
4. Analytics (ingestão + Revenue Content Score)
5. AI Orchestrator (interface + providers mock/OpenAI/Anthropic + Task Router)
6. Content Intelligence (pattern discovery + predictive scoring, com
   `insufficientData`)
7. Dashboard (Next.js) consumindo a API acima

Os módulos 12–19 da spec (vídeo, publishing multi-plataforma, autopublishing,
repurposing) ficam com a interface definida e o ponto de integração marcado
com `// TODO(providerName)`, prontos para plugar credenciais reais — não
foram mockados com dados falsos.
