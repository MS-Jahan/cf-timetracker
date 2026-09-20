# Demo deploy runbook (Cloudflare)

**Date:** 2026-09-20
**Purpose:** deploy this app as a public demo with demo mode (splash, banner, reset endpoint) enabled. Companion to `2026-09-20-deploy-runbook.md` (full production hardening). Steps below reflect the **actual** deployment done on 2026-09-20.

## Live URLs

| What | URL |
|---|---|
| UI (Pages) | https://cf-timetracker.pages.dev |
| API (Worker) | https://cf-timetracker-api.ssarwarjahan.workers.dev |
| MCP | `POST https://cf-timetracker-api.ssarwarjahan.workers.dev/mcp` |

**Naming rule:** the Worker is named `cf-timetracker-api`, **not** `cf-timetracker`. Workers and Pages now share one namespace — a Worker named `cf-timetracker` blocks creating the Pages project `cf-timetracker` (and therefore `cf-timetracker.pages.dev`). If you redeploy, keep `name = "cf-timetracker-api"` in `worker/wrangler.toml`.

## 1. Prerequisites

```bash
npx wrangler login        # browser OAuth; wrangler whoami must show the account
```

## 2. D1 database

```bash
npx wrangler d1 create cf-timetracker    # once; put database_id into worker/wrangler.toml
cd db
for f in schema.sql migrations/*.sql; do
  npx --prefix ../worker wrangler d1 execute cf-timetracker --remote --file="$f"
done
```

Note: `archived_at` / `image_url` migrations report "duplicate column" on a fresh database — expected, `schema.sql` already includes those columns.

## 3. Worker

`worker/wrangler.toml` must have:

```toml
name = "cf-timetracker-api"
[[d1_databases]] database_id = "<real id>"
[vars] DEMO_MODE = "true"
```

```bash
cd worker && npx wrangler deploy
curl -s https://cf-timetracker-api.<subdomain>.workers.dev/api/demo/status   # {"demoMode":true}
curl -s -X POST .../api/demo/reset                                           # {"success":true}
```

## 4. Frontend (Pages)

`VITE_API_BASE` is baked in at **build time** — always pass it:

```bash
cd web
VITE_API_BASE=https://cf-timetracker-api.<subdomain>.workers.dev npm run build
rm -f dist/wrangler.json                     # stale Workers-assets artifact breaks classic Pages deploys
npx wrangler pages project create cf-timetracker --production-branch main --force   # once
npx wrangler pages deploy dist --project-name cf-timetracker --force
```

The `--force` flag deploys to **classic Pages** (real `*.pages.dev` URL). Without it, new wrangler delegates to the Workers-platform Pages and fails on `dist/_redirects` (`/* /index.html 200` is read as an infinite-loop rule there; classic Pages handles it fine as the SPA fallback).

If deploy complains about `.wrangler/deploy/config.json`, delete `web/.wrangler` and retry.

## 5. Verify

| # | Check | Expected |
|---|---|---|
| 1 | Open https://cf-timetracker.pages.dev | Dashboard renders, demo banner visible |
| 2 | Deep link `/settings`, `/clients/:id` | HTTP 200, app renders (SPA fallback) |
| 3 | Header "Reset demo" button | confirm dialog → reload → 5 sample entries |
| 4 | `POST /api/demo/reset` twice via curl | `{"success":true}` both times (idempotent) |
| 5 | Dashboard figures | 06:30 h, $610.00 billed, 2 clients / 3 projects |

## 6. Demo-mode internals

- Worker env `DEMO_MODE=true` enables `POST /api/demo/reset` (`resetDemoData` in `worker/src/core.js`); returns 403 when off.
- Reset **resolves master-data ids by name** after `INSERT OR IGNORE` — activities have a UNIQUE `name`, and default `General`/`Meeting` rows may pre-exist under different ids. Entries always reference the resolved ids (this fixed the original `FOREIGN KEY constraint failed` bug).
- Client reads `GET /api/demo/status` on mount → banner, header reset button, Settings demo card, splash.

## 7. Local dev notes

- `web/wrangler.jsonc.workers-assets-alt` is an alternative single-Worker (static assets) deploy config, kept for reference; rename it back to `wrangler.jsonc` only if abandoning Pages.
- Production hardening (Zero Trust, `ALLOWED_ORIGINS`, GAS/Gemini secrets): see `2026-09-20-deploy-runbook.md` §2 and §5.
