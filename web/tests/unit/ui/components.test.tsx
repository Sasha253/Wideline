import { Check } from "lucide-react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfidenceMeter } from "@/components/ui/ConfidenceMeter";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { Cover } from "@/components/ui/Cover";
import { ExpiryBanner, ExpiryLabel } from "@/components/ui/ExpiryBanner";
import { ExpiryChip } from "@/components/ui/ExpiryChip";
import { MiniPitch } from "@/components/ui/MiniPitch";
import {
  AveragePositionMap,
  heatLevel,
  heatStep,
  PitchHeatmap,
} from "@/components/ui/PitchHeatmap";
import { initials, PlayerCard } from "@/components/ui/PlayerCard";
import { ReviewEventRow } from "@/components/ui/ReviewEventRow";
import { StatStrip, StatTile } from "@/components/ui/StatTile";
import {
  EVENT_STATES,
  StatusChip,
  EventStatusChip,
  INVITATION_STATES,
  InvitationStatusChip,
  MATCH_STATES,
  MatchStatusChip,
  ORGANISATION_STATES,
  OrganisationStatusChip,
  SCOUT_STATES,
  ScoutStatusChip,
  type EventReviewState,
  type InvitationState,
} from "@/components/ui/StatusChip";
import { TeamMarker } from "@/components/ui/TeamMarker";
import type { MatchStatus, OrganisationStatus, ScoutStatus } from "@/generated/prisma/enums";

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
    expect(out).toContain('class="wl-btn wl-btn--danger wl-btn--s"');
    expect(out).toContain('type="button"');
    expect(html(<Button variant="primary">Confirm</Button>)).toContain("wl-btn--m");
    expect(
      html(
        <Button variant="primary" size="xl">
          Continue
        </Button>,
      ),
    ).toContain("wl-btn--xl");
  });
  it("renders disabled as aria-disabled, so it stays focusable", () => {
    const out = html(
      <Button variant="primary" disabled>
        Claim match
      </Button>,
    );
    expect(out).toContain('aria-disabled="true"');
    expect(out).not.toMatch(/<button[^>]* disabled=""/);
  });
  it("shows a spinner and Saving while loading, by variant", () => {
    const out = html(
      <Button variant="primary" icon={Check} loading>
        Confirm
      </Button>,
    );
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("wl-spin");
    expect(out).toMatch(/Saving<\/button>/);
    expect(out).not.toContain("Confirm");
    expect(
      html(
        <Button variant="danger" loading>
          Delete upload
        </Button>,
      ),
    ).toContain("Deleting");
    expect(
      html(
        <Button variant="secondary" loading loadingLabel="Sending">
          Send
        </Button>,
      ),
    ).toContain("Sending");
  });
  it("puts the Kbd inside the label and hides the icon", () => {
    const out = html(
      <Button variant="primary" icon={Check} kbd="Y">
        Confirm
      </Button>,
    );
    expect(out).toMatch(/Confirm<kbd class="wl-kbd">Y<\/kbd><\/button>/);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('stroke-width="1.8"');
  });
  it("goes full width on phones when block", () => {
    expect(
      html(
        <Button variant="primary" block>
          Yes
        </Button>,
      ),
    ).toContain("wl-btn--block");
  });
});

