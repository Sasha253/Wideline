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
- **Answer:** Keep the default: a link decision takes effect at once. Ask the privacy lawyer at the v0 gate whether this satisfies POPIA s35. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework. Lawyer question added to the v0 gate.

## Q-016 · C05 · Languages for guardian consent

- **Question:** Should the guardian consent screens and the paper form be offered in languages other than English, for example isiZulu, isiXhosa, Afrikaans or Sesotho?
- **Default taken:** English only, written for a reading age of about 12. Each wording version holds the text for two audiences (guardian and adult player), with no language key.
- **Recommended:** English for the pilot. Add the pilot clubs' main home languages before v1, each translated and checked by the privacy lawyer, because a guardian must understand what they agree to.
- **Impact:** a language key in `CONSENT_WORDINGS` (a version per language, stored on the Consent row), a language choice on the first guardian screen and on the print page, and translated screen copy. No change to states or visibility.
- **Answer:** English for the pilot; add the pilot clubs' home languages before v1, translated and checked by the lawyer. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-017 · C05 · Who may record or withdraw consent on the club side

- **Question:** Who may record or withdraw consent on the club side: owners and admins only, or coaches too (as with squad edits in Q-011)?
- **Default taken:** `CONSENT_ADMIN_ROLES` = owners and admins. Coaches see consent state and history read-only.
- **Recommended:** keep owners and admins. The PRD gives consent recording to the club admin, and a mistaken grant carries POPIA weight.
- **Impact:** one constant in `session.ts`, plus the read-only branch on the player page and the role expectations in the e2e spec.
- **Answer:** Owners and admins only record or withdraw consent; coaches read. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-018 · C05 · Consent gate for players aged 18 or over

- **Question:** Should the consent gate on per-player data (NFR08) also apply to players aged 18 or over, so an adult with no recorded consent gets no per-player stats?
- **Default taken:** yes. `attributablePlayerIds` allows only `club_only` or `scout_visible` for everyone. Adults give self-consent, recorded by the club.
- **Recommended:** keep it. It is simpler and safer, and CONS01 gives every player a consent state.
- **Impact:** one condition in `visibility.ts` (`mayAttribute`) plus its tests.
- **Answer:** Yes: every player, adult or minor, needs recorded consent before per-player data is derived. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-019 · C05 · How a guardian receives the consent link in v0

