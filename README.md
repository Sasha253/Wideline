# Wideline

Wideline turns wide-angle match recordings into player stats. Requirements are
in [docs/Wideline-PRD.pdf](docs/Wideline-PRD.pdf). This repository is **V0**:
the foundation plus an internal **CV Lab** for running and measuring the
computer-vision pipeline.

## Quick start

Needs Docker Desktop (Compose v2), and port 80 free.

```sh
make up      # creates .env with fresh secrets, builds and starts everything
make seed    # creates the Lab and demo organisations, an admin user, two teams and a match
```

Open http://wideline.localhost and sign in with the email and password `make
seed` prints. Use Chrome or Firefox: they resolve `*.localhost` to your machine
without any setup. Safari does not.

| URL | What |
|---|---|
| http://wideline.localhost | The app |
| http://mail.wideline.localhost | Mailpit: magic-link and invitation emails land here |
| http://console.wideline.localhost | RustFS console (object storage) |
| http://s3.wideline.localhost | S3 API, used by presigned URLs |

`make help` lists every target. `make down` stops the stack and keeps data;
`make reset` deletes all data volumes.

## Layout

```
docker-compose.yml   caddy, web, transcode-worker, postgres, rustfs, mailpit, init
Caddyfile            reverse proxy for the *.wideline.localhost hosts
web/                 Next.js app and the transcode worker (same codebase)
  prisma/            schema, migrations, seed
  src/app/           App Router pages and route handlers
  src/server/        server-only code: db, auth, queue, storage, …
  src/worker/        transcode worker entry point (pg-boss consumers)
  tests/             Vitest (unit, integration) and Playwright (e2e)
cv_worker/           Python CV worker, run per job
docs/                PRD
```

## How things fit

- **Auth**: Better Auth inside Next.js, database sessions. Email and password,
  magic link (via Mailpit locally), and Google when `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET` are set. Sign-up is off: users come from invitations or
  the seed.
- **Permissions** (AUTH-06): every page, route handler and server action calls
  `requireRole()` (or `requirePageRole()` / `withRole()`) from
  `src/server/auth/session.ts`. Pages that only need a signed-in user, with or
  without an organisation (`/organisations`, `/forbidden`, the app layout), call
  `requireUser()`. `src/proxy.ts` only redirects signed-out
  visitors; it is not a permission check. Only `platform_admin` can use the Lab
  and the organisation approval queue (`/admin/organisations`). A unit test
  (`tests/unit/server-actions-guarded.test.ts`) checks every `actions.ts`;
  the only public actions are accepting an invitation (the token is the
  capability), the "Join the pilot" form at `/apply` and scout registration
  at `/register`.
- **App shell and navigation** (D02): every signed-in page renders inside
  `src/components/shell/AppShell.tsx` (sidebar from 992px, rail from 768px, top
  bar and bottom tab bar on phones). The nav comes from `src/lib/nav.ts` by the
  roles in the active organisation; it is a convenience only, and every page
  still calls `requirePageRole()`. A new top-level page adds its item to
  `NAV_ITEMS` with the matching role constant (`CLUB_ROLES`, `SCOUT_ROLES`,
  `ORG_ADMIN_ROLES`, `PLATFORM_ROLES` in `session.ts`; a unit test keeps the two
  in step). `homeFor()` picks where `/` sends each role. Pages are built from
  `src/components/templates/` and `src/components/states/`; see
  `/dev/templates`. `src/proxy.ts` matches every path apart from the public ones,
  so new shell pages need no proxy change.
- **Organisations and invitations** (AUTH-03 to AUTH-05, ADMIN-01): new
  organisations apply at `/apply` and start `pending`; a platform admin approves
  them, which emails the applicant an owner invitation. Owners and admins invite
  people by email with a role from `/settings/members`. Invitations last 14
  days and only a sha256 hash of the token is stored; `/invite/<token>` creates
  the account or links an existing one in one transaction. `platform_admin` is
  never assignable, only an owner grants owner, and the last owner cannot be
  removed. Membership and invitation changes are written to `AuditLog`.
- **Scouts** (AUTH-08 to AUTH-10, ADMIN-06): independent scouts register at
  `/register` (one topic per step). Each gets a pending `ScoutProfile` and an
  accepted `scout` membership in one shared organisation, "Wideline scouts"
  (type `scout_network`, id `scout-network`), so `requireRole()`, the nav and
  the switcher work unchanged. The ID or passport number is stored only as an
  HMAC-SHA256 with `ID_HASH_SECRET` (unique, so one identity registers once).
  A signed-out registration creates the user with no password and no session:
  the emailed confirmation link signs the mailbox owner in, and they set a
  password on `/scout` (`src/server/auth/password.ts`). Password sign-in needs
  a verified email, and the first confirmation revokes any account link or
  session an unverified user had, so nobody can plant access on someone
  else's email. Declared clubs and players are `ScoutAffiliation` rows; scouts
  edit them at `/scout`, and `scoutConflicts()` returns the organisations they
  may not review (for C10): linked rows, unlinked rows whose club name equals
  an active academy, club or agency (case-insensitive), and accepted
  memberships. Platform admins approve, reject, suspend and reinstate at
  `/admin/scouts`; approval needs a confirmed email and links exact name
  matches, and a filter shows scouts with clubs or players nobody has checked. Review pages and routes
  use `requireReviewer()` / `requireReviewerPage()` / `withReviewer()` from
  `src/server/auth/reviewer.ts`: scout role, approved profile and the current
  terms version, read on every request, so a suspension applies at once (a
  unit test checks every page under `/review` and `/api/review`). Both scout
  tables are global and refused by the scoped client.
- **Entitlements and usage** (BILL01, BILL02, ADMIN04, ADMIN05, NFR04): every
  limit and feature flag is read through `src/server/entitlements/`, never from
  a constant or a role check. A value resolves from the registry fallback
  (`src/lib/entitlement-keys.ts`, only when the plan lacks the key), then the
  organisation's plan, then its override, then its flag; a flag has the last
  word. Call `entitlement(orgId, key)`, `may(orgId, feature)` or
  `hasCapacity(orgId, limit, used)`; never compare a limit with a number
  yourself (`tests/unit/limit-literals.test.ts` fails the build). Unlimited is
  stored as `"unlimited"` and read as `Infinity`. Every organisation gets a
  pilot `Subscription` (on `/apply`, for the scout network, in the seed); one
  without falls back to the pilot plan with a logged warning. Platform admins
  set flags and limit overrides at `/admin/organisations/<id>` ("Flags and
  limits"), each change audited in the same transaction. Usage (matches, video
  seconds, GPU cost in cents with a currency, storage bytes as signed deltas)
  is recorded with `recordUsage()` from `src/server/usage/meter.ts`, once per
  source, so a retried job counts once (NFR06). `Plan`, `Subscription`,
  `Entitlement` and `UsageEvent` are refused by the scoped client, and so are
  the matching Organisation relations.
- **Tenant scoping** (NFR-16): application code gets a Prisma client from
  `requireRole()` that is scoped to the active organisation
  (`src/server/db/scoped.ts`). It injects `organisationId` into every query and
  rejects writes that name another organisation, or that change an
  organisation's platform-only fields (status, plan, review). References between
  tenant tables are composite `(organisationId, id)` foreign keys, so the
  database also refuses cross-tenant links. The active organisation is stored
  per session (`Session.activeOrganisationId`) and changed only by
  `setActiveOrganisation()`; a stale value falls back to the user's oldest active
  membership. The unscoped client (`src/server/db/raw.ts`) is limited by an
  ESLint rule to auth (including the invitation accept path), platform
  operations (`src/server/platform/`, which take a `platform_admin` context),
  scout registration and profiles (`src/server/scouts/`, the public
  registration or the caller's own userId), entitlements and the usage meter
  (`src/server/entitlements/`, `src/server/usage/meter.ts`, one explicit
  organisationId per call), the seed, the worker and the worker callback.
- **Queue**: pg-boss in the `pgboss` schema of the same Postgres. Three attempts
  per job, then the dead-letter queue (CV-10, NFR-30).
- **Object storage**: S3 API only. Locally RustFS (MinIO no longer publishes
  container images); Hetzner Object Storage in production. Presigned URLs are
  signed for `s3.wideline.localhost`, which resolves to Caddy both from the
  browser and from inside the compose network. Caddy answers CORS for the S3
  host locally; in production the bucket's CORS rules do this.
- **Logs**: JSON (pino in Node, structlog in Python). Sentry is wired and off
  unless `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set.

