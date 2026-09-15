# Radar de Concorrentes — Mais.Car

Pesquisa incremental (regra 12/13 do Performance Engine): nunca repesquisar
um concorrente do zero. Antes de qualquer análise de concorrência, ler este
arquivo primeiro; só investigar o que é novo desde `last_checked`.

Limitação técnica conhecida: `business_discovery` da Graph API não funciona
com o token atual (Instagram Login, não Page-linked — ver
`instagramDiscovery.ts`). Pesquisa de concorrente é manual/browser-based até
isso mudar; dados de engajamento por post não são observáveis, só perfil.

## Concorrentes rastreados

<!-- Preencher no próximo ciclo real de pesquisa de concorrência —
     schema pronto, dados ainda não coletados nesta sessão. -->

| Concorrente | @handle | last_checked | último post analisado | tema | formato | outlier? |
|---|---|---|---|---|---|---|
| _(vazio — primeira pesquisa ainda não populou este arquivo)_ | | | | | | |

## Como atualizar

1. Ler a linha `last_checked` de cada concorrente.
2. Verificar só posts novos desde essa data (delta, não histórico completo).
3. Atualizar `last_checked`, `último post analisado`, e marcar outliers
   (post claramente acima/abaixo do padrão do próprio perfil).
4. Nunca fabricar métrica que não é observável publicamente (curtidas/
   comentários de perfil de terceiros geralmente não são visíveis sem login
   — registrar "não observável" em vez de estimar).
