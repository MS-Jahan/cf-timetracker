# Personal instance deployment (timetracker.sabit.dev)

**Date:** 2026-09-20
**Purpose:** record the real deployment of the owner's personal instance, separate from the public demo.

## Live URLs

| What | URL |
|---|---|
| UI | https://timetracker.sabit.dev |
| UI (Pages fallback) | https://timetracker-8ss.pages.dev |
| API (Worker) | https://timetracker-api.safe-browsing.workers.dev |

## Account split (important)

Cloudflare resources live in **two accounts**:

| Account | Zone / resources | Deploys with |
|---|---|---|
| `Lalita90-mukharji@yahoo.com` (8f7f76fd…) | **sabit.dev** zone; personal instance (D1 `timetracker`, Worker `timetracker-api`, Pages `timetracker`) | current `wrangler login` + `CLOUDFLARE_ACCOUNT_ID=8f7f76fdafcd4c31e1554644c96d9543` |
| `Ssarwarjahan@gmail.com` (afa2d9b0…) | demo instance (D1 `cf-timetracker`, Worker `cf-timetracker-api`, Pages `cf-timetracker` → cf-timetracker.pages.dev) | `wrangler login` with that account; redeploy to pick up newer worker code |

Wrangler holds one OAuth login at a time. `worker/wrangler.toml` carries both configs: top-level = personal, `[env.demo]` = demo (deploy with `npx wrangler deploy --env demo` from the Ssarwarjahan login).

## Custom domain

- Pages custom domain `timetracker.sabit.dev` attached via API (`POST /accounts/{acc}/pages/projects/timetracker/domains`).
- DNS: CNAME `timetracker` → `timetracker-8ss.pages.dev`, proxied, added in the sabit.dev zone dashboard (wrangler's OAuth token has no DNS scope; `api.cloudflare.com` needs `--http1.1` from this machine).
- Specific record overrides the zone's existing `*.sabit.dev` wildcard.

## Env vars / secrets state

| Var | Value / status |
|---|---|
| `DEMO_MODE` | `"false"` — reset endpoint returns 403 |
| `ALLOWED_ORIGINS` | `https://timetracker.sabit.dev,https://timetracker-8ss.pages.dev` |
| `GAS_SECRET` | not set — set via `npx wrangler secret put GAS_SECRET` if Sheets sync wanted (same value goes into the Apps Script `SHARED_SECRET` property) |
| `GEMINI_API_KEY` | not set — optional, enables voice capture |
| `APP_TOKEN` | not set — optional, would require native clients to send `X-App-Token` |

## Bug fixed during this deploy

`/api/demo/status` used `Boolean(env.DEMO_MODE)`; toml vars are strings, so `DEMO_MODE = "false"` was truthy and the personal instance showed the demo banner + reset button. Worker now compares `env.DEMO_MODE === "true"` for both the status flag and the reset guard (`worker/src/index.js`). The demo instance still runs the old worker build (its `DEMO_MODE` is `"true"`, so behavior is unchanged); redeploy it from the other account whenever convenient.

## Verify checklist (all passing 2026-09-20)

1. `https://timetracker.sabit.dev/` → 200, dashboard, no demo banner
2. `GET /api/demo/status` → `{"demoMode":false}`; `POST /api/demo/reset` → 403
3. Timer start/stop writes to the personal D1 (distinct from demo D1)
4. Deep links (`/settings`, `/clients/:id`) serve via SPA fallback
