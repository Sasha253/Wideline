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
- **Answer:** Keep the default. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-008 · C03 · Which roles count toward member seats and scout seats

- **Question:** Which roles count toward the `member_seats` and `scout_seats` limits? The admin page describes each limit, and v2 enforcement (BILL05) will count against these words.
- **Default taken:** member seats are owners, admins and coaches. Scout seats are scouts and agents. Players and guardians never count, because they never pay (PRD pricing). The descriptions in `web/src/lib/entitlement-keys.ts` say so, marked as draft copy.
- **Recommended:** keep the default for v0. Nothing is enforced until v2, so confirm it when the paid plans are priced.
- **Impact:** a different split changes two descriptions now, and the seat-counting query when BILL05 is built. No schema change.
- **Answer:** Keep the default. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-009 · C03 · Limits on the free Pilot plan

- **Question:** What limits should the free Pilot plan have?
- **Default taken:** `matches_per_month` 100, `favourited_clips` 10,000, `member_seats` 100, `scout_seats` 50, `upload_max_bytes` 8 GiB, and every feature flag (billing, scout search, share links, scout reports) off. These are draft values, in `PILOT_PLAN_LIMITS` and in the `pilot` Plan row.
- **Recommended:** keep these generous numbers for the pilot (the PRD says "effectively unmetered"). Nothing is enforced until V201 (BILL05), and a single club can be raised from the admin flags and limits page.
- **Impact:** different numbers need only a new data migration that updates the Plan row's limits JSON, plus the constant. No code or schema change.
- **Answer:** Keep the default. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-010 · C03 · Currency for GPU cost in the usage meter

- **Question:** Which currency should GPU cost be recorded in for the usage meter (NFR04, NFR05)?
- **Default taken:** each GPU cost row records cents in the provider's billing currency, with an ISO currency column. Totals are grouped by currency, with no exchange-rate conversion.
- **Recommended:** keep the provider's currency, and add ZAR conversion in the C18 usage report once the GPU provider (a PRD open question) is chosen.
- **Impact:** if everything must be stored in ZAR, C08 converts at record time with a stored rate. The meter already has the currency column, so nothing in C03 changes.
- **Answer:** Keep the default. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-011 · C04 · Can coaches change the squad

- **Question:** Should coaches be able to add and edit teams and players, import CSVs, or mark players departed?
- **Default taken:** owners and admins only (`SQUAD_ADMIN_ROLES` = `ORG_ADMIN_ROLES`). Coaches see the squad read-only.
- **Recommended:** keep the default for v0. The PRD gives "adds the squad" and "marks players who leave" to the club admin.
- **Impact:** one constant in `session.ts` and the read-only branches on two pages. No schema change.
- **Answer:** Coaches too: owners, admins and coaches may change the squad. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** differs from the default (owners and admins only). The session's permission check first blocked it; the user then confirmed it explicitly in chat on 2026-10-24. Done: `SQUAD_ADMIN_ROLES` is owners, admins and coaches.

## Q-012 · C04 · Undoing a departure

- **Question:** Can a club undo a departure it made by mistake?
- **Default taken:** no. Once departed, the player is read-only to the club (SQUAD09), and the confirm dialog says so. A platform admin can fix a mistake later (C18).
- **Recommended:** allow an owner or admin an "Undo departure" action for 7 days, audited. This is cheap and still keeps SQUAD09's intent.
- **Impact:** one audited server action and a button on the departed player page. No schema change.
- **Answer:** Yes: an owner, admin or coach may undo a departure within 7 days, audited. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** differs from the default (no undo). Reworked in the C04 follow-up commit.

## Q-013 · C04 · Importing valid rows when some rows have errors

- **Question:** When the import preview has rows with errors, may the user import the valid rows and skip the rest?
- **Default taken:** yes. The confirm button says "Import 18 players, skip 2 rows with errors". Nothing commits until it is pressed.
- **Recommended:** keep the default. The alternative is to block the commit until the file has no errors.
- **Impact:** one branch in `commitImport` and the button copy.
- **Answer:** Keep the default: import valid rows and skip rows with errors. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-014 · C04 · Named opposition players

- **Question:** May opposition players be named, or only unnamed placeholders?
- **Default taken:** only placeholders (shirt number and optional position) on opposition teams.
- **Recommended:** keep placeholders only. Named opposition minors would have no guardian consent recorded by their own club.
- **Impact:** lifting it means relaxing one validator and showing the name fields on opposition teams. No schema change.
- **Answer:** Keep the default: opposition players are unnamed placeholders only. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-015 · C05 · Checking who answers through a guardian link

