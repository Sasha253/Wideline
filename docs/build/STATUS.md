# Build status

This file tracks progress against [CHUNKS.md](CHUNKS.md). The orchestrator session and the `wideline-build` workflow update it after every chunk. Status values are `todo`, `in_progress`, `done` and `blocked`.

**Baseline:** Phase 1 is commit `0b1a32c` (see "Already done" in CHUNKS.md).

## v0: Pilot

| ID | Title | Status | Commit | Notes |
|---|---|---|---|---|
| B00 | Build kit and conventions | done | see git log (`B00: Build kit and conventions`) | Files: `docs/build/STATUS.md` (new), `README.md` ("Build conventions" section). All review lenses passed; no unresolved issues. Assumptions: one table per release in build order; Gates and Log sections added; README Layout block left unchanged; Cover gap noted on D01. Gaps: no new tests (no code changed); mypy venv shebangs were stale, repaired with `uv sync --reinstall` in `cv_worker/` (see Log). Minor, not fixed: README section is 14 lines (plan said 6-10); CHUNKS.md conventions had no consent rule (NFR08, CONS03); the orchestrator added one. |
| D01 | Design system in React | done | see git log (`D01: Design system in React`) | All lenses pass after the orchestrator check (the one major was an unverified e2e run; the orchestrator ran it: 13/13). Assumptions: components.css already matched bundle.css apart from fonts and `body`; Cover built from preview.html as `wl-cover*` in the Additions block; forced dark via `ThemeScope`; no user theme toggle; every StatusChip preset has an icon. **NFR25 is still open:** only groundwork here (focus ring, labelled controls). The video player, captions and keys belong to C07/C11. Exceptions: gallery-only floodlight use (New chip, Cover) exceeds the twice-per-screen rule because the gallery shows every variant; 88px Cover wordmark and 3.2-unit dot labels are recorded font-size exceptions. Minor, open: PitchHeatmap dot radius scales with SVG width (~7px at 375); dot labels ~9px at 375 and not in the aria-label; gallery lacks a few variants (e.g. PlayerCard 'No current club'); PlayerCard menu has no e2e for Escape/outside click; globals.css wl- rules sit outside the components layer; Cover keeps literal `rx` attrs (CSS overrides them); screenshot baselines come from the dev server in the Playwright image, while CI runs a production build on ubuntu (untested pairing, check on first CI run). Pre-existing, for later: login `next` accepts `/\evil.com` (open redirect, fix in C01 or D02); Lab table scroll wrapper needs tabIndex/region label (D02); `text-[24px]` in lab/layout.tsx (D02). |
| C01 | Organisations, roles, invitations and switching | todo | - | |
| D02 | App shell, navigation and page templates | todo | - | |
| C02 | Independent scout registration and conflicts | todo | - | |
| C03 | Entitlements, plans and feature flags | todo | - | |
| C04 | Squad: teams, players, CSV import, departures | todo | - | |
| C05 | Consent records and guardian consent | todo | - | |
| C06 | Matches and resumable upload | todo | - | |
| C07 | Transcode, HLS and secure playback | todo | - | |
| C08 | CV job dispatch, GPU lifecycle and result ingest | todo | - | |
| C09 | CV pipeline (Python) and clip cutting | todo | - | |
| C10 | Review queue and claims | todo | - | |
| C11 | Review workspace | todo | - | |
| C12 | Stats derivation and publishing | todo | - | |
| C13 | Player profiles and clips | todo | - | |
| C14 | Club dashboard | todo | - | |
| C15 | Shortlists (v0 scope) | todo | - | |
| C16 | Email notifications | todo | - | |
| C17 | Retention and cleanup | todo | - | |
| C18 | Admin console, disputes and spot-checks | todo | - | |
| C19 | Pilot hardening and operations | todo | - | |

## v1: Scout network

| ID | Title | Status | Commit | Notes |
|---|---|---|---|---|
| V101 | Passes and v1 stats | todo | - | |
| V102 | Scout search | todo | - | |
| V103 | Reports and sharing | todo | - | |
| V104 | Consent v1 and player self-service | todo | - | |
| V105 | Notification centre and reviewer metrics | todo | - | |

