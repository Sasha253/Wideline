A heatmap shows where a player spent time, drawn on a 105 × 68 m pitch.

- **Provide:** the zone shares (a 6 × 4 grid by default), the attacking direction, and the sample (matches).
- **Drawing:** the pitch is filled with `turf` and drawn in `chalk` at 1.5px. Zones step from `heat-1` to `heat-5` at 85% opacity. Always attack left to right, and say so in the legend.
- **Accessibility:** the SVG gets `role="img"` and an `aria-label` describing the main pattern in words. The legend is always visible.
- **Variants:** average position uses the same pitch, with a 10px dot per player in `home` or `away` plus a TeamMarker letter.
