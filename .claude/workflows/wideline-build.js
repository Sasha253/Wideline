export const meta = {
  name: 'wideline-build',
  description: 'Build one or more Wideline PRD chunks: plan, design, build, verify, fix, record',
  whenToUse: 'Run by the Wideline orchestrator session with args {chunks: ["C04"], commit: false}. One chunk per run is the normal size.',
  phases: [
    { title: 'Plan', detail: 'read the chunk spec, PRD IDs and current code; produce a build plan' },
    { title: 'Design', detail: 'screen specs from the design system, for chunks with UI' },
    { title: 'Build', detail: 'implement the plan and the design spec' },
    { title: 'Verify', detail: 'requirements, design, security and tests, in parallel' },
    { title: 'Fix', detail: 'fix blocker and major issues, then re-verify the failed lenses' },
    { title: 'Record', detail: 'update STATUS.md and optionally commit' },
  ],
}

// Mirrors docs/build/CHUNKS.md. The full spec for each chunk is read from that file by heading.
// ui: the chunk owns screens, so it gets a design stage and a design review.
// cv: the chunk touches cv_worker/, so the tests lens also runs make test-cv.
const CHUNKS = [
  { id: 'B00', title: 'Build kit and conventions', release: 'v0', deps: [], ui: false },
  { id: 'D01', title: 'Design system in React', release: 'v0', deps: ['B00'], ui: true },
  { id: 'C01', title: 'Organisations, roles, invitations and switching', release: 'v0', deps: ['B00'], ui: true },
  { id: 'D02', title: 'App shell, navigation and page templates', release: 'v0', deps: ['D01', 'C01'], ui: true },
  { id: 'C02', title: 'Independent scout registration and conflicts', release: 'v0', deps: ['C01'], ui: true },
  { id: 'C03', title: 'Entitlements, plans and feature flags', release: 'v0', deps: ['C01'], ui: true },
  { id: 'C04', title: 'Squad: teams, players, CSV import, departures', release: 'v0', deps: ['D02', 'C01'], ui: true },
  { id: 'C05', title: 'Consent records and guardian consent', release: 'v0', deps: ['C04'], ui: true },
  { id: 'C06', title: 'Matches and resumable upload', release: 'v0', deps: ['C04', 'C03'], ui: true },
  { id: 'C07', title: 'Transcode, HLS and secure playback', release: 'v0', deps: ['C06'], ui: true },
  { id: 'C08', title: 'CV job dispatch, GPU lifecycle and result ingest', release: 'v0', deps: ['C07'], ui: false, cv: true },
  { id: 'C09', title: 'CV pipeline (Python) and clip cutting', release: 'v0', deps: ['C08', 'C05'], ui: true, cv: true },
  { id: 'C10', title: 'Review queue and claims', release: 'v0', deps: ['C02', 'C08'], ui: true },
  { id: 'C11', title: 'Review workspace', release: 'v0', deps: ['C10', 'C09', 'D01'], ui: true },
  { id: 'C12', title: 'Stats derivation and publishing', release: 'v0', deps: ['C11'], ui: false },
  { id: 'C13', title: 'Player profiles and clips', release: 'v0', deps: ['C12'], ui: true },
  { id: 'C14', title: 'Club dashboard', release: 'v0', deps: ['C13', 'C06'], ui: true },
  { id: 'C15', title: 'Shortlists (v0 scope)', release: 'v0', deps: ['C13', 'C10'], ui: true },
  { id: 'C16', title: 'Email notifications', release: 'v0', deps: ['C08', 'C10', 'C12'], ui: true },
  { id: 'C17', title: 'Retention and cleanup', release: 'v0', deps: ['C09', 'C13'], ui: true },
  { id: 'C18', title: 'Admin console, disputes and spot-checks', release: 'v0', deps: ['C10', 'C12', 'C03'], ui: true },
  { id: 'C19', title: 'Pilot hardening and operations', release: 'v0',
    deps: ['D02', 'C02', 'C05', 'C07', 'C11', 'C14', 'C15', 'C16', 'C17', 'C18'], ui: true },
  { id: 'V101', title: 'Passes and v1 stats', release: 'v1', deps: ['C19'], ui: true, cv: true },
  { id: 'V102', title: 'Scout search', release: 'v1', deps: ['C19'], ui: true },
  { id: 'V103', title: 'Reports and sharing', release: 'v1', deps: ['V102'], ui: true },
  { id: 'V104', title: 'Consent v1 and player self-service', release: 'v1', deps: ['C19'], ui: true },
  { id: 'V105', title: 'Notification centre and reviewer metrics', release: 'v1', deps: ['C19'], ui: true },
  { id: 'V201', title: 'Billing', release: 'v2', deps: ['V101', 'V102', 'V103', 'V104', 'V105'], ui: true },
  { id: 'V202', title: 'Advanced CV and re-runs', release: 'v2', deps: ['V101'], ui: true, cv: true },
  { id: 'V203', title: 'Pro tools', release: 'v2', deps: ['V102', 'V103'], ui: true },
]

