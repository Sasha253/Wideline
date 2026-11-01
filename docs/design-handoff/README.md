# Handoff: Wideline · Floodlight redesign

## Overview
Wideline turns wide-angle recordings of youth and amateur matches into verified player stats. A club uploads a match and its lineups. A computer-vision pipeline finds players, the ball and events. A registered scout confirms or corrects the uncertain events. The stats then land on player profiles that scouts can see once a guardian says yes.

This bundle is a **visual redesign** of the existing product: same screens, same rules, new look. The chosen direction is **Floodlight**: graphite surfaces, one floodlit lime used only for what's live, Archivo's width axis for names and figures, hairline panels and high density.

## About the design files
The files in `design/` are **design references built in HTML**. They are prototypes that show the intended look and behaviour, not production code. Rebuild them in the Wideline codebase (Next.js App Router, React 19, CSS custom properties and Tailwind CSS v4, Lucide icons, Google Fonts) using its existing patterns. Don't ship the HTML.

To view them, open any `design/*.dc.html` file in a browser, with `support.js` and `icons.js` in the same folder. Pan and zoom the canvas pages.

`tokens/` is meant to be used directly: `wideline-tokens.css` and `wideline-tailwind.css` are production-ready.

## Fidelity
**High fidelity.** Colours, type, spacing, radii, states and copy are final. Rebuild them pixel for pixel using the tokens. The sample data (names, clubs, numbers) is illustrative.

## Non-negotiable rules (from product, privacy law and accessibility)
1. **No photos of players.** Avatars are initials, or the shirt number in the profile hero. Video frames appear only in the review workspace and clip players. The only illustration is pitch geometry (lines, arcs, centre circle).
2. **Never colour alone.** Status = colour + icon + word, plus shape: solid means settled, **dashed** means waiting on a person, a thin outline means waiting on the system, **struck through** means a rejected event. Teams = fixed UI colour + **H/A** letter, never kit colours.
3. **Lime is for live or next only:** the primary action, the current-minute playhead, upload progress, the usual-position marker, detection of the selected player. Selection is shown in ink (`bg-selected` plus an ink underline or inset), never lime. Lime is never text on a light surface.
4. **Numbers are facts.** Tabular figures, units in the string ("9.1 km"), and the sample beside every rate ("0.62 per 90 · based on 2 matches"). Flag a small sample under 3 matches. Nothing counts up. Every stat and event links to its clip.
5. **No hype.** No ratings, ranks, badges, leaderboards or potential scores.
6. **Two complete themes.** Dark is the default everywhere. Light is offered in the account menu (Dark / Light / Match system). The review workspace stays dark unless the user chose Light.
7. **WCAG 2.2 AA.** See `A11Y.md`. All 34 token pairs pass in both themes.

## Copy rules
Sentence case everywhere, including buttons. British and South African spelling (organisation, favourite). Say match, pitch, squad, kit, U17, never game, field or roster. No emoji. No exclamation marks except a first-run success message. Guardian screens are written for a reading age of about 12. Exact strings are in the design files. Use them.

## Design tokens
The source of truth is `tokens/wideline-tokens.css`, which uses the `--wl-` prefix. `tokens/wideline-tailwind.css` maps the tokens to Tailwind v4 utilities and clears the default palette, so only Wideline roles exist (`bg-panel`, `text-ink-muted`, `border-control`, `bg-brand`, `text-pending`, `h-control-l`, `rounded-control`, `text-stat-xl`, `stretch-wide`…).

**Colour roles (dark / light)**