describe("IconButton", () => {
  it("carries the aria-label and the same title", () => {
    const out = html(<IconButton icon={Check} tone="ok" aria-label="Confirm (Y)" />);
    expect(out).toContain('aria-label="Confirm (Y)"');
    expect(out).toContain('title="Confirm (Y)"');
    expect(out).toContain("wl-iconbtn wl-iconbtn--ok");
  });
  it("has ghost and size variants", () => {
    const out = html(<IconButton icon={Check} variant="ghost" size="l" aria-label="Close" />);
    expect(out).toContain("wl-iconbtn wl-iconbtn--ghost wl-iconbtn--l");
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
  it("codes the match states by shape, with the design's words", () => {
    expect(MATCH_STATES.draft).toMatchObject({ tone: "neutral", label: "Draft" });
    expect(MATCH_STATES.uploading.tone).toBe("system");
    expect(MATCH_STATES.processing.tone).toBe("system");
    expect(MATCH_STATES.awaiting_review).toMatchObject({ tone: "warn", label: "Ready for review" });
    expect(MATCH_STATES.in_review).toMatchObject({ tone: "new", label: "In review" });
    expect(MATCH_STATES.published).toMatchObject({ tone: "ok", label: "Reviewed" });
    expect(MATCH_STATES.failed.tone).toBe("danger");
    expect(html(<StatusChip kind="match" status="ready" />)).toContain("Ready for review");
    expect(html(<StatusChip kind="match" status="processing" />)).toContain("wl-spin");
  });
  it("shows live progress inside the chip", () => {
    const out = html(<MatchStatusChip status="uploading" progress={61.6} />);
    expect(out).toContain('<span class="wl-chip__num">62%</span>');
  });
  it("gives every event state a label and an icon", () => {
    for (const state of Object.keys(EVENT_STATES) as EventReviewState[]) {
      const out = html(<EventStatusChip state={state} />);
      expect(out).toContain(EVENT_STATES[state].label);
      expect(out).toContain("<svg");
    }
    expect(html(<EventStatusChip state="pending_review" />)).toContain("wl-chip--warn");
  });
  it("strikes through a rejected event only", () => {
    expect(html(<EventStatusChip state="rejected" />)).toContain(
      '<s class="wl-chip__struck">Rejected</s>',
    );
    expect(html(<EventStatusChip state="confirmed" />)).not.toContain("<s ");
  });
  it("draws the s size and the disc with the word as its name", () => {
    expect(html(<EventStatusChip state="pending" size="s" />)).toContain(
      "wl-chip wl-chip--warn wl-chip--s",
    );
    const disc = html(<EventStatusChip state="confirmed" size="disc" />);
    expect(disc).toContain('role="img"');
    expect(disc).toContain('aria-label="Confirmed"');
    expect(disc).toContain('title="Confirmed"');
    expect(disc).toContain("wl-chip--disc");
  });
});

describe("ConsentBadge", () => {
  it.each([
    ["scout_visible", "ok", "Consent given"],
    ["given", "ok", "Consent given"],
    ["club_only", "ok-subtle", "Club only"],
    ["requested", "warn", "Awaiting consent"],
    ["awaiting", "warn", "Awaiting consent"],
    ["withdrawn", "danger", "Consent withdrawn"],
    ["none", "neutral", "Not requested"],
  ] as const)("maps %s", (state, tone, label) => {
    const out = html(<ConsentBadge state={state} />);
    expect(out).toContain(`wl-chip wl-chip--${tone}`);
    expect(out).toContain(label);
    expect(out).toContain("<svg");
  });
  it("uses the short word in tables", () => {
    expect(html(<ConsentBadge state="scout_visible" size="s" />)).toMatch(/wl-chip--s".*Given</);
  });
  it("names the icon-only form", () => {
    const out = html(<ConsentBadge state="withdrawn" iconOnly />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Consent withdrawn"');
    expect(out).toContain('title="Consent withdrawn"');
    expect(out).not.toContain("line-through");
  });
  it("adds the date in the hero form", () => {
    const out = html(<ConsentBadge state="scout_visible" date="2 Sep 2026" />);
    expect(out).toContain('<span class="wl-consent-dated__state">Given</span>');
    expect(out).toContain('<span class="wl-consent-dated__date">2 Sep 2026</span>');
  });
});

describe("ConfidenceMeter", () => {
  it("is low under 0.50, not at it", () => {
    const low = html(<ConfidenceMeter value={0.42} />);
    expect(low).toContain("wl-conf--low");
    expect(low).toContain("Low</span>");
    expect(html(<ConfidenceMeter value={0.5} />)).not.toContain("wl-conf--low");
  });
  it("fills ten segments from the value and shows two decimals", () => {
    const out = html(<ConfidenceMeter value={0.66} />);
    expect(count(out, /wl-conf__seg--on/g)).toBe(7);
    expect(count(out, /class="wl-conf__seg[" ]/g)).toBe(10);
    expect(out).toContain('class="wl-conf__track" aria-hidden="true"');
    expect(out).toContain('<span class="sr-only">Confidence </span>0.66');
  });
  it("accepts the deprecated score prop and clamps", () => {
    const out = html(<ConfidenceMeter score={1.4} threshold={0.75} />);
    expect(out).toContain("1.00");
    expect(count(out, /wl-conf__seg--on/g)).toBe(10);
  });
  it("shows the large form with its label and the low chip", () => {
    const out = html(<ConfidenceMeter value={0.42} size="large" />);
    expect(out).toContain("Model confidence");
    expect(out).toContain("Low · check first");
  });
  it("says who added a manual event", () => {
    expect(html(<ConfidenceMeter manual />)).toContain("Added by scout");
    expect(
      html(<ConfidenceMeter manual size="large" addedBy="Nomvula Mthembu" addedAt="31:40" />),
    ).toContain("Added by Nomvula Mthembu at 31:40");
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
  it("takes the letters and the four sizes", () => {
    const bare = html(<TeamMarker side="A" size={32} />);
    expect(bare).toContain('role="img"');
    expect(bare).toContain('aria-label="Away side"');
    expect(bare).toContain("wl-team__mark wl-team__mark--32");
  });
});

describe("ExpiryBanner", () => {
  it("is neutral with every step when given deletesAt", () => {
    const out = html(<ExpiryBanner deletesAt={at(12 * 24 * HOUR)} now={now} />);
    expect(out).toContain("wl-expiry wl-expiry--neutral");
    expect(out).toContain('role="status"');
    expect(out).toContain("Raw footage for this match is kept until 3 Nov 2025.");
    expect(out).toContain("12 d left");
  });
  it("is pending with role=status from 3 days down", () => {
    const out = html(<ExpiryBanner deletesAt={at(46 * HOUR)} now={now} />);
    expect(out).toContain("wl-expiry--pending");
    expect(out).toContain('role="status"');
    expect(out).toContain(
      "Raw footage for this match is deleted in 2 days. Review it before then to add missed events.",
    );
    expect(out).toContain("1 d 22 h left");
  });
  it("alerts under 24 hours, and children replace the consequence", () => {
    const out = html(
      <ExpiryBanner deletesAt={at(8 * HOUR + 41 * 60_000)} now={now}>
        Claim it now.
      </ExpiryBanner>,
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain("wl-expiry--urgent");
    expect(out).toContain("Raw footage for this match is deleted in 9 hours. Claim it now.");
    expect(out).toContain("8 h 41 m left");
  });
  it("hides the minute countdown from screen readers", () => {
    const out = html(<ExpiryBanner deletesAt={at(6 * HOUR)} now={now} />);
    expect(out).toContain('<span class="wl-expiry__left" aria-hidden="true">');
  });
  it("shows the lock once deleted", () => {
    const out = html(<ExpiryBanner deletesAt={at(-HOUR)} now={now} />);
    expect(out).toContain("wl-expiry--deleted");
    expect(out).toContain(
      "Raw footage was deleted on 22 Oct 2025. Confirmed clips are kept. Missed events can no longer be added.",
    );
  });
  it("keeps the old rule for the deprecated expiresAt: nothing above 72 hours", () => {
    expect(html(<ExpiryBanner expiresAt={at(120 * HOUR)} now={now} />)).toBe("");
    expect(html(<ExpiryBanner expiresAt={at(48 * HOUR)} now={now} />)).toContain(
      "wl-expiry--pending",
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

describe("ExpiryChip", () => {
  it.each([
    [12 * 24 * HOUR, "neutral", "12 d", "Footage deleted in 12 days"],
    [46 * HOUR, "pending", "1 d 22 h", "Footage deleted in 1 day 22 hours"],
    [8 * HOUR + 41 * 60_000, "urgent", "8 h 41 m", "Footage deleted in 8 hours 41 minutes"],
  ])("at %i ms is %s: %s", (ms, step, short, words) => {
    const out = html(<ExpiryChip deletesAt={at(ms)} now={now} />);
    expect(out).toContain(`wl-xchip wl-xchip--${step}`);
    expect(out).toContain(`<span aria-hidden="true">${short}</span>`);
    expect(out).toContain(`<span class="sr-only">${words}</span>`);
    expect(out).not.toMatch(/role="(status|alert)"/);
  });
  it("says Footage deleted with a lock once gone", () => {
    const out = html(<ExpiryChip deletesAt={at(HOUR)} now={now} deleted />);
    expect(out).toContain("wl-xchip--deleted");
    expect(out).toContain("Footage deleted");
  });
});

describe("StatTile", () => {
  it("shows the figure, the rate, the sample and the clip link", () => {
    const out = html(
      <StatTile
        label="Shots"
        value="14"
        rate="2.06 per 90"
        matches={8}
        clipHref="/clips"
        linkLabel="14 clips"
      />,
    );
    expect(out).toMatch(/^<a [^>]*href="\/clips"/);
    expect(out).toContain('class="wl-stat"');
    expect(out).toContain('<span class="wl-stat__value">14</span>');
    expect(out).toContain("<span>2.06 per 90</span>");
    expect(out).toContain('<span class="wl-stat__sample">based on 8 matches</span>');
    expect(out).toContain("14 clips");
    expect(out).not.toContain("Small sample");
  });
  it("flags a small sample under 3 matches with the dashed edge", () => {
    const out = html(<StatTile label="Key passes" value="2" rate="0.62 per 90" matches={2} />);
    expect(out).toContain("wl-stat wl-stat--small");
    expect(out).toContain("Small sample");
    expect(out).toContain("based on 2 matches");
  });
  it("puts the unit beside the value", () => {
    const out = html(<StatTile label="Distance covered" value="62.0" unit="km" matches={8} />);
    expect(out).toContain('<span class="wl-stat__unit">km</span>');
    expect(out).toMatch(/^<div class="wl-stat"/);
  });
  it("keeps the deprecated href and minutes", () => {
    expect(html(<StatTile label="Shots" value="2.1" matches={7} href="/x" />)).toMatch(
      /^<a [^>]*href="\/x"/,
    );
    expect(
      html(<StatTile label="Goals per 90" value="0.62" matches={7} minutes={612} />),
    ).toContain("based on 7 matches · 612 min");
  });
  it("says Not recorded yet with the reason, and never shows an unmeasured 0", () => {
    const out = html(
      <StatTile label="Sprints" matches={0} reason="Needs a full-pitch camera angle." />,
    );
    expect(out).toContain("Not recorded yet");
    expect(out).toContain("Needs a full-pitch camera angle.");
    expect(out).toContain("wl-stat--quiet");
    expect(html(<StatTile label="Goals" value="0" matches={0} />)).toBe("");
  });
  it("loads as static blocks", () => {
    const out = html(<StatTile label="Passes completed" matches={0} loading />);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("wl-block");
  });
  it("lays a strip of tiles edge to edge", () => {
    const out = html(
      <StatStrip columns={4} label="Season stats">
        <StatTile label="Goals" value="3" matches={8} />
      </StatStrip>,
    );
    expect(out).toContain('role="group"');
    expect(out).toContain("--wl-strip-cols:4");
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
  it("shows initials, the meta line, the club and at most 3 figures", () => {
    const out = html(<PlayerCard {...base} number={7} currentClub="Orlando Pirates Academy" />);
    expect(out).toContain('<span class="wl-avatar" aria-hidden="true">TN</span>');
    expect(count(out, "<b>")).toBe(3);
    expect(out).not.toContain("Distance");
    expect(out).toContain("Winger · U17 · No. 7");
    expect(out).toContain("Orlando Pirates Academy");
    expect(out).not.toContain("<img");
  });
  it("gives scouts the shortlist toggle with aria-pressed, never the consent badge", () => {
    const off = html(<PlayerCard {...base} viewer="scout" onToggleShortlist={() => {}} />);
    expect(off).toContain('aria-label="Add to shortlist"');
    expect(off).toContain('aria-pressed="false"');
    expect(off).not.toContain("wl-chip");
    const on = html(
      <PlayerCard
        {...base}
        viewer="scout"
        shortlisted
        shortlistName="Midfield U17"
        onToggleShortlist={() => {}}
      />,
    );
    expect(on).toContain('aria-label="On Midfield U17"');
    expect(on).toContain('aria-pressed="true"');
  });
  it("gives club staff the consent badge instead of the toggle", () => {
    const out = html(<PlayerCard {...base} consent="requested" onToggleShortlist={() => {}} />);
    expect(out).toContain("wl-chip");
    expect(out).not.toContain("aria-pressed");
  });
  it("puts the sample in the footer and flags a small one", () => {
    const out = html(<PlayerCard {...base} sample="8 matches · 2026 season" matches={8} />);
    expect(out).toContain("8 matches · 2026 season");
    expect(out).not.toContain("Small sample");
    expect(html(<PlayerCard {...base} matches={2} />)).toContain("Small sample");
  });
  it("shows the departure and no figures for a departed player", () => {
    const out = html(<PlayerCard {...base} viewer="club" departed={{ on: "14 Aug 2026" }} />);
    expect(out).toContain(
      "Left the club on 14 Aug 2026. Stats stay with the club, and scouts can no longer see them.",
    );
    expect(out).toContain("Former player");
    expect(count(out, "<b>")).toBe(0);
  });
  it("loads in the same footprint", () => {
    expect(html(<PlayerCard {...base} loading />)).toContain('aria-busy="true"');
  });
  it("shows the former club, or no current club", () => {
    expect(html(<PlayerCard {...base} formerClub="Kaizer Chiefs Academy" />)).toContain(
      "Former club: Kaizer Chiefs Academy",
    );
    expect(html(<PlayerCard {...base} />)).toContain("No current club");
  });
  it("shows the consent badge only when consent is passed", () => {
    expect(html(<PlayerCard {...base} />)).not.toContain("wl-chip");
    expect(html(<PlayerCard {...base} consent="scout_visible" />)).toContain("Consent given");
  });
  it("links the whole card through the name", () => {
    const out = html(<PlayerCard {...base} />);
    expect(out).toMatch(/<a [^>]*href="\/players\/1"/);
    expect(out).toContain("wl-pcard__link");
  });
});

describe("ReviewEventRow", () => {
  const row = {
    time: "31:24",
    type: "Goal",
    side: "home" as const,
    who: { kind: "player" as const, number: 8, name: "S. Ndlovu" },
    confidence: 0.81,
  };
  const noop = () => {};
  it("draws time, H/A, type, who, a 10-segment meter and the status disc", () => {
    const out = html(<ReviewEventRow {...row} state="pending" />);
    expect(out).toContain('<span class="wl-erow__time">31:24</span>');
    expect(out).toContain('<span aria-hidden="true">H</span><span class="sr-only">Home</span>');
    expect(out).toContain("8 S. Ndlovu");
    expect(count(out, /<i data-on=""/g)).toBe(8);
    expect(count(out, /<i/g)).toBe(10);
    expect(out).toContain("0.81");
    expect(out).toContain("wl-disc wl-disc--pending");
    expect(out).not.toContain("aria-current");
  });
  it("opens the selected row with Confirm Y, Reject N and Edit E", () => {
    const out = html(
      <ReviewEventRow
        {...row}
        state="pending"
        selected
        facts={["Ball over the line at 31:24.6", "Scorer matched by shirt number"]}
        onSelect={noop}
        onConfirm={noop}
        onReject={noop}
        onEdit={noop}
      />,
    );
    expect(out).toContain('aria-current="true"');
    expect(out).toContain("wl-erow--selected");
    expect(out).toContain('aria-expanded="true"');
    expect(out).toMatch(/aria-keyshortcuts="Y".*Confirm.*<kbd aria-hidden="true">Y<\/kbd>/);
    expect(out).toMatch(/aria-keyshortcuts="N".*Reject/);
    expect(out).toMatch(/aria-keyshortcuts="E".*Edit/);
    expect(out).toContain("Ball over the line at 31:24.6");
  });
  it("keeps actions closed until the row is selected", () => {
    const out = html(<ReviewEventRow {...row} state="pending" onConfirm={noop} />);
    expect(out).not.toContain("Confirm");
  });
  it("accepts the deprecated current and threshold", () => {
    const out = html(
      <ReviewEventRow {...row} threshold={0.75} state="pending" current onConfirm={noop} />,
    );
    expect(out).toContain('aria-current="true"');
    expect(out).toContain("Confirm");
  });
  it("strikes a rejected row through and keeps it in place", () => {
    const out = html(<ReviewEventRow {...row} state="rejected" />);
    expect(out).toContain("wl-erow--rejected");
    expect(out).toContain("wl-disc--rejected");
    expect(out).toContain('<span class="sr-only"> (rejected)</span>');
  });
  it("turns the meter pending under 0.50", () => {
    expect(html(<ReviewEventRow {...row} confidence={0.42} state="pending" />)).toContain(
      "wl-meter wl-meter--low",
    );
    expect(html(<ReviewEventRow {...row} confidence={0.5} state="pending" />)).not.toContain(
      "wl-meter--low",
    );
  });
  it("says Edited, flashes when saved, and shows Scout for a scout's event", () => {
    const out = html(
      <ReviewEventRow {...row} state="confirmed" edited editedFrom="4 L. Mahlangu" saved />,
    );
    expect(out).toContain('title="was 4 L. Mahlangu"');
    expect(out).toContain("Edited");
    expect(out).toContain("wl-erow--saved");
    expect(out).toContain("wl-disc--confirmed");
    const scout = html(<ReviewEventRow {...row} confidence={null} source="scout" state="manual" />);
    expect(scout).toContain("Scout");
    expect(scout).not.toContain("wl-meter");
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
  it("is an image with a text alternative and one grid cell per zone", () => {
    const out = html(<PitchHeatmap zones={zones} label="Heatmap: left of centre" matches={7} />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Heatmap: left of centre"');
    // The legend's five swatches follow the grid; count the grid only.
    const grid = out.split("wl-heatlegend")[0]!;
    expect(count(grid, /<i( data-h="\d")?><\/i>/g)).toBe(24);
    expect(count(grid, /data-h="5"/g)).toBe(1);
    expect(out).toContain("--wl-heat-cols:6;--wl-heat-rows:4");
    expect(out).toContain('data-theme="dark"');
  });
  it("uses the fixed ramp: shares of minutes, not relative to the player", () => {
    expect(heatStep(0)).toBe(0);
    expect(heatStep(0.01)).toBe(1);
    expect(heatStep(0.02)).toBe(2);
    expect(heatStep(0.05)).toBe(3);
    expect(heatStep(0.06)).toBe(4);
    expect(heatStep(0.08)).toBe(5);
    expect(heatStep(0.5)).toBe(5);
    expect(heatLevel(0.06, 0.1)).toBe(3);
  });
  it("always shows the legend and the sample", () => {
    const out = html(<PitchHeatmap zones={zones} label="x" matches={8} minutes={612} />);
    expect(out).toContain("Share of minutes");
    expect(out).toContain("8% and over");
    expect(out).toContain("8 matches · 612 min");
    expect(out).toContain("ATTACK →");
    const small = html(<PitchHeatmap zones={zones} label="x" matches={2} minutes={128} />);
    expect(small).toContain("wl-pitchbox--small");
    expect(small).toContain("Small sample · based on 2 matches · 128 min");
  });
  it("shows the no-data variant", () => {
    const out = html(<PitchHeatmap zones={[[0, 0]]} label="x" matches={0} />);
    expect(out).toContain('aria-label="Pitch: no tracked minutes yet"');
    expect(out).toContain("No tracked minutes yet");
    expect(out).not.toContain("wl-heatlegend");
  });
  it("links the halves when asked", () => {
    const out = html(
      <PitchHeatmap
        zones={zones}
        label="x"
        matches={8}
        half="first"
        halfHref={(h) => `?half=${h}`}
      />,
    );
    expect(out).toMatch(
      /href="\?half=first" aria-current="true"|aria-current="true" href="\?half=first"/,
    );
    expect(out).toContain("2nd half");
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
    expect(out).toContain("Orlando Pirates U17");
  });
});

describe("MiniPitch", () => {
  it("marks the usual position in lime and the others outlined, with a key", () => {
    const out = html(
      <MiniPitch
        usual={{ x: 48, y: 34, label: "CM" }}
        also={[
          { x: 38, y: 34, label: "DM" },
          { x: 63, y: 28, label: "AM" },
        ]}
      />,
    );
    expect(count(out, /wl-diamond--usual/g)).toBe(1);
    expect(count(out, /wl-diamond--also/g)).toBe(2);
    expect(out).toContain("Usual position · CM");
    expect(out).toContain("Also played · DM, AM");
  });
  it("names the pitch itself without the key", () => {
    const out = html(<MiniPitch usual={{ x: 48, y: 34, label: "CM" }} legend={false} />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Usual position · CM"');
  });
});

describe("Cover", () => {
  it("renders the tagline, honours titleAs and hides the art", () => {
    const out = html(<Cover titleAs="p" />);
    expect(out).toContain('<p class="wl-cover__name">Wideline</p>');
    expect(out).toContain("Every match filmed. Every player findable.");
    expect(out).toContain('class="wl-cover__art" aria-hidden="true"');
    expect(html(<Cover />)).toContain('<h1 class="wl-cover__name">');
  });
});

describe("InvitationStatusChip and OrganisationStatusChip", () => {
  const expected = {
    invitation: {
      pending: "Pending",
      expired: "Expired",
      accepted: "Accepted",
      revoked: "Revoked",
    },
    organisation: {
      pending: "Pending",
      active: "Active",
      rejected: "Rejected",
      suspended: "Suspended",
    },
    scout: {
      pending: "Awaiting approval",
      approved: "Approved",
      suspended: "Suspended",
      rejected: "Not approved",
    },
  };

  it.each(Object.keys(SCOUT_STATES) as ScoutStatus[])(
    "scout %s has a word and an icon",
    (status) => {
      const out = html(<ScoutStatusChip status={status} />);
      expect(out).toContain(expected.scout[status]);
      expect(out).toContain(`wl-chip--${SCOUT_STATES[status].tone}`);
      expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    },
  );

  it("uses the C02 tones for scout states", () => {
    expect(SCOUT_STATES.pending.tone).toBe("warn");
    expect(SCOUT_STATES.approved.tone).toBe("ok");
    expect(SCOUT_STATES.suspended.tone).toBe("danger");
    expect(SCOUT_STATES.rejected.tone).toBe("danger");
  });

  it.each(Object.keys(INVITATION_STATES) as InvitationState[])(
    "invitation %s has a word and an icon",
    (state) => {
      const out = html(<InvitationStatusChip state={state} />);
      expect(out).toContain(expected.invitation[state]);
      expect(out).toContain(`wl-chip--${INVITATION_STATES[state].tone}`);
      expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    },
  );

  it.each(Object.keys(ORGANISATION_STATES) as OrganisationStatus[])(
    "organisation %s has a word and an icon",
    (status) => {
      const out = html(<OrganisationStatusChip status={status} />);
      expect(out).toContain(expected.organisation[status]);
      expect(out).toContain(`wl-chip--${ORGANISATION_STATES[status].tone}`);
      expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    },
  );

  it("uses the tones from the design spec", () => {
    expect(INVITATION_STATES.pending.tone).toBe("warn");
    expect(INVITATION_STATES.expired.tone).toBe("neutral");
    expect(INVITATION_STATES.accepted.tone).toBe("ok");
    expect(INVITATION_STATES.revoked.tone).toBe("danger");
    expect(ORGANISATION_STATES.suspended.tone).toBe("danger");
  });
});
