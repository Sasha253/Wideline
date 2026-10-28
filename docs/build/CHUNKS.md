# Wideline build chunks

This file breaks the PRD into buildable chunks. Each chunk has an ID, a release, its dependencies, the PRD requirement IDs it covers, what to build, the design surfaces it owns, and the acceptance checks that mark it done.

- The PRD is `docs/Wideline-PRD.pdf`. Its text is in `docs/build/prd.txt`, so you can grep it by requirement ID.
- The design system is in `docs/design-system/`. Read its `README.md` before building any UI.
- Progress is tracked in `docs/build/STATUS.md`.
- The build workflow is `.claude/workflows/wideline-build.js`. It reads the section for a chunk from this file by its heading (`## <ID> ...`). Keep the headings stable.

## Already done

**Phase 1** (commit `0b1a32c`): the Docker Compose stack, Better Auth (password, magic link, optional Google, invite-only), `requireRole()`, the tenant-scoped Prisma client (NFR16), composite tenant foreign keys, pg-boss with 3 attempts and a dead-letter queue, S3 storage, JSON logs, Sentry wiring, CI (lint, types, tests, Playwright, pnpm audit, pip-audit, Trivy), and the first design tokens and components for the Lab.

This partly covers AUTH01, AUTH02, AUTH06, AUTH07, NFR16, NFR19, NFR21, NFR30 and NFR31. Later chunks extend this work. They do not replace it.

## Conventions for every chunk

- **Permissions.** Every page, route handler and server action calls `requireRole()`, `requirePageRole()` or `withRole()`. Never gate anything on the client only (AUTH06).
- **Tenant data.** Tenant data goes through the scoped client. Add a new tenant table with `organisationId` and composite `(organisationId, id)` foreign keys. Review data is scoped to the claiming scout (NFR16).
- **Consent.** No per-player data is derived or kept for an under-18 player without a recorded guardian consent. The gate sits at ingest, not at publication (NFR08). A player's consent state is always the newest `Consent` row, and rows are never edited in place. Read player visibility through the one consent-aware helper (`consentVisibleTo(viewer)`, from C05), so a withdrawal takes effect on the next query (CONS03). Add a test whenever a chunk exposes per-player data.
- **Limits.** Read every limit from entitlements (BILL01), once C03 exists. Never hard-code one.
- **Audit log.** Write role changes, consent changes, exports, review sessions and deletions to `AuditLog` (AUTH07, NFR20).
- **Schema changes.** Make them with `make migrate-new name=<chunk>_<thing>`. Never edit a migration that has already been applied.
- **UI.** Use only the tokens and `wl-` components from the design system. Write copy in sentence case, British and South African spelling, and football-native words (*match*, *pitch*, *squad*). Check every screen at 375, 768 and 1280 px. Never use colour alone to carry meaning (NFR23, NFR24, NFR27).
- **Tests.** Write Vitest unit and integration tests for server logic. Add a tenant-isolation test for every new tenant table. Add a Playwright test for the main path of every new screen.
- **Running e2e.** Use `make test-e2e` (it signs in with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `.env`); it also derives `E2E_DATABASE_URL=postgresql://<user>:<pass>@postgres:5432/<db>` from `POSTGRES_*` in `.env` for tests that need the database (override it on the command line if needed). The first run after `make up` compiles routes cold and may time out; re-run with `ARGS=--last-failed` before reporting a failure. If sign-in fails with `?email=&password=` in the URL, the dev server is in a Fast Refresh reload loop: run `make up` (keeps data) and retry. The suite's global teardown deletes the rows it created when `E2E_DATABASE_URL` is set. Never write the password into the repo.
- **Done.** A chunk is done when `make lint` and `make test-web` pass, the acceptance checks below hold, and `STATUS.md` is updated.

## Release v0: Pilot (free, invite-only)

### Gate to v1

5 clubs are live, shot recall is 95% or more, and 10 reviewers are active.

