import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerShortcuts } from "@/components/video/PlayerShortcuts";

// C07 (Surface 1): the match page's shortcut list names C (captions) only
// when the player has captions, as the captions control does.

describe("PlayerShortcuts", () => {
  it("leaves out the captions row without captions", () => {
    const out = renderToStaticMarkup(<PlayerShortcuts />);
    expect(out).toContain("Play or pause");
    expect(out).toContain("Full screen");
    expect(out).not.toContain("Captions on or off");
    expect(out).not.toContain(">C</kbd>");
  });

  it("adds the captions row when captions are passed", () => {
    const out = renderToStaticMarkup(<PlayerShortcuts captions />);
    expect(out).toContain("Captions on or off");
    expect(out).toContain('<kbd class="wl-kbd">C</kbd>');
  });
});
