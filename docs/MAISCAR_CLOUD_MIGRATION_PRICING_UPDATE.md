# MAISCAR_CLOUD_MIGRATION_PRICING_UPDATE.md

Addendum to `docs/MAISCAR_CLOUD_MIGRATION.md`, 2026-09-15.

The owner asked to re-verify current cloud prices before contracting
and to bump the target compute to 4 vCPU / 8 GB / ~80 GB (so Node +
Chromium + FFmpeg + Postgres + Redis coexist with headroom during a
render). This file supersedes the pricing tables in the main plan.

---

## Verified compute price sweep — September 2026

| Provider | Plan     | CPU (arch)                | RAM | SSD | Egress    | Monthly (ex VAT) | + IPv4        | All-in ex VAT     |
| -------- | -------- | ------------------------- | --- | --- | --------- | ---------------- | ------------- | ----------------- |
| Hetzner  | **CX33** | 4 vCPU shared Intel/AMD x86 | 8 GB | **80 GB** | 20 TB/mo | **€8.49**      | **+€0.50**    | **€8.99 / ~US$9.85** |
| Hetzner  | CAX21    | 4 vCPU shared Ampere ARM  | 8 GB | 80 GB | 20 TB/mo | €10.49           | +€0.50        | €10.99 / ~$12.05  |
| Hetzner  | CPX32    | 4 vCPU dedicated-ish AMD EPYC | 8 GB | 160 GB | 20 TB/mo | **€35.49** ⚠️  | +€0.50        | €35.99 / ~$39.45  |
| Contabo  | Cloud VPS 4 | 4 vCPU shared, older gens | 8 GB | 100 GB | 32 TB/mo (200 Mbit cap) | US$6.60 intro / renewal opaque | included | ~$6.60 first 24 mo |
| DigitalOcean | Basic 4vCPU/8GB | 4 vCPU shared         | 8 GB | 160 GB | 5 TB/mo  | **US$48.00**   | included      | ~$48              |

**Hetzner June-2026 price shock** — CPX32 went from €13.99 to €35.49
(+154 %). CX33 rose from €6.49 to €8.49 (+31 %). The old MVP number
(€3.79 CX22) in the migration doc is stale for a 4 vCPU tier.

**Contabo caveats** — introductory price only for 24 months, no
published renewal rate, 200 Mbit/s port cap, older shared CPU
generations with variable performance. A Reel render that averages 5-8
min on Hetzner CX33 can drift to 15-20 min on Contabo when the host
neighbor is noisy. Not disqualifying, but not the recommendation for
a service that ships on a fixed 09:00 / 19:00 schedule.

**DigitalOcean caveats** — 5× the price of Hetzner for the same
spec. No advantage for this workload.

---

## Recommendation

**Hetzner CX33** — €8.49/mo + €0.50 IPv4 = **€8.99/mo ex VAT**,
about **US$9.85/mo** at 2026-09 EUR/USD ≈ 1.10.

Location: `nbg1` (Nuremberg, DE) or `fsn1` (Falkenstein, DE). Both
give ~30-45 ms to Meta's EU ingest endpoints — Brazil viewers hit the
Meta CDN directly, so VPS latency to Brazil does not matter here.

Spec fit against the workload:
- 4 vCPU x86_64 → Chromium (Remotion) + FFmpeg + Postgres + Redis all
  fit; render step uses ~2 vCPU, Postgres/Redis idle at ~5 %, the
  fourth core buffers the scheduler.
- 8 GB RAM → 3.5 GB Chromium peak + 1 GB Node + 512 MB Postgres +
  128 MB Redis + 1 GB Caddy/system overhead + ~2 GB slack.
- 80 GB SSD → docker images ~2 GB, generated cache with 30-day R2
  lifecycle stays under 3 GB steady-state, Postgres data starts at
  ~200 MB and grows slow. 80 GB is 20× current need.
- 20 TB traffic/mo included → publishing 2 Reels/day at 25 MB each is
  1.5 GB/mo. Comfortable ceiling.

Total operating cost (before Brazilian VAT):
- Hetzner CX33 + IPv4: **€8.99 / ~US$9.85**
- Cloudflare R2 (10 GB storage, 1 M reads, Class A ops < 1 M): **US$0**
- GHCR + GitHub Actions (private repo under free tier): **US$0**
- **Total: ≈ US$10 / mo** until the free tiers overflow.

Brazilian resident buying Hetzner: 17-19 % ICMS/PIS/COFINS on the
imported service invoice, ~€10.60 / ~US$11.60 all-in.

---

## R2 configuration (also verified)

- Bucket: `maiscar-media`
- Storage class: **Standard** (kept — Infrequent Access saves nothing
  at this write-once/read-few pattern below 100 GB).
- Public access: r2.dev subdomain enabled OR bind a
  `media.mais.car` custom domain (free with Cloudflare, no cost
  change).
- Lifecycle rules: three rules in `r2-lifecycle.json` at repo root:
  1. `reels/*` — auto-delete after 30 days.
  2. `temp/*` — auto-delete after 24 h.
  3. Any incomplete multipart upload — abort after 24 h.
- Storage math: 25 MB per Reel × 2 Reels/day × 30 days = 1.5 GB
  steady-state. Free tier absorbs 6× that.

Fallback: `USE_R2_STORAGE=false` in `.env.production` reverts to the
GitHub-release media bridge from `autonomousReelCycle.ts`. Not
recommended for production but preserved for outage days.

---

## What did NOT change

- Architecture (one VPS, docker-compose, Postgres in-container,
  Cloudflare R2, Caddy, GitHub Actions).
- Migration order (A → Q).
- The 09:00 / 19:00 gate: still `SCHEDULER_ENABLED=false` until one
  end-to-end cloud publish passes.
- Rollback plan: local Windows / Docker Desktop / `RUN-REEL-NOW.bat`
  labeled `LOCAL_DEV_ONLY` after cloud runs 7 days green, not deleted.

---

## Payment reality

Contracting Hetzner requires:
1. A verified account (email + phone + credit card).
2. First month prorated on card at server create.
3. Auto-renewal monthly.

Contracting Cloudflare R2 requires:
1. A free Cloudflare account (email).
2. A credit card on file for R2 (they charge $0 in free tier but the
   card must exist for overage).

Neither can be automated from this session. Both are the "PAYMENT /
ACCOUNT CREATION" blocker in the response format.
