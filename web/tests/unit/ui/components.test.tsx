import { Check } from "lucide-react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfidenceMeter } from "@/components/ui/ConfidenceMeter";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { Cover } from "@/components/ui/Cover";
import { ExpiryBanner, ExpiryLabel } from "@/components/ui/ExpiryBanner";
import { AveragePositionMap, heatLevel, PitchHeatmap } from "@/components/ui/PitchHeatmap";
import { initials, PlayerCard } from "@/components/ui/PlayerCard";
import { ReviewEventRow } from "@/components/ui/ReviewEventRow";
import { StatTile } from "@/components/ui/StatTile";
import {
  EVENT_STATES,
  EventStatusChip,
  MATCH_STATES,
  MatchStatusChip,
  type EventReviewState,
} from "@/components/ui/StatusChip";
import { TeamMarker } from "@/components/ui/TeamMarker";
import type { MatchStatus } from "@/generated/prisma/enums";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const count = (s: string, needle: string | RegExp) =>
  (s.match(typeof needle === "string" ? new RegExp(needle, "g") : needle) ?? []).length;

const HOUR = 60 * 60 * 1000;
const now = new Date("2025-10-22T10:00:00+02:00");
const at = (ms: number) => new Date(now.getTime() + ms);

describe("Button", () => {
  it("sets variant and size classes", () => {
    const out = html(
      <Button variant="danger" size="sm">
        Withdraw consent
      </Button>,
    );
    expect(out).toContain('class="wl-btn wl-btn--danger wl-btn--sm"');
    expect(out).toContain('type="button"');
  });
  it("passes disabled through", () => {
    expect(
      html(
        <Button variant="primary" disabled>
          Claim match
        </Button>,
      ),
    ).toMatch(/<button[^>]*disabled=""/);
  });
  it("puts the Kbd inside the label and hides the icon", () => {
    const out = html(
      <Button variant="primary" icon={Check} kbd="Y">
        Confirm
      </Button>,
    );
    expect(out).toMatch(/Confirm<span class="wl-kbd">Y<\/span><\/button>/);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('stroke-width="1.5"');
  });
  it("goes full width and 48px on phones when block", () => {
    expect(
      html(
        <Button variant="primary" block>
          Yes
        </Button>,
      ),
    ).toContain("w-full h-12 md:w-auto md:h-10");
  });
});

describe("IconButton", () => {
  it("carries the aria-label and the same title", () => {
    const out = html(<IconButton icon={Check} tone="ok" aria-label="Confirm (Y)" />);
    expect(out).toContain('aria-label="Confirm (Y)"');
    expect(out).toContain('title="Confirm (Y)"');
    expect(out).toContain("wl-iconbtn wl-iconbtn--ok");
  });
});

describe("StatusChip presets", () => {
  it("gives every match status a label and an icon", () => {
    for (const status of Object.keys(MATCH_STATES) as MatchStatus[]) {
      const out = html(<MatchStatusChip status={status} />);
      expect(out).toContain(`wl-chip--${MATCH_STATES[status].tone}`);
      expect(out).toContain(MATCH_STATES[status].label);
      expect(out).toContain("<svg");
    }
    expect(Object.keys(MATCH_STATES)).toHaveLength(7);
  });
  it("gives every event state a label and an icon", () => {
    for (const state of Object.keys(EVENT_STATES) as EventReviewState[]) {
      const out = html(<EventStatusChip state={state} />);
      expect(out).toContain(EVENT_STATES[state].label);
      expect(out).toContain("<svg");
    }
    expect(html(<EventStatusChip state="pending_review" />)).toContain("wl-chip--warn");
  });
});

describe("ConsentBadge", () => {
  it.each([
    ["scout_visible", "ok", "Scout-visible"],
    ["club_only", "neutral", "Club only"],
    ["requested", "warn", "Requested"],
    ["withdrawn", "danger", "Withdrawn"],
    ["none", "neutral", "No consent"],
  ] as const)("maps %s", (state, tone, label) => {
    const out = html(<ConsentBadge state={state} />);
    expect(out).toContain(`wl-chip wl-chip--${tone}`);
    expect(out).toContain(label);
    expect(out.includes("<svg")).toBe(state !== "none");
  });
});

