# Blockers

These questions stop a chunk. No safe default exists for them, or the answer has legal or cost weight. The build keeps going on chunks that do not depend on a blocked chunk, and stops when nothing else can run. Write your answer on the `Answer:` line, then start the build session again.

## B-001 · C09 · Runtime licences of the GPU model stack

- **Question:** The build rule allows only Apache-2.0, MIT or BSD code. Running RF-DETR on an NVIDIA GPU needs PyTorch's CUDA runtime wheels (`nvidia-*`, NVIDIA's proprietary CUDA licence), and the `rfdetr` and `torch` dependency trees bring further non-BSD licences (expected: certifi and tqdm MPL-2.0, typing-extensions and matplotlib PSF, pillow HPND, filelock Unlicense; the exact list comes from `uv run python scripts/check_licences.py --extra model` in an environment with the model extra). May the GPU image use a named allow-list of such licences, none of them AGPL or GPL?
- **Why no default is safe:** there is no permissively licensed way to do GPU inference on NVIDIA hardware, so no default is both safe and within the rule, and the answer has legal weight. It blocks only the production model image (`cv_worker/Dockerfile` target `gpu`, `make cv-image-gpu`) and model-mode runs. The rest of C09, including synthetic mode, CI and every acceptance check, uses only Apache, MIT and BSD packages (plus the listed core exceptions) and went ahead. Production CV is already waiting for the GPU provider (Q-033).
- **Recommended:** approve a named allow-list for the model image: the NVIDIA CUDA runtime licence, MPL-2.0 (unmodified use), PSF, HPND, ISC and Unlicense, each pinned by package in `MODEL_LICENCE_EXCEPTIONS` (`cv_worker/scripts/check_licences.py`) and listed in LICENSES.md. None imposes obligations on server-side use without distribution. Keep the AGPL and GPL denial and the `ultralytics` deny list. Confirm also that RF-DETR's published COCO checkpoints for the Apache-2.0 sizes (pinned: `rf-detr-medium`) are acceptable, given that COCO's images carry mixed Flickr licences.
- **Answer:**

## B-002 · C12 · Unfinished dependency: C11 Review workspace (and C10 uncommitted)

- **Question:** C12 depends on C11 (Review workspace, including "Mark as reviewed", which moves a match to `MatchStatus.published`, and `EventCorrection`). C11 is not built, and C10 (Review queue and claims) exists only as uncommitted work in the working tree (`web/src/server/review/`, the `c10_review_claims` and `c10_review_rules` migrations). Should C10 and C11 be finished before C12?
- **Why no default is safe:** C12 starts its stats rebuild from the C11 publish and re-review action, and PROF06 counts only reviewed matches. Without C11 there is no reviewed state to derive from. Guessing its contract (status transition, `publishedAt`, re-review flow) risks rework in both chunks.
- **Recommended:** finish, verify and commit C10, build C11, then run C12 with the current plan.
- **Answer:**

## B-003 · C11 · Unfinished dependency: C10 Review queue and claims

- **Question:** C11 depends on C10 (Review queue and claims), which is `in_progress` with no commit. Should C10 be finished, verified and committed before C11 starts?
- **Why no default is safe:** Every part of C11 builds on C10's uncommitted code: `claimScope()`, `ClaimDb`, the `/api/review/claims/[claimId]/hls` routes, the claimed-match page, `endClaim()`, `auditReview()` and the ReviewClaim submit columns. One major C10 issue is still open: `tests/integration/review-playback.test.ts` "answers 404 after a release and after the claim runs out" times out. That test is the only check that a released or expired claim cannot stream (NFR16, REVIEW11), and C11's "URL request after submit is refused" check uses the same playback path. If the C10 fix changes `claimScope` or the playback routes, C11 needs rework. Building on uncommitted, unreviewed code also mixes the two chunks' commits, against the per-chunk commit rule (Q-001). The "Log in as" impersonation work C10 depends on is uncommitted too. B-002 records the same ordering for C12.
- **Recommended:** Split `review-playback.test.ts` into 'after release' and 'after expiry' with one HLS seed each (or seed once in `beforeAll`), set the describe timeout to 60 s, and record a green run. Commit the impersonation work first, then C10, and mark C10 done in STATUS.md. Then run C11 with the current plan unchanged.
- **Answer:** Yes. The open test fixed and green, the impersonation work committed first, then C10 (orchestrator, 2026-10-31, on the user's go-ahead).

## B-004 · C11 · Docker Desktop and WSL need an admin restart

- **Question:** Docker Desktop on this host answers "Docker Desktop is unable to start", `docker info` times out, the WSL service is stuck with no VM running, and host CPU sits at 100%. Can the owner restart WSL and Docker Desktop (as admin, for example `wsl --shutdown` and then start Docker Desktop again)?
- **Why no default is safe:** The restart needs admin rights and stops every WSL distro on the host, so the build session cannot do it. Until Docker answers, C11 cannot finish: `make lint`, the full `make test-web` (integration against Postgres) and `make test-e2e` for `tests/e2e/review-workspace.spec.ts` and `tests/e2e/settings-review.spec.ts` (the keyboard-only review path and axe at 375/768/1280, both C11 acceptance items) have never run against C11. Later chunks that depend on C11 (C12, B-002) wait on it.
- **Recommended:** Restart WSL and Docker Desktop. Once `docker info` answers, run `make ps`, `make lint`, `make test-web` and `make test-e2e E2E_PASSWORD=...`, fix the C11 failures (including the ReviewEventRow tests in `tests/unit/ui/components.test.tsx`), and record the green runs in STATUS.md.
- **Answer:**