- **Question:** How does a guardian receive the consent link in v0, before emailed requests (CONS05) arrive in v1?
- **Default taken:** the club copies the link and shares it itself (WhatsApp or SMS), or hands its phone to the guardian. A paper form can be printed for signed consent. No email is sent.
- **Recommended:** keep it for the pilot. V104 adds email via `sendMail` and pg-boss.
- **Impact:** adding email now means a guardian email field (more personal data) and one `sendMail` call in `createConsentRequest`.
- **Answer:** Email the guardian the consent link now: add a guardian email field and send the link from Wideline (Mailpit locally). (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** differs from the default (club shares the link itself). Rework queued as a C05 follow-up. Choosing a real email provider for production stays a separate decision (it touches real infrastructure).

## Q-020 · C05 · Draft consent wording

- **Question:** Is the draft consent wording (version `2026-10-draft-1`, marked for legal review) acceptable for building, with the privacy lawyer approving the final text as part of the v0 gate?
- **Default taken:** build with the draft wording. It discloses independent scout review even when the scouts answer is no, and EU storage with possible processing elsewhere, outside South Africa.
- **Recommended:** yes, the same approach as Q-004.
- **Impact:** new wording means a new `CONSENT_WORDING_VERSION` entry. Existing rows keep their version. A re-consent prompt would be extra work in V104.
- **Answer:** Build with the draft wording; the privacy lawyer approves the final text at the v0 gate. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-021 · C05 · Names of club-only players during scout review

- **Question:** When independent scouts review a match (C10/C11), may they see the names of `club_only` players, or only shirt numbers?
- **Default taken:** C05 discloses review in the wording. C10/C11 decide the display, and the noted default is shirt number only for `club_only` players.
- **Recommended:** shirt number only for `club_only` players during review.
- **Impact:** a reviewer viewer kind in `consentVisibleTo` and the review workspace labels. No schema change.
- **Answer:** Shirt number only for club-only players during scout review. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework. Applies in C10/C11.

## Q-022 · C05 · Uploading signed paper consent forms

- **Question:** Should clubs upload a scan or photo of a signed paper consent form as evidence?
- **Default taken:** no upload in v0. `Consent.evidencePath` exists but is unused. The method `paper_form` and the recording user are stored.
- **Recommended:** add it in V104 with private storage and a retention rule.
- **Impact:** an upload step, an S3 prefix, and a signed-URL route for owners and admins. No schema change.
- **Answer:** Later, in V104. (Given by the user in the orchestrator chat on 2026-10-24, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-023 · C06 · Lineups and markers before processing

- **Question:** Must a club enter the lineups and set the kickoff and half-time markers before a match goes on to processing? The pipeline links tracks to lineup players (CV06) and maps video time to match minutes with the markers (MATCH05).
- **Default taken:** no. Accepted footage moves the match to Processing straight away. The match page shows the missing step as its main button ("Enter lineups", then "Set kickoff and half-time"), and lineups and markers stay editable until the match is in review.
- **Recommended:** keep the default for C06, and decide in C08 whether the CV job waits for the lineup and markers (or the reviewer fills them in during review).
- **Impact:** a hold would add a "Needs lineup" step between Uploading and Processing, a check in `onFootageAccepted()`, and one more line in the match status panel. No schema change.
- **Answer:** No: processing starts when footage is accepted; decide in C08 whether the CV job waits for lineups and markers. (Given by the user in the orchestrator chat on 2026-10-26, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework. Decision carried to C08.
- **C08 decision:** the CV job does not wait. It starts when the footage is accepted, links tracks to the lineup present at ingest (shirt numbers, through the consent gate), and leaves the rest unlinked for the reviewer. Event times are stored in video milliseconds and mapped to match time when read, so markers set later still apply. Recommended for C11: re-run shirt-number linking (with the consent gate) when a lineup is saved while the match awaits review.

## Q-024 · C06 · Adding an opposition team while creating a match

- **Question:** When the opposition is not in the list, should the coach type its name inside the create-match form, or go to the team form and come back?
- **Default taken:** a link under the team selects, "Add an opposition team", opens the C04 team form with `next=/matches/new`. After saving, the coach returns to the create-match form with the new team chosen as away. Anything already typed in the match form is lost.
- **Recommended:** keep the default for the pilot. If coaches create matches on a phone after the final whistle, add an inline "New opposition team" option that creates the team in the same step.
- **Impact:** the inline option needs a name and season field in the match form and a team insert in `createMatch`'s transaction. No schema change.
- **Answer:** Keep the link to the team form. (Given by the user in the orchestrator chat on 2026-10-26, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-025 · C06 · Deleting a match before its footage is 7 days old

- **Question:** May an owner or admin who deletes a match (MATCH08) remove its raw footage at once, even though NFR32 says raw footage is never deleted before 7 days or by any process other than the retention job?
- **Default taken:** yes. Deleting a match removes the database rows at once and enqueues a purge on the `retention` queue. The retention worker deletes the raw file, and later HLS and clips, straight away. The deletion is audited (`match.deleted`).
- **Recommended:** keep the default. MATCH08 is an explicit request from the club, and NFR32 protects the review window from accidental or automatic deletion. Routing the purge through the retention worker keeps one deleting process.
- **Impact:** if footage must stay for the full 7 days, the purge job is sent with `startAfter` at `rawExpiresAt`, and the match stays hidden from the club until then. No schema change.
- **Answer:** Keep raw footage 7 days: the match disappears for the club at once, but its files stay until rawExpiresAt and are then deleted by the retention job. (Given by the user in the orchestrator chat on 2026-10-26, recorded by the orchestrator.)
- **Resolved:** differs from the default (purge at once). Rework in the C06 follow-up commit.

## Q-026 · C06 · Who may delete a match

- **Question:** Who may delete a match: owners and admins only, or coaches too? Coaches create matches, upload, and enter lineups and markers.
- **Default taken:** owners and admins only (`MATCH_DELETE_ROLES` = `ORG_ADMIN_ROLES` in `src/server/auth/session.ts`). Coaches do everything else on a match and see "Only owners and admins can delete a match."
- **Recommended:** owners and admins. A deletion removes footage, lineups and every stat and clip from the match.
- **Impact:** one constant, the Delete section's branch on the match page, and the role expectations in `page-guards.test.tsx`, `matches.test.ts` and `matches.spec.ts`.
- **Answer:** Owners and admins only delete a match. (Given by the user in the orchestrator chat on 2026-10-26, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework.

## Q-027 · C06 · Footage rules and re-film guidance

- **Question:** Are the draft footage rules and re-film guidance right for the pilot clubs' cameras? Reject: under 5 minutes, under 1080p on the short side, portrait, under 20 fps. Warn: 20 to 25 fps, narrower than 1.7:1 ("may not be wide-angle"), or a length that does not fit the half length (more than 10 minutes short of 2 × half, or over 150 minutes).
- **Default taken:** these values are in `FOOTAGE_RULES` (`web/src/lib/footage-rules.ts`), and the guidance copy is marked "Draft for review" in the code. Wide-angle is judged from the display aspect ratio only, until CV can check the field of view.
- **Recommended:** keep them, and check them against a sample export from each pilot club's camera (Veo, Pixellot, a phone on a tripod) before the first upload.
- **Impact:** a threshold or copy change is a one-line constant change plus its unit test (`tests/unit/footage-rules.test.ts`). No schema change.
- **Answer:** Keep the draft rules, and check them against a sample export from each pilot club's camera before the first upload. (Given by the user in the orchestrator chat on 2026-10-26, recorded by the orchestrator.)
- **Resolved:** matches the default; no rework. Camera sample check added to the pilot checklist.

## Q-028 · C07 · Video quality on phones and mobile data

- **Question:** Should the match player start phones on a lower quality, or warn about mobile data use, since data is expensive in South Africa? A 90-minute match is about 0.9 GB at 480p and about 3.4 GB at 1080p.
- **Default taken:** the quality menu starts on **Auto**, which hls.js caps to the player's size (about 480p on a 375px phone) and to the connection speed. There is no data-use note, and the chosen quality is not remembered between visits.
- **Recommended:** keep the default. Auto already keeps phones near 480p, and a note would add copy to every watch screen. Revisit if pilot coaches or scouts report data costs.
- **Impact:** a data note is one caption under the player (`HlsPlayer` or the Watch section). A lower start level is one hls.js option (`startLevel`, or `maxAutoLevel` on touch devices) plus its component test. No schema change.
- **Answer:**

## Q-029 · C07 · HLS bitrate ladder and the storage budget

- **Question:** Is the HLS bitrate ladder (1080p at 5 Mbps, 720p at 2.8 Mbps, 480p at 1.2 Mbps; about 6.5 GB per 90-minute match for 7 days) right for the pilot's storage budget (NFR05)?
- **Default taken:** build all three renditions as `RENDITIONS` in `web/src/server/transcode/ladder.ts`.
- **Recommended:** keep three renditions, and lower the 1080p rate to 4 Mbps if storage cost per match runs over budget.
- **Impact:** one constant change plus its unit test; existing HLS is unaffected until re-transcoded.
- **Answer:**

## Q-030 · C07 · Match audio in the HLS renditions

- **Question:** Should the HLS renditions keep the match audio, which may carry children's voices and touchline talk, or be video-only?
- **Default taken:** keep audio (AAC 96k) when the source has it.
- **Recommended:** keep audio for reviewers (whistles help), and confirm with the privacy lawyer alongside the reviewer-footage question.
- **Impact:** dropping audio is a flag in `ffmpegArgs()`; already-transcoded matches keep audio until they expire at 7 days.
- **Answer:**

## Q-031 · C07 · Showing a failed transcode to the club

- **Question:** When a transcode fails 3 times, should the match move to the Failed status the club sees, or stay in Processing while Wideline staff retry quietly?
- **Default taken:** move processing to failed and show the existing "Processing failed. Wideline staff have been told and will try again." copy.
- **Recommended:** keep the default, and add the admin retry in C18.
- **Impact:** removing one transition and one `updateMany` in the failure path, and the copy on the detail page.
- **Answer:**

## Q-032 · C07 · Debian ffmpeg with libx264 (GPL)

- **Question:** The Debian ffmpeg build uses libx264 (GPL-2+). It runs as a separate process on our servers and is never distributed. Is that acceptable, given that the PRD bans only AGPL?
- **Default taken:** use Debian ffmpeg with libx264, and correct the `LICENSES.md` row.
- **Recommended:** accept it. GPL, unlike AGPL, puts no obligations on server-side use without distribution.
- **Impact:** otherwise switch to an LGPL ffmpeg build with openh264 or a hardware encoder: a Dockerfile change, with lower quality per bit.
- **Answer:**

## Q-033 · C08 · Which hourly GPU provider runs the CV worker

- **Question:** Which hourly GPU provider should run the CV worker? The PRD leaves it open: price per hour for a T4-class or better GPU, start-up by API, per-minute billing, region.
- **Default taken:** the `GpuProvider` interface with a working `docker` provider for local development and an `hourly` stub (`src/server/cv/providers/hourly.ts`) with real billing maths that refuses every call until a provider is chosen. `CV_DISPATCH=docker` everywhere for now.
- **Recommended:** choose before the first pilot upload: per-minute billing, and an API that supports labels or tags (the watchdog finds instances by label). Sign its operator agreement too (NFR15).
- **Impact:** implement start, status, destroy and list in `providers/hourly.ts`, and set the `HOURLY_GPU_*` settings. No schema change. Until then production cannot run CV jobs.
- **Answer:**

## Q-034 · C08 · CV in parallel with the transcode

- **Question:** Should the CV job run at the same time as the transcode, or only after playback is ready?
- **Default taken:** at the same time. Both read the raw file; the match waits in Processing until both have succeeded.
- **Recommended:** in parallel, for NFR01's 4-hour review-ready target.
- **Impact:** sequential means sending the cv job from the transcode's success path instead of the probe, and the panel copy goes back to "Starts after playback is ready."
- **Answer:**

## Q-035 · C08 · Position data of opposition players

- **Question:** Opposition players are unnamed placeholders with no consent. When a readable shirt number matches one, may the track keep its positions (unlinked), or must it be discarded like any non-consented player?
- **Default taken:** discarded: no track and no points; the track's events keep their team side only.
- **Recommended:** keep the strict default for v0, and ask the privacy lawyer at the v0 gate whether unlinked opposition positions (no name, no club record) are a child's personal information.
- **Impact:** allowing it is one branch in `planTracks` (`src/server/cv/ingest.ts`) and its test. Opposition heatmaps would then become possible.
- **Answer:**

## Q-036 · C08 · GPU cost per instance or per job

- **Question:** Should GPU cost be recorded for every instance, failed attempts included, or only once per successful job?
- **Default taken:** per instance, when it is destroyed, with `metadata.matchId`. `ProcessingJob.costCents` is the sum. (The C03 note said once per cv job.)
- **Recommended:** per instance: failed attempts are real spend, and NFR05's R120-per-match target needs them.
- **Impact:** per job only means moving `recordUsage()` into the ingest transaction and dropping failed attempts' cost.
- **Answer:**

## Q-037 · C08 · How platform admins hear of a failed job

- **Question:** How should a platform admin be told when a processing job fails 3 times (NFR30)?
- **Default taken:** one plain email per failed job to every platform admin (ids, the job type and a link to `/admin`, no names), plus an error log line. Transcode failures use the same alert.
- **Recommended:** email for the pilot; C18 adds a failed-jobs view with a retry.
- **Impact:** another channel (Slack or a webhook) is one more sender in `src/server/processing/alerts.ts`.
- **Answer:**

## Q-038 · C08 · Draft CV constants

- **Question:** Are the draft CV constants right: a shirt number links a track at confidence 0.5 or more, one CV attempt may run at most 4 hours, and each dispatcher runs 2 CV jobs at once?
- **Default taken:** these values, as `TRACK_LINK_MIN_CONFIDENCE` in `src/server/cv/ingest.ts` and the `CV_MAX_JOB_SECONDS` and `CV_CONCURRENCY` settings.
- **Recommended:** keep them for the pilot, and tune them from the Lab's recall numbers and real job timings (`cvTimings()`).
- **Impact:** a constant or setting change and its tests. No schema change.
- **Answer:**