describe("ConfidenceMeter", () => {
  it("is low below the threshold, not at it", () => {
    expect(html(<ConfidenceMeter score={0.68} threshold={0.75} />)).toContain("wl-conf--low");
    expect(html(<ConfidenceMeter score={0.75} threshold={0.75} />)).not.toContain("wl-conf--low");
  });
  it("shows the words below threshold only in detail views", () => {
    const detail = html(<ConfidenceMeter score={0.58} threshold={0.75} detail />);
    expect(detail).toContain("0.58");
    // Set in the sans caption style and kept on one line.
    expect(detail).toContain('<span class="caption whitespace-nowrap"> below threshold</span>');
    const plain = html(<ConfidenceMeter score={0.58} threshold={0.75} />);
    expect(plain).not.toContain("below threshold");
    expect(plain).toContain('<span class="sr-only">, under auto-accept threshold</span>');
  });
  it("sizes the fill from the score and hides the track", () => {
    const out = html(<ConfidenceMeter score={0.93} threshold={0.75} />);
    expect(out).toContain("width:93%");
    expect(out).toContain('class="wl-conf__track" aria-hidden="true"');
    expect(out).toContain('<span class="sr-only">Confidence </span>0.93');
  });
  it("clamps out-of-range scores", () => {
    expect(html(<ConfidenceMeter score={1.4} threshold={0.75} />)).toContain("width:100%");
  });
});

describe("TeamMarker", () => {
  it("marks home with H and away with A, plus words for screen readers", () => {
    const home = html(<TeamMarker side="home" name="Orlando Pirates U17" />);
    expect(home).toContain("wl-team wl-team--home");
    expect(home).toContain('<span class="wl-team__mark" aria-hidden="true">H</span>');
    expect(home).toContain('<span class="sr-only">Home side: </span>Orlando Pirates U17');
    const away = html(<TeamMarker side="away" name="SuperSport Academy U17" />);
    expect(away).toContain("wl-team--away");
    expect(away).toContain('aria-hidden="true">A</span>');
    expect(away).toContain("Away side: ");
  });
});

