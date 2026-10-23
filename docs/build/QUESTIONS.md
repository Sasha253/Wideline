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
- **Answer:**

## Q-003 · D02 · Where each role lands after sign-in or a switch

- **Question:** Where should each role land after signing in or switching organisation?
- **Default taken:** platform admins go to `/lab/matches`; owners, admins and coaches to `/dashboard` (a placeholder until C14); scouts to `/review` (a placeholder until C10); anyone else to `/organisations`. With several roles, the first match in that order wins.
- **Recommended:** keep this default. It lives in one function, `homeFor()` in `web/src/lib/nav.ts`.
- **Impact:** a different landing page changes only `homeFor()` and the redirect expectations in the e2e specs.
- **Answer:**

## Q-004 · C02 · Reviewer confidentiality terms wording

- **Question:** What should the reviewer confidentiality terms say? This includes the PRD open question of whether a scout who reviewed a match may contact a non-consented player's club about that player.
- **Default taken:** draft wording in `web/src/server/scouts/terms.ts`, version `2026-10-draft-1`, marked "Draft for legal review". It forbids downloading or recording footage, and forbids contacting players or clubs seen in review outside Wideline. It requires declaring conflicts and confirming 18 or over.
- **Recommended:** keep the draft for the build and have the privacy lawyer approve the final wording as part of the v0 gate (NFR15).
- **Impact:** new wording means a new `REVIEWER_TERMS_VERSION`. Every scout is then blocked from review until they re-accept on `/scout`. That flow is built in, so nothing changes beyond the text and the version.
- **Answer:**

## Q-005 · C02 · Scout identity verification beyond a manual check

- **Question:** How should scout identity be verified beyond a platform admin's manual check? Options are a paid ID-verification provider or an SMS one-time code to the phone.
- **Default taken:** manual. The admin approves on name, phone, confirmed email and affiliations. The ID is used only as a hashed uniqueness check. No third-party service and no SMS.
- **Recommended:** manual for the pilot (10 reviewers). Revisit before v1, when there are 40 or more reviewers.
- **Impact:** a provider adds an identity-check step and a stored verification reference. SMS adds an OTP step and a cost per message. `ScoutProfile.verifiedAt` already exists for either.
- **Answer:**

## Q-006 · C02 · Cooling-off after removing a declared conflict

- **Question:** Should removing a declared club affiliation keep blocking that club for a cooling-off period, so a scout cannot remove a conflict and then claim the match?
- **Default taken:** no cooling-off. Removals are soft (`removedAt` kept) and audited, so platform admins can see the history.
- **Recommended:** add a 90-day cooling-off in `scoutConflicts()` once C10 is in place. It is a one-line filter change.
- **Impact:** only `scoutConflicts()` changes, to count rows removed within the period. No schema change.
- **Answer:**