| Role | Dark | Light | Use |
|---|---|---|---|
| bg-canvas | #0b0d10 | #f3f5f7 | page behind panels |
| bg-panel | #12151a | #ffffff | panels, tables, sidebar |
| bg-raised | #181c22 | #f8f9fb | hover, inputs, menus |
| bg-selected | #1c2129 | #e6ebf1 | selection, current nav |
| bg-sunken | #07080a | #eceff3 | video well, kbd |
| ink | #eceff3 | #0d1014 | text |
| ink-muted | #98a1ae | #535b67 | secondary text |
| ink-disabled | #5b6370 | #9aa2ad | disabled only |
| line / line-strong | #1f242c / #2b313b | #dde2e8 / #c3cad3 | dividers / overlay edges |
| border-control | #636d7c | #7a8494 | control borders (3:1) |
| focus | #c6f135 | #0d1014 | 2px focus ring, 2px offset |
| brand (+hover, press) | #c6f135 (#d4f75a, #afd61f) | same | lime fills |
| on-brand | #0b0d10 | #0d1014 | text on lime |
| brand-edge | #c6f135 | #0d1014 | border of every lime fill |
| brand-text | #c6f135 | #4a6b00 | links |
| brand-subtle | #1e2610 | #eef9cf | save flash, In review |
| home / on-home | #5aaeff / #0b0d10 | #0b62c4 / #ffffff | H marker |
| away / on-away | #f47cb8 / #0b0d10 | #b8246f / #ffffff | A marker |
| confirmed / -subtle | #3dd6a3 / #0d2a22 | #08765a / #dcf3ea | confirmed, consent given |
| pending / -subtle | #ffb547 / #2d220d | #8a5700 / #fbeed3 | pending, awaiting, expiry |
| rejected / -subtle | #ff6b5e / #2e1210 | #c0261b / #fde4e1 | rejected, withdrawn, danger |
| on-status | #12151a | #ffffff | text on solid status fills |

Pitch and data are the same in both themes: pitch #161b21, chalk #4a525d, heat-1…5 = lime at 16/34/55/78/100% over the pitch (#323d24, #526428, #77912c, #9fc231, #c6f135) for under 2% / 2–4 / 4–6 / 6–8 / 8%+ of minutes.

**Type.** Archivo (Google Fonts, `wdth 62..125`, `wght 300..900`) and JetBrains Mono (400–700).

| Token | Spec | Use |
|---|---|---|
| display-xl | 800 · 56/0.92 · 125% wide · caps · −0.015em | player name in hero |
| display-l | 800 · 36/0.95 · 125% · caps · −0.01em (28–30 on phone) | page titles |
| stat-xl | 700 · 38/0.9 · 125% · −0.02em · tabular | stat tile figure |
| stat-m | 700 · 22/1 · 125% | inline figures |
| heading-section | 700 · 15/1.1 · 125% · caps · 0.02em | panel heads |
| title-guardian | 700 · 30/1.12 · 112.5% · −0.015em | guardian, auth, step titles |
| title-m | 600 · 20/1.25 | modal titles |
| body-guardian | 400 · 18/1.5 | guardian copy |
| body | 400 · 14/1.45 (15 on phone) | default |
| body-s | 400 · 12.5/1.4 | meta |
| label | 600 · 13.5/1 | buttons, tabs, chips |
| mono-l / mono-m | 600 15 / 500 13 | clocks / timestamps, confidence, numeric cells |
| overline | mono 500 · 10.5/1.2 · caps · 0.08em | table headers, tile labels, breadcrumbs |