- **Question:** A decision made through a guardian link takes effect as soon as it is saved. Wideline cannot check that the person who opened the link is really the player's parent or guardian. Should a link decision wait until a club admin confirms it, or take effect at once?
- **Default taken:** it takes effect at once. The guardian types their name, chooses a relationship and confirms "I am {first name}'s parent or guardian and I am 18 or over". The club sees the decision in the consent history as "Guardian link", recorded by "The guardian, through the link", and can withdraw it or record consent again. The copy box tells the club to send the link only to the parent or guardian.
- **Recommended:** keep the default for the pilot, and ask the privacy lawyer as part of the v0 gate whether this is enough for a "competent person" under POPIA section 35. A confirm step would add a sixth, pending state outside CONS01's five.
- **Impact:** a club confirmation step means a "waiting for the club" state (or a flag on the Consent row), a confirm action on the player page, and different copy on the guardian done screen. The append-only model and the visibility helper stay the same.
- **Answer:**

## Q-016 · C05 · Languages for guardian consent

- **Question:** Should the guardian consent screens and the paper form be offered in languages other than English, for example isiZulu, isiXhosa, Afrikaans or Sesotho?
- **Default taken:** English only, written for a reading age of about 12. Each wording version holds the text for two audiences (guardian and adult player), with no language key.
- **Recommended:** English for the pilot. Add the pilot clubs' main home languages before v1, each translated and checked by the privacy lawyer, because a guardian must understand what they agree to.
- **Impact:** a language key in `CONSENT_WORDINGS` (a version per language, stored on the Consent row), a language choice on the first guardian screen and on the print page, and translated screen copy. No change to states or visibility.
- **Answer:**

## Q-017 · C05 · Who may record or withdraw consent on the club side

- **Question:** Who may record or withdraw consent on the club side: owners and admins only, or coaches too (as with squad edits in Q-011)?
- **Default taken:** `CONSENT_ADMIN_ROLES` = owners and admins. Coaches see consent state and history read-only.
- **Recommended:** keep owners and admins. The PRD gives consent recording to the club admin, and a mistaken grant carries POPIA weight.
- **Impact:** one constant in `session.ts`, plus the read-only branch on the player page and the role expectations in the e2e spec.
- **Answer:**

## Q-018 · C05 · Consent gate for players aged 18 or over

- **Question:** Should the consent gate on per-player data (NFR08) also apply to players aged 18 or over, so an adult with no recorded consent gets no per-player stats?
- **Default taken:** yes. `attributablePlayerIds` allows only `club_only` or `scout_visible` for everyone. Adults give self-consent, recorded by the club.
- **Recommended:** keep it. It is simpler and safer, and CONS01 gives every player a consent state.
- **Impact:** one condition in `visibility.ts` (`mayAttribute`) plus its tests.
- **Answer:**

## Q-019 · C05 · How a guardian receives the consent link in v0

- **Question:** How does a guardian receive the consent link in v0, before emailed requests (CONS05) arrive in v1?
- **Default taken:** the club copies the link and shares it itself (WhatsApp or SMS), or hands its phone to the guardian. A paper form can be printed for signed consent. No email is sent.
- **Recommended:** keep it for the pilot. V104 adds email via `sendMail` and pg-boss.
- **Impact:** adding email now means a guardian email field (more personal data) and one `sendMail` call in `createConsentRequest`.
- **Answer:**

## Q-020 · C05 · Draft consent wording

- **Question:** Is the draft consent wording (version `2026-10-draft-1`, marked for legal review) acceptable for building, with the privacy lawyer approving the final text as part of the v0 gate?
- **Default taken:** build with the draft wording. It discloses independent scout review even when the scouts answer is no, and EU storage with possible processing elsewhere, outside South Africa.
- **Recommended:** yes, the same approach as Q-004.
- **Impact:** new wording means a new `CONSENT_WORDING_VERSION` entry. Existing rows keep their version. A re-consent prompt would be extra work in V104.
- **Answer:**

## Q-021 · C05 · Names of club-only players during scout review

- **Question:** When independent scouts review a match (C10/C11), may they see the names of `club_only` players, or only shirt numbers?
- **Default taken:** C05 discloses review in the wording. C10/C11 decide the display, and the noted default is shirt number only for `club_only` players.
- **Recommended:** shirt number only for `club_only` players during review.
- **Impact:** a reviewer viewer kind in `consentVisibleTo` and the review workspace labels. No schema change.
- **Answer:**

## Q-022 · C05 · Uploading signed paper consent forms

- **Question:** Should clubs upload a scan or photo of a signed paper consent form as evidence?
- **Default taken:** no upload in v0. `Consent.evidencePath` exists but is unused. The method `paper_form` and the recording user are stored.
- **Recommended:** add it in V104 with private storage and a retention rule.
- **Impact:** an upload step, an S3 prefix, and a signed-URL route for owners and admins. No schema change.
- **Answer:**
