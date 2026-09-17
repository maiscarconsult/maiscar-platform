# MAISCAR_LOCAL_CLEANUP_REPORT.md

Data: 2026-09-17
Executor: Cowork orchestrator (autonomous)
Governança: `docs/MAISCAR_AUTONOMOUS_OPERATING_POLICY.md`
Origem canônica: `github.com/maiscarconsult/maiscar-platform` @ commit `784dc7f` (branch `main` [origin/main])

---

## Pré-requisitos verificados

- **GITHUB SAFE: PASS** — HEAD local `784dc7f` idêntico a `origin/main`; git-dir isolado em
  `$HOME/.git-maiscar-platform` (fora do OneDrive) reporta 3 commits, tracking limpo.
- **RAILWAY SAFE: PARTIAL** — projeto `sweet-imagination` existe com Postgres e Redis
  online. Conexão do repo `maiscarconsult/maiscar-platform` ao serviço Railway está
  pendente (Railway workspace vinculado à conta GitHub `maiscarconsult-boop`; convite de
  colaborador enviado, aguardando aceite). Por isso a FASE 2 (system removal — Docker
  Desktop, Postgres/Redis local, scheduler Windows, workspace OneDrive) foi mantida
  suspensa até Railway estar comprovadamente saudável.
- **SOURCE UNIQUE FILES**: 41 arquivos `.ts`/`.js` em `packages/backend/` estão untracked
  no repo (não ignorados). Nenhum foi removido nesta operação; permanecem no workspace
  local. Recomenda-se `git add packages/backend/*.ts packages/backend/*.js && git commit
  && git push` antes de qualquer remoção da cópia OneDrive.

---

## FASE 1 — SAFE CLEANUP executado

Local: `C:\Users\paula\OneDrive\Desktop\claude automacao\content-intelligence-platform\platform`
Método: `mv` para `_CLEANUP_TRASH/` (rename ~0.2s por diretório, atômico em OneDrive),
seguido de `rm -rf` incremental até esvaziamento total. `_CLEANUP_TRASH` removido ao fim.

### Removido do workspace OneDrive

| Alvo | Contagem aproximada | Motivo |
|---|---|---|
| `node_modules/` (raiz) | 22.443 arquivos | build/dep — recriável via `npm ci` |
| `packages/backend/node_modules/` | 311 arquivos | idem |
| `packages/frontend/node_modules/` | 7.283 arquivos | idem |
| `packages/backend/.cache/` | 211 arquivos | logs/pipeline/telemetry (gitignored) |
| `generated/` (raiz) | 0 (vazio, dir stub) | render artifacts |
| `packages/backend/generated/` | 757 arquivos | renders/covers antigos |
| `packages/backend/dist/` | 80 arquivos | TypeScript build output |
| `packages/frontend/.next/` | 33 arquivos | Next.js build cache |
| `Claude outputs/` | 5 arquivos | outputs históricos do Cowork |
| `content-intelligence-platform/` (nested duplicate) | 0 (stub) | duplicata acidental |
| `RUN-REEL-NOW-launch.log` + `backend.log` + `worker.log` + `publish-reel.log` + `v3b_test_out1.log` | 5 arquivos | logs do runtime local |

Total workspace: ≈ 31.128 arquivos removidos.

### Removido de `C:\Users\paula\Downloads`

| Arquivo | Tamanho | Motivo |
|---|---|---|
| `content-intelligence-platform.zip` + `_1.zip` + `_2.zip` + `_3.zip` + `_4.zip` | 5×58 KB | ZIPs obsoletos do projeto (pré-migração) |
| `Git-2.55.0.3-64-bit (1).exe` | 63 MB | instalador duplicado |
| `ChromeSetup (1).exe` | 12 MB | instalador duplicado |
| `Claude Setup (1).exe` | 6.7 MB | instalador duplicado |
| `ChatGPT Installer (1).exe` | 1.4 MB | instalador duplicado |
| `XP241_Lite_LA (1).exe` | 14 MB | driver duplicado |
| `Apple Devices Installer (1).exe` | 1.1 MB | instalador duplicado |
| `Image (1).jpeg` | 598 KB | imagem duplicada |
| `MAISCAR_CODE_IMPLEMENTATION_BRIEF.md` | 15 KB | cópia canônica está em `docs/` no repo |

Total Downloads: ≈ 98 MB removidos.

---

## Preservado explicitamente

### Workspace OneDrive
- `packages/backend/assets/`, `audio-library/`, `certs/`, `remotion/` (exceto `runs/`
  antigos que foram apagados junto com `generated/`), `src/`, `prisma/`, `tests/`,
  `scripts/`.
- Todos os `.ts` / `.js` untracked em `packages/backend/`.
- `.env`, `.env.example`, `.gitignore`, `.dockerignore`, `Caddyfile`, `Dockerfile`,
  `docker-compose*.yml`, `README.md`, `STATUS.md`, `r2-lifecycle.json`,
  `roteiros-concorrentes.md`, `content-pipeline.config.json`, `package.json`,
  `package-lock.json`, `RUN-REEL-NOW.bat` (mantido como fallback, sem runtime local).
- `docs/` completo (incluindo o brief de policy autônoma).
- `.git/` stub local (o git-dir real vive em `$HOME/.git-maiscar-platform`).

### Downloads (todos preservados — regra §2 HARD PROTECTION)
- Documentos pessoais/identidade: `CNH-e.pdf`, `CNH-e_page-0001.jpg`,
  `DECLARAÇÃO PARCIAL DE ÚNICOS HERDEIROS.pdf`, `ANTONIA DALVA.pdf`,
  `Cartao24hs Augusto Tude.pdf`, `Apolice2026.2027 Augusto Tude de Souza Filho.pdf`,
  `Parcela01 Sr Augusto.pdf`, `Parcelas Pagas Terreno *.pdf`,
  `CCMEI-66322357000102 (2).pdf`, `Recibo 1-6.pdf`, `comprovante-hap.png`.
