# Deploying 0.21.0 (username/password auth + authenticated MCP) - 2026-11-15

Step-by-step for shipping PR #1 (`feat/password-auth-mcp`). It supersedes the Zero Trust / `APP_TOKEN` parts of `2026-09-20-deploy-runbook.md` (§2, §5); the rest of that runbook (D1 creation, GAS, rollback basics) still applies. Design background: `2026-11-12-auth-and-mcp-blueprint.md` §11.

There are two separate deployments. Each has its **own D1, its own Worker secrets and its own first account**:

| | Personal | Demo |
|---|---|---|
| Worker | `timetracker-api` (top-level wrangler env) | `cf-timetracker-api` (`--env demo`) |
| D1 | `timetracker` | `cf-timetracker` |
| Frontend | `timetracker.sabit.dev` (Pages Git integration) | `cf-timetracker.pages.dev` (CI via `deploy.yml`) |
| Deployed by | you, `wrangler deploy` | CI on every push to `main` |

All `wrangler` commands below run from `worker/`.

## 1. Environment variables

### Worker secrets (set with `wrangler secret put`, never in git)

| Name | Required | Rule | How to generate |
|---|---|---|---|
| `AUTH_PEPPER` | **Yes** | At least 32 characters. Mixed into every password hash. If missing or short, every protected route answers `503 auth_not_configured`. **Losing it invalidates all passwords** - keep a copy in a password manager. Do not rotate casually. | `openssl rand -base64 48` |
| `SETUP_TOKEN` | For the first account only | At least 24 characters. Guards `POST /api/auth/setup`, which only works while there are zero users. Delete it after the first account exists. | `openssl rand -base64 32` |
| `GAS_SECRET` | Only for Google Sheets sync | Unchanged from before. | existing |
| `GEMINI_API_KEY` | Only for voice capture | Unchanged from before. | existing |

Use a **different** `AUTH_PEPPER` and `SETUP_TOKEN` for personal and demo.

### Worker plain vars (`wrangler.toml` `[vars]` / `[env.demo.vars]`)

| Name | Required | Default / current value | Notes |
|---|---|---|---|
| `ALLOWED_ORIGINS` | Yes | personal: `https://timetracker.sabit.dev,https://timetracker-8ss.pages.dev`; demo: `*` | Cookie sign-in is credentialed only for origins listed here. `*` never carries credentials, so the demo uses the Bearer transport. A cookie write from an unlisted origin gets `403 origin_not_allowed`. |
| `DEMO_MODE` | Yes | `false` / `true` | `"true"` turns the Worker into the open demo (no auth, daily reset, `/api/demo/reset`). Personal must stay `"false"`. |
| `AUTH_PBKDF2_ITERATIONS` | No | `100000` | Lower it (e.g. `20000`) only if logins fail with Workers CPU limit errors on the Free plan. |
| `SESSION_TTL_HOURS` | No | `720` (30 days), range 1-2160 | |
| `SESSION_COOKIE_SAMESITE` | No | `Lax` | Leave alone unless UI and API are on different sites and you insist on cookies (prefer Bearer instead). |
| `AUTH_IP_LIMIT` | No | `10` | Login attempts per IP per 15 minutes. |
| `DEMO_WRITE_LIMIT` | No | `60` | Demo only: writes per IP per 10 minutes. |
| `DEMO_RESET_LIMIT` | No | `3` | Demo only: resets per IP per hour. |

`APP_TOKEN` and `X-App-Token` are **gone**. If `APP_TOKEN` is still set on a Worker, delete it (step 2.7).

### Frontend build variables (Pages / CI, baked in at build time)

| Name | Personal | Demo |
|---|---|---|
| `VITE_API_BASE` | `https://tt-api.sabit.dev` (recommended, see 2.4) or the `workers.dev` URL | `https://cf-timetracker-api.ssarwarjahan.workers.dev` (already in `deploy.yml`) |
| `VITE_AUTH_TRANSPORT` | unset (cookie) when UI and API are same-site; `bearer` if the API stays on `workers.dev` | `bearer` (already in `deploy.yml`) |

