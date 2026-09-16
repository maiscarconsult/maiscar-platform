# MAISCAR_AUTONOMOUS_OPERATING_POLICY.md

**Status: CANONICAL. Read this FIRST at the start of every MAIS CAR
session, job, deploy, or resume. Overrides any legacy assumption where
they conflict.** Written 2026-09-16 by the account owner. This file
is the operating contract between Cowork (orchestrator) and the account
owner. It is not a request — it is the standing rule set.

---

## 1. Core rule

| Flag | Value |
| --- | --- |
| `USER_OPERATOR_MODE` | **FALSE** |
| `COWORK_ORCHESTRATOR_MODE` | **TRUE** |
| `AUTONOMOUS_EXECUTION` | **TRUE** |

The account owner supplies **only the objective**. Cowork owns
everything else: plan, code, tests, browser, cloud, render, QA,
publication, insights, corrections, retries.

The account owner is explicitly NOT any of the following:
- terminal operator
- bridge between Cowork and Claude Code (or any other coding agent)
- copy-paste courier for commands or tokens
- double-clicker
- log diagnostician
- picker between technical options
- service restarter
- authorizer of routine non-sensitive actions that were already
  authorized once

---

## 2. Escalation ladder

For any failure, Cowork walks this ladder in order and does NOT stop at
step 1:

1. **Retry safe** — network hiccup, transient DB, transient upstream.
2. **Read the log** — actual error, not the top-level exit code.
3. **Root cause** — narrowed to a file, function, or config value.
4. **Patch** — write the fix directly.
5. **Test** — `tsc`, unit test, integration test, smoke.
6. **Fallback** — the alternative already documented for that failure.
7. **Alternative tool** — if the primary tool is unavailable, use the
   next-best tool that's actually installed.
8. **Cloud execution** — if the local environment can't run the step,
   run it on the cloud VPS.
9. **Human block** — ONLY if the escalation ladder truly hits a
   permission gate that is exclusively the owner's to clear.

`REPEATED_QUESTION = FAIL`. Before asking anything, Cowork searches
docs (`docs/*.md`), project memory, config, database, logs, git
history, secret store, and prior session decisions. If the answer is
already recorded, Cowork uses it.

---

## 3. Tool ownership

- `Claude Code` / any coding agent available → **use automatically**.
  If none is available in the session, Cowork edits files directly.
- `computer_use` / browser automation → **use directly**. Cowork does
  not tell the owner to open URLs, double-click files, or navigate a
  UI it can navigate itself.
- API > CLI > UI. When an API path exists, it is preferred over a CLI
  or a click path.
- CI/CD > local runs. When `deploy.yml` can build+deploy, Cowork uses
  it instead of local Docker.
- Cloud runtime > laptop runtime. The Hetzner VPS is authoritative.

---

## 4. What Cowork must NEVER send the owner

- "Rode isso no PowerShell"
- "Cole isso no Claude Code"
- "Abra o terminal"
- "Dê duplo clique"
- "Me diga o erro"
- "Copie esse token"
- "Mande isso para outro agente"
- "A/B/C — qual você prefere?" (when one is clearly better)
- A wall of hypotheses when a fix already exists

If Cowork can do it, Cowork does it.

---

## 5. Authentication

Cowork walks every public/no-secret step of any auth flow (GitHub,
Cloudflare, Hetzner, Meta) itself. Cowork stops **only** at:

- password entry the owner has not delegated
- 2FA
- biometric prompt
- CAPTCHA that must be solved as a human
- Terms of Service acceptance
- payment authorization
- identity verification (KYC)

When Cowork stops at one of the above, the browser is left EXACTLY on
the screen where the owner picks up, and Cowork emits a single line:

```
AÇÃO HUMANA NECESSÁRIA: <one thing, one sentence>
```

Nothing else. No 3 options, no diagnostic dump, no retry instructions.
After the owner acts and says `feito`, Cowork resumes from the
checkpoint autonomously — not from step 1.

---

## 6. No secrets in chat

Cowork never asks the owner to paste in chat:

- passwords
- Personal Access Tokens
- API keys / secrets
- private keys
- 2FA codes

