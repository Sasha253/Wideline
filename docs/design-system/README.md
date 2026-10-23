Wideline turns wide-angle match footage from academies and amateur clubs into verified player stats that scouts can search. The UI has to feel like serious football analysis, not a fantasy-league app. It should be calm, precise and trustworthy, with one jolt of floodlight energy. Every number on screen is traceable to a clip, and the design should make that visible.

## Who uses it, and where

Design every screen for the person and the surface below. Phones are first-class: scouts review on the sideline, and guardians give consent on their phones.

| Surface | Main user | What matters |
| --- | --- | --- |
| Club dashboard | Club admin, coach | Squad at a glance, matches by status, consent gaps |
| Upload and lineup | Coach | Resumable upload with progress, lineup entry, kickoff and half-time markers |
| Review queue | Scout | Matches to claim, sorted by footage expiry; time left always visible |
| Review workspace | Scout | Video left, event list right, keyboard-driven (J/K next and previous, Y confirm, N reject, E edit) |
| Player profile | Everyone with access | Hero with name, position, age band and club; stat tiles; heatmap; match log; clips |
| Scout search | Scout (v1) | Dense filter rail, results table, saved shortlists |
| Consent | Parent or guardian | Plain language, one decision per screen, large tap targets |
| Admin | Wideline staff | Jobs, disputes, takedowns; data-dense tables |

Navigation: a left sidebar on `surface-sunken` at 992px and up, collapsing to a bottom tab bar under 768px. Breakpoints are 375, 768 and 1280px; check every screen at all three.

## Voice and content

- Write in plain, football-native English (South African and British spelling: *favourite*, *organisation*). Say *match*, *pitch*, *squad*, *kit*, *U17*, never *game*, *field* or *roster*.
- Use sentence case everywhere, including buttons and headings: "Mark as reviewed", not "Mark As Reviewed".
- Show numbers as numerals with units: "62 min", "8.4 km", "0.81 confidence", "2 matches". Show match time as `31:24` in the `data` style.
- State facts. Never hype a player ("future star", "wonderkid"): Wideline supports scouting judgement, it doesn't replace it.
- Always state sample size beside a rate: "0.62 goals per 90 · based on 2 matches". Under 3 matches, add the small-sample flag.
- Talk to guardians at a reading age of about 12. "We record goals, shots and where your child ran during matches. Scouts can only see this if you say yes."
- Don't use emoji, and avoid exclamation marks except in a first-run success message.

Real copy to reuse:
- Empty review queue: "No matches waiting. New matches appear here as clubs upload them."
- Expiry banner: "Raw footage for this match is deleted in 2 days. Review it before then to add missed events."
- Consent request: "Can scouts see Lebo's stats?" with the options "Yes, scouts can see them" and "No, keep them inside the club".

## Colour

- Build every screen on `surface`, with cards on `surface-raised` bordered by `line`. Video wells and inputs sit on `surface-sunken`.
- Set text in `ink`, with secondary text in `ink-muted`. Both pass 4.5:1 on every surface in both themes.
- `pitch` is the brand and the only colour for primary actions, links, active navigation and confirmed states. Put `on-pitch` text on pitch fills; never hard-code white.
- `floodlight` is the accent. Use it as a fill only, with `on-floodlight` text, and at most once or twice per screen: the "new" dot, the current-minute marker on the timeline, a highlighted chart series. If floodlight is everywhere, it means nothing.
- Kit colours already carry meaning in the footage, so the UI never invents team colours. Mark the home side with `home` (blue) plus an **H** marker, and the away side with `away` (orange) plus an **A** marker. Never show colour alone.
- Statuses always pair a colour with a word and an icon:
  - **Confirmed:** `pitch`.
  - **Pending review:** `warning` on `warning-soft`.
  - **Rejected or withdrawn:** `danger` on `danger-soft`.
- Draw heatmaps on `turf` with `chalk` pitch markings, stepping through `heat-1` to `heat-5`, and always show a legend.
- Dark theme is the default for the review workspace: video reads better on it, and it feels like an evening match under floodlights. Everywhere else follows the system setting.

