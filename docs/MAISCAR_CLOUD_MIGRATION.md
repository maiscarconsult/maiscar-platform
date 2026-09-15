# MAISCAR_CLOUD_MIGRATION.md

Definitive plan for moving MAIS CAR production off the account owner's
Windows laptop + OneDrive + Docker Desktop stack, and onto a single
low-cost Linux VPS with S3-compatible object storage. Written
2026-09-15 in response to the "MIGRAÇÃO DEFINITIVA PARA CLOUD" brief.

This file is the ORCHESTRATOR PLAN. The technical building blocks it
delivers live at the repo root:

- `Dockerfile` — one image, Node + Chromium + FFmpeg + fonts + Prisma.
- `docker-compose.cloud.yml` — one-machine deployment (backend +
  scheduler + Postgres + Redis + Caddy).
- `.env.production.example` — categorized secret inventory.
- `.dockerignore` — keeps OneDrive junk out of the image.
- `.github/workflows/deploy.yml` — build image → push to GHCR → SSH
  deploy → smoke test.
- `scripts/cloud-smoke-test.ts` — 8-check readiness gate the CI runs
  BEFORE any Reel job dispatches.
- `scripts/deploy.sh` — bootstrap for a fresh VPS.
- `packages/backend/src/config/storage.ts` — R2 upload client that
  replaces the GitHub-release media bridge.

Nothing in the editorial pipeline changes. The MASTER stays
`MAISCAR_FULL_AUTONOMOUS_AVATAR_REEL_MASTER`. All P0 code (register
variety, screen evidence, hook block, powerpoint detector, hook / cover
scoring, B-roll relevance) stays.

---

## What the cloud stack replaces

| On-notebook today                        | Cloud replacement                              |
| ---------------------------------------- | ---------------------------------------------- |
| Windows + OneDrive workspace             | Linux VPS, `/srv/maiscar`, no cloud-file sync  |
| Docker Desktop                           | Docker Engine on Linux                         |
| Postgres in Docker Desktop               | Postgres in docker-compose, persistent volume  |
| Redis (BullMQ) on the same Docker Desktop| Redis in docker-compose                        |
| Remotion / Chromium bundled per Windows  | System Chromium from Debian apt (`chromium`)   |
| gh CLI + Windows keyring                 | GHCR auth via `GH_PULL_PAT` env var            |
| GitHub Release Assets media bridge       | Cloudflare R2 public bucket                    |
| Windows Task Scheduler 09:00 / 19:00     | node-cron inside the `scheduler` container     |
| `RUN-REEL-NOW.bat` + double-click        | GitHub Actions `workflow_dispatch` OR VPS cron |
| "Claude Desktop must stay open"          | Cowork monitors the VPS; jobs run without it   |

The account owner's laptop no longer participates in production. Cowork
still supervises through Git commits, GitHub Actions logs, and — when
the notebook is on — the same `device_bash` this session uses. When the
notebook is off, jobs proceed on the VPS on their own schedule.

---

## Provider stack (recommended)

| Layer                | Choice                                      | Monthly       | Free tier                | Why                                                                                     |
| -------------------- | ------------------------------------------- | ------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| Compute              | Hetzner Cloud **CX22** (2 vCPU AMD, 4 GB, 40 GB SSD) | **€3.79** | none                   | Cheapest EU VPS that comfortably renders Remotion; 20 TB/mo egress included             |
| Object storage       | Cloudflare **R2**                           | **$0**        | 10 GB + 1M reads / mo    | No egress fees — Meta ingest and viewer fetch don't cost anything                       |
| DB                   | Postgres 16 in the same VPS (persistent volume) | **$0**    | n/a                     | Simplest; ≈ 200 MB of relational state today. Migrate to Neon Free later if it grows    |
| Container registry   | GitHub **GHCR**                             | **$0**        | 500 MB private per repo  | Native to the CI, no third-party account                                                |
| CI                   | GitHub **Actions**                          | **$0**        | 2000 min/mo public/free  | Same account, no extra vendor                                                           |
| TLS                  | Caddy + Let's Encrypt                       | **$0**        | free                     | Automatic cert                                                                          |
| DNS + subdomain      | Cloudflare (via Cloudflare Registrar)       | **~$0-10/yr** | .com ≈ $10/yr            | Only needed if you want a permanent HTTPS health endpoint; R2 gives you a public URL   |

**All-in monthly: ~€3.79 (~US $4.20).** Everything else is free tier
for the account sizes MAIS CAR runs at today.

**Alternatives considered and rejected for the smallest deploy:**

