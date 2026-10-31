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
docker-compose.yml   caddy, web, transcode-worker, cv-dispatcher, postgres, rustfs, mailpit, init
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
  capability), the "Join the pilot" form at `/apply`, scout registration
  at `/register`, and a guardian's answer or withdrawal at `/consent/<token>`
  (C05; the link token is the capability).
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
- **Squad** (SQUAD01 to SQUAD04, SQUAD07, SQUAD09): `src/server/squad/`. Pages
  under `/squad` read with `CLUB_ROLES`; every squad action writes with
  `SQUAD_ADMIN_ROLES` (owners and admins), so coaches read only. A Team row is
  one team in one season, its name unique per season. Squad numbers are unique
  per team among active players through a partial unique index
  (`Player_team_squadNumber_active_key`, Prisma's `partialIndexes` preview), so
  a departed player frees their number. Opposition teams (`isOpposition`) hold
  unnamed placeholders only. Departing sets `clubStatus` and `departedAt` and
  nothing else, audited in the same transaction; the club cannot edit a
  departed player. Pickers and dashboards read `ACTIVE_PLAYER` or
  `activePlayers()`. The CSV import is stateless: the preview returns the text
  and a sha256 digest, and the commit re-checks every row and writes in one
  transaction, or returns a fresh preview when anything changed. Audit rows
  carry ids and field names, never names or dates of birth.
- **Matches and upload** (MATCH01 to MATCH05, MATCH07, MATCH08, SQUAD05,
  SQUAD06, NFR26; C06): `src/server/matches/`. Pages under `/matches` read with
  `CLUB_ROLES`; actions and the upload route handlers (`/api/matches/[matchId]/
  upload`, `/parts`, `/complete`, `/video-url`) use `MATCH_ROLES`, and deleting
  a match `MATCH_DELETE_ROLES` (owners and admins). Footage goes straight from
  the browser to object storage as an S3 multipart upload with presigned part
  URLs (`src/lib/upload/multipart-client.ts`: 8 MiB parts, 3 at a time, retry
  with backoff, pause while offline, resume from the server's ListParts after a
  reload or on another device). `Video` holds one live upload per match
  (partial unique index), its probe metadata, the four half-time offsets and
  `rawExpiresAt` (upload plus 7 days). Completing records `storage_bytes` and
  enqueues `probe`; the worker runs ffprobe and the footage rules in
  `src/lib/footage-rules.ts` (draft thresholds), then moves the match to
  Processing or back to Draft, recording `video_seconds` once. Lineup writes
  re-read every player on the server (`ACTIVE_PLAYER`, the side's team, this
  organisation); substitutions live on Lineup (`endedAt`, `startedAt`,
  `replacesLineupId`) and minutes played come from `minutesPlayed()` in
  `src/lib/match-clock.ts`. Deleting a match removes its rows at once and
  enqueues `retention`, whose worker aborts open uploads, deletes everything
  under `orgs/{org}/matches/{match}/` and nets the storage off the meter: the
  only process that deletes footage (NFR32). The S3 clients compute checksums
  only when required, or presigned part URLs carry a checksum of an empty body.
  Production bucket CORS must allow PUT from the app origin and expose ETag.
- **Transcode and playback** (MATCH06, NFR03, NFR17, NFR25, NFR31; C07):
  accepted footage gets a transcode `ProcessingJob` (tenant table; one per
  video by a partial unique index) in the probe's transaction, and the
  `transcode` pg-boss job is sent with `ProcessingJob.bossJobId` as its id, so
  a resend is a no-op. The worker (`src/worker/transcode.ts`) runs one ffmpeg
  process (`src/server/transcode/ladder.ts`: 1080p, 720p and 480p, never
  upscaled; fMP4, 4 s segments, a keyframe every 2 s) into a temp dir
  (`TRANSCODE_TMP_DIR`, about twice the HLS size free), uploads to
  `orgs/{org}/matches/{match}/hls/{videoId}/{master.m3u8, {rendition}/index.m3u8,
  init.mp4, seg_NNNNN.m4s}` (under the match prefix, so the `match_deleted`
  purge removes it), then in one transaction sets `Video.hlsManifestPath`,
  marks the job succeeded with its timings, and records `storage_bytes` once
  per rendition (sourceType `Rendition`, `metadata.matchId`). A failed attempt
  goes back to queued; the third marks the job and the match failed and
  pg-boss dead-letters it. Every job state change is one log line,
  `msg: "processing job"`, with ids, attempt and timings, so filtering by
  `processingJobId` rebuilds its history (`src/server/processing/jobs.ts`).
  Playback (`src/server/matches/playback.ts`) never puts a bucket URL in a
  playlist: `/api/matches/[matchId]/hls/master.m3u8` and
  `/hls/[rendition]/index.m3u8` are read from storage and rewritten to app
  routes (`Cache-Control: no-store, private`), and `init.mp4` and segments
  answer 302 to a GET presigned for `HLS_SEGMENT_URL_TTL_SEC` (default 60 s);
  every request checks the session and `MATCH_ROLES`. The player is
  `src/components/video/HlsPlayer.tsx` (hls.js loaded on mount, native HLS on
  Safari). `/video-url` (15 minutes, raw file) stays only as the marker tool's
  fallback while the transcode runs. Production bucket CORS must also allow GET
  from the app origin (Caddy does this locally), since the browser follows the
  302 to the bucket.
- **CV jobs** (CV01, CV09, CV10, NFR04, NFR06, NFR07, NFR08, NFR30; C08):
  accepted footage also gets a `cv` `ProcessingJob` in the probe's
  transaction; it runs in parallel with the transcode, and the match moves
  Processing to Awaiting review once both have succeeded
  (`src/server/processing/readiness.ts`, under a Match row lock). The
  `cv-dispatcher` service (`WORKER_QUEUES=cv,cv-watchdog`) handles `cv`
  (`src/worker/cv.ts`): one GPU instance per attempt through a `GpuProvider`
  (`src/server/cv/providers/`: `docker` locally, starting the
  `wideline-cv-worker` image built by `make cv-image`; `hourly` is a stub until
  the provider is chosen). The instance gets ids and signed URLs only (raw
  footage GET, result PUT under `orgs/{org}/matches/{match}/cv/`), heartbeats
  and reports through `POST /api/jobs/[jobId]/callback`, the one route with no
  session (an HMAC token per instance, `CV_CALLBACK_SECRET`), which only records
  the report on the `GpuInstance` row. The dispatcher polls that row, destroys
  the instance (cost recorded once per instance: the row,
  `ProcessingJob.costCents` and a `gpu_cost_cents` usage row with
  `metadata.matchId`), checks the result against the contract
  (`src/server/cv/contract/cv-result-1.0.schema.json`, ajv, plus semantic
  checks; the worker bundles the same schema) and ingests it in one
  transaction (`src/server/cv/ingest.ts`). Ingest is keyed on
  `(jobId, trackIndex)`, `(matchId, trackId, tMs)` and `(jobId, sourceKey)`, so a
  replay changes nothing (NFR06). The consent gate sits there:
  `attributablePlayerIds()` decides which shirt-number links are kept; tracks
  of anyone else on the lineup (no consent, withdrawn, opposition
  placeholders) are never stored, and their events keep only the team side.
  Event status comes from `Organisation.settings.autoAccept`
  (`src/lib/auto-accept.ts`; catalogue defaults goal 0.90, shot 0.75, touch
  0.80). `TrackPoint` is hash-partitioned by match (16 partitions in schema
  `trackpoint_parts`). The `cv-watchdog` job runs every minute
  (`src/worker/cv-watchdog.ts`): it destroys instances idle for 10 minutes or
  30 minutes past their job, and orphans; resends cv jobs that never started;
  and fails jobs pg-boss lost. A job's third failure fails it and its match and
  emails platform admins once (`src/server/processing/alerts.ts`; transcodes
  too). A consent withdrawal deletes the player's tracks and unlinks their
  events (`src/server/cv/withdrawal.ts`).
- **CV pipeline** (CV02 to CV08, CV11, NFR01; C09): the worker
  (`cv_worker/wideline_cv/pipeline/`) samples at 5 fps, detects people and the
  ball, tracks them (ByteTrack vendored from supervision, MIT, and a ball
  tracker), splits the teams by kit colour, calibrates the pitch, votes on
  shirt numbers and finds goals, shots (on target or not) and touches, then
  writes contract 1.0 and a calibration still. Two modes, `WIDELINE_CV_MODE`:
  `synthetic` (the default everywhere: a seeded scene rendered and "detected"
  with noise, no GPU, weights or network; `modelVersions` say `synthetic-1`)
  and `model` (RF-DETR, Apache-2.0, from the `model` extra and weights baked
  into the hand-built GPU image; waits on blocker B-001). The dispatcher
  passes the mode (`CV_PIPELINE_MODE`, default `synthetic`), the venue's
  stored calibration and a signed still URL. Ingest also picks home and away
  from lineup shirt numbers (Q-041), stores `Track.distanceM`
  (`src/lib/positions.ts`) and the video's `PitchCalibration`, and creates the
  `clips` job: the transcode worker cuts one 720p MP4 per event from the raw
  footage (`src/worker/clips.ts`) under `orgs/{org}/matches/{match}/clips/`,
  with `storage_bytes` usage, and `expiresAt` = upload + 14 days unless a
  `ClipFavourite` exists (database triggers). A match is review-ready once
  transcode, cv and clips have all succeeded. The CV Lab (`/lab`) shows recall
  against hand-tagged CSV imports per match and per model version (the v0
  gate: 95% of goals and shots), time to review-ready, and a pitch calibration
  tool that is reused per venue and camera.

  ```sh
  make cv-run video=match.mp4 mode=synthetic   # result.json and still.png in ./out
  make cv-bench video=match.mp4                # stage timings (synthetic; add
                                               # WIDELINE_CV_SYNTHETIC_MAX_SEC=5400 for 90 min)
  make cv-golden                               # regenerate web/tests/fixtures/cv after a pipeline change
  make cv-image-gpu                            # the GPU model image, by hand only (B-001)
  ```
- **Review queue and claims** (C10; REVIEW01, REVIEW02, REVIEW13, AUTH07,
  AUTH10, NFR16): `src/server/review/`. `/review` lists Awaiting review
  matches of active academies and clubs, soonest raw footage expiry first,
  with match-level facts only (no venue, players or lineups); matches whose
  raw footage is gone stay under "Clips only" until their clips go. A scout
  claims a match for 48 hours (`CLAIM_DURATION_MS`, a product rule) after a
  no-conflict declaration; how many they may hold at once is the
  `review_claims_active` limit, read from the scout network organisation. A
  claim takes FOR UPDATE on the match (lineup and marker saves take FOR
  SHARE, `src/server/db/locks.ts`), re-checks conflicts on the server
  (`src/server/review/conflicts.ts`: `scoutConflicts()`, declared club
  names as whole words in either team name, represented players among the
  named lineup players whatever their consent (REVIEW02); a removed
  declaration keeps blocking for 90 days) and moves the match to In review.
  Conflicts reach pages as one boolean, never a name. Because a declared
  name can block on a child the scout may not see, declaring names is capped:
  at most 30 player names may block at once, removed ones included while
  their cooling-off runs (`cooling_off_limit`, Q-053), and every declaration
  and refused claim is audited without the name. A
  "Log in as" session can view review pages but never claim or release
  (Q-064).
  `ReviewClaim` is a tenant table on the match's organisation: readable
  through the scoped client (a club sees when its review is due, never by
  whom), never writable there. Review data is scoped to the claiming scout:
  `claimScope(ctx, claimId)` hands out a read-only client bound to the claim
  only while the caller holds the live claim, checked on every request. It
  reaches only the claimed match's Match, Video, Lineup, Event, Track,
  TrackPoint and Clip rows, and Player names of that match's scout_visible
  lineup players; scalar fields only (no include or relation filters), no
  writes, no other model. The reviewer HLS routes
  `/api/review/claims/{claimId}/hls/...` use it. Expiry is enforced on every check (`isClaimLive`) and tidied by the
  `review-sweep` queue every minute on the transcode worker
  (`src/worker/review-sweep.ts`), which also releases the claims of
  suspended or conflicted scouts and emails platform admins once per video
  when an unreviewed match has 48 hours of raw footage left
  (`Video.reviewAlertedAt`, ids only). A suspension and a new conflicting
  affiliation or admin link release claims in their own transaction. Audit
  actions: `review.claim_started`, `review.claim_refused`,
  `review.claim_released` and `review.claim_expired`
  (ids, reason codes and the declaration version only).
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
  organisationId per call), CV dispatch and ingest (`src/server/cv/`, one
  explicit organisationId per call), the review queue and claims
  (`src/server/review/`, the caller's own ReviewerContext), the seed, the
  worker and the worker callback.
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
make fixtures                         # C06 test footage (ffmpeg; test-web and test-e2e run it)
make test-web                         # Vitest inside the web container
make test-e2e E2E_PASSWORD=…          # Playwright against the running stack
# E2E_DATABASE_URL (postgresql://…@postgres:5432/…) is derived from POSTGRES_*
# in .env for the e2e checks that set database state directly; override it
# on the command line if needed
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

- **Consent** (C05; CONS01 to CONS04, NFR08 to NFR12): `Consent` is
  append-only and the newest row is the current state. Postgres enforces it:
  CHECK constraints tie the state to the two choices (club stats, scout
  visibility) and require a parent or guardian for a minor's grant; the
  trigger `Consent_append_only` refuses UPDATE and DELETE (cascades from an
  organisation or player deletion still run); `Consent_before_insert` writes
  the cached `Player.consentState` in the same statement and stamps a strictly
  increasing `createdAt`; `Player_consentState_guard` refuses any other write of
  the cache. The scoped client refuses consent updates and deletes too. Record
  changes through `src/server/consent/` (`recordConsent`, `withdrawConsent`,
  `createConsentRequest`, the guardian side in `guardian.ts`), each audited in
  the same transaction with no names in the metadata. Read player visibility
  only through `consentVisibleTo(viewer)` from
  `src/server/consent/visibility.ts` (kinds `club`, `club_stats`, `scout`),
  spread into every player query's where clause
  (`tests/unit/player-queries-consent.test.ts` checks it). A new viewer kind
  goes in that file with a case in `tests/integration/consent-visibility.test.ts`.
  The wording lives in `src/server/consent/wording.ts`; a new text is a new
  `CONSENT_WORDING_VERSION`. Guardian links (`/consent/<token>`, public, sha256
  hash stored) decide for 14 days and withdraw until revoked or replaced.
  Changes that take visibility away enqueue `consent-withdrawn` for later chunks
  to purge derived data within 24 hours.
- [docs/build/STATUS.md](docs/build/STATUS.md): progress per chunk, and the log.
- [docs/build/QUESTIONS.md](docs/build/QUESTIONS.md) and
  [docs/build/BLOCKERS.md](docs/build/BLOCKERS.md): open decisions.
- [docs/build/prd.txt](docs/build/prd.txt): the PRD as searchable text.
- [docs/design-system/README.md](docs/design-system/README.md): the brand book.

## Before the pilot

These are deliberately deferred from V0 and must be done before real clubs
join:

- **The hourly GPU provider** (Q-033): `src/server/cv/providers/hourly.ts` is
  a stub. Choose the provider, implement it, and set `CV_DISPATCH=hourly` and
  `CV_CALLBACK_BASE_URL`. TrackPoint partitioning (hash by match) and the
  consent gate at ingest are done (C08).
- **Postgres row-level security** as a second layer under the scoped client.
- **Retention cleanup job** and bucket lifecycle rules (CONS-09, NFR-13). C06
  added the `retention` queue (match deletions); C17 adds the daily sweep and an
  AbortIncompleteMultipartUpload lifecycle rule for abandoned uploads.
- The legal gates in NFR-14 and NFR-15.

## Security notes

- `.env` is git-ignored; `.env.example` holds only local defaults.
- `ID_HASH_SECRET` keys the scout ID hash and is required in production
  (`make env` generates one). Outside production it falls back to a key derived
  from `BETTER_AUTH_SECRET`. Changing it makes every stored ID hash unmatchable.
- Postgres is not published to the host.
- The CV dispatcher's Docker mode (C08) mounts the Docker socket into the
  `cv-dispatcher` container only. That is root-equivalent on the host and is
  for local development only; production uses the hourly GPU provider.
- `CV_CALLBACK_SECRET` signs each CV instance's callback token; it must be at
  least 32 characters in production (`make env` generates 64).