## Type

- `display` (Barlow Condensed) is for player names, page titles and big numbers. It is stadium-signage condensed and gives the brand its voice. Keep it out of running text.
- `sans` (Instrument Sans) is for all interface and reading text. Use `body` by default, `body-lg` on guardian and consent screens, and `label` for form labels and table headers.
- `mono` (IBM Plex Mono) is for timestamps, confidence scores and numeric table columns, using the `data` style.
- Every number that lines up in a column or ticks while a value updates uses `font-variant-numeric: tabular-nums`.
- The fonts load from Google Fonts: Barlow Condensed 500, 600 and 700; Instrument Sans 400, 500 and 600; IBM Plex Mono 400 and 500.

## Space, shape, depth

- Spacing runs on a 4px grid: `space-1` (4px) up to `space-12` (48px). Page gutters are `space-4` on phones, `space-6` on tablets and `space-8` on desktop. Cards are padded with `space-4`.
- Corners stay small and technical. Use `radius-sm` for chips, inputs and rows; `radius-md` for buttons, cards and video; and `radius-lg` for modals and the profile hero. Reserve `radius-pill` for confidence meters, toggles and avatars.
- Use borders, not shadows. Cards get a 1px `line` border. `shadow-pop` is only for menus, popovers and modals.
- Desktop layouts sit on a 12-column grid with a `space-6` gap. The review workspace splits 8 columns of video to 4 columns of event list; on a phone, the list sits under the video.

## Data display

- A stat tile shows the number (`stat-xl`), its label (`label`), the per-90 or total qualifier, and the sample (`caption`). Every tile and event links to its clip.
- Show confidence as a small pill meter plus the number in `data` style, for example "0.81". Use `pitch` at or above the auto-accept threshold, and `warning` below it.
- In tables, numbers are right-aligned, text is left-aligned, rows are 40px tall (48px on touch), and headers stay sticky. Never use zebra stripes; use `line` dividers.
- Show a player's position on a mini pitch rather than as text alone wherever space allows.

## Imagery and people

- Use no photos of players. Most players are children, and their faces belong in consented footage only. Avatars are initials on `pitch-soft` inside a `radius-pill` circle.
- Video frames appear only inside the player or review workspace, never as decoration.
- For marketing or empty-state art, use pitch geometry: chalk lines, arcs and the centre circle on `turf` or `pitch`. Don't use stock footballs or trophies.

## Motion

- Keep motion short and functional: 150ms ease-out for hovers and toggles, and 200ms for panels.
- When a correction is saved, the row settles with a brief `pitch-soft` flash.
- Never animate numbers counting up, because stats must read as facts. Respect `prefers-reduced-motion`.

## Iconography

- Use Lucide icons at a 1.5px stroke and 20px size (16px in dense tables), coloured with `currentColor` from the surrounding text token.
- These are the core meanings. Keep them consistent:
  - `check` confirm, `x` reject, `pencil` edit, `plus` add missed event.
  - `clock` expiry, `shield-check` consent given, `shield-off` withdrawn.
  - `star` favourite clip, `flag` dispute, `upload` upload.
- No Wideline logo exists yet. Until one does, set the name as a wordmark in `display` at 600 weight in `ink`.

## Accessibility

- Meet WCAG 2.2 AA. Every text pair named in a token's usage note meets 4.5:1 in both themes, and control borders (`line-strong`) and the `focus` ring meet 3:1.
- Focus is always visible: a 2px solid `focus` ring with a 2px offset.
- Touch targets are at least 44px on phones. Every keyboard shortcut in the review workspace also has a visible button.
- Never rely on colour alone, especially for teams, statuses and consent.
- Video players need caption support and full keyboard control.

## Components in this system

These components each have a live preview and usage notes: Button, StatusChip, ConsentBadge, ConfidenceMeter, TeamMarker, StatTile, PlayerCard, ReviewEventRow, ExpiryBanner and PitchHeatmap. Style them with the `wl-` classes in `components/bundle.css`.