## B00 Build kit and conventions

- **Release:** v0
- **Depends on:** none
- **PRD:** none (enabling work)
- **Build:**
  - Check that `docs/design-system/` and `docs/build/prd.txt` exist.
  - Create `docs/build/STATUS.md` with one row per chunk in this file: ID, title, status (`todo`, `in_progress`, `done` or `blocked`), commit and notes. Mark B00 `done` when finished.
  - Add a short "Build conventions" section to `README.md` that points at this file.
- **Acceptance:** `STATUS.md` lists every chunk. Nothing else changes.

## D01 Design system in React

- **Release:** v0
- **Depends on:** B00
- **PRD:** NFR23, NFR24, NFR25, NFR27
- **Build:**
  - Sync `web/src/styles/components.css` with all of `docs/design-system/components/bundle.css`. Today it holds only part of it.
  - Keep `tokens.css` identical to the design-system copy. The only exception is the stray `}}` fix already made in the repo's copy.
  - Add a typed React component in `web/src/components/ui/` for each of the 11 components: Button, StatusChip (replaces the existing one), TeamMarker, ConfidenceMeter, ConsentBadge, ExpiryBanner, StatTile, PlayerCard, ReviewEventRow, PitchHeatmap and Cover. Follow each component's README and `preview.html` exactly.
  - Add the theme mechanism: `data-theme` on `<html>`, following the system setting by default, with the review workspace forced to dark.
  - Add a gallery page at `/dev/components`, open to `platform_admin` only, that shows every component in every variant, in both themes.
- **Design surfaces:** the component gallery.
- **Acceptance:**
  - Every component renders in both themes.
  - Playwright screenshots of the gallery at 375, 768 and 1280 px are stored as baselines.
  - No hard-coded colour, font or spacing values exist outside `tokens.css`. Check with grep for hex and rgb values in the components.
  - axe reports no violations on the gallery.

## D02 App shell, navigation and page templates

- **Release:** v0
- **Depends on:** D01, C01
- **PRD:** AUTH05, NFR23, NFR24
- **Build:**
  - Add an authenticated layout:
    - At 992 px and up, a left sidebar on `surface-sunken`.
    - Under 768 px, a bottom tab bar.
    - Between 768 and 991 px, a collapsed sidebar.
  - Build the nav items from the user's role in the active organisation:
    - Club admin and coach: Dashboard, Squad, Matches, Settings.
    - Scout: Review queue, Shortlists.
    - Platform admin: Admin, Lab.
  - Add an organisation switcher in the shell.
  - Add page templates for list pages, detail pages with a hero, a two-pane workspace, and a single-decision flow (used for consent).
  - Add shared empty, loading (skeleton), error and forbidden states that use the copy rules in the design system.
  - Move the existing Lab pages into the shell.
- **Design surfaces:** shell, nav, org switcher, all templates.
- **Acceptance:**
  - Keyboard navigation works through the shell, with focus always visible.
  - Each role sees only its nav items. The server-side checks already exist; nav is only a convenience.
  - Playwright passes at all three breakpoints.

## C01 Organisations, roles, invitations and switching

- **Release:** v0
- **Depends on:** B00
- **PRD:** AUTH01, AUTH03, AUTH04, AUTH05, AUTH07, ADMIN01
- **Build:**
  - Use the full role set: owner, admin, coach, scout, agent, player, guardian and platform_admin.
  - Add invitations by email with a role. They expire after 14 days. The accept flow creates or links a user, and the email is sent through Mailpit locally.
  - Let a user belong to several organisations, with an active-organisation switch that persists per session.
  - Add organisation settings: name, type, country and region.
  - Add a platform admin queue for approving or rejecting new organisations (ADMIN01). Organisations start `pending`.
  - Write audit entries for logins, invitations and role changes.
- **Design surfaces:**
  - the invite form and its pending list
  - the accept-invitation page
  - the org switcher's data source
  - organisation settings
  - the admin organisation-approval list