| Option                            | Rejected because                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| DigitalOcean Basic $6/mo (1 vCPU, 1 GB) | 1 GB RAM won't hold Node + Chromium + Postgres together; OOM on the first render  |
| AWS Fargate + RDS + S3            | ~$30-40/mo minimum; over-engineered for a 2-Reel-per-day workload                       |
| Fly.io Machines                   | Suspends idle machines; scheduled 09:00/19:00 boots hit cold-start ~10-20s and can drop |
| Contabo VPS S ($4.50/mo, 4 vCPU)  | Cheaper per-spec but historically unreliable network; not worth the 60¢ savings         |
| Vercel / Netlify                  | No long-running processes; incompatible with Remotion render step (minutes-long)        |

---

## Cost ceiling / when to move up

The CX22 handles the current workload — 2 Reels/day, ~30s each, ~25 MB
per Reel, single Haiku call per Reel, hourly Insights sync — with plenty
of headroom. Trigger to upsize:

- CPU sustained > 70% during a render → CX32 (€6.80/mo, 4 vCPU, 8 GB).
- Postgres > 5 GB → migrate to Neon Free (0.5 GB — too small; use their
  Launch tier at $19/mo instead) OR move Postgres to its own CX22.
- R2 storage > 10 GB → $0.015/GB/mo excess is cheap; no action needed
  until 100+ GB.

---

## Migration order

Numbered stages. Each ends with a checkpoint the orchestrator (Cowork)
can resume from if a session drops.

### A. Preserve current code — DONE

All P0 files and docs are already committed to
`platform/` on the OneDrive-synced disk. The next stage moves them to
Git as the source of truth so OneDrive is no longer required to preserve
them.

### B. GitHub as source of truth — HUMAN ACTION REQUIRED

Cowork cannot create the Git remote by itself (it doesn't have write
credentials to a fresh GitHub account). Owner does this **once**:

1. Create empty private repo `maiscarconsult/maiscar-platform`.
2. On the laptop, in `content-intelligence-platform/platform/`:
   ```
   git init && git add -A && git commit -m "initial snapshot"
   git remote add origin git@github.com:maiscarconsult/maiscar-platform.git
   git push -u origin main
   ```
3. Add these Actions secrets to the repo:
   - `CLOUD_VPS_HOST` — VPS IP (from stage C)
   - `CLOUD_VPS_USER` — `maiscar`
   - `CLOUD_VPS_SSH_KEY` — private key generated in stage C
   - `GH_PULL_PAT` — a fine-grained PAT with `read:packages`

After that step, Cowork can commit and push edits through the same
`device_bash` bridge that already writes files to the mounted folder,
by simply `git commit && git push` from the mount — but only while the
notebook is on. Once the CI runs, further code changes flow: Cowork
edits → `git commit && git push` (or a PR merge) → Actions builds and
deploys.

### C. VPS provision — HUMAN ACTION REQUIRED (payment)

Owner does this **once**:

1. Sign up at hetzner.com/cloud (~$4/mo, credit card).
2. Create a CX22 in `nbg1` or `fsn1` (Germany).
3. Debian 12 image.
4. Add the SSH key from `ssh-keygen -t ed25519 -C maiscar-deploy`.
5. Note the IP; feed it into the `CLOUD_VPS_HOST` GH secret above.
6. `scp platform/scripts/deploy.sh root@<ip>:/root/ && ssh root@<ip>
   "bash /root/deploy.sh"` — one-time bootstrap.

Alternatives: DigitalOcean, Vultr, Linode all work; Hetzner is
recommended for cost.

### D. Cloudflare R2 — HUMAN ACTION REQUIRED (no payment yet)

Owner:

1. Sign up at cloudflare.com (free).
2. Create bucket `maiscar-media`.
3. Enable public access on the bucket (r2.dev subdomain is fine).
4. Create an R2 API token (read + write, bucket-scoped).
5. Fill `R2_*` in `.env.production`.

### E. Secrets — HUMAN ACTION REQUIRED (paste tokens, no payment)

Owner copies the current `.env` values into `.env.production` on the
VPS (paths: `META_APP_ID`, `META_APP_SECRET`, `ANTHROPIC_API_KEY`,
`PEXELS_API_KEY`, `INSTAGRAM_INITIAL_LONG_LIVED_TOKEN` — the last one
from a fresh 60-day IG login). File permissions `chmod 600 .env.production`.

### F. Container build — Cowork