describe("ExpiryBanner", () => {
  it("warns with role=status at 2 days", () => {
    const out = html(<ExpiryBanner expiresAt={at(48 * HOUR)} now={now} />);
    expect(out).toContain('role="status"');
    expect(out).not.toContain("wl-banner--danger");
    expect(out).toContain("Footage deleted in 2 days.");
  });
  it("alerts with role=alert at 6 hours", () => {
    const out = html(
      <ExpiryBanner expiresAt={at(6 * HOUR)} now={now}>
        Claim it now.
      </ExpiryBanner>,
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain("wl-banner wl-banner--danger");
    expect(out).toContain("<b>Footage deleted in 6 hours.</b> Claim it now.");
  });
  it("renders nothing at 5 days", () => {
    expect(html(<ExpiryBanner expiresAt={at(120 * HOUR)} now={now} />)).toBe("");
  });
  it("says due now once past", () => {
    expect(html(<ExpiryBanner expiresAt={at(-HOUR)} now={now} />)).toContain(
      "Footage is due for deletion now.",
    );
    expect(html(<ExpiryLabel expiresAt={at(-HOUR)} now={now} />)).toContain("Due now");
  });
  it("labels queue rows with tone and time left", () => {
    expect(html(<ExpiryLabel expiresAt={at(48 * HOUR)} now={now} />)).toContain("wl-chip--warn");
    const danger = html(<ExpiryLabel expiresAt={at(6 * HOUR)} now={now} />);
    expect(danger).toContain("wl-chip--danger");
    expect(danger).toContain('<span class="sr-only">Footage deleted in </span>6 hours');
    expect(html(<ExpiryLabel expiresAt={at(120 * HOUR)} now={now} />)).toBe("");
  });
});

describe("StatTile", () => {
  it("flags a small sample under 3 matches", () => {
    const out = html(<StatTile label="Shots on target" value="71" unit="%" matches={2} />);
    expect(out).toContain("wl-stat__sample--small");
    expect(out).toContain("Small sample · 2 matches");
    expect(out).toContain("71");
  });
  it("states matches and minutes", () => {
    const out = html(<StatTile label="Goals per 90" value="0.62" matches={7} minutes={612} />);
    expect(out).toContain("Based on 7 matches · 612 min");
    expect(out).not.toContain("--small");
    expect(out).toMatch(/^<div class="wl-card wl-stat"/);
  });
  it("is a link when href is set", () => {
    expect(html(<StatTile label="Shots" value="2.1" matches={7} href="/x" />)).toMatch(
      /^<a [^>]*href="\/x"/,
    );
  });
  it("says 1 match and hides a stat with no matches", () => {
    expect(html(<StatTile label="Goals" value="1" matches={1} />)).toContain(
      "Small sample · 1 match<",
    );
    expect(html(<StatTile label="Goals" value="0" matches={0} />)).toBe("");
  });
});

describe("PlayerCard", () => {
  const base = {
    name: "Thabo Nkosi",
    position: "Winger",
    ageGroup: "U17",
    foot: "left" as const,
    href: "/players/1",
    stats: [
      { label: "Matches", value: "14" },
      { label: "Goals per 90", value: "0.62" },
      { label: "Shots per 90", value: "2.1" },
      { label: "Distance", value: "8.4 km" },
      { label: "Headers won", value: "61%" },
    ],
  };
  it("builds initials from the first and last words", () => {
    expect(initials("Thabo Nkosi")).toBe("TN");
    expect(initials("Lebo Ann Mokoena")).toBe("LM");
    expect(initials("thabo")).toBe("T");
  });
  it("shows at most 4 stats", () => {
    const out = html(<PlayerCard {...base} currentClub="Orlando Pirates Academy" />);
    expect(count(out, "<b>")).toBe(4);
    expect(out).not.toContain("Headers won");
    expect(out).toContain("Winger · U17 · Left foot · Orlando Pirates Academy");
  });
  it("shows the former club, or no current club", () => {
    expect(html(<PlayerCard {...base} formerClub="Kaizer Chiefs Academy" />)).toContain(
      "Former club: Kaizer Chiefs Academy",
    );
    expect(html(<PlayerCard {...base} />)).toContain("No current club");
  });
  it("shows the consent badge only when consent is passed", () => {
    expect(html(<PlayerCard {...base} />)).not.toContain("wl-chip");
    expect(html(<PlayerCard {...base} consent="scout_visible" />)).toContain("Scout-visible");
  });
  it("links the whole card through the name and labels the menu", () => {
    const out = html(<PlayerCard {...base} />);
    expect(out).toContain('href="/players/1"');
    expect(out).toContain("after:absolute after:inset-0");
    expect(out).toContain('aria-label="More actions for Thabo Nkosi"');
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).toContain('aria-expanded="false"');
  });
});

describe("ReviewEventRow", () => {
  const row = {
    time: "31:24",
    type: "Shot on target",
    side: "home" as const,
    who: { kind: "player" as const, number: 7, name: "Thabo Nkosi" },
    confidence: 0.68,
    threshold: 0.75,
  };
  it("sets aria-current only on the current row", () => {
    expect(html(<ReviewEventRow {...row} state="pending" current />)).toContain(
      'aria-current="true"',
    );
    expect(html(<ReviewEventRow {...row} state="pending" />)).not.toContain("aria-current");
  });
  it("names each shortcut in the pending actions", () => {
    const out = html(<ReviewEventRow {...row} state="pending" />);
    expect(out).toContain('aria-label="Confirm (Y)"');
    expect(out).toContain('aria-label="Edit (E)"');
    expect(out).toContain('aria-label="Reject (N)"');
    expect(out).toContain("#7 Thabo Nkosi");
    expect(out).toContain("wl-conf");
  });
  it("keeps a pending_review row actionable, with no chip", () => {
    const out = html(<ReviewEventRow {...row} state="pending_review" />);
    expect(out).toContain('aria-label="Confirm (Y)"');
    expect(out).toContain('aria-label="Edit (E)"');
    expect(out).toContain('aria-label="Reject (N)"');
    expect(out).not.toContain("wl-chip");
  });
  it("collapses a handled row into a chip with no buttons", () => {
    const out = html(<ReviewEventRow {...row} state="confirmed" note="corrected" />);
    expect(out).toContain("wl-chip wl-chip--ok");
    expect(out).toContain("Confirmed");
    expect(out).toContain(" · corrected");
    expect(out).not.toContain("<button");
    expect(out).toContain('<span aria-hidden="true"></span>');
  });
  it("reads an unlinked track", () => {
    expect(
      html(
        <ReviewEventRow
          {...row}
          side="away"
          who={{ kind: "track", trackId: 22 }}
          state="pending"
        />,
      ),
    ).toContain("Unlinked track 22");
  });
});

