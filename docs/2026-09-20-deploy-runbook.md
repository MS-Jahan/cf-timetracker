# Production deploy runbook (T-W4, T-Z1-T-Z3)

**Date:** 2026-09-20
**Purpose:** every remaining production step, in order, executable by the account owner. Nothing here can be done from this repo alone - each step needs the Cloudflare dashboard or a logged-in `wrangler`.

## 0. Prerequisites

- A Cloudflare account with Workers, Pages, and D1 access.
- `npx wrangler login` (once) - then `wrangler whoami` shows the account.
- Decide the domains: e.g. Worker `tt-api.yourdomain.com`, Pages `timesheet.yourdomain.com` (a `workers.dev`/`pages.dev` subdomain works without a custom domain).

## 1. D1 - create production database and apply schema (T-Z2)

```bash
cd worker
npx wrangler d1 create cf-timetracker        # prints the real database_id
# put that id into worker/wrangler.toml [[d1_databases]] (replace placeholder-dev-local)
npx wrangler d1 execute cf-timetracker --remote --file=../db/schema.sql
npx wrangler d1 execute cf-timetracker --remote --file=../db/migrations/2026-09-19-single-running-timer.sql
npx wrangler d1 execute cf-timetracker --remote --file=../db/migrations/2026-09-19-master-data-archive.sql
# seed only if this is a demo account; production starts empty:
# npx wrangler d1 execute cf-timetracker --remote --file=../db/seed.sql
```

## 2. Worker - secrets and prod CORS (T-W4, T-Z2)

```bash
# Generate once; this value also goes into the GAS Script Property (step 4).
openssl rand -hex 32
npx wrangler secret put GAS_SECRET          # paste the value

# worker/wrangler.toml [vars] - replace "*" with the exact Pages origin(s):
# ALLOWED_ORIGINS = "https://timesheet.yourdomain.com[,https://www.yourdomain.com]"
```

Rules:

- `ALLOWED_ORIGINS` must list every origin the UI is served from (scheme + host + port, no trailing slash).
- Never commit the secret; `.dev.vars` stays local and gitignored.
- Access headers (`Cf-Access-Jwt-Assertion`) are already in the allowed CORS list.

## 3. Deploy Worker + Pages (T-Z3)

```bash
cd worker && npx wrangler deploy
cd ../web && npm run build && npx wrangler pages deploy dist --project-name cf-timetracker
# or connect the repo in the Pages dashboard: build "npm run build", output "dist",
# env VITE_API_BASE=https://tt-api.yourdomain.com
```

Custom domains: Pages dashboard → the project → Custom domains; Worker dashboard → Triggers → add route `tt-api.yourdomain.com/*`.

## 4. GAS receiver deployment (completes T-G1-G3)

1. New Google Sheet → Extensions → Apps Script → paste `gas/Code.gs`.
2. Project Settings → Script Properties → `SHARED_SECRET` = the same value as the Worker's `GAS_SECRET`.
3. Deploy → New deployment → Web app → Execute as **Me**, Who has access → **Anyone** → copy the `/exec` URL.
4. In the app: Settings → Sheets sync → paste the `/exec` URL → Sync. GAS ignores custom headers, so the Worker already sends the secret in the JSON body (`payload.secret`).
5. Prove dedupe: sync the same month twice; the second run must report the same sheet row count (GAS returns `{status:"success", count:0, skipped:N}`).

## 5. Cloudflare Zero Trust Access (T-Z1)

1. Zero Trust dashboard → Access → Applications → Add → **Self-hosted**.
2. Application domain: `timesheet.yourdomain.com` (the Pages UI). Add a second self-hosted app for `tt-api.yourdomain.com` so the API is not open to the internet.
3. Policy: Allow → Include → `emails ending in @yourcompany.com` (or specific emails). Login method: One-time PIN (default) and/or Google.
4. Optional hardening (Worker can later verify): check `Cf-Access-Authenticated-User-Email` / validate `Cf-Access-Jwt-Assertion` (team domain + AUD from the Access app) before touching D1. The CORS config already allows the JWT header.

## 6. Prod smoke checklist (record results in the task list)

| # | Check | Expected |
|---|---|---|
| 1 | Incognito → UI URL | Access challenge, then UI after PIN |
| 2 | `curl -s -o /dev/null -w '%{http_code}' https://tt-api.yourdomain.com/api/bootstrap` from a disallowed origin | CORS headers reflect `ALLOWED_ORIGINS` only |
| 3 | UI: start timer → stop timer | 200s; entry appears in ledger and D1 (`--remote` query) |
| 4 | UI: double-click start (two tabs) | one 200, one 409 `timer_running` |
| 5 | Settings → Sync Sheets (valid URL + secret) | `{status:"success",count:N}`; re-sync adds 0 |
| 6 | Wrong-secret sync (edit the Script Property temporarily) | error JSON, no rows added |
| 7 | `POST /mcp` `initialize` against prod | 200 with `protocolVersion` |
| 8 | `npm run verify` with `VERIFY_API_BASE=https://tt-api.yourdomain.com` | gate passes against prod |

## 7. Rollback

- Worker: `npx wrangler rollback` (or redeploy the previous image from CI history).
- Pages: deployments list → instant rollback to the previous build.
- D1: schema changes are additive (`ALTER`/`CREATE INDEX IF NOT EXISTS`); time-travel restore in the dashboard covers data mistakes (7-30 days).
