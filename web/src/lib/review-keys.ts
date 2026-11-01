/**
 * The review workspace's keyboard map (C11; REVIEW07, docs/build/design/C11.md,
 * "Keyboard (workspace)"). Pure, so the unit test covers it without a DOM:
 * the workspace's one document keydown listener asks keyAction() and calls
 * preventDefault only when it returns an action.
 */

export type KeyAction =
  | "next"
  | "previous"
  | "confirm"
  | "reject"
  | "edit"
  | "add"
  | "shortcuts"
  | "toggle"
  | "seekBack"
  | "seekForward";

/** The parts of a keydown the map reads. The target is duck-typed (an Element in the browser). */
export type KeyInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: KeyTarget | null;
};

export type KeyTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
};

export type KeyContext = {
  /** A "Log in as" session (Q-064): moving and playing only. */
  readOnly: boolean;
  /** Any dialog[open] on the page. */
  dialogOpen: boolean;
  /**
   * The reviewer's "Single-key shortcuts" setting (WCAG 2.1.4, NFR23). Off: J, K, Y,
   * N, E, A and ? do nothing, so speech input cannot confirm or reject by accident; every
   * action keeps its visible button. Space and the arrows are not character keys
   * and stay on. Default on.
   */
  singleKeys?: boolean;
};

/** Where the workspace keeps the setting (per browser, like the player's volume). */
export const SINGLE_KEYS_STORAGE = "wl.review.singleKeys";

/** The stored setting: on unless the reviewer turned it off. */
export function readSingleKeys(stored: string | null): boolean {
  return stored !== "off";
}

/** Typing targets: their keys are text, never shortcuts. */
const TYPING = 'input, select, textarea, [contenteditable=""], [contenteditable="true"]';
/** Regions that switch the workspace keys off: the add panel, the player's menus. */
const KEYS_OFF = '[data-review-keys="off"]';
/** Targets that keep their native Space. */
const OWN_SPACE = new Set(["BUTTON", "A", "SUMMARY"]);

const isTab = (t: KeyTarget) => t.getAttribute?.("role") === "tab";

function inside(t: KeyTarget, selector: string): boolean {
  return typeof t.closest === "function" && t.closest(selector) != null;
}

const LETTERS: Record<string, KeyAction> = {
  j: "next",
  k: "previous",
  y: "confirm",
  n: "reject",
  e: "edit",
  a: "add",
};
/** Writes: a read-only ("Log in as") session gets none of them. */
const WRITES = new Set<KeyAction>(["confirm", "reject", "edit", "add"]);

export function keyAction(e: KeyInput, ctx: KeyContext): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (ctx.dialogOpen) return null;
  const t = e.target ?? null;
  if (t) {
    if (t.isContentEditable || inside(t, TYPING)) return null;
    const tag = t.tagName?.toUpperCase();
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return null;
    if (inside(t, KEYS_OFF)) return null;
  }

  if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
    if (ctx.singleKeys === false) return null;
    // Shift only for the capital letters.
    if (e.shiftKey && e.key !== e.key.toUpperCase()) return null;
    const action = LETTERS[e.key.toLowerCase()];
    if (!action) return null;
    if (ctx.readOnly && WRITES.has(action)) return null;
    return action;
  }
  // "?" (Shift and / on most layouts) opens the shortcut list; a character key too.
  if (e.key === "?") return ctx.singleKeys === false ? null : "shortcuts";
  if (e.shiftKey) return null;
  if (e.key === " ") {
    if (t && (OWN_SPACE.has(t.tagName?.toUpperCase() ?? "") || isTab(t))) return null;
    return "toggle";
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (t && isTab(t)) return null;
    return e.key === "ArrowLeft" ? "seekBack" : "seekForward";
  }
  return null;
}
