# Versioning policy (2026-10-09)

Until now the project had no version: no tags, `package.json` files had no `version`. From 0.16.0 on we use **Semantic Versioning** (`MAJOR.MINOR.PATCH`) for the product as a whole (worker + web + gas + Flutter client ship together).

## Single source of truth
- Root `package.json` `version`. Nothing else is edited by hand.
- `web/vite.config.js` injects it as the build-time constant `__APP_VERSION__`.
- `CHANGELOG.md` (repo root, newest first) records every bump. The newest heading must equal `package.json`; `scripts/check-version.mjs` enforces this and runs inside `npm run verify` (and CI).
- `worker/package.json`, `web/package.json` and `apps/timetracker/pubspec.yaml` versions are not used for releases; do not bump them.

## Where the version is shown
- Printed/PDF timesheets: small `v0.16.0` after "cf-timetracker" in the header, and in the footer line.
- Candidates not done yet (open follow-ups): Settings page "About" row, `/api/health` field, MCP `initialize` `serverInfo.version`.

## Bump rules (pre-1.0: `0.MINOR.PATCH`)
| Change | Bump | Commit type |
|---|---|---|
| New user-visible capability, new endpoint/tool/setting | MINOR (patch resets to 0) | `feat` |
| Bug fix, visual/print fix, perf, refactor with user-visible effect | PATCH | `fix` / `perf` / `refactor` |
| Breaking API contract / schema change while pre-1.0 | MINOR, entry marked `BREAKING` | `feat!` / `fix!` |
| Docs only, comments, tests only, CI/deploy config, chores, formatting | none | `docs` / `test` / `ci` / `chore` / `style` |

- One bump per commit (or PR), the highest rule wins when mixed. Never bump twice for one commit.
- After 1.0.0: breaking = MAJOR, `feat` = MINOR, `fix` = PATCH.
- **1.0.0** is cut when production is deployed and smoke-tested (T-Z3 in `docs/2026-09-20-deploy-runbook.md`) and the API contract in `AGENTS.md` is declared stable.
- Pre-releases are not used; the demo deploy simply runs whatever `main` is.

## Agent procedure (every change that bumps)
1. Decide the bump from the table above before committing.
2. Edit root `package.json` `version`.
3. Add a new top entry to `CHANGELOG.md`: `## X.Y.Z - YYYY-MM-DD` then one bullet per notable change (`- feat|fix: summary`, add `BREAKING:` when relevant).
4. Commit with a Conventional Commit message; mention the version in the body when it bumps (`Release: 0.17.0`).
5. Run `npm run verify` (includes the version check).
6. Optional: `git tag vX.Y.Z` after pushing; tags are not required.

Docs-only/chore/ci commits skip steps 2-3 (no version change).

## Baseline
Versions 0.1.0 to 0.15.x in `CHANGELOG.md` were assigned retroactively from the 35 commits on 2026-10-09 by applying the table (each `feat` -> minor, each `fix` -> patch; `docs`/`chore`/`ci` skipped). This change itself is 0.16.0.
