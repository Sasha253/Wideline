# Floodlight · implementation notes

For every agent working on the Floodlight redesign after the foundations stage. Read this
before you edit anything, then `README.md` (the spec) and `A11Y.md` in this folder. The
design files themselves (`design/*.dc.html`) live in the claude.ai/design project; read the
screens you need there (by `data-screen-label`) and rebuild them in React. Never ship the HTML.

The redesign is presentation only: same screens, same rules, same data and permissions. Do
not change server logic, data fetching, server actions, `requireRole` / `requirePageRole`
checks, tenancy, consent rules or the database schema.

## 1. Where things are

| What | File |
|---|---|
| Every token, both themes, base rules | `web/src/styles/wideline-tokens.css` (verbatim from the handoff, only the font stacks wired to next/font) |
| Tokens as Tailwind v4 utilities | `web/src/styles/wideline-tailwind.css` (verbatim) |
| Wiring, layer order, temporary legacy utilities | `web/src/app/globals.css` |
| Component CSS by group | `web/src/styles/components/{core,domain,shell}.css` |
| Per-screen CSS utilities can't express | `web/src/styles/components/screens.css`, `review.css` |
| Fonts | `web/src/app/layout.tsx` |
| Theme | `web/src/components/ui/theme.tsx`, `theme-client.tsx`, `theme-server.tsx`, `theme-constants.ts` |
| UI barrel | `web/src/components/ui/index.ts` (sections `// --- core ---`, `// --- domain ---`, `// --- shell ---`) |

## 2. How to style

1. **Tailwind utilities from `wideline-tailwind.css` first.** It clears Tailwind's default
   colours, fonts, type sizes, radii, shadows and breakpoints, so only Wideline roles exist.
   `bg-white`, `text-gray-500`, `text-sm`, `rounded-md`, `shadow-lg`, `sm:` do not exist (a
   few old names survive temporarily, see section 7; do not use them).
2. **Group CSS files for what utilities can't express**: pseudo-elements, `::-webkit-*`,
   `:has()` chains, keyframes, SVG paint, complex grid templates. Put the rule in your group's
   file (`core.css`, `domain.css` or `shell.css`), which sits in Tailwind's `components`
   layer, so a utility on the same element still wins. Use `var(--wl-*)` tokens only.
3. **Never hard-code** a hex, `rgb()` or `hsl()` value outside `wideline-tokens.css`, and no
   arbitrary px utilities like `h-[42px]` (`tests/unit/design-system.test.ts` fails on both in
   `components/ui`, `shell`, `templates`, `states`, `app/dev` and `styles/components`). If a
   size has a token but no utility, use the variable: `h-[var(--wl-row-review)]`.
4. Class names in group CSS keep the `wl-` prefix (`.wl-btn`, `.wl-chip`…). New components
   may use utilities only and need no group CSS at all.

### Utility names (as they exist in the mapping)

**Colour** (works with every colour utility: `bg-`, `text-`, `border-`, `outline-`, `fill-`,
`stroke-`, `divide-`, `decoration-`, `ring-`):

| Role | Utility |
|---|---|
| Surfaces | `bg-canvas` (page), `bg-panel` (panels, tables, sidebar), `bg-raised` (hover, inputs, menus), `bg-selected` (selection, current nav), `bg-sunken` (video well, kbd) |
| Ink | `text-ink`, `text-ink-muted`, `text-ink-disabled` (disabled only), `text-ink-inverse` |
| Lines | `border-line` (hairlines), `border-line-strong` (overlay edges), `border-control` (control borders, 3:1) |
| Focus | `outline-focus` / `ring-focus` helper (section 4) |
| Brand (lime) | `bg-brand`, `hover:bg-brand-hover`, `active:bg-brand-press`, `text-on-brand`, `border-brand-edge` (always on a lime fill), `text-brand-text` (links), `bg-brand-subtle` (save flash, In review) |
| Teams | `bg-home` + `text-on-home`, `bg-away` + `text-on-away`, `border-home`, `border-away` |
| Status | `text-confirmed` / `bg-confirmed` / `bg-confirmed-subtle`, `text-pending` / `bg-pending-subtle`, `text-rejected` / `bg-rejected-subtle`, `text-on-status` (on a solid status fill), aliases `text-danger`, `text-warning` |
| Overlay | `bg-scrim` |
| Pitch and data | `bg-pitch`, `stroke-chalk`, `bg-heat-1` … `bg-heat-5` (same in both themes) |
| Other | `bg-transparent`, `text-current` |

**Type.** `text-*` sets size, line height, weight and tracking. It does **not** set the family,
the width or caps, so combine:

| Style | Classes |
|---|---|
| display-xl (hero name) | `font-display text-display-xl stretch-wide uppercase` |
| display-l (page title) | `font-display text-display-l stretch-wide uppercase` (phones: `text-display-phone`) |
| stat-xl (tile figure) | `font-display text-stat-xl stretch-wide tabular-nums` |
| stat-m (inline figure) | `font-display text-stat-m stretch-wide tabular-nums` |
| heading-section (panel head) | `font-display text-heading-section stretch-wide uppercase` |
| title-guardian (guardian, auth, steps) | `text-title-guardian stretch-semi` (sentence case, never caps) |
| title-m (modal title) | `text-title-m` |
| body-guardian | `text-body-guardian` |
| body | inherit it (see below) or `text-body` |
| body-s (meta) | `text-body-s` |
| label (buttons, tabs, chips) | `text-label` |
| mono-l (clocks) | `font-mono text-mono-l tabular-nums` |
| mono-m (timestamps, confidence, numeric cells) | `font-mono text-mono-m tabular-nums` |
| overline (table headers, tile labels, breadcrumbs) | `font-mono text-overline uppercase` (never the bare `overline` class: Tailwind's `overline` is text-decoration) |

Body text: `<html>` is 14px / 1.45 and steps up to 15px below 768px (wideline-tokens.css base).
Running text should inherit that so the phone step works. `text-body` pins 14px.

**Archivo width.** `stretch-wide` = 125% (names, figures, section heads), `stretch-semi` =
112.5% (guardian and auth titles), nothing = 100% (all other UI). In CSS:
`font-stretch: var(--wl-stretch-wide)`. The font loads with its whole `wdth` axis (62 to 125)
and weights 300 to 900, so any `font-*` weight utility (`font-semibold`, `font-extrabold`)
renders true.

**Tabular figures.** `tabular-nums` (Tailwind built-in) on every figure, clock, count and
numeric cell; `font-variant-numeric: tabular-nums` in CSS. Units in the string ("9.1 km"),
the sample beside every rate ("0.62 per 90 · based on 2 matches").

**Spacing.** `--spacing` is 4px: `p-0.5` = 2, `p-1` = 4, `p-2` = 8, `p-3` = 12, `p-4` = 16,
`p-5` = 20, `p-6` = 24, `p-7` = 28 (desktop page padding), `p-8` = 32, `p-10` = 40,
`p-12` = 48, `p-16` = 64. Same scale for `m-`, `gap-`, `w-`, `h-`, `inset-`.

**Sizing.** `h-control-s` (32, desktop table rows only), `h-control-m` (36, desktop default),
`h-control-l` (44, touch minimum), `h-control-xl` (56, phone primary, guardian); also as
`min-h-`, `w-`, `size-`. Rows: `h-row-dense` (40), `h-row` (48), `h-row-touch` (56), review
row `h-[var(--wl-row-review)]` (42). Shell: `w-sidebar` (232), `w-rail` (64), top bar and tab
bar `h-[var(--wl-shell-topbar)]` / `h-[var(--wl-shell-tabbar)]` (56).

**Radii.** `rounded-none` (panels, tables, banners, video), `rounded-control` (2px: controls,
chips, tiles, markers), `rounded-overlay` (4px: menus, toasts, modals, sheets), `rounded-full`
(avatars, discs, radios). Plain `rounded` does not exist.

**Borders.** `border` = 1px hairline. Selected underline or inset = 2px (`border-b-2`,
`shadow-[inset_2px_0_0_var(--wl-color-ink)]`). Tile top edge 3px (`border-t-3`).
`border-pending` helper = 1.5px dashed pending (the whole border shorthand).

**Elevation.** Panels are flat: no shadow, a hairline. Only overlays: `shadow-overlay` (menus,
toasts, popovers), `shadow-modal` (modals, sheets), over `bg-scrim`.

**Breakpoints.** `tablet:` (768 and up: rail), `desktop:` (992 and up: sidebar), `wide:`
(1280 and up). `touch:` = below 768 (top bar and tab bar). Design at 375, 768 and 1280.

**Motion.** `duration-fast` (100ms hover and press), `duration-base` (150ms menus, tabs),
`duration-slow` (240ms modal entrance), `ease-enter`, `ease-exit`, `animate-saved` (600ms
save flash). Reduced motion zeroes all durations globally (wideline-tokens.css); the save
flash then becomes a check icon that stays 1.2s (component's job).

**`light:` variant.** Matches an explicit `data-theme="light"` only, not "Match system" on a
light OS. Prefer roles, which already switch in every mode; use `light:` only when a role
can't express the difference.

## 3. Rules that are easy to break

- **No player photos.** Initials, or the shirt number in the profile hero.
- **Never colour alone.** Colour + icon + word + shape: solid = settled
  (`bg-confirmed text-on-status`), dashed = waiting on a person (`border-pending`), thin
  outline = waiting on the system (`border border-control`), struck through = rejected event
  (`line-through`). Withdrawn consent is never struck through. Teams: fixed colour + H/A.
- **Lime only for live or next**: the one primary action, the playhead, upload progress, the
  usual-position marker, the selected player's detection. **Selection is ink**
  (`bg-selected` + a 2px ink underline or inset), never lime. Lime is never text on a light
  surface (`text-brand-text` is lime on dark and olive on light, so it is safe). Every lime
  fill has `border border-brand-edge`.
- **No ratings, ranks, badges, leaderboards, potential scores.** Nothing counts up.
- **Copy**: exact strings from the design files. Sentence case, British / South African
  spelling, match / pitch / squad / kit / U17, no emoji, no exclamation marks.
- **Icons**: lucide-react, `strokeWidth={1.8}`, 20px (16 in dense tables), `aria-hidden`
  next to a word; icon-only buttons have `aria-label`. `iconProps` in `ui/icons.ts` sets the
  1.8 stroke; sizes come from component CSS or `ICON_SIZE` / `ICON_SIZE_DENSE`.
- **Targets**: 44px minimum below 768 (`h-control-l`), 56px phone primaries, 64px guardian
  answers. `h-control-s` only in desktop tables.

## 4. Focus

One rule, in `wideline-tokens.css`: `:focus-visible { outline: 2px solid var(--wl-color-focus);
outline-offset: 2px }`. Lime on dark, ink on light, 3:1 on every surface. Never remove it
without drawing a replacement. To move the ring onto a wrapper, use the `ring-focus` helper
(`has-[:focus-visible]:ring-focus`, or `outline` in group CSS) and `outline-none` on the inner
element. Inside dense lists use an inset ring (`-outline-offset-2`). Selection and focus are
separate and can show together (review list: selection = `bg-selected` + 1px focus inset; Tab
focus = 2px inset ring). Sticky headers, toasts and the upload strip must not cover focus:
`scroll-padding-top: var(--wl-shell-topbar)` on scroll containers.

## 5. Theme API

Dark is the default everywhere. `<html data-theme>` holds the user's choice: `"dark"`,
`"light"` or `"system"` (the tokens resolve `system` with `prefers-color-scheme`). The root
layout renders `data-theme="dark"`; `ThemeScript` (in `<head>`) applies the stored choice
before first paint. The choice is stored in this browser (localStorage and a cookie, both
named `wideline-theme`); other tabs follow at once.

```tsx
// Client components (the AccountMenu theme radio):
import { useTheme } from "@/components/ui/theme";
const { choice, resolved, setChoice, options } = useTheme();
// options = THEME_OPTIONS: [{ value: "dark", label: "Dark", icon: Moon },
//   { value: "light", label: "Light", icon: Sun }, { value: "system", label: "Match system", icon: Monitor }]
// choice: what the user picked. resolved: "dark" | "light" actually on screen.
// setChoice(value) (also exported as setThemeChoice) stores it and applies it everywhere.

// Server components: force a subtree.
import { ThemeScope } from "@/components/ui/theme";           // <ThemeScope theme="light"> for print views
import { ReviewThemeScope, getThemeChoice } from "@/components/ui/theme-server";
// <ReviewThemeScope className="…">…</ReviewThemeScope>: dark unless the user chose Light
// (Match system stays dark). Reads the cookie, so the first paint is right; follows changes live.
```

`theme-server.tsx` is server-only and deliberately not in the `ui/index.ts` barrel. The review
workspace (and the CV Lab, today `ThemeScope theme="dark"` in `app/(app)/lab/layout.tsx`)
should move to `ReviewThemeScope`. The `Workspace` template still uses `ThemeScope`.

## 6. Checks

Local `pnpm` is not on PATH on this machine; the `web` container has it and the full
dependencies:

- `docker compose exec -T web pnpm typecheck`
- `docker compose exec -T web pnpm lint`
- `docker compose exec -T web pnpm test` (slow, about 9 minutes; filter with
  `pnpm test tests/unit/<file>`)
- Build in a throwaway container, never in the running one (it shares `/app/.next` with the
  dev server), with `NODE_ENV=production` (the container's development value makes the
  prerender of `/_global-error` fail): `docker compose run --rm --no-deps -T -e NODE_ENV=production web pnpm build`

`tests/unit/*.test.tsx` pin some markup (for example `states.test.tsx`, `shell.test.tsx`,
`squad-page.test.tsx`). When you restyle a component and a test asserted its old classes,
update that assertion in the same change and say so in your result. Lint runs
`prettier --check`; `src/styles/components/` and the two `wideline-*.css` files are in
`.prettierignore` (one rule per line, as before).

## 7. Temporary legacy layer (removed)

**Removed at the Floodlight integration.** `styles/tokens.css` and the legacy utilities block
in `globals.css` are gone; `tests/unit/design-system.test.ts` fails if either comes back or if
component CSS reads an old variable name. `screens.css` now holds only the few per-screen
rules utilities can't express (video player, calibration, copy box, player form grid), on
`--wl-*` tokens; `review.css` holds the reviewer watermark. The Tabs component's classes are
`.wl-tabset*` (they were `.wl-tabbar*`, which collided with the shell's phone tab bar).

What the layer was, for reference:

- `styles/tokens.css` is a **legacy alias block**: the old variable names (`--surface`,
  `--surface-raised`, `--surface-sunken`, `--line`, `--line-strong`, `--ink`, `--ink-muted`,
  `--pitch`, `--on-pitch`, `--pitch-soft`, `--floodlight`, `--on-floodlight`, `--home`,
  `--away`, `--warning(-soft)`, `--danger(-soft)`, `--focus`, `--turf`, `--chalk`,
  `--heat-1…5`, `--shadow-pop`, `--space-*`, `--radius-*`, `--font-sans/display/mono`) mapped
  to the nearest `--wl-` role, and the old type classes (`.display-xl`, `.stat-xl`,
  `.heading-1`, `.heading-2`, `.body-lg`, `.body`, `.body-strong`, `.label`, `.caption`,
  `.overline`, `.data`, plus `.eyebrow` in globals.css) re-pointed at Floodlight type.
- `globals.css` has a **legacy utilities** block: `bg-surface`, `bg-surface-raised`,
  `bg-surface-sunken`, `rounded-sm/md/lg`, the `md:` (768), `lg:` (1024) and `xl:` (1280)
  breakpoints, and `text-pitch` / `border-pitch` repainted as brand-text / brand-edge (the old
  link colour; in Floodlight `pitch` is the graphite pitch surface).
- `styles/components/screens.css` holds the old per-screen rules (C02 to C09), one section per
  route.

When you migrate a file, move it off every legacy name: `var(--wl-*)` and the utilities above,
`text-brand-text` instead of `text-pitch`, `tablet:` / `desktop:` / `wide:` instead of `md:` /
`lg:` / `xl:`. The integrator deletes `tokens.css`, the legacy block in `globals.css` and
`screens.css` once nothing uses them (`grep -rE "var\(--(surface|pitch|floodlight|danger|warning|turf|space-|radius-)|\b(md|lg|xl):|text-pitch|bg-surface|heading-[12]|body-strong|\bcaption\b" web/src`).

## 8. File-ownership map

Edit only files you own. If you need a change in someone else's file, work around it and list
it in `openIssues`.

| Owner | Files |
|---|---|
| **core agent** | `web/src/components/ui/{Button,StatusChip,ConsentBadge,TeamMarker,ConfidenceMeter,cx,icons}.*`, `web/src/components/forms.tsx`, `web/src/components/ConfirmDialog.tsx`, `web/src/components/SignOutButton.tsx`, new core components under `web/src/components/ui/` (Tabs, SegmentedFilter, Toast, Modal, Sheet, TextField / Select / SearchSelect if split out), `web/src/styles/components/core.css`, the core section of `ui/index.ts` |
| **domain agent** | `web/src/components/ui/{StatTile,PlayerCard,PlayerCardMenu,ReviewEventRow,ExpiryBanner,expiry,PitchHeatmap,Cover}.*`, new domain components (MiniPitch, DataTable, StepHeader, StateMessage, ExpiryChip), `web/src/components/states/**`, `web/src/components/templates/**`, `web/src/styles/components/domain.css`, the domain section of `ui/index.ts` |
| **shell agent** | `web/src/components/shell/**`, `web/src/components/ui/Logo.tsx`, the `(app)` route-group layout file(s) that mount the shell (`web/src/app/(app)/layout.tsx`), `web/src/styles/components/shell.css`, the shell section of `ui/index.ts` |
| **foundation** (and later the integrator) | `web/src/app/globals.css`, `web/src/styles/wideline-*.css`, `web/src/styles/tokens.css`, `web/src/app/layout.tsx`, `web/src/components/ui/theme*.ts(x)`, `web/src/styles/components/screens.css` (screen agents may edit only their route's section, with exact-string edits) |
| **screen agents** | the route folders they are assigned |

Not in the map (treat as integrator-owned unless your task assigns them):
`web/src/components/consent/**`, `web/src/components/video/**`,
`web/src/components/section-result.ts`, `web/tests/**` outside the assertions your change
breaks.

The barrel `ui/index.ts` is shared: edit only inside your section, with exact-string edits.