const SOURCES = `Sources of truth, all in the repo:
- docs/build/CHUNKS.md: the chunk spec. Read the "Conventions for every chunk" section and your chunk's section (heading "## <ID> ...").
- docs/build/prd.txt: the PRD as text. Grep it for each requirement ID the chunk lists, and read the full row. Also read the "Data model" and "Rules the schema must enforce" sections when the chunk touches the schema.
- docs/design-system/README.md, docs/design-system/tokens.json and docs/design-system/components/<Name>/README.md: the design system.
- docs/build/STATUS.md: what is done.
- README.md: how the stack, permissions, tenant scoping, queue and storage fit together.
- web/prisma/schema.prisma, web/src/server/, web/src/app/, cv_worker/: the current code.`

const STACK = `Stack rules:
- The dev stack runs in Docker Compose. Use \`make ps\` to check it and \`make up\` to start it. Never run \`make reset\` or delete volumes: that destroys data.
- Schema changes: \`make migrate-new name=<chunk>_<thing>\`. Never edit an applied migration.
- Checks: \`make lint\`, \`make test-web\`, \`make test-cv\` (CV chunks), and Playwright via \`make test-e2e E2E_PASSWORD=...\` (the seed prints the password; \`make seed\` is safe to re-run only if the seed is idempotent, so check first).
- If Docker is unavailable, say so in your output. Never claim a check passed that you did not run.
- Never push, never force anything, never touch git history.`

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    blocked: { type: 'boolean', description: 'true if a dependency is not done or a question must be answered by the user before building' },
    blockedReason: { type: 'string' },
    prdIds: { type: 'array', items: { type: 'string' }, description: 'every PRD requirement ID this chunk covers' },
    summary: { type: 'string' },
    schemaChanges: { type: 'array', items: { type: 'string' }, description: 'models, fields, enums, constraints, raw SQL migrations' },
    steps: { type: 'array', items: { type: 'string' }, description: 'ordered build steps, each naming the files it touches' },
    tests: { type: 'array', items: { type: 'string' }, description: 'unit, integration, tenant-isolation and e2e tests to add' },
    surfaces: { type: 'array', items: { type: 'string' }, description: 'screens or UI pieces this chunk owns; empty if none' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'small choices you made that the user does not need to see' },
    questions: {
      type: 'array',
      description: 'non-blocking questions for the user: you build with a default now, and the answer may change it later',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          defaultTaken: { type: 'string', description: 'what you will build until the user answers' },
          recommended: { type: 'string' },
          impact: { type: 'string', description: 'what changes if the user picks differently' },
        },
        required: ['question', 'defaultTaken', 'recommended', 'impact'],
      },
    },
    blockers: {
      type: 'array',
      description: 'questions that stop this chunk: no safe default exists, building without the answer means rework, or the answer has legal or cost weight. Set blocked=true if any.',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          why: { type: 'string', description: 'why no default is safe' },
          recommended: { type: 'string' },
        },
        required: ['question', 'why', 'recommended'],
      },
    },
  },
  required: ['blocked', 'prdIds', 'summary', 'steps', 'tests', 'surfaces', 'assumptions', 'questions', 'blockers'],
}