- **Acceptance:**
  - An expired invitation cannot be accepted.
  - Switching organisation changes which data the scoped client returns. Prove it with an integration test.
  - Every new action is checked with `requireRole()`.

## C02 Independent scout registration and conflicts

- **Release:** v0
- **Depends on:** C01
- **PRD:** AUTH08, AUTH09, AUTH10, ADMIN01, ADMIN06 (suspension)
- **Build:**
  - Add a public scout registration flow. Collect name, ID or passport number (store only a hash), and phone. Require acceptance of the reviewer confidentiality terms, and store `termsAcceptedAt` and the wording version.
  - Add `ScoutProfile` with status `pending`, `approved` or `suspended`, plus `accuracyScore`.
  - Add `ScoutAffiliation`: the clubs and represented players a scout declares, which they can edit later.
  - Add a platform admin approve, reject and suspend flow.
  - A scout has no review access until they are approved and have accepted the terms.
- **Design surfaces:**
  - the registration steps, one topic per step
  - the terms acceptance step
  - the scout's own profile and affiliations page
  - the admin scout-approval list
- **Acceptance:**
  - An unapproved or suspended scout gets 403 on every review route.
  - The raw ID number is never stored.
  - Every approval, rejection and suspension is audited.

## C03 Entitlements, plans and feature flags

- **Release:** v0
- **Depends on:** C01
- **PRD:** BILL01, BILL02, ADMIN04, ADMIN05 (metering groundwork), NFR04
- **Build:**
  - Add `Plan`, `Subscription` and `Entitlement`.
  - Add one server function, `entitlement(orgId, key)` or `may(orgId, key)`, that resolves a value from the plan defaults, then the organisation's overrides, then feature flags.
  - Seed a `pilot` plan with generous limits, and put every pilot organisation on it.
  - Add per-organisation feature flags, with an admin UI to toggle them.
  - Add a usage meter table that records matches, minutes, GPU cost in cents and storage bytes per organisation. Wire it in from now on, even though nothing is charged.
- **Design surfaces:** the admin flags and overrides page for an organisation.
- **Acceptance:**
  - Unit tests cover the resolution order.
  - A lint rule or test fails the build if a known limit key is compared with a numeric literal.

## C04 Squad: teams, players, CSV import, departures

- **Release:** v0
- **Depends on:** D02, C01
- **PRD:** SQUAD01–SQUAD07, SQUAD09
- **Build:**
  - Add create, read, update and delete for teams: age group, gender (a label only) and season.
  - Add players: name, date of birth, position, preferred foot, height and squad number.
  - Squad numbers must be unique per team per season. Enforce this in the database.
  - Add CSV import with an upload step, a preview with per-row errors, and a commit step.
  - Add opposition placeholder players.
  - Let a club admin mark a player departed. This sets `clubStatus` and `departedAt` only, cascades nothing, removes the player from pickers and dashboards, and makes them read-only to the club.
- **Design surfaces:**
  - the squad list (dense table on desktop, cards on phones)
  - player create and edit
  - the CSV import steps
  - the team list
  - the departed filter
- **Acceptance:**
  - A duplicate squad number is rejected with a clear message.
  - The import preview shows row-level errors and commits nothing until the user confirms.
  - A departed player keeps all their records.

## C05 Consent records and guardian consent

- **Release:** v0
- **Depends on:** C04
- **PRD:** CONS01–CONS04, NFR08 (data side), NFR09, NFR10, NFR11 (live queries), NFR12
- **Build:**
  - Make `Consent` append-only. The current state is always the newest row. There are five states: none, requested, club-only, scout-visible and withdrawn.
  - Add separate choices for club-internal stats and for scout visibility.
  - For a player under 18, require a guardian: name, relationship, method and timestamp. Use the player's date of birth to decide.
  - Store a version for the consent wording. The wording must disclose independent scout review and processing outside South Africa (CONS04, NFR12).
  - Withdrawing consent is as easy as granting it, and takes effect immediately in every query. Add a `consentVisibleTo(viewer)` helper and use it in every player query.
  - Add a club-side consent recording flow, and a guardian-facing consent screen that uses `body-lg`, makes one decision per screen, and has large tap targets. The real copy is in the design system README.
