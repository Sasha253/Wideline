/**
 * Shared props for Lucide icons: 1.5px stroke, hidden from screen readers.
 * The bundle CSS sets the size per component (18px in buttons, 14px in chips,
 * 20px in banners). Every icon sits next to a word, apart from IconButton,
 * which carries an aria-label.
 */
export const iconProps = { strokeWidth: 1.5, "aria-hidden": true } as const;