const QUESTION_FILES = `Question files, in docs/build/:
- QUESTIONS.md: non-blocking questions. Each entry has an ID (Q-001, Q-002, ...), the chunk, the question, the default taken, the recommended answer, the impact, and an empty "Answer:" line for the user.
- BLOCKERS.md: blocking questions. Each entry has an ID (B-001, ...), the chunk, the question, why no default is safe, the recommended answer, and an empty "Answer:" line.
Create a file with a one-line intro if it does not exist. Append new entries at the end, numbered after the highest existing ID. Never edit or remove the user's answers. Skip a question that is already in either file.`

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    migrations: { type: 'array', items: { type: 'string' } },
    checksRun: { type: 'array', items: { type: 'string' }, description: 'each command and its result, e.g. "make lint: pass"' },
    knownGaps: { type: 'array', items: { type: 'string' }, description: 'anything in the plan not done, with the reason' },
  },
  required: ['summary', 'filesChanged', 'checksRun', 'knownGaps'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'true only if there are no blocker or major issues' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          where: { type: 'string', description: 'file:line, screen, or PRD ID' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'where', 'problem', 'fix'],
      },
    },
    evidence: { type: 'string', description: 'what you checked and how: commands run, files read, IDs traced' },
  },
  required: ['pass', 'issues', 'evidence'],
}

const RECORD_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked', 'in_progress'] },
    commit: { type: 'string', description: 'commit SHA, or empty if not committed' },
    notes: { type: 'string' },
  },
  required: ['status', 'commit', 'notes'],
}

function lenses(chunk) {
  const all = [
    {
      key: 'requirements',
      prompt: `Lens: requirements coverage.
For every PRD ID in the plan, grep docs/build/prd.txt for its full text, then find the code that satisfies each clause. Check every acceptance item in the chunk's section of docs/build/CHUNKS.md.
A clause with no code is a blocker. A clause that is partly done is major. Also flag scope creep: work for IDs outside this chunk is minor, unless it changes behaviour other chunks own, which is major.`,
    },
    {
      key: 'security',
      prompt: `Lens: security, tenancy and consent.
Check every new page, route handler and server action: it must call requireRole(), requirePageRole() or withRole() with the right roles (AUTH06). Tenant data must go through the scoped client, and new tenant tables need organisationId and composite (organisationId, id) foreign keys plus a tenant-isolation test (NFR16). The raw client may only be used where the ESLint rule allows it.
Check consent: no per-player data for a non-consented under-18 (NFR08), visibility follows the newest Consent row, and withdrawal takes effect on the next query (CONS03).
Check the audit log for role changes, consent changes, exports, review sessions and deletions (NFR20). Check signed URLs for video (NFR17), input validation, and secrets in code (NFR19).
Any way to read or write another organisation's data, or a non-consented minor's data, is a blocker.`,
    },
    {
      key: 'tests',
      prompt: `Lens: tests and build health.
Run \`make lint\` and \`make test-web\`${chunk.cv ? ', and `make test-cv`' : ''}. If the chunk adds screens, run the Playwright suite too. Report the exact failing output.
Then read the new tests. A failing check is a blocker. A missing test for an acceptance item in the chunk's section of docs/build/CHUNKS.md is major. A test that cannot fail (it asserts nothing real, or mocks the thing under test) is major.`,
    },
  ]
  if (chunk.ui) {
    all.push({
      key: 'design',
      prompt: `Lens: design-system compliance and accessibility.
Read docs/design-system/README.md and the design spec at docs/build/design/${chunk.id}.md. For every screen this chunk adds:
- Only tokens and wl- components. Grep the changed files for hex, rgb(), hsl(), px font sizes and arbitrary Tailwind values: each one outside tokens.css is major.
- Colour rules: pitch only for primary actions, links, active nav and confirmed states; floodlight as a fill at most twice per screen; statuses always pair colour, word and icon; home and away use H and A markers (NFR27).
- Type: display only for names, titles and big numbers; mono data style with tabular-nums for timestamps, scores and numeric columns.
- Copy: sentence case, British and South African spelling, football-native words, numerals with units, sample size beside every rate, no emoji, no hype. Wrong copy is minor; misleading copy is major.
- Layout at 375, 768 and 1280 px. If the stack runs, use Playwright to take screenshots at all three and look at them. A broken or overflowing layout is major.
- Accessibility (NFR23): keyboard operation, visible focus, labelled controls, 4.5:1 contrast. Run axe through Playwright where possible. An axe violation is major.`,
    })
  }
  return all
}