- **Design surfaces:**
  - the consent screens for guardians
  - consent recording by the club
  - the consent history on a player
  - the ConsentBadge on lists
- **Acceptance:**
  - A test proves withdrawal hides the player from scout queries in the same request cycle.
  - No path edits a consent row in place.
  - Every consent change is audited.

## C06 Matches and resumable upload

- **Release:** v0
- **Depends on:** C04, C03
- **PRD:** MATCH01–MATCH05, MATCH07, MATCH08, SQUAD05, SQUAD06, NFR26
- **Build:**
  - Add match create, read, update and delete: date, venue, competition, and home and away teams.
  - Add chunked, resumable upload straight to S3 (multipart with presigned parts). It accepts MP4 or MOV up to 8 GB, shows progress, and retries and resumes after a dropped connection.
  - Validate the file with ffprobe on the worker: duration, at least 1080p, frame rate and aspect ratio. Warn or reject footage that is not wide-angle, with guidance on how to re-film.
  - Add lineup entry (starters, subs, shirt numbers and positions) and substitutions with the minute.
  - Add kickoff and half-time markers set against the video.
  - Show match status, with an estimated finish time and a countdown to raw-footage expiry (`rawExpiresAt` is upload time plus 7 days).
  - Deleting a match removes everything derived from it, and is audited.
  - Every upload is recorded in the usage meter.
- **Design surfaces:**
  - the match list grouped by status
  - create match
  - the upload screen (progress, resume, errors)
  - lineup entry
  - the kickoff and half-time marker tool
  - the match detail page
- **Acceptance:**
  - An upload interrupted at 50% resumes without restarting. Prove it in a Playwright or integration test.
  - Footage under 1080p is rejected with guidance.
  - Minutes played are computed correctly across substitutions.

## C07 Transcode, HLS and secure playback

- **Release:** v0
- **Depends on:** C06
- **PRD:** MATCH06, NFR03, NFR17, NFR25, NFR31
- **Build:**
  - Add a pg-boss transcode job on the CPU worker. It uses ffmpeg to produce HLS at several bitrates.
  - Add a `ProcessingJob` record per job: type, status, attempts, timings and error.
  - Add an HLS player component that uses short-lived signed URLs (the playlist and its segments), with keyboard controls, captions track support and a time display in the `data` style.
  - Write job history to the structured logs, so a job's whole history can be rebuilt.
- **Design surfaces:** the video player and the processing status on the match page.
- **Acceptance:**
  - Playback starts in under 3 s locally.
  - Signed URLs expire, and an expired URL returns 403.
  - A failed transcode retries 3 times and then lands in the dead-letter queue.

## C08 CV job dispatch, GPU lifecycle and result ingest

- **Release:** v0
- **Depends on:** C07
- **PRD:** CV01, CV09, CV10, NFR04, NFR06, NFR07, NFR30
- **Build:**
  - Add a `GpuProvider` interface with a `docker` implementation for local development and a stub for an hourly provider.
  - The dispatcher starts an instance per job. The worker pulls frames by signed URL, writes the versioned JSON result (the contract on PRD page 19) to S3, then calls back to the API.
  - Add a JSON Schema for the result contract. Validate every result against it.
  - Add idempotent ingest: a retried job can never double-count. Key everything on `(jobId, trackIndex)` and on the event's identity.
  - Write `Track`, `TrackPoint` (partitioned by match with a raw SQL migration) and `Event` rows. The status comes from the per-organisation thresholds: at or above the threshold is `auto_accepted`, below is `pending_review`.
  - Add a watchdog that destroys an instance after 10 minutes idle, or 30 minutes past its job.
  - Record `costCents` per job.
  - After 3 failures a job goes to the dead-letter queue and a platform admin is alerted.