## Development

```sh
make migrate-new name=add_something   # create a migration from schema changes
make test-web                         # Vitest inside the web container
make test-e2e E2E_PASSWORD=…          # Playwright against the running stack
# add E2E_DATABASE_URL=postgresql://…@postgres:5432/… for the e2e checks that
# set database state directly (an expired invitation); they skip without it
make test-cv                          # pytest for the worker (needs uv)
make lint                             # ESLint, Prettier, tsc, ruff, mypy
```

The web container bind-mounts `web/`, so edits hot-reload. After changing
dependencies, run `make up` again: it rebuilds the image and refreshes
`node_modules`.

For editor support on the host, run `pnpm install` in `web/` and `uv sync` in
`cv_worker/`.

## Build conventions

The product is built chunk by chunk from
[docs/build/CHUNKS.md](docs/build/CHUNKS.md). Its "Conventions for every
chunk" section holds the rules each chunk follows: permissions, tenant data,
entitlement limits, consent, the audit log, migrations via `make migrate-new`, UI
tokens and voice, tests, and the definition of done.

- [docs/build/STATUS.md](docs/build/STATUS.md): progress per chunk, and the log.
- [docs/build/QUESTIONS.md](docs/build/QUESTIONS.md) and
  [docs/build/BLOCKERS.md](docs/build/BLOCKERS.md): open decisions.
- [docs/build/prd.txt](docs/build/prd.txt): the PRD as searchable text.
- [docs/design-system/README.md](docs/design-system/README.md): the brand book.

## Before the pilot

These are deliberately deferred from V0 and must be done before real clubs
join:

- **TrackPoint partitioning.** Prisma cannot declare partitions. TrackPoint
  (about 600,000 rows per match) must be partitioned by match with a raw SQL
  migration. The model carries a `TODO(partition)` note when it lands (Phase 4).
- **Postgres row-level security** as a second layer under the scoped client.
- **Consent gate at ingest** (NFR-08). V0 Lab lineups use shirt-number
  placeholders only, so no per-player data is derived about named,
  non-consented children.
- **Retention cleanup job** and bucket lifecycle rules (CONS-09, NFR-13).
- The legal gates in NFR-14 and NFR-15.

## Security notes

- `.env` is git-ignored; `.env.example` holds only local defaults.
- `ID_HASH_SECRET` keys the scout ID hash and is required in production
  (`make env` generates one). Outside production it falls back to a key derived
  from `BETTER_AUTH_SECRET`. Changing it makes every stored ID hash unmatchable.
- Postgres is not published to the host.
- The CV dispatcher's Docker mode (Phase 4) mounts the Docker socket into the
  worker container. That is root-equivalent on the host and is for local
  development only.