function verifyPrompt(chunk, plan, build, lens) {
  return `You are reviewing chunk ${chunk.id} (${chunk.title}) of the Wideline build. Be adversarial: your job is to find what is wrong, not to approve.

${SOURCES}

${STACK}

The plan:
${JSON.stringify(plan, null, 2)}

The builder's report:
${JSON.stringify(build, null, 2)}

Find the changed files with \`git status --porcelain\` and \`git diff\`, plus the builder's filesChanged list. Earlier chunks may also be uncommitted, so focus on this chunk's files.

${lens.prompt}

Do not edit any file. Return pass=true only if there are no blocker or major issues.`
}

if (!args || !Array.isArray(args.chunks) || args.chunks.length === 0) {
  throw new Error('Pass args {chunks: ["C04"], commit: false}. Chunk IDs are listed in docs/build/CHUNKS.md.')
}
const maxFixRounds = typeof args.maxFixRounds === 'number' ? args.maxFixRounds : 2
const selected = args.chunks.map(id => {
  const c = CHUNKS.find(x => x.id === id)
  if (!c) throw new Error(`Unknown chunk ${id}`)
  return c
})
if (selected.length > 1) log(`Running ${selected.length} chunks in order: ${selected.map(c => c.id).join(', ')}. They run one after another because they share the schema and migrations.`)

