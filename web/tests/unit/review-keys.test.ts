import { describe, expect, it } from "vitest";
import { keyAction, readSingleKeys, type KeyTarget } from "@/lib/review-keys";
import {
  initialSelection,
  neighbourId,
  nextPendingId,
  progress,
  visibleEvents,
  type WorkspaceEvent,
} from "@/lib/review-workspace";

// C11 (REVIEW07; docs/build/design/C11.md, "Keyboard (workspace)"): J next, K
// previous, Y confirm, N reject, E edit, Space and the arrows for the video.
// Ignored with Ctrl, Meta or Alt, in inputs and contenteditable, inside a
// data-review-keys="off" region and while a dialog is open. A "Log in as"
// session gets no decision keys. After a decision the selection moves to the
// next pending event.

const ctx = { readOnly: false, dialogOpen: false };

/** A fake element: its tag, role and the selectors it sits inside. */
function el(tagName: string, { role, within = [] }: { role?: string; within?: string[] } = {}) {
  return {
    tagName,
    getAttribute: (n: string) => (n === "role" ? (role ?? null) : null),
    closest: (s: string) => (within.some((w) => s.includes(w)) ? {} : null),
  } satisfies KeyTarget;
}

describe("keyAction", () => {
  it("maps the review letters, either case", () => {
    expect(keyAction({ key: "j" }, ctx)).toBe("next");
    expect(keyAction({ key: "J", shiftKey: true }, ctx)).toBe("next");
    expect(keyAction({ key: "k" }, ctx)).toBe("previous");
    expect(keyAction({ key: "y" }, ctx)).toBe("confirm");
    expect(keyAction({ key: "N", shiftKey: true }, ctx)).toBe("reject");
    expect(keyAction({ key: "e" }, ctx)).toBe("edit");
    expect(keyAction({ key: "a" }, ctx)).toBe("add");
    expect(keyAction({ key: "?", shiftKey: true }, ctx)).toBe("shortcuts");
    expect(keyAction({ key: "x" }, ctx)).toBeNull();
    expect(keyAction({ key: "l" }, ctx)).toBeNull();
  });

  it("turns the letters off with the Single-key shortcuts setting (WCAG 2.1.4)", () => {
    const off = { ...ctx, singleKeys: false };
    for (const key of ["j", "k", "y", "n", "e", "a", "?", "J", "Y"]) {
      expect(keyAction({ key, shiftKey: key === key.toUpperCase() }, off)).toBeNull();
    }
    // Space and the arrows are not character keys and stay on.
    expect(keyAction({ key: " " }, off)).toBe("toggle");
    expect(keyAction({ key: "ArrowLeft" }, off)).toBe("seekBack");
    expect(keyAction({ key: "y" }, { ...ctx, singleKeys: true })).toBe("confirm");
  });

  it("reads the stored setting as on unless it says off", () => {
    expect(readSingleKeys(null)).toBe(true);
    expect(readSingleKeys("on")).toBe(true);
    expect(readSingleKeys("off")).toBe(false);
  });

  it("maps Space and the arrows to the video", () => {
    expect(keyAction({ key: " ", target: el("DIV") }, ctx)).toBe("toggle");
    expect(keyAction({ key: "ArrowLeft" }, ctx)).toBe("seekBack");
    expect(keyAction({ key: "ArrowRight" }, ctx)).toBe("seekForward");
  });

  it("leaves buttons, links, summaries and tabs their own Space, and tabs their arrows", () => {
    for (const tag of ["BUTTON", "A", "SUMMARY"]) {
      expect(keyAction({ key: " ", target: el(tag) }, ctx)).toBeNull();
    }
    const tab = el("BUTTON", { role: "tab" });
    expect(keyAction({ key: "ArrowRight", target: tab }, ctx)).toBeNull();
    // Y on a focused button is the workspace's, not the button's.
    expect(keyAction({ key: "y", target: el("BUTTON") }, ctx)).toBe("confirm");
  });

  it("ignores keys with Ctrl, Meta or Alt, and Shift on Space and arrows", () => {
    expect(keyAction({ key: "j", ctrlKey: true }, ctx)).toBeNull();
    expect(keyAction({ key: "y", metaKey: true }, ctx)).toBeNull();
    expect(keyAction({ key: "n", altKey: true }, ctx)).toBeNull();
    expect(keyAction({ key: " ", shiftKey: true }, ctx)).toBeNull();
    expect(keyAction({ key: "ArrowLeft", shiftKey: true }, ctx)).toBeNull();
  });

  it("ignores keys typed in fields, editable text and keys-off regions", () => {
    for (const tag of ["INPUT", "SELECT", "TEXTAREA"]) {
      expect(keyAction({ key: "y", target: el(tag) }, ctx)).toBeNull();
    }
    expect(
      keyAction({ key: "y", target: { ...el("DIV"), isContentEditable: true } }, ctx),
    ).toBeNull();
    const inPanel = el("BUTTON", { within: ['[data-review-keys="off"]'] });
    expect(keyAction({ key: "y", target: inPanel }, ctx)).toBeNull();
    expect(keyAction({ key: "j", target: inPanel }, ctx)).toBeNull();
  });

  it("ignores every key while a dialog is open", () => {
    expect(keyAction({ key: "j" }, { ...ctx, dialogOpen: true })).toBeNull();
    expect(keyAction({ key: " " }, { ...ctx, dialogOpen: true })).toBeNull();
  });

  it("keeps a 'Log in as' session to moving and playing (Q-064)", () => {
    const ro = { readOnly: true, dialogOpen: false };
    expect(keyAction({ key: "j" }, ro)).toBe("next");
    expect(keyAction({ key: " " }, ro)).toBe("toggle");
    expect(keyAction({ key: "y" }, ro)).toBeNull();
    expect(keyAction({ key: "n" }, ro)).toBeNull();
    expect(keyAction({ key: "e" }, ro)).toBeNull();
    expect(keyAction({ key: "a" }, ro)).toBeNull();
    expect(keyAction({ key: "?", shiftKey: true }, ro)).toBe("shortcuts");
  });
});