Cowork writes the Dockerfile + `.dockerignore` + `docker-compose.cloud.yml`.
Verifies via CI (first `git push` triggers the workflow, which builds
the image on GitHub's Ubuntu runner and pushes to GHCR). No local Docker
needed.

### G. Cloud smoke test — Cowork

CI's `deploy.yml` invokes `cloud-smoke-test.ts` after every deploy. It
verifies Postgres, Redis, FFmpeg, Chromium, Remotion, TTS, R2, Meta
token. Fails the deploy on any single check that doesn't pass.

### H. First cloud publish — Cowork

Once smoke passes, Cowork triggers one render via a manual `POST
/jobs/run-once` (behind Basic Auth). The pipeline runs, renders, QAs,
uploads to R2, and calls the Graph API. If publish returns a permalink,
mediaId + permalink go into `ContentVersion.metadata`, and Cowork's
Insights sync starts collecting `+1h/+6h/+24h/+72h`.

### I. Enable 09:00/19:00 scheduling — Cowork

Only after H succeeds. Cowork edits `.env.production` on the VPS to
flip `SCHEDULER_ENABLED=true`, then `docker compose restart scheduler`.
node-cron takes over.

### J. Restart / duplicate-publish test — Cowork

Cowork validates:

- `docker compose restart backend` mid-render: the job stays `QUEUED`
  in Postgres, resumes on restart, does NOT double-publish (idempotency
  key checked against `instagramMediaId`).
- Duplicate `POST /jobs/run-once` returns 409 if a Reel with the same
  topic already published in the last 12h.

### K. Retire the notebook path — Cowork

`RUN-REEL-NOW.bat` and `scripts/run-reel-and-publish-now.ps1` are
labeled `DEPRECATED` in a header comment but left on disk as fallback.
Windows Task Scheduler entries are documented for removal in a
separate `deprecate-notebook.md`, executed only when the cloud path has
survived 7 consecutive days of scheduled runs.

---

## Data flow after migration

```
     git push (main)                             hourly cron
     ─────────────►  GitHub Actions            ────────────►
                        │                                    │
                        │  docker build + push               │
                        ▼                                    ▼
                  ┌─────────────┐                    ┌───────────────┐
                  │    GHCR     │                    │  scheduler    │
                  └──────┬──────┘                    │  container    │
                         │                            │ (node-cron)   │
                         │ ssh + docker pull          └──────┬────────┘
                         ▼                                    │
                  ┌─────────────────────────────────────┐    │
                  │            Hetzner CX22 VPS         │◄───┘  09:00 /
                  │                                     │        19:00 /
                  │  ┌──────────┐  ┌────────┐  ┌─────┐  │        insights
                  │  │ backend  │  │ Postgres│ │Redis│  │
                  │  │  + queue │──│         │ │     │  │
                  │  └────┬─────┘  └─────────┘ └─────┘  │
                  │       │                              │
                  │       │  Remotion → MP4 → sharp → cover
                  │       │                              │
                  │       └──────► R2 (public bucket)    │
                  │                                     │
                  │  Caddy → Let's Encrypt → /health    │
                  └─────────────────────────────────────┘
                                    │
                    R2 public URL ──┼──► Meta Graph API
                                    │      video_url ingest → media_publish
                                    ▼
                              instagram.com/reel/…
```

---

## Rollback

Each of the eight P0 files stays on the OneDrive-synced disk. The
`RUN-REEL-NOW.bat` + local Postgres + Docker Desktop path is preserved,
so if the cloud publish path has an unrecoverable failure the account
owner can still run a Reel manually from the laptop. Rollback path:

1. `git checkout main` on the laptop (same repo the cloud runs from).
2. Start local Docker Desktop.
3. `powershell -File scripts/run-reel-and-publish-now.ps1`.

The R2 bucket is the only piece that has no laptop fallback; if R2 is
down, the GitHub media bridge (`autonomousReelCycle.ts`'s existing
path) still works. That code is not deleted — it lives behind a feature
flag `USE_R2_STORAGE=true|false` in `.env.production`.

---

## What Cowork owns after this migration lands

- Editing code by writing to the repo (via `device_bash` on OneDrive
  today, via a direct GitHub commit tool when one is added later).
- Reviewing every Reel MP4 before its first cloud publish (SendUserFile
  on the R2 URL).
- Diagnosing failures by reading structured logs (`journalctl -u docker`
  and `docker compose logs backend scheduler`).
- Deciding when to switch `USE_R2_STORAGE`, when to enable
  `SCHEDULER_ENABLED`, when to flip `AUTO_PUBLISH_ENABLED`.

The owner is out of the operator loop unless a NEW secret (a new API
key, a payment reauthorization, a Meta identity re-verification) is
required.