describe("PitchHeatmap", () => {
  const zones = [
    [0.01, 0.01, 0.03, 0.03, 0.05, 0.03],
    [0.01, 0.03, 0.05, 0.07, 0.09, 0.07],
    [0.01, 0.03, 0.05, 0.05, 0.07, 0.05],
    [0, 0.01, 0.01, 0.03, 0.03, 0.01],
  ];
  it("is an image with a label and one rect per non-zero zone", () => {
    const out = html(<PitchHeatmap zones={zones} label="Heatmap: left of centre" matches={7} />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Heatmap: left of centre"');
    expect(count(out, /class="h[1-5]"/g)).toBe(23);
    expect(out).toContain('class="h5" x="70" y="17" width="17.5" height="17"');
  });
  it("buckets shares 1 to 5", () => {
    expect(heatLevel(0, 0.09)).toBe(0);
    expect(heatLevel(0.01, 0.09)).toBe(1);
    expect(heatLevel(0.03, 0.09)).toBe(2);
    expect(heatLevel(0.05, 0.09)).toBe(3);
    expect(heatLevel(0.07, 0.09)).toBe(4);
    expect(heatLevel(0.09, 0.09)).toBe(5);
    expect(heatLevel(0.06, 0.1)).toBe(3);
  });
  it("states the direction and the sample in the legend", () => {
    const out = html(<PitchHeatmap zones={zones} label="x" matches={7} />);
    expect(out).toContain("attacking left to right");
    expect(out).toContain("· 7 matches");
    expect(count(out, /<i aria-hidden="true"/g)).toBe(5);
    expect(html(<PitchHeatmap zones={zones} label="x" matches={2} />)).toContain(
      "· Small sample · 2 matches",
    );
  });
  it("shows an empty pitch with no data", () => {
    const out = html(<PitchHeatmap zones={[[0, 0]]} label="x" matches={0} />);
    expect(out).toContain('aria-label="Pitch: no position data yet"');
    expect(out).toContain("No position data yet.");
    expect(out).not.toContain("wl-legend");
  });
  it("draws average positions with side letters and a key", () => {
    const out = html(
      <AveragePositionMap
        players={[
          { side: "home", label: "7", x: 78, y: 22 },
          { side: "away", label: "9", x: 40, y: 34 },
        ]}
        label="Average positions"
        matches={7}
        home="Orlando Pirates U17"
        away="SuperSport Academy U17"
      />,
    );
    expect(out).toContain('class="dot-home"');
    expect(out).toContain('class="dot-away"');
    expect(out).toContain(">H7</text>");
    expect(out).toContain("Home side: </span>Orlando Pirates U17");
  });
});

describe("Cover", () => {
  it("renders the tagline, honours titleAs and hides the art", () => {
    const out = html(<Cover titleAs="p" />);
    expect(out).toContain('<p class="wl-cover__name display-xl">Wideline</p>');
    expect(out).toContain("Every match filmed. Every player findable.");
    expect(out).toContain('class="wl-cover__art" aria-hidden="true"');
    expect(html(<Cover />)).toContain('<h1 class="wl-cover__name display-xl">');
  });
});