const ev = (id: string, status: WorkspaceEvent["status"], extra: Partial<WorkspaceEvent> = {}) =>
  ({
    id,
    timestampMs: Number(id.slice(1)) * 1000,
    type: "shot",
    onTarget: null,
    status,
    side: "home",
    trackId: null,
    entryId: null,
    confidence: 0.6,
    clipId: null,
    clipStartMs: null,
    clipEndMs: null,
    corrected: false,
    manual: false,
    toCheck: status !== "auto_accepted",
    ...extra,
  }) satisfies WorkspaceEvent;

describe("selection and auto-advance", () => {
  const rows = [
    ev("e1", "confirmed"),
    ev("e2", "pending_review"),
    ev("e3", "rejected"),
    ev("e4", "pending_review"),
  ];

  it("starts on the first pending event, else the first row", () => {
    expect(initialSelection(rows)).toBe("e2");
    expect(initialSelection([ev("e1", "confirmed"), ev("e2", "rejected")])).toBe("e1");
    expect(initialSelection([])).toBeNull();
  });

  it("advances to the next pending after the current, then from the top, else stays", () => {
    expect(nextPendingId(rows, "e2")).toBe("e4");
    expect(nextPendingId(rows, "e4")).toBe("e2");
    const done = rows.map((r) => ({ ...r, status: "confirmed" as const }));
    expect(nextPendingId(done, "e3")).toBe("e3");
  });

  it("moves J and K without wrapping", () => {
    expect(neighbourId(rows, "e1", 1)).toBe("e2");
    expect(neighbourId(rows, "e4", 1)).toBeNull();
    expect(neighbourId(rows, "e1", -1)).toBeNull();
  });

  it("lists the to-check and manual events, and the auto-accepted ones on request", () => {
    const all = [
      ...rows,
      ev("e5", "auto_accepted"),
      ev("e0", "manual", { manual: true, toCheck: false }),
    ];
    expect(visibleEvents(all, false).map((r) => r.id)).toEqual(["e0", "e1", "e2", "e3", "e4"]);
    expect(visibleEvents(all, true).map((r) => r.id)).toEqual(["e0", "e1", "e2", "e3", "e4", "e5"]);
    // Manual events do not count towards "checked".
    expect(progress(all)).toEqual({ checked: 2, total: 4 });
  });
});