### Local dev (`worker/.dev.vars`, gitignored; template is `worker/.dev.vars.example`)
`AUTH_PEPPER`, `SETUP_TOKEN`, `ALLOWED_ORIGINS=http://localhost:5173`. Never reuse production values.

### GitHub repo secrets (demo CI, already needed before this change)
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Nothing new.

## 2. Personal instance (`timetracker` D1, `sabit.dev` account)

1. **Confirm the migration landed** (you said it ran; this proves it):
   `npx wrangler d1 execute DB --remote --command "SELECT group_concat(name) FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','api_tokens','auth_throttle')"`
   Expect all four names. If not, run `npx wrangler d1 execute DB --remote --file=../db/migrations/2026-11-12-auth.sql` (idempotent, safe to repeat).
2. **Set the secrets** (each prompts for the value):
   ```
   npx wrangler secret put AUTH_PEPPER
   npx wrangler secret put SETUP_TOKEN
   ```
3. **Check the plan.** On Workers Free, a login costs about 35 ms CPU against a 10 ms limit. If you are on Free, add `AUTH_PBKDF2_ITERATIONS = "20000"` under `[vars]` in `wrangler.toml` before deploying. On a paid plan leave the default.
4. **Recommended: same-site API domain.** Workers dashboard -> `timetracker-api` -> Settings -> Domains & Routes -> Add Custom Domain `tt-api.sabit.dev`. Then in the Pages project env set `VITE_API_BASE=https://tt-api.sabit.dev`. Cookie sign-in then works on `timetracker.sabit.dev` (the `pages.dev` fallback URL is cross-site and will not keep a cookie). *Alternative:* keep `workers.dev` and set `VITE_AUTH_TRANSPORT=bearer` in the Pages env.
5. **Deploy the Worker, then the frontend.** The branch is not merged yet, so either merge PR #1 first (the personal Pages Git integration then rebuilds) or deploy from the branch:
   ```
   npx wrangler deploy
   ```
   then trigger a Pages rebuild (push, or Retry deployment in the dashboard) so it picks up the new env vars.
6. **Create the first account.** Open `https://timetracker.sabit.dev` -> "Create the first account", enter the `SETUP_TOKEN`, a username and a password of at least 12 characters. Or:
   ```
   curl -s https://tt-api.sabit.dev/api/auth/setup -H 'Content-Type: application/json' \
     -d '{"setupToken":"<SETUP_TOKEN>","username":"<you>","password":"<12+ chars>","transport":"token"}'
   ```
7. **Clean up.** `npx wrangler secret delete SETUP_TOKEN` (setup is permanently closed once a user exists, but there is no reason to keep it). If it exists: `npx wrangler secret delete APP_TOKEN`.

## 3. Demo instance (`cf-timetracker` D1, `--env demo`) - open, no accounts

The demo is public by design: no login, no API tokens, no MCP, no Google Sheets sync. Visitors can add, edit and delete; voice shows "not configured" because no Gemini key is set. A daily cron (03:00 UTC, `[env.demo.triggers]` in `wrangler.toml`) wipes all clients, projects, activities and entries and re-seeds the sample set. The Reset demo button does the same on demand.

