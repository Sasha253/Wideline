# Open questions

These questions do not block the build. Each one has a default that the build is already using. Write your answer on the `Answer:` line whenever you like. The build session reads this file before every chunk. An answer that differs from the default gets a rework note in `STATUS.md`.

## Q-001 · all chunks · Commit permission

- **Question:** May the build session commit each chunk to the current branch, once the chunk passes review and the session's own checks? It would never push.
- **Default taken:** no commits. The work stays uncommitted, and `STATUS.md` records which files belong to each chunk.
- **Recommended:** yes. With one commit per chunk, each chunk is easy to review and to revert.
- **Impact:** if you answer yes, later chunks are committed as they finish, and the earlier finished chunks are committed one by one, in order.
- **Answer:** Yes. Commit each chunk once it passes review and the session's own checks. Never push. (Given by the user in the orchestrator chat on 2026-10-23, recorded by the orchestrator.)
- **Resolved:** matches the recommendation. B00 is committed, and later chunks run with `commit: true`.