- **Design surfaces:** none beyond the job status already on the match page.
- **Acceptance:**
  - Ingesting the same result twice changes nothing.
  - Watchdog tests use a fake clock.
  - The schema rejects a result with a missing field.

## C09 CV pipeline (Python) and clip cutting

- **Release:** v0
- **Depends on:** C08, C05
- **PRD:** CV02–CV08, CV11, NFR08 (ingest gate), NFR01
- **Build:** in `cv_worker/`:
  - Sample frames at 5 fps.
  - Detect players, goalkeepers, referees and the ball with RF-DETR (Apache-2.0).
  - Track players with ByteTrack, using `supervision`, which is MIT.
  - Assign teams by kit colour, handling goalkeepers separately.
  - Calibrate the pitch once per venue and camera, with a homography to the 105 by 68 pitch, and reuse the calibration.
  - Link tracks to lineup players, using shirt numbers where they can be read.
  - Detect goals and shots, each with a confidence and a clip window.
  - Produce position tracks, heatmaps and distance covered.
  - Keep a synthetic mode so CI runs without a GPU.
  - Before any event is attributed, discard tracks linked to under-18 players who have no recorded consent (NFR08). The gate lives at ingest, not at publication.
  - After the CV job, the CPU worker cuts one clip per event and creates `Clip` rows with `expiresAt` set to upload time plus 14 days (CV11).
  - Add the `ClipFavourite` model now, so C11 and C13 can share it. Any favourite clears `expiresAt`, and removing the last one restores it.
  - Update `LICENSES.md` for every model and dataset you add. No AGPL code. Use SoccerNet only for benchmarking.
- **Design surfaces:** the Lab recall and benchmark views, which already exist and need extending.
- **Acceptance:**
  - Synthetic end-to-end goes from upload, to processing, to events in the database.
  - A non-consented minor gets no events and no track points retained. Prove it with a test.
  - Recall against hand-tagged fixtures is reported in the Lab.

## C10 Review queue and claims

- **Release:** v0
- **Depends on:** C02, C08
- **PRD:** REVIEW01, REVIEW02, REVIEW13, AUTH07 (review sessions)
- **Build:**
  - Add a shared queue of matches in `awaiting_review`, sorted by how soon their raw footage expires. Show the time left on every row.
  - A claim lasts 48 hours. Only one claim can be active per match. An expired claim returns the match to the queue, through a scheduled job.
  - Block a claim if the scout declared an affiliation with either club, or represents a player in the lineup.
  - Alert platform admins 48 hours before an unreviewed match's footage is deleted.
  - Audit every claim, release and expiry.
- **Design surfaces:**
  - the review queue: a table on desktop and cards on phones, with an ExpiryBanner and the "No matches waiting" empty state
  - the claim confirmation
- **Acceptance:**
  - A conflicted scout cannot claim the match. The server rejects it even if the UI is bypassed.
  - A claim is released at 48 hours. Prove it with a fake clock.
  - The queue is ordered by expiry.

## C11 Review workspace

- **Release:** v0
- **Depends on:** C10, C09, D01
- **PRD:** REVIEW03–REVIEW11, AUTH07
- **Build:**
  - Use a two-pane layout, dark by default: video on the left, the event list on the right. It stacks on a phone.
  - List every event below its threshold, using ReviewEventRow. Each row has a ConfidenceMeter, a TeamMarker and its clip cued up.
  - Add keyboard shortcuts: J and K for next and previous, Y to confirm, N to reject, E to edit.
  - Let the scout reassign an event to another player.
  - Let the scout add a missed event at a timestamp. Only allow this while the raw footage exists.
  - Add a track-link editor. Changing a link re-attributes every event on that track in one transaction.
  - Store every correction in `EventCorrection`, as training data.
  - Let the scout favourite a clip (PROF08), using the `ClipFavourite` model from C09.
  - Add "Mark as reviewed", which publishes. It hands off to C12.
  - Playback is stream-only, with the reviewer's name as a watermark overlay and no download. Access ends on submit or when the claim expires. Signed URLs are only issued against an active claim.
  - Add per-organisation thresholds per event type in organisation settings (REVIEW10).