**Spacing.** 4px grid (0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Desktop page padding is 28px, panels 16–20px, phone margins 16–20px.
**Sizing.** control-s 32 (desktop table rows only), m 36 (desktop default), l 44 (touch minimum), xl 56 (phone primary and guardian). Rows: dense 40, review 42, comfortable 48, touch 56. Shell: sidebar 232, rail 64, top bar 56, tab bar 56.
**Radii.** 0 for panels, tables, banners and video. 2px for controls, chips, tiles and markers. 4px for overlays. Full for avatars, discs and radios.
**Borders.** 1px hairlines; a 1px control border; a 2px selected underline or inset; a 3px tile top edge (solid ink, or dashed pending for a small sample); 1.5px dashed for pending.
**Elevation.** The page is flat: panels sit on hairlines with no shadow. Shadows only on overlays: shadow-2 `0 8px 24px rgba(0,0,0,.48)` (light .14), shadow-3 `0 24px 64px rgba(0,0,0,.6)` (light .22), and a scrim `rgba(5,6,8,.72)` (light `rgba(13,16,20,.48)`).
**Motion.** 100ms hover and press, 150ms menus and tabs, 240ms modal entrance; ease-enter `cubic-bezier(.2,0,0,1)`, ease-exit `cubic-bezier(.4,0,1,1)`. Save flash: brand-subtle fading to transparent over 600ms. Under reduced motion everything is 0.
**Breakpoints.** Below 768: top bar and bottom tab bar. 768–991: 64px icon rail. 992 and up: 232px sidebar. Layouts are designed at 375, 768 and 1280.

## Components
Plain semantic names. Each is shown with all its states in `design/Wideline Components.dc.html` (core) and `design/Wideline Patterns.dc.html` (football components and shell).

| Component | Props | States / notes |
|---|---|---|
| `Button` | `variant: primary \| secondary \| ghost \| danger`, `size: s \| m \| l \| xl`, `icon`, `loading`, `disabled` | default, hover (raised or brand-hover), focus ring, pressed (selected or brand-press), disabled (raised fill, ink-disabled, line border, `aria-disabled` plus a reason nearby), loading (spinner replaces the icon, label becomes "Saving", width kept). One primary per view. Danger only inside confirm dialogs. |
| `TextField`, `Select`, `SearchSelect` | `label`, `help`, `error`, `mono` | the label is always visible above the field. Focus: 1px focus border plus a 1px ring. Error: rejected border plus ring, and a message with circle-alert icon that says how to fix it. Placeholders show format only. |
| `Tabs` (page) | `items[{label,count}]` | the selected tab has a 2px ink underline. Counts are mono. Arrow-key navigation. |
| `SegmentedFilter` | `options[{label,count,icon?}]` | selected = bg-selected plus a line-strong inset. `radiogroup`. |
| `StatusChip` | `kind: match \| event`, `status`, `size: m(26) \| s(22) \| disc(20)`, `progress?` | match: draft (thin outline, file icon), uploading (outline, upload, "62%"), processing (outline, loader), ready for review (dashed pending, clock), in review (brand-subtle with brand-text edge, eye), reviewed (solid confirmed, check), failed (rejected-subtle, alert). Event: confirmed / pending / rejected (the event name is struck through). Not interactive. |
| `ConsentBadge` | `state: given \| awaiting \| withdrawn \| none`, `date?`, `iconOnly?` | shield-check solid / clock dashed / shield-off subtle / plain shield outline. Club staff only. |
| `TeamMarker` | `side: H \| A`, `size: 16 \| 20 \| 24 \| 32` | a square with an expanded 800 letter. |
| `ConfidenceMeter` | `value 0..1`, `size: inline \| large`, `manual?` | 10 segments plus a 2-decimal number. Under 0.50 it turns pending and adds "Low". `manual` shows "Added by scout". Review only. |
| `Toast` | `tone: success \| info \| warning \| error`, `action?` | bottom left on desktop, above the tab bar on phones. 6 s and pauses on hover or focus. Errors stay until dismissed. `role=status` (or `alert` for errors). |
| `Modal`, `ConfirmDialog`, `Sheet` | `title`, `onClose` | focus trap, Esc closes, focus returns to the trigger. A bottom sheet on phones. The confirm dialog focuses the safe button first. |
| `StatTile` | `label, value, unit, rate, sample, matches, clipHref` | default, hover, focus, small sample (under 3 matches: dashed pending top edge plus flag), not recorded (says why), loading (static blocks). The whole tile is a link. |
| `PlayerCard` | `player, figures[3], viewer: scout \| club, shortlisted` | scout: bookmark toggle (`aria-pressed`). Club: consent badge. Departed: no figures. Loading. |
| `ReviewEventRow` | `event, selected, focused, saved` | 42px rows: time, H/A, type, who, a 10-segment meter, status disc. Selected opens inline with Confirm Y / Reject N / Edit E. Rejected rows are struck through. Edited rows show "Edited". Saved rows flash. The list never reorders. |
| `ExpiryBanner`, `ExpiryChip` | `deletesAt` | more than 3 d neutral, 3 d or less pending, under 24 h rejected (`role=alert`), deleted (lock icon). Updates once a minute. Can't be dismissed. |
| `PitchHeatmap` | `zones[16×10], sample, half?` | CSS grid cells on the pitch with chalk lines drawn in SVG. Fixed ramp, legend and sample always shown. `role=img` with a text alternative. Small-sample and no-data variants. |
| `MiniPitch` | `usual, also[]` | a lime diamond for the usual position, outlined diamonds for others. |
| `DataTable` | `columns, rows, sort, selection` | sticky header with an ink underline, hairline dividers (no zebra stripes), text left and numbers right in mono, `aria-sort`, a bulk bar replaces the toolbar when rows are selected. On phones it becomes 56px list rows. |
| `AppShell` | `role(s), org, current` | `Sidebar` (≥992), `Rail` (768–991, tooltips on hover and focus), `TopBar` and `BottomTabBar` (<768, up to 4 items plus More), `OrgSwitcher`, `AccountMenu` (theme radio Dark / Light / Match system, shortcuts, sign out). Current page: bg-selected plus a 2px ink inset. A count badge only when action is waiting. |
| `StepHeader` | `steps, current` | numbered discs (confirmed when done, ink when current). Phone version: n-of-m plus bars. |
| `StateMessage` | `kind: empty \| loading \| error \| forbidden \| offline` | pitch-line mark, title, one sentence, at most one primary action. Errors show a reference code. Always rendered inside the page header. |

Icons: Lucide at 1.8 stroke, 20px (16 in dense tables). Names used: `check, x, pencil, plus, clock, shield-check, shield-off, shield, star, flag, upload, play, pause, search, chevron-*, arrow-left, triangle-alert, info, circle-alert, list-checks, bookmark, user, users, chevrons-up-down, ellipsis, rotate-ccw, rotate-cw, maximize, lock, circle-play, eye, mail, loader-circle, undo-2, trash-2, file, refresh-cw, layout-dashboard, video, sliders-horizontal, flask-conical, log-out, moon, sun, monitor, keyboard, menu, arrow-down`. `design/icons.js` holds the exact path data. Fixed meanings: check = confirm, x = reject, pencil = edit, plus = add missed event, clock = pending or expiry, shield-check = consent given, shield-off = withdrawn, star = favourite clip, flag = dispute, upload = upload.

Logo ("The wide channel"): a pitch outline 46×22 with the halfway line and centre circle, the near touchline as a solid lime bar (4px under an 18px pitch), and "WIDELINE" in Archivo 800, 125% width, tracked 0.1em. The SVG markup is in any design file header.

## Screens
All are at 1280 and 375, plus 768 where the layout changes. Specs are in the files and named by `data-screen-label`.

**Screens A** (`design/Wideline Screens A.dc.html`, club admin Nomvula Mthembu)
1. **Sign in.** Desktop split 640/640: a graphite pitch-line panel with the lime near touchline and the line "Every number on Wideline comes from a clip a scout has checked", and a form column (max 400): email, password with show toggle, "Forgot password?", primary "Sign in" (44), an "or" divider, secondary "Email me a sign-in link" and "Continue with Google". Phone: an error summary (`role=alert`) giving the same message for a wrong email or password, and a "Check your email" screen (link works once, expires in 15 min, resend countdown).
2. **Club dashboard.** "Needs you" row of 3 actionable items (consent gaps, missing lineup, failed match). "Matches by status" strip of 7 counts that link to filtered lists. Latest matches table. Squad consent per team as a segmented bar plus legend. Consent gaps list with Remind or Add guardian. Withdrawn consent is never chased.
3. **Matches list.** Filters (All / Needs you / In progress / Reviewed), a table (date, match with H/A, team, status, footage countdown, events, row action), pagination. Tablet: rail plus 3 columns. Phone: 76px rows.
4. **Match detail.** Processing: header with status and title, tabs (Events disabled until reviewed), six named pipeline steps with only the running one showing a lime bar, an estimate, "you can leave this page". Facts panel and a consent-coverage note. Phone, failed: which step stopped, why in plain words, "Upload another recording" or "Process the 54 usable minutes". Includes a table of what each of the 7 statuses shows.
5. **Upload.** Step 1, recording: a resumable chunked upload, and a paused state that carries on from the last chunk. Step 2, lineup: the upload keeps running in a strip at the top. Home players come from the squad with a consent icon. Away players need only a shirt number. Duplicate-number validation. Step 3, markers: the scrubber maps video time to match time (KO, HT, 2H, FT), set from the current frame (M), ±1 s and 10 s steps. "Finish and process" is disabled until FT is set.

**Screens B** (`design/Wideline Screens B.dc.html`, scout Daniel Fourie)
6. **Review queue.** The claimed match on top ("Continue review", the only primary). The queue is always sorted by footage deleted soonest. Matches from declared clubs are locked with the reason. Phone cards. Empty state copy: "No matches waiting. New matches appear here as clubs upload them."
7. **Review workspace** (always dark). Header with 38 progress ticks and "Mark as reviewed" (disabled, "32 left"). Expiry banner. An 8/4 split: video with detection boxes (selected player in lime with its confidence), controls, a timeline (home above the axis, away below; tick height for goal > shot > pass; lime playhead; HT line). The event list with the selected row open and shortcuts. Add missed event, J and K. Tablet: stacked. Phone: a current-event card with 56px Confirm / Reject / Edit, Up next, and an edit bottom sheet with the nearest players.
8. **Player profile.** Hero: outlined shirt number, name in display-xl, position, age band and club, mini pitch, "Play all clips", shortlist toggle. Tabs. A strip of 6 stat tiles. Heatmap, clips (favourite star, no download), match log. Phone stacked.

**Screens C** (`design/Wideline Screens C.dc.html`)
9. **Squad.** Team tabs plus Departed. Consent filters with counts. A table (number, player, position, consent, guardian status with action, matches, minutes). Departed list with Restore.
10. **Guardian consent** (no account, opened from an emailed or texted link). 1 explanation (can see / never see). 2 the question alone: "Can scouts see Lebo's stats?", with "Yes, scouts can see them" and "No, keep them inside the club" as equal 64px buttons. 3 confirmation. Later: the manage page with "Stop sharing with scouts", then the withdrawn screen. It never asks why.
11. **Scout registration.** Four steps, one topic each (identity, contact, clubs, terms), saved as you go. Desktop clubs step with club search. "I'm not connected to any club" counts as an answer. Then "Application sent" (waiting for review).
12. **Scout approvals** (Wideline staff, desktop). Admin tabs, status filters, a table (applicant, sent, declared clubs, ID check, status), Review plus a row menu (Approve, Ask for more information, Reject with a reason).
13. **State family.** Empty, loading, error (reference code) and forbidden (who can grant access), plus offline in review (decisions queued on the phone).

## Interactions and behaviour
- **Review loop:** J and K select. Y, N and E act and jump to the next *pending* event. U undoes. The save flash is 600ms. Rows never reorder. Single-key shortcuts can be turned off. Decisions save optimistically and queue offline.
- **Claiming:** one match at a time. A claim lasts 72 h or until the footage is deleted, whichever is first. A match can be released.
- **Upload:** resumable chunked upload that survives tab close and network loss. Lineup and markers can be done while it uploads. Processing starts only when all three steps are done.
- **Consent:** takes effect immediately in both directions. A withdrawn player appears on scout shortlists as "No longer available".
- **Expiry:** countdown from the server time, updated every 60 s. The step changes at 3 d and at 24 h.
- **Theme:** stored per user. `data-theme` on `<html>`. The review workspace forces dark unless the user chose Light.

## State to model
Match `status` (draft, uploading, processing, ready, in review, reviewed, failed) plus `failure {step, reason, options}`. Event `status` (pending, confirmed, rejected) plus `edited`, `source: model | scout`, `confidence`. Consent `state` (given, awaiting, withdrawn, none) plus dates. Scout application `status` (waiting, needs information, approved, rejected) plus `idCheck`. Footage `deletesAt`. Upload `bytesSent / total / paused`.

## Files
- `tokens/wideline-tokens.css`: all tokens, both themes, system mode, reduced motion.
- `tokens/wideline-tailwind.css`: Tailwind v4 `@theme` mapping and helpers.
- `A11Y.md`: WCAG 2.2 AA pass with the full contrast table, keyboard map and open items.
- `design/Wideline Tokens.dc.html`: tokens with live contrast and colour-blindness checks.
- `design/Wideline Components.dc.html`: 9 core components, all states, both themes.
- `design/Wideline Patterns.dc.html`: football components and the app shell.
- `design/Wideline Screens A/B/C.dc.html`: all screens.
- `design/icons.js`, `design/support.js`: needed to open the design files.