## v2: Paid platform

| ID | Title | Status | Commit | Notes |
|---|---|---|---|---|
| V201 | Billing | todo | - | |
| V202 | Advanced CV and re-runs | todo | - | |
| V203 | Pro tools | todo | - | |

## Gates (outside the build)

These are not chunks. The build cannot close them. See "Release gates" in ORCHESTRATOR.md.

| Gate | What | Status | Notes |
|---|---|---|---|
| NFR14 | Information officer, PAIA manual and privacy notice | blocked | Owned outside the build; needs user confirmation. |
| NFR15 | Club terms, operator agreements and reviewer terms | blocked | Owned outside the build; needs user confirmation. |
| v0 gate | 5 clubs live, shot recall of 95% or more, 10 active reviewers, and legal review of the consent wording and scout-review exposure | todo | Must be confirmed by the user before any v1 chunk starts. |
| v1 gate | 25 clubs live, pass recall of 85% or more, 50 weekly scouts, and a choice of payment provider for V201 | todo | Must be confirmed by the user before any v2 chunk starts. |

## Log

- **2026-10-23 · B00 Build kit and conventions** (no PRD IDs; enabling work). Created `docs/build/STATUS.md`. Added a "Build conventions" section to `README.md`. Checked that `docs/design-system/` and `docs/build/prd.txt` exist, and that the chunk tables list the same 30 IDs as the `## <ID>` headings in CHUNKS.md. Checks: the first `make lint` run passed ESLint, Prettier, tsc and ruff, then failed to start mypy. The cause was that `cv_worker/.venv` had been created under an old path (`/Users/sashamuller/wideline`), so its script shebangs were stale. After review, the venv was repaired with `uv sync --reinstall` in `cv_worker/`. This changed the local environment only, not repo files. Re-run after the repair: `make lint` exit 0 (ESLint, Prettier, tsc, ruff check, ruff format, mypy), `make test-web` exit 0 (9 tests), `make test-cv` exit 0 (3 tests). No questions or blockers raised. Uncommitted (Q-001 default). Next chunk: D01.
- **2026-10-23 · Orchestrator check of B00.** Q-001 answered yes by the user in chat; recorded in QUESTIONS.md. Re-ran `make lint` (ESLint, Prettier, tsc, ruff, mypy: all pass) and `make test-web` (9/9 pass). Added a "Consent" bullet to the CHUNKS.md conventions and "consent" to the README list, closing the security lens's minor. Left open: the README section is 14 lines (cosmetic). B00 committed with the build kit (`docs/build/`, `docs/design-system/`, `.claude/workflows/`). Next chunk: D01.
- **2026-10-23 · D01 Design system in React** (NFR23, NFR24, NFR25 foundations, NFR27). Built the typed UI library in `web/src/components/ui/`, the theme mechanism (`ThemeScript` on `<html>`, `ThemeScope` for forced dark; Lab now uses it) and the `/dev/components` gallery (light and dark bands, 12 blocks each). `components.css` already held every bundle rule; a Vitest sync test now locks it to `docs/design-system/` (skipped in the web container, which does not mount `docs/`; ran on the host: 37/37 pass). Left out on purpose: the bundle's Google Fonts @import and `body` rule. Cover follows `preview.html` (no README). Checks: `make lint` pass (ESLint, Prettier, tsc, ruff, mypy); `make test-web` pass (96 passed, 2 skipped: the docs sync tests); Playwright in `mcr.microsoft.com/playwright:v1.64.1-noble` against the dev stack: 9/9 pass (smoke, theme, gallery with axe wcag2a/aa, 21a/aa, 22aa zero violations, screenshots at 375/768/1280). Smoke and theme specs also pass on the macOS host. Baselines are Linux only (`*-chromium-linux.png`); regenerate with `make test-e2e-update E2E_PASSWORD=…`. A macOS `make test-e2e` run has no darwin baselines and will write them as new snapshots. Added devDependency `@axe-core/playwright` 4.14.0 and rebuilt the stack with `make up`. `make seed` was re-run, which reset the local admin password. Next chunk: C01.
- **2026-10-23 · D01 review fixes.** (1) `make test-e2e` now runs in `mcr.microsoft.com/playwright:v1.64.1-noble` with the Caddy relay, like `test-e2e-update` (shared `PLAYWRIGHT_RUN`). `playwright.config.ts` sets `updateSnapshots: "none"` and `ignoreSnapshots` when not CI and not Linux, so a direct macOS run skips only the pixel comparison and never writes darwin PNGs. Axe and the screenshot are now separate tests per width. (2) PlayerCard focus ring: the Tailwind `has-[.wl-player__link…]` class compiled to a dead selector (`_` becomes a space). It is replaced by plain CSS in the Additions block, and the duplicate unlayered `:focus-visible` rule in globals.css is removed so the components-layer rule can be overridden. New e2e test checks the card's computed outline after Tab. (3) Additions block font sizes: menu items use `.body`, the Cover name uses `.display-xl` (88px from 768px stays as an exception) and the tagline uses `.body` (the 14/20 size and 2px nudge are dropped). tokens.css now imports into the `base` layer, so wl- rules and utilities can adjust type classes. New unit test guards Additions font sizes and px spacing. Checks: `make lint` pass; `make test-web` pass (99 passed, 2 skipped); host vitest design-system test 40/40; `make test-e2e` 13/13 after regenerating the 3 Linux baselines (the 375px cover is 13px taller); host `playwright test` 13/13, no darwin PNGs written. `make seed` re-run (idempotent; resets the generated admin password).
- **2026-10-23 · D01 review fixes, round 2.** No code changes. The only finding was that the signed-in Playwright suite could not be verified, because the admin password had been reset and not reported. `make seed` was re-run (idempotent: it only resets the generated admin password) and the new password was handed to the reviewer out of band, not recorded here. Checks: `make test-e2e E2E_PASSWORD=…` 13/13 pass (smoke, theme ×3, gallery redirect, axe at 375/768/1280, 3 Linux screenshot baselines unchanged, PlayerCard focus ring, band surfaces); `make lint` pass (ESLint, Prettier, tsc, ruff, mypy); `make test-web` pass (99 passed, 2 skipped: the docs sync tests).
- **2026-10-23 · D01 recorded as in_progress.** One major issue is unresolved. The reviewer could not verify the signed-in Playwright suite. With the last reported password, `make test-e2e` gave 10 failed, 3 passed, all at sign-in (`auth.ts:25`). The reviewer's `make seed` reset the password again, and the classifier denied the re-run. To close: set `SEED_ADMIN_PASSWORD` in `.env`, run `make test-e2e E2E_PASSWORD=…`, confirm 13/13 with the 3 baselines unchanged. Minor findings are listed in the D01 row. Not committed (Q-001).
- **2026-10-23 · Orchestrator check of D01.** Ran `make test-e2e` in the Playwright image with the current seed password: 13/13 pass (axe at 375/768/1280, 3 baselines, theme, smoke). Read the gallery screenshots at 375 and 1280 in both themes; layout and tokens look right. Fixed minors myself: all `.wl-btn` sizes are 44px tall under 768px (design-system touch target); ConfidenceMeter "below threshold" words now set in sans `caption`, no wrap; StatTile drops the gap before `%`; the hex/rgb/px guard also scans `src/app/dev`; new unit test for a `pending_review` ReviewEventRow; `web/tsconfig.tsbuildinfo` untracked and `*.tsbuildinfo` git-ignored. Regenerated baselines (`make test-e2e-update`), then `make test-e2e` 13/13, `make lint` pass, `make test-web` 106 pass, 2 skipped (docs sync, skips in the container by design). Note: `make seed` rotates the admin password unless `SEED_ADMIN_PASSWORD` is set in `.env`. No questions or blockers raised. Next chunk: C01.
