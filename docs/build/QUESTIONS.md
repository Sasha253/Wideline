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
