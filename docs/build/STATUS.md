# Build status

This file tracks progress against [CHUNKS.md](CHUNKS.md). The orchestrator session and the `wideline-build` workflow update it after every chunk. Status values are `todo`, `in_progress`, `done` and `blocked`.

**Baseline:** Phase 1 is commit `0b1a32c` (see "Already done" in CHUNKS.md).

## v0: Pilot

| ID | Title | Status | Commit | Notes |
|---|---|---|---|---|
| B00 | Build kit and conventions | done | see git log (`B00: Build kit and conventions`) | Files: `docs/build/STATUS.md` (new), `README.md` ("Build conventions" section). All review lenses passed; no unresolved issues. Assumptions: one table per release in build order; Gates and Log sections added; README Layout block left unchanged; Cover gap noted on D01. Gaps: no new tests (no code changed); mypy venv shebangs were stale, repaired with `uv sync --reinstall` in `cv_worker/` (see Log). Minor, not fixed: README section is 14 lines (plan said 6-10); CHUNKS.md conventions had no consent rule (NFR08, CONS03); the orchestrator added one. |
| D01 | Design system in React | todo | - | `docs/design-system/components/Cover/` has only `preview.html`, no `README.md`. Build Cover from `preview.html`. |
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
