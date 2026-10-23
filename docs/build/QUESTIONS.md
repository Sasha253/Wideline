# Open questions

These questions do not block the build. Each one has a default that the build is already using. Write your answer on the `Answer:` line whenever you like. The build session reads this file before every chunk. An answer that differs from the default gets a rework note in `STATUS.md`.

## Q-001 · all chunks · Commit permission

- **Question:** May the build session commit each chunk to the current branch, once the chunk passes review and the session's own checks? It would never push.
- **Default taken:** no commits. The work stays uncommitted, and `STATUS.md` records which files belong to each chunk.
- **Recommended:** yes. With one commit per chunk, each chunk is easy to review and to revert.
- **Impact:** if you answer yes, later chunks are committed as they finish, and the earlier finished chunks are committed one by one, in order.
- **Answer:** Yes. Commit each chunk once it passes review and the session's own checks. Never push. (Given by the user in the orchestrator chat on 2026-10-23, recorded by the orchestrator.)
- **Resolved:** matches the recommendation. B00 is committed, and later chunks run with `commit: true`.

## Q-002 · D02 · Settings in the coach's nav

- **Question:** Should coaches see a Settings nav item? CHUNKS.md lists Settings for "club admin and coach", but the settings pages (organisation, members) are for owners and admins only. A coach who clicked Settings today would land on "No access".
- **Default taken:** Settings shows for owners and admins only. Coaches see Dashboard, Squad and Matches.
- **Recommended:** keep it hidden for coaches until there is a settings page that matters to them, such as personal notification preferences (V105).
- **Impact:** if coaches should see it, add a read-only organisation settings view or a personal settings page for coaches, and add `coach` to the Settings roles in `web/src/lib/nav.ts`. That is one constant plus one page.
- **Answer:** Keep the default. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-003 · D02 · Where each role lands after sign-in or a switch

- **Question:** Where should each role land after signing in or switching organisation?
- **Default taken:** platform admins go to `/lab/matches`; owners, admins and coaches to `/dashboard` (a placeholder until C14); scouts to `/review` (a placeholder until C10); anyone else to `/organisations`. With several roles, the first match in that order wins.
- **Recommended:** keep this default. It lives in one function, `homeFor()` in `web/src/lib/nav.ts`.
- **Impact:** a different landing page changes only `homeFor()` and the redirect expectations in the e2e specs.
- **Answer:** Keep the default. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-004 · C02 · Reviewer confidentiality terms wording

- **Question:** What should the reviewer confidentiality terms say? This includes the PRD open question of whether a scout who reviewed a match may contact a non-consented player's club about that player.
- **Default taken:** draft wording in `web/src/server/scouts/terms.ts`, version `2026-10-draft-1`, marked "Draft for legal review". It forbids downloading or recording footage, and forbids contacting players or clubs seen in review outside Wideline. It requires declaring conflicts and confirming 18 or over.
- **Recommended:** keep the draft for the build and have the privacy lawyer approve the final wording as part of the v0 gate (NFR15).
- **Impact:** new wording means a new `REVIEWER_TERMS_VERSION`. Every scout is then blocked from review until they re-accept on `/scout`. That flow is built in, so nothing changes beyond the text and the version.
- **Answer:** Keep the draft for the build; the privacy lawyer approves the final wording before the first pilot club joins (v0 gate, NFR15). The draft's "no contact with players or clubs seen in review outside Wideline" stands as the answer to the PRD open question until the lawyer says otherwise. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default. Legal sign-off stays open as part of the v0 gate.

## Q-005 · C02 · Scout identity verification beyond a manual check