1. Migration: apply `2026-11-12-auth.sql` (the demo's rate limiter stores its counters in `auth_throttle`; the other auth tables stay unused).
2. Secrets: **none needed.** `AUTH_PEPPER` / `SETUP_TOKEN` are ignored on the demo (you may leave or delete them). Do not set `GEMINI_API_KEY` or `GAS_SECRET`.
3. Merge PR #1. CI (`deploy.yml`) deploys the Worker (registering the cron) and Pages.
4. Check: `curl -s https://cf-timetracker-api.ssarwarjahan.workers.dev/api/auth/status` -> `{"configured":true,"setupRequired":false,"demo":true}`, then `curl -s .../api/bootstrap` -> 200 without any header.
5. **Abuse limits (built in, no setup; they use the `auth_throttle` table from the migration, so apply it):** each IP gets 60 writes per 10 minutes and 3 resets per hour; the demo holds at most 300 entries, 30 clients, 60 projects and 30 activities (then 409 `demo_limit_reached` until the next reset); CSV import is off. Tune with the optional vars `DEMO_WRITE_LIMIT` and `DEMO_RESET_LIMIT`. If the throttle table is missing the limiter fails open, so apply the migration.
6. **Safety:** `DEMO_MODE="true"` makes the whole API public. It must never be set on the personal Worker (top-level `[vars]` has `"false"`); only the exact string `"true"` enables it.

## 4. Clients and automation

- **Claude Code (MCP client).** In the web app: Settings -> API tokens -> create a token with scope `mcp`; copy the `ttp_...` value (shown once). Then:
  ```
  claude mcp add --transport http timetracker https://tt-api.sabit.dev/mcp \
    --header "Authorization: Bearer ttp_..."
  ```
  The MCP server is the Worker's existing `POST /mcp`; cookies are not accepted there and `GET /mcp` answers 405.
- **Flutter app.** Rebuild with `--dart-define=API_BASE_URL=https://tt-api.sabit.dev`. It now shows a sign-in screen and stores the token in secure storage. Remove any old `APP_TOKEN` setting.
- **Scripts** (`check-single-timer.mjs`, `kimai-export/import.mjs`): set `TT_TOKEN` to a `full`-scope API token.
- **Forgot password / lost access:** `AUTH_PEPPER=<current pepper> node scripts/reset-password.mjs <username>` prints SQL; run it with `wrangler d1 execute DB --remote --command "<sql>"`. The script never executes SQL itself.

## 5. Smoke test (record results in PR #1)

Set `BASE=https://tt-api.sabit.dev` (or the demo Worker URL).

| # | Check | Expected |
|---|---|---|
| 1 | `curl -s $BASE/api/auth/status` | `{"configured":true,"setupRequired":false}` after step 2.6 |
| 2 | `curl -s -o /dev/null -w '%{http_code}' $BASE/api/bootstrap` | `401` |
| 3 | same, with headers `X-App-Token: x` and `Cf-Access-Authenticated-User-Email: a@b.c` | `401` (old bypasses are gone) |
| 4 | login with `"transport":"token"`, then `GET /api/bootstrap` with `Authorization: Bearer <token>` | `200` with `ETag` and `Cache-Control: private, no-cache` |
| 5 | repeat with `If-None-Match: <that ETag>` | `304` |
| 6 | browser: sign in, start then stop a timer, sign out, reload | login screen after sign-out |
| 7 | MCP `tools/list` with the `ttp_` token / with no token / `GET /mcp` | `200` with 4 tools / `401` / `405` |
| 8 | `mcp`-scope token on `/api/bootstrap` | `403 insufficient_scope` |
| 9 | `npx wrangler tail` during a login | no `exceededCpu` (if present, lower `AUTH_PBKDF2_ITERATIONS`) |
| 10 | `VERIFY_API_BASE=$BASE VERIFY_TOKEN=<full token> npm run verify` | passes (leaves one closed race-check entry) |

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Every API call returns `503 auth_not_configured` | `AUTH_PEPPER` missing or under 32 chars on that Worker. Set it (use `--env demo` for the demo). |
| `500` mentioning `no such table: users` | Migration not applied to that D1 (step 2.1 / 3.1). |
| Login works in `curl` but the web app keeps signing out | Cookie is cross-site. Use the same-site `tt-api` domain, or build with `VITE_AUTH_TRANSPORT=bearer`. |
| `403 origin_not_allowed` on a web write | The page's origin is not in `ALLOWED_ORIGINS`. |
| Login fails with a CPU limit error | Workers Free plan: set `AUTH_PBKDF2_ITERATIONS` lower. |
| `429 too_many_attempts` | IP limit (10 per 15 min) or account lock (5 wrong passwords, 15 min). Wait it out. |
| Setup returns `403 setup_disabled` | `SETUP_TOKEN` unset or under 24 chars. |
| Setup returns `409 setup_complete` | A user already exists. Sign in, or use the reset script. |

## 7. Rollback

`npx wrangler rollback` restores the previous Worker; the four new tables are additive and ignored by old code. **Rolling back re-opens the API**: the old code had no auth. If you must roll back, put the instance behind Cloudflare Access again or set `APP_TOKEN` as a stopgap, and fix forward quickly.
