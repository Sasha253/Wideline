# Wideline design system — files

- `README.md`: the brand book. Voice, colour, type, spacing, data display, imagery, motion, icons and accessibility rules. Start here.
- `tokens.json`: every colour (light and dark), type style, spacing step, radius and shadow, each with a usage note. This is the source of truth.
- `tokens.css`: the same tokens as CSS variables, ready to import. Light is the default; dark applies with `data-theme="dark"` on `<html>`, or automatically from the system setting.
- `components/bundle.css`: styles for the `wl-` component classes. It also loads the three Google Fonts (Barlow Condensed, Instrument Sans, IBM Plex Mono).
- `components/<Name>/README.md`: when and how to use each component.
- `components/<Name>/preview.html`: a reference rendering of each component. Open it with `tokens.css` and `bundle.css` loaded to see it.

Load order in a page: `tokens.css`, then `components/bundle.css`.