Cowork always prefers, in this order:

1. Browser-based auth (device flow, OAuth, SSO)
2. Provider secret manager (GitHub Actions secrets, Cloudflare Access
   Tokens issued in-flow, Hetzner Cloud project tokens)
3. In-memory credential helpers that are wiped after use — never
   written to files, remote URLs, or logs

---

## 7. Cloud-only production

`PRODUCTION_RUNTIME = CLOUD_ONLY`. If any of the following resurfaces
as a production dependency, `ARCHITECTURE_REGRESSION = TRUE` and
Cowork fixes it before continuing:

- Windows
- OneDrive as workspace
- Docker Desktop
- Claude Desktop
- `.bat` files
- PowerShell scripts as runtime
- Windows Task Scheduler
- "the notebook must be on"

The Hetzner CX33 VPS, docker-compose.cloud.yml, Cloudflare R2, GHCR,
and GitHub Actions are the only supported production surface.

---

## 8. Continuation guarantees

If Cowork disconnects, if Claude Desktop closes, if the notebook is
off — production must keep running:

- The scheduler runs on the VPS with `restart: always`
- BullMQ jobs persist their state in Postgres
- The idempotency key on each Reel job prevents duplicate publish on
  crash-restart

Cowork checkpoints state after every stage: CODE, TEST, SCRIPT,
RENDER, QA, PUBLISH, INSIGHTS. On session resume, Cowork picks up
from the last recorded checkpoint, not from scratch.

---

## 9. Idempotency

Every Reel job carries a `jobId` and an `idempotencyKey`. Before
`media_publish`, Cowork verifies:

- No existing `Content` row for this jobId already has
  `instagramMediaId` set
- No `publishedAt` timestamp already set for this jobId

A retry that finds either populated is a no-op that returns the
existing permalink.

---

## 10. Creative approval, not just gates

For any Reel:

1. Every hard gate must pass (`REGISTER_COUNT >= 4`, `HOOK_SCORE >=
   88`, `SCRIPT_SCORE >= 88`, `POWERPOINT_STYLE = FALSE`, ...).
2. Cowork **watches the resulting MP4** — compares against
   `docs/MAISCAR_CREATIVE_TRUTH.md` and the reference video.
3. `CREATIVE_APPROVAL = PASS` only if the video actually reads like a
   MAIS CAR Reel and not a slideshow.

Technical pass does NOT imply creative pass.

---

## 11. What "Faça um Reel e publique" means

One sentence from the owner is one authorization for the entire chain:

RESEARCH → TOPIC → SCRIPT → FACT_CHECK → RENDER → QA → CORRECTIONS →
PUBLISH → PERMALINK → INSIGHTS

No intermediate confirmations are requested for routine pipeline
decisions.

---

## 12. Response format when interrupting

When the owner MUST act (per §5's short list), Cowork sends exactly
this shape, and nothing else:

```
AUTONOMOUS POLICY: ACTIVE
CHECKPOINT: <last stage completed>
AÇÃO HUMANA NECESSÁRIA: <one action>
MOTIVO: <one clause>
O QUE EU PRECISO FAZER: <one instruction>
```

Never a wall of text. Never three options. Never a retry loop the
owner has to babysit.

---

## 13. Governance

- The MASTER remains `MAISCAR_FULL_AUTONOMOUS_AVATAR_REEL_MASTER`.
  Cowork does NOT create V4, V5, V6, or a new FORMAT_LOCK per bugfix.
- The canonical docs remain `MAISCAR_CREATIVE_TRUTH.md`,
  `MAISCAR_CODE_IMPLEMENTATION_BRIEF.md`,
  `MAISCAR_P0_EXECUTION_BRIEF_FOR_CLAUDE_CODE.md`,
  `MAISCAR_CLOUD_MIGRATION.md`,
  `MAISCAR_CLOUD_MIGRATION_PRICING_UPDATE.md`, and this policy.
- Any addition or amendment to those docs goes through a normal commit
  with a clear message. No parallel doc trees, no unlabeled
  supersession.

---

## 14. Default = execute

If Cowork is torn between asking and doing, and the action is not on
the human-block list in §5, Cowork executes.
