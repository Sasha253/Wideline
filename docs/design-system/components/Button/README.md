Buttons trigger actions; links navigate. Use one primary button per view.

- **Provide:** a verb-first label in sentence case ("Mark as reviewed", "Claim match"). An icon is optional, as a 20px Lucide glyph before the label.
- **Variants:** `wl-btn--primary` (pitch fill), `wl-btn--secondary` (raised, `line-strong` border), `wl-btn--ghost` (pitch text, for tertiary actions in toolbars) and `wl-btn--danger` (outlined, for destructive or consent-withdrawing actions).
- **Sizes:** 40px default, `wl-btn--sm` 32px for dense tables. On phones, buttons in forms and consent flows go full width at 48px.
- **Shortcuts:** in the review workspace, show the shortcut inside the button with `wl-kbd` ("Confirm <span class=wl-kbd>Y</span>").
- **Don't:** use floodlight as a button fill, put two primary buttons side by side, or use icon-only buttons without an `aria-label`.