- **Design surfaces:**
  - the review workspace
  - the track-link editor
  - the add-missed-event flow
  - the threshold settings
- **Acceptance:**
  - The keyboard-only review path passes in Playwright.
  - A track relink moves every event on the track.
  - A URL request after submit is refused.
  - Corrections are stored with the previous and new values.

## C12 Stats derivation and publishing

- **Release:** v0
- **Depends on:** C11
- **PRD:** REVIEW08, PROF02, PROF06, PROF07, the stats catalogue (v0 rows)
- **Build:**
  - Add one stats catalogue module that defines every stat once: ID, label, unit, auto-accept threshold and release. The pipeline, the review screen and the profile all use it.
  - Build `PlayerMatchStats` from the events when a match is published or re-reviewed. Nothing ever writes to it directly.
  - Cover minutes played, distance, heatmap, average position, goals, shots, shots on target and touches.
  - Compute season totals and per-90 rates. Under 3 matches, flag the small sample.
  - Only reviewed matches count.
  - Email the club when its match is reviewed (NOTIF02, part).
- **Design surfaces:** none beyond stat formatting helpers ("0.62 goals per 90 · based on 2 matches").
- **Acceptance:**
  - Rebuilding twice gives the same result.
  - An unreviewed match contributes nothing.
  - Unit tests cover the per-90 maths and the sample flag.

## C13 Player profiles and clips

- **Release:** v0
- **Depends on:** C12
- **PRD:** PROF01–PROF05, PROF07–PROF09
- **Build:**
  - Add a profile hero: name, position, age band, club, and the former club if the player departed.
  - Add StatTiles with sample sizes, a PitchHeatmap per match and per season (on `turf`, with a legend), and a match log.
  - Every stat drills down to its events, with a timestamp and a clip while the clip is retained.
  - Add favouriting to the profile, using the `ClipFavourite` model from C09. Club staff, the reviewing scout, and the player or guardian can favourite. The favourite count is limited by an entitlement.
  - The profile is private to the club until consent makes it visible.
  - A departed player's profile stays under the player's or guardian's control.
- **Design surfaces:**
  - the player profile
  - the stat drill-down
  - the clip player
  - the favourite control and its limit message
- **Acceptance:**
  - Visibility follows the consent state. Prove it with a test for each role.
  - The favourite limit is read from entitlements.
  - The profile passes axe and works at 375 px.

## C14 Club dashboard

- **Release:** v0
- **Depends on:** C13, C06
- **PRD:** the "Club dashboard" surface, SQUAD09
- **Build:**
  - Show the squad at a glance, matches by status, consent gaps (players with no consent or a request outstanding), and footage expiring soon.
  - Coaches see a read-mostly version.
- **Design surfaces:** the club dashboard.
- **Acceptance:** departed players are excluded, and the counts match the database.

## C15 Shortlists (v0 scope)

- **Release:** v0
- **Depends on:** C13, C10
- **PRD:** SCOUT01
- **Build:**
  - Add named shortlists and the ability to add or remove players.
  - In v0, a scout can only add consented players from matches they reviewed.
  - Each entry can have a note.
- **Design surfaces:** the shortlist list, the shortlist detail, and an "Add to shortlist" button on the profile.
- **Acceptance:**
  - The server rejects adding a non-consented player, or a player from a match the scout did not review.

## C16 Email notifications

