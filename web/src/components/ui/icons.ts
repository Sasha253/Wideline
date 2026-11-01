/**
 * Shared props for Lucide icons (Floodlight): 1.8px stroke, hidden from screen readers.
 * Icons are 20px by default and 16px in dense tables; the component CSS sets the size
 * per component (16px in m buttons, 15px in m chips, 12px in s chips and discs). Every
 * icon sits next to a word, apart from IconButton and the icon-only consent badge and
 * status disc, which carry an accessible name of their own.
 */
export const iconProps = { strokeWidth: 1.8, "aria-hidden": true } as const;

/** The default icon size in px, and the size in dense tables. */
export const ICON_SIZE = 20;
export const ICON_SIZE_DENSE = 16;