const results = []
for (const chunk of selected) {
  const earlierInRun = results.filter(r => r.status === 'done').map(r => r.id)

  // Plan
  phase('Plan')
  const plan = await agent(`You are planning chunk ${chunk.id} (${chunk.title}, release ${chunk.release}) of the Wideline build.

${SOURCES}

Dependencies: ${chunk.deps.length ? chunk.deps.join(', ') : 'none'}. ${earlierInRun.length ? `Already finished in this run: ${earlierInRun.join(', ')}.` : ''}
Check docs/build/STATUS.md (if it exists) and the code: if a dependency is not actually done, set blocked=true and say which. B00 creates STATUS.md, so for B00 its absence is expected.

Then read the chunk's section in docs/build/CHUNKS.md, the full PRD text for each ID it lists, and the code it will change. Write a concrete plan that names files, models, routes, server actions and jobs. Reuse what exists: requireRole(), the scoped client, the queue, storage, audit and the components in web/src/components/.
The user is not available during the build. Never wait on them. Read docs/build/QUESTIONS.md and docs/build/BLOCKERS.md first: any entry with a filled-in "Answer:" is a decision, so follow it.
Resolve small choices yourself with the option that best fits the PRD, and list them as assumptions.
If the PRD leaves a choice to the user (for example an item in its "Open questions" list) and a safe default exists, put it in questions and build with the default. Prefer defaults that are cheap to change, such as an interface with a stub, a setting, or draft copy marked for review.
Put a question in blockers, and set blocked=true, only if no default is safe: building without the answer means real rework, or the answer has legal or cost weight that the build must not assume.
Do not edit any file.`, { label: `plan:${chunk.id}`, phase: 'Plan', schema: PLAN_SCHEMA })

  if (!plan) { results.push({ id: chunk.id, status: 'blocked', notes: 'Plan agent returned nothing' }); break }
  if (plan.blocked) {
    log(`${chunk.id} blocked: ${plan.blockedReason || plan.blockers.map(b => b.question).join('; ')}`)
    phase('Record')
    await agent(`Chunk ${chunk.id} (${chunk.title}) of Wideline is blocked and was not built.

${QUESTION_FILES}

Reason: ${plan.blockedReason || 'blocking questions'}
Blockers: ${JSON.stringify(plan.blockers, null, 2)}
Non-blocking questions: ${JSON.stringify(plan.questions, null, 2)}

1. Append the blockers to docs/build/BLOCKERS.md. If the reason is an unfinished dependency rather than a question, add one entry saying which dependency.
2. Append the non-blocking questions to docs/build/QUESTIONS.md.
3. Set ${chunk.id} to "blocked" in docs/build/STATUS.md, with the blocker IDs in its notes.
Do not commit. Return the IDs you wrote.`, { label: `record:${chunk.id}:blocked`, phase: 'Record' })
    results.push({ id: chunk.id, status: 'blocked', reason: plan.blockedReason, blockers: plan.blockers, questions: plan.questions })
    break
  }

  // Design
  let designSpec = null
  if (chunk.ui && plan.surfaces.length) {
    phase('Design')
    designSpec = await agent(`You are the product designer for chunk ${chunk.id} (${chunk.title}) of Wideline.

${SOURCES}

Read docs/design-system/README.md in full, docs/design-system/tokens.json, and the README and preview.html of every component you use. Look at the existing screens in web/src/app/ so new ones match them.

Plan:
${JSON.stringify(plan, null, 2)}

Write docs/build/design/${chunk.id}.md (create the folder if needed). For each surface in plan.surfaces:
- Who uses it, on which device, and the one job it does (from the "Who uses it, and where" table).
- Layout at 375, 768 and 1280 px: regions, order, what collapses or stacks.
- The wl- components and tokens for each element. Name the token, never a raw value. If a component is missing from the design system, specify it from existing tokens and say so.
- Every state: empty, loading, error, forbidden, partial data, long content, small sample.
- Final copy for every heading, label, button, message and empty state, following the voice rules. Reuse the README's real copy where it fits.
- Keyboard order and shortcuts, focus handling, and labels for screen readers.
- Theme: say if the surface is forced dark (the review workspace is).
Keep it to what a builder needs. No mood boards, no alternatives.
The user is not available. If a design decision needs them, choose the option that fits the design system best, specify that, and append the question to docs/build/QUESTIONS.md.
${QUESTION_FILES}
Return the path you wrote and a 3-line summary.`, { label: `design:${chunk.id}`, phase: 'Design' })
  }

  // Build
  phase('Build')
  const build = await agent(`You are building chunk ${chunk.id} (${chunk.title}) of Wideline.

${SOURCES}

${STACK}

Plan:
${JSON.stringify(plan, null, 2)}
${designSpec ? `\nDesign spec: docs/build/design/${chunk.id}.md. Follow it exactly. If it cannot be followed, follow the design system README and note why in knownGaps.\n` : ''}
Implement the plan in order. Match the style of the surrounding code: naming, comment density, file layout. Write the tests in the plan as you go. Run the migrations, then \`make lint\` and \`make test-web\`${chunk.cv ? ' and `make test-cv`' : ''}, and fix what fails. For new screens, run their Playwright tests.
Do not start work that belongs to another chunk. If something the plan needs is missing from an earlier chunk, build the smallest piece needed and note it in knownGaps.
Do not commit. Report every command you ran and its real result.`, { label: `build:${chunk.id}`, phase: 'Build', schema: BUILD_SCHEMA })

  if (!build) { results.push({ id: chunk.id, status: 'blocked', notes: 'Build agent returned nothing', plan }); break }

  // Verify, then fix until clean or out of rounds
  const chunkLenses = lenses(chunk)
  let verdicts = await parallel(chunkLenses.map(l => () =>
    agent(verifyPrompt(chunk, plan, build, l), { label: `verify:${chunk.id}:${l.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => v && { lens: l.key, ...v })))
  verdicts = verdicts.filter(Boolean)

  let round = 0
  let failing = verdicts.filter(v => !v.pass)
  while (failing.length && round < maxFixRounds) {
    round++
    phase('Fix')
    const issues = failing.flatMap(v => v.issues.filter(i => i.severity !== 'minor').map(i => ({ lens: v.lens, ...i })))
    log(`${chunk.id} fix round ${round}: ${issues.length} blocker or major issues from ${failing.map(v => v.lens).join(', ')}`)
    await agent(`You are fixing chunk ${chunk.id} (${chunk.title}) of Wideline after review.

${SOURCES}

${STACK}

Fix every issue below at its root, not by weakening a test or a check. If a reviewer is wrong, leave the code and explain why in your output, citing the PRD or the design system.
${JSON.stringify(issues, null, 2)}

Then run \`make lint\` and \`make test-web\`${chunk.cv ? ' and `make test-cv`' : ''} again. Do not commit. Return a short list of what you changed and the check results.`, { label: `fix:${chunk.id}:r${round}`, phase: 'Fix' })

    const recheck = await parallel(chunkLenses.filter(l => failing.some(v => v.lens === l.key)).map(l => () =>
      agent(verifyPrompt(chunk, plan, build, l) + `\n\nThis is re-check round ${round}. Earlier issues for this lens:\n${JSON.stringify(failing.find(v => v.lens === l.key).issues, null, 2)}\nConfirm each is fixed, and look for new problems the fix caused.`,
        { label: `verify:${chunk.id}:${l.key}:r${round}`, phase: 'Fix', schema: VERDICT_SCHEMA })
        .then(v => v && { lens: l.key, ...v })))
    const fresh = recheck.filter(Boolean)
    verdicts = verdicts.map(v => fresh.find(f => f.lens === v.lens) || v)
    failing = verdicts.filter(v => !v.pass)
  }

  const clean = failing.length === 0
  const minors = verdicts.flatMap(v => v.issues.filter(i => i.severity === 'minor').map(i => ({ lens: v.lens, ...i })))
  if (!clean) log(`${chunk.id} still has blocker or major issues after ${round} fix rounds. Recording as in_progress.`)

  // Record
  phase('Record')
  const record = await agent(`You are recording the result of chunk ${chunk.id} (${chunk.title}) of Wideline.

Outcome: ${clean ? 'all review lenses passed' : 'unresolved blocker or major issues remain'}.
Unresolved issues: ${JSON.stringify(failing.flatMap(v => v.issues.filter(i => i.severity !== 'minor')), null, 2)}
Minor issues (not fixed): ${JSON.stringify(minors, null, 2)}
Plan assumptions: ${JSON.stringify(plan.assumptions)}
Non-blocking questions from the plan: ${JSON.stringify(plan.questions, null, 2)}
Known gaps from the builder: ${JSON.stringify(build.knownGaps)}

${QUESTION_FILES}

1. Update docs/build/STATUS.md: set ${chunk.id} to ${clean ? '"done"' : '"in_progress"'}, and put the assumptions, known gaps and any unresolved issues in its notes, briefly. Create the file from docs/build/CHUNKS.md if it does not exist.
2. Append the plan's non-blocking questions to docs/build/QUESTIONS.md, and put their IDs in the STATUS.md notes. ${clean ? '' : 'If an unresolved issue needs a user decision to fix, append it to docs/build/BLOCKERS.md.'}
3. ${args.commit && clean
    ? `Commit this chunk's changes. Stage only the files that belong to it (check \`git status\`), never .env or secrets. Message: a first line of "${chunk.id}: ${chunk.title}", a blank line, a short bullet list of what was built with the PRD IDs, then a blank line and "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Do not push.`
    : 'Do not commit.'}
Return the status, the commit SHA (empty if none) and one line of notes.`, { label: `record:${chunk.id}`, phase: 'Record', schema: RECORD_SCHEMA })

  results.push({
    id: chunk.id,
    status: record ? record.status : (clean ? 'done' : 'in_progress'),
    commit: record ? record.commit : '',
    prdIds: plan.prdIds,
    assumptions: plan.assumptions,
    questions: plan.questions,
    knownGaps: build.knownGaps,
    unresolved: failing.map(v => ({ lens: v.lens, issues: v.issues.filter(i => i.severity !== 'minor') })),
    minors,
    fixRounds: round,
  })
  if (!clean) break
}

const notRun = selected.map(c => c.id).filter(id => !results.some(r => r.id === id))
if (notRun.length) log(`Stopped early. Not run: ${notRun.join(', ')}`)
return { results, notRun }