- **Release:** v0
- **Depends on:** C08, C10, C12
- **PRD:** NOTIF01, NOTIF02, NOTIF03
- **Build:**
  - Add email templates that follow the design-system voice.
  - Send emails when processing finishes or fails, when new matches enter the queue (to scouts), when a match is reviewed (to the club), and 3 days before un-favourited clips are deleted (to the club and the player or guardian).
  - Queue every email through pg-boss and make sending idempotent.
- **Design surfaces:** the email templates.
- **Acceptance:** each email lands in Mailpit in the e2e tests, and none is sent twice for one event.

## C17 Retention and cleanup

- **Release:** v0
- **Depends on:** C09, C13
- **PRD:** CONS09, NFR13, NFR32, MATCH07
- **Build:**
  - Add a daily retention job:
    - It deletes raw footage and HLS 7 days after upload.
    - It deletes un-favourited clips 14 days after upload.
    - It sets `deletedAt` on each record and keeps the record, events and stats.
  - Add S3 lifecycle rules as a second layer.
  - No other process deletes raw footage.
  - The job never deletes anything before 7 days, and refuses if the clock looks wrong.
  - Audit every deletion.
- **Design surfaces:** "Footage deleted" states on the match and clip views.
- **Acceptance:**
  - Fake-clock tests cover day 6, day 7, day 14, and a clip favourited after its warning was sent.

## C18 Admin console, disputes and spot-checks

- **Release:** v0
- **Depends on:** C10, C12, C03
- **PRD:** ADMIN02, ADMIN03, ADMIN05, ADMIN06, REVIEW12
- **Build:**
  - Add a jobs dashboard with re-run and cancel.
  - Add a takedown and consent-withdrawal action.
  - Add usage reports per organisation: matches, minutes, GPU cost and storage, read from the usage meter.
  - Add a review-queue dashboard: unclaimed matches, time to expiry, reviewer activity, disputed reviews, and suspending a scout.
  - A club can dispute a published review within 7 days, and a platform admin decides it.
  - Pick a weekly random sample of reviews for spot-checks.
- **Design surfaces:** the admin home, jobs, usage, the review operations dashboard, the dispute flow on both the club and admin sides, and the spot-check list.
- **Acceptance:**
  - A dispute after 7 days is refused.
  - Every admin action is audited.

## C19 Pilot hardening and operations

- **Release:** v0
- **Depends on:** all other v0 chunks
- **PRD:** NFR02, NFR18, NFR19, NFR22, NFR23, NFR24, NFR28, NFR29, and the README's "Before the pilot" list
- **Build:**
  - Add Terraform with the hcloud provider: a server, a volume, a firewall (22 key-only from restricted IPs, plus 80 and 443), automatic security updates, and object storage buckets with lifecycle rules.
  - Add a production compose override, and inject secrets at deploy.
  - Add nightly database dumps to object storage with 30-day retention, plus a restore script.
  - Add Postgres row-level security as a second layer under the scoped client.
  - Add uptime monitoring and disk alerts.
  - Add a performance budget check: pages under 2 s on simulated 4G.
  - Run a full WCAG 2.2 AA pass on every v0 screen.
- **Design surfaces:** a final visual QA pass across every screen at 3 breakpoints and in both themes.
- **Acceptance:**
  - `terraform plan` is clean.
  - A restore from a dump works.
  - The RLS tests prove cross-tenant reads fail even through the raw client in an app role.
  - There are no axe violations.
- **Not engineering:** NFR14 and NFR15 (information officer, PAIA manual, club terms and operator agreements) are gates owned outside the build. They are listed in `STATUS.md` as `blocked` until someone confirms them.

## Release v1: Scout network (free, opt-in profiles)

### Gate to v2

25 clubs are live, pass recall is 85% or more, and 50 scouts are active each week.

## V101 Passes and v1 stats

