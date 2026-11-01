# Wideline design system: superseded by Floodlight

The old brand book that lived here (pitch green, floodlight accent, Barlow Condensed,
Instrument Sans, IBM Plex Mono, light by default) is **retired**. The Floodlight redesign
replaces it. Build every new or changed screen from:

- `docs/design-handoff/README.md`: the spec. Rules, tokens, components with props and
  states, screens and interactions.
- `docs/design-handoff/A11Y.md`: the WCAG 2.2 AA pass, contrast table and keyboard map.
- `docs/design-handoff/IMPLEMENTATION.md`: how to build it in this repo (utilities, token
  names, fonts, theme API, focus, checks, file ownership).
- `web/src/styles/wideline-tokens.css`: the only source of token values (`--wl-*`, both
  themes). `web/src/styles/wideline-tailwind.css` maps them to Tailwind utilities.
- The design files (`design/*.dc.html` in the claude.ai/design project): exact layout,
  spacing, states and copy, by `data-screen-label`.

`tokens.json` and `tokens.css` in this folder are retired stubs, so nothing can regenerate the
old palette. `components/` keeps the old per-component notes for reference only: where they
disagree with the handoff, the handoff wins.

## Non-negotiables

1. **No photos of players.** Avatars are initials, or the shirt number in the profile hero.
   Video frames only in the review workspace and clip players. The only illustration is
   pitch geometry.
2. **Never colour alone.** Status = colour + icon + word, plus shape: solid = settled, dashed
   = waiting on a person, thin outline = waiting on the system, struck through = a rejected
   event. Teams = fixed UI colour + H/A letter, never kit colours.
3. **Lime is for live or next only**: the primary action, the current-minute playhead, upload
   progress, the usual-position marker, the selected player's detection. Selection is ink
   (`bg-selected` plus an ink underline or inset), never lime. Lime is never text on a light
   surface.
4. **Numbers are facts.** Tabular figures, units in the string ("9.1 km"), the sample beside
   every rate ("0.62 per 90 · based on 2 matches"), a flag under 3 matches. Nothing counts
   up. Every stat and event links to its clip.
5. **No hype.** No ratings, ranks, badges, leaderboards or potential scores.
6. **Two complete themes.** Dark is the default everywhere. Light is offered in the account
   menu (Dark / Light / Match system). The review workspace stays dark unless the user chose
   Light.
7. **WCAG 2.2 AA.** 2px focus ring with a 2px offset on everything focusable; 44px targets
   below 768px; never colour alone.
8. **Icons**: Lucide at 1.8 stroke, 20px (16 in dense tables), with fixed meanings (check =
   confirm, x = reject, pencil = edit, plus = add missed event, clock = pending or expiry,
   shield-check = consent given, shield-off = withdrawn, star = favourite clip, flag =
   dispute, upload = upload).

## Copy

Sentence case everywhere, including buttons. British and South African spelling
(organisation, favourite). Say match, pitch, squad, kit, U17, never game, field or roster. No
emoji. No exclamation marks except a first-run success message. Guardian screens are written
for a reading age of about 12. Exact strings are in the design files: use them.