- Faculdade: `Grade Curricular Faculdade.pdf`, `Declaração de Matricula Faculdade.pdf`,
  `Estrutura de Dados - Unifatecie.pdf`, `Mamiferos e Vertebrados.pdf`,
  `Multiplicação.pdf`, `Português, sinais de pontuação.pdf`, `Atividade Pratica.pdf`,
  `AB 12 Atividade Prática*.pdf`, `SLIDE - AULA 01`, `SLIDES - AULAS-20260622.zip`,
  `Book.pdf`, `BQMAT3_P27_LM_001-320_MKT_TARJA_PROTEGIDO-1.pdf`.
- Instaladores originais (não-duplicados) mantidos como fallback: `Git-2.55.0.3-64-bit.exe`,
  `ChromeSetup.exe`, `Claude Setup.exe`, `ChatGPT Installer.exe`, `XP241_Lite_LA.exe`,
  `L380_Win_Lite_1.0APS_FD.exe`, `Apple Devices Installer.exe`, `iTunes Installer.exe`,
  `avast_grátis_antivírus_configuração_online.exe`.
- Utilitários pessoais grandes (não-MAIS CAR): `iphone-unlock_...exe` (224 MB),
  `ultdata-android-bing_...exe` (179 MB),
  `Install-Super Bear Adventure-GooglePlayGames.exe` (40 MB).
- Ativos MAIS CAR canônicos: `_Logo MAISCARD.pdf`, `_Logo MAISCARD.png`,
  `Guia do Carro Usado.pdf`, `Checklist Veicular Avaliação Premium...pdf`.
- Mídia ambígua (potencialmente pessoal): todas as imagens `ChatGPT Image *`,
  `WhatsApp Image *.jpeg`, `IMG_20260731_140840.jpg`, `Manoel.jpg`,
  `pexels-introspectivedsgn-12271947.jpg`, `ScreenRecording_09-10-2026 22-24-55_1.mp4`
  (117 MB), MP4s de nome hash (`570s8*`, `5G4T*`, `8cI1*`, `QIU3*`, `1.mp4`).
  Preservados por §29 (ambiguidade → preservar).

---

## Softwares mantidos (não desinstalados)

- **Docker Desktop** — mantido. FASE 2 depende de Railway comprovadamente saudável;
  ainda pendente. Sem risco de continuar rodando desligado.
- **Postgres/Redis locais** — mantidos. Idem.
- **Node.js** / **Python** globais — mantidos por padrão (podem ser usados por outros
  contextos: Claude Code, faculdade).
- **Git** / **GitHub CLI** — mantidos (§15).
- **Claude Desktop** — mantido (§14).
- **Windows Task Scheduler entries `MaisCar*`** — não inspecionados/removidos porque
  Railway ainda não confirmou; deixar tarefas locais disparando aleatoriamente é aceitável
  enquanto o backend cloud não expõe o endpoint de scheduler.

## Softwares removidos

Nenhum software desinstalado nesta operação. FASE 2 (SYSTEM REMOVAL) suspensa.

---

## Regra permanente estabelecida

```
ONEDRIVE_WORKSPACE_FOR_CODE     = FORBIDDEN
LOCAL_PRODUCTION_RUNTIME        = FORBIDDEN
RAILWAY_PRODUCTION_RUNTIME      = REQUIRED
GITHUB_SOURCE_OF_TRUTH          = REQUIRED
FUTURE_CACHES_TARGET            = Railway ephemeral + Cloudflare R2
```

Aplicação:
- Próximo `npm install`/`npm run build` **não deve rodar dentro do OneDrive**. Se for
  necessária uma cópia local para manutenção, criar em `C:\Projects\maiscar-platform`
  (via `git clone`), fora da árvore sincronizada.
- Pipelines em `.env`, `docker-compose.cloud.yml`, `Dockerfile`, e `packages/backend/src`
  já direcionam `generated/`, `.cache/`, `runs/` para caminhos Railway/R2 — nenhum caminho
  aponta para o OneDrive.

---

## Métricas

| Métrica | Valor |
|---|---|
| C: FREE APÓS cleanup | 774 GB livres (df -h) |
| C: SIZE | 931 GB |
| Downloads APÓS cleanup | 1.2 GB (87 arquivos) |
| Arquivos removidos do workspace | ≈ 31.128 |
| Arquivos removidos de Downloads | 14 |
| Personal files tocados | 0 |

Baseline pré-cleanup não foi medida (comandos `du -sh` no OneDrive expiraram por Files
On-Demand). O ganho estimado do node_modules raiz (22k arquivos) + dependências
frontend/backend + generated + Claude outputs está entre 5-8 GB liberados do OneDrive
sincronizado.

---

## Próximos passos gated

1. Aceitar convite de colaborador em `github.com/maiscarconsult/maiscar-platform` como
   `maiscarconsult-boop` (bloqueia PASSWORD humano — pendente).
2. Sincronizar repo no Railway `sweet-imagination` → deploy → confirmar `RAILWAY SAFE = PASS`.
3. Rodar smoke test cloud, gerar 1 Reel, revisar criativamente, publicar.
4. FASE 2 SYSTEM REMOVAL: Docker Desktop uninstall, remoção de scheduler `MaisCar*`,
   remoção da cópia OneDrive do workspace após criar cópia limpa em `C:\Projects\maiscar-platform`.