- **Release:** v1
- **Depends on:** C19
- **PRD:** CV12, stats catalogue (v1 rows: passes, direction and length, cross, assist, possession share)
- **Build:**
  - Detect passes, each with a sender, a receiver and an outcome.
  - Add the v1 catalogue stats, with their thresholds.
  - Add pass events to the review workspace.
- **Acceptance:** pass recall against hand-tagged fixtures is reported, and the stats are rebuilt for re-reviewed matches.

## V102 Scout search

- **Release:** v1
- **Depends on:** C19
- **PRD:** SEARCH01–SEARCH04, NFR11 (derived artefacts within 24 h)
- **Build:**
  - Search consented players by name, position, age band, region and club, including "no current club".
  - Filter by stat thresholds and sort by any stat, with a minimum-matches filter.
  - Results always exclude players without current consent.
  - Purge any search index or cache within 24 hours of a withdrawal.
- **Design surfaces:** the search page, with a dense filter rail, a results table, and a filter sheet on phones.
- **Acceptance:** a withdrawn player disappears from results at once.

## V103 Reports and sharing

- **Release:** v1
- **Depends on:** V102
- **PRD:** SCOUT02–SCOUT04
- **Build:**
  - Add scouting reports with ratings and free text. A report is private to its author unless shared.
  - Let a scout share a shortlist with a colleague, by link or by invitation.
- **Design surfaces:** the report editor, the report view, and the share dialog.

## V104 Consent v1 and player self-service

- **Release:** v1
- **Depends on:** C19
- **PRD:** CONS05–CONS08, NOTIF05, PROF10, SQUAD08, SQUAD10
- **Build:**
  - Email guardians a consent request, and email them when consent is granted or withdrawn.
  - Prompt players turning 18 to confirm consent in their own right.
  - Export everything held about a player, on request.
  - Delete a player on request within 30 days. The deletion cascades and leaves a tombstone in the audit log.
  - Add a public profile link that the player or guardian can switch off.
  - Merge duplicate player records.
  - Let a new club claim a departed player's profile, with consent.
- **Design surfaces:**
  - the player and guardian home
  - the public profile
  - the merge tool
  - the claim flow
  - the export and delete request flows

## V105 Notification centre and reviewer metrics

- **Release:** v1
- **Depends on:** C19
- **PRD:** NOTIF04, REVIEW14
- **Build:**
  - Add an in-app notification centre.
  - Show the reviewer, time taken and correction count per match, plus a per-scout accuracy score from spot-checks.
- **Design surfaces:** the notification panel and the reviewer metrics.

## Release v2: Paid platform

## V201 Billing

- **Release:** v2
- **Depends on:** V101–V105
- **PRD:** BILL03–BILL06
- **Build:**
  - Add a payment provider interface. Pick the provider just before v2: Paystack, Stripe, PayFast or Peach.
  - Add self-serve checkout, plan changes and cancellation.
  - Enforce entitlement limits.
  - Add invoices.
  - A lapsed organisation becomes read-only. Its data is never deleted.
  - All of this sits behind the C03 feature flag.

## V202 Advanced CV and re-runs

- **Release:** v2
- **Depends on:** V101
- **PRD:** CV13, CV14, stats catalogue (v2 rows)
- **Build:**
  - Detect tackles, duels, interceptions and recoveries.
  - Allow re-running a match with a newer model, only while its raw footage exists.

## V203 Pro tools

- **Release:** v2
- **Depends on:** V102, V103
- **PRD:** PROF11, PROF12, SEARCH05, SCOUT05, CONS10, NOTIF06, the agent role
- **Build:**
  - Compare up to 4 players side by side.
  - Build highlight reels from favourited clips.
  - Add saved-search alerts.
  - Export to PDF and CSV.
  - Blur the faces of non-consented players in shared clips.
  - Notify players of profile views, if they have opted in.
  - Add the agent and pro-club workflows.

## Not scheduled

- MATCH09 (importing from Veo or Pixellot)
- v3