- **Question:** How should scout identity be verified beyond a platform admin's manual check? Options are a paid ID-verification provider or an SMS one-time code to the phone.
- **Default taken:** manual. The admin approves on name, phone, confirmed email and affiliations. The ID is used only as a hashed uniqueness check. No third-party service and no SMS.
- **Recommended:** manual for the pilot (10 reviewers). Revisit before v1, when there are 40 or more reviewers.
- **Impact:** a provider adds an identity-check step and a stored verification reference. SMS adds an OTP step and a cost per message. `ScoutProfile.verifiedAt` already exists for either.
- **Answer:** Manual admin check for the pilot. Revisit before v1 (40+ reviewers). (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-006 · C02 · Cooling-off after removing a declared conflict

- **Question:** Should removing a declared club affiliation keep blocking that club for a cooling-off period, so a scout cannot remove a conflict and then claim the match?
- **Default taken:** no cooling-off. Removals are soft (`removedAt` kept) and audited, so platform admins can see the history.
- **Recommended:** add a 90-day cooling-off in `scoutConflicts()` once C10 is in place. It is a one-line filter change.
- **Impact:** only `scoutConflicts()` changes, to count rows removed within the period. No schema change.
- **Answer:** Yes: a 90-day cooling-off. A removed club conflict keeps blocking claims for 90 days. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** differs from the default (no cooling-off). Rework note added to C10 in STATUS.md: `scoutConflicts()` must count affiliations removed within the last 90 days.

## Q-007 · C03 · How numbers are written

- **Question:** How should large numbers and decimals be written in the app? C03 adds the first number formatter, for limits such as "10,000 clips" and "8.59 GB".
- **Default taken:** commas between thousands and a full stop for decimals ("10,000", "8.59"), using `Intl.NumberFormat("en-GB")` in `formatCount()` and `formatGB()` in `web/src/lib/labels.ts`. This matches the design system's own examples ("8.4 km", "0.81 confidence").
- **Recommended:** keep the default. The South African standard style ("10 000", "8,59") is correct but less familiar on screens, and it would clash with the design system's examples.
- **Impact:** a different style changes the locale in two helpers in `labels.ts` and the expected text in a few tests. No schema or layout change.
- **Answer:**

## Q-008 · C03 · Which roles count toward member seats and scout seats

- **Question:** Which roles count toward the `member_seats` and `scout_seats` limits? The admin page describes each limit, and v2 enforcement (BILL05) will count against these words.
- **Default taken:** member seats are owners, admins and coaches. Scout seats are scouts and agents. Players and guardians never count, because they never pay (PRD pricing). The descriptions in `web/src/lib/entitlement-keys.ts` say so, marked as draft copy.
- **Recommended:** keep the default for v0. Nothing is enforced until v2, so confirm it when the paid plans are priced.
- **Impact:** a different split changes two descriptions now, and the seat-counting query when BILL05 is built. No schema change.
- **Answer:**

## Q-009 · C03 · Limits on the free Pilot plan

- **Question:** What limits should the free Pilot plan have?
- **Default taken:** `matches_per_month` 100, `favourited_clips` 10,000, `member_seats` 100, `scout_seats` 50, `upload_max_bytes` 8 GiB, and every feature flag (billing, scout search, share links, scout reports) off. These are draft values, in `PILOT_PLAN_LIMITS` and in the `pilot` Plan row.
- **Recommended:** keep these generous numbers for the pilot (the PRD says "effectively unmetered"). Nothing is enforced until V201 (BILL05), and a single club can be raised from the admin flags and limits page.
- **Impact:** different numbers need only a new data migration that updates the Plan row's limits JSON, plus the constant. No code or schema change.
- **Answer:**

## Q-010 · C03 · Currency for GPU cost in the usage meter

- **Question:** Which currency should GPU cost be recorded in for the usage meter (NFR04, NFR05)?
- **Default taken:** each GPU cost row records cents in the provider's billing currency, with an ISO currency column. Totals are grouped by currency, with no exchange-rate conversion.
- **Recommended:** keep the provider's currency, and add ZAR conversion in the C18 usage report once the GPU provider (a PRD open question) is chosen.
- **Impact:** if everything must be stored in ZAR, C08 converts at record time with a stored rate. The meter already has the currency column, so nothing in C03 changes.
- **Answer:**
