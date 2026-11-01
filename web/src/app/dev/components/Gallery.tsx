import { Check, Inbox, Pencil, Plus, RotateCcw, Upload, WifiOff, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { DataListRow, DataTable, DataTablePagination } from "@/components/templates/DataTable";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { ConfidenceMeter } from "@/components/ui/ConfidenceMeter";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { Cover } from "@/components/ui/Cover";
import { ExpiryBanner } from "@/components/ui/ExpiryBanner";
import { ExpiryChip } from "@/components/ui/ExpiryChip";
import { iconProps } from "@/components/ui/icons";
import { Logo, LogoMark } from "@/components/ui/Logo";
import { MiniPitch } from "@/components/ui/MiniPitch";
import { AveragePositionMap, PitchHeatmap } from "@/components/ui/PitchHeatmap";
import { PlayerCard } from "@/components/ui/PlayerCard";
import { ReviewEventListHeader, ReviewEventRow } from "@/components/ui/ReviewEventRow";
import { StateMessage } from "@/components/ui/StateMessage";
import { StatStrip, StatTile } from "@/components/ui/StatTile";
import {
  CLAIM_STATES,
  ClaimStatusChip,
  ClubStatusChip,
  FOOTAGE_STATES,
  FootageChip,
  InvitationStatusChip,
  MatchStatusChip,
  OrganisationStatusChip,
  ScoutStatusChip,
  StatusChip,
  type FootageState,
  type MatchChipStatus,
} from "@/components/ui/StatusChip";
import { StepHeader } from "@/components/ui/StepHeader";
import { TeamMarker } from "@/components/ui/TeamMarker";
import { Select, TextArea, TextField } from "@/components/ui/TextField";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { NavLinks, type NavCounts } from "@/components/shell/NavLinks";
import { OrgSwitcher, type SwitcherOrganisation } from "@/components/shell/OrgSwitcher";
import { navForRoles, type NavItem } from "@/lib/nav";
import { Toast } from "@/components/ui/Toast";
import type { ConsentState, ReviewClaimStatus } from "@/generated/prisma/enums";
import { ModalDemo, SegmentedDemo, ShortlistCardDemo, TabsDemo } from "./GalleryDemos";
import {
  alsoSpots,
  averagePositions,
  AWAY_TEAM,
  CLUB_STATE_FIXTURES,
  heatmapZones,
  hoursFromNow,
  HOME_TEAM,
  INVITATION_STATE_FIXTURES,
  neutralExpiry,
  now,
  ORGANISATION_STATE_FIXTURES,
  pendingExpiry,
  SCOUT_STATE_FIXTURES,
  siphoFigures,
  thaboFigures,
  thinZones,
  urgentExpiry,
  usualSpot,
} from "./fixtures";

type Theme = "light" | "dark";

/** The match states in the order the design lists them. */
const MATCH_FIXTURES: { status: MatchChipStatus; progress?: number }[] = [
  { status: "draft" },
  { status: "uploading", progress: 62 },
  { status: "processing" },
  { status: "ready" },
  { status: "in_review" },
  { status: "reviewed" },
  { status: "failed" },
];

const CONSENT_STATES: ConsentState[] = ["scout_visible", "requested", "withdrawn", "none"];

// Upload progress fixtures (docs/build/design/C06.md, Surface 7).
const PROGRESS_FIXTURES = [
  {
    key: "half",
    title: "Uploading",
    head: "52%",
    percent: 52,
    caption: "2.51 GB of 4.8 GB · 3.4 MB/s · about 12 min left",
    paused: false,
  },
  {
    key: "paused",
    title: "Paused",
    head: "Paused at 52%",
    percent: 52,
    caption: "2.51 GB of 4.8 GB",
    paused: true,
  },
];

const SQUAD = [
  {
    id: "p8",
    no: 8,
    name: "Lebo Mokoena",
    pos: "CM",
    consent: "scout_visible",
    matches: 8,
    min: 612,
  },
  { id: "p4", no: 4, name: "Sipho Dlamini", pos: "CB", consent: "requested", matches: 7, min: 590 },
  {
    id: "p7",
    no: 7,
    name: "Thabo Nkosi",
    pos: "LW",
    consent: "scout_visible",
    matches: 2,
    min: 140,
  },
  {
    id: "p11",
    no: 11,
    name: "Kagiso Molefe",
    pos: "ST",
    consent: "withdrawn",
    matches: 6,
    min: 431,
  },
] as const;

function kebab(name: string) {
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function Block({
  theme,
  name,
  title,
  rule,
  half = false,
  children,
}: {
  theme: Theme;
  name: string;
  title: string;
  rule: string;
  half?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-component={name}
      id={`${theme}-${kebab(name)}`}
      className={
        half
          ? "flex min-w-0 flex-col gap-4 border-t border-line pt-5 desktop:col-span-6"
          : "flex min-w-0 flex-col gap-4 border-t border-line pt-5 desktop:col-span-12"
      }
    >
      <div className="flex flex-col gap-1.5">
        <h3 className="m-0 font-display text-heading-section stretch-wide uppercase">{title}</h3>
        <p className="m-0 max-w-prose text-body-s text-ink-muted">{rule}</p>
      </div>
      {children}
    </div>
  );
}

/** Sample nav for the shell demo: a club owner's items, with Dashboard shown as current. */
const SHELL_ITEMS: NavItem[] = navForRoles(["owner"], "club").map((item, i) =>
  i === 0 ? { ...item, match: "/dev/components" } : item,
);
const SHELL_COUNTS: NavCounts = { matches: { count: 2, hint: "2 need a lineup" } };
const SHELL_ORGS: SwitcherOrganisation[] = [
  { id: "sample-org", name: "Wideline Demo FC", typeLabel: "Club", rolesLabel: "Owner" },
];
const SHELL_USER = { name: "Nomvula Mthembu", email: "nomvula@example.com" };

/**
 * The shell's parts, static, in frames: the sidebar (it turns into the rail from 768 to
 * 991px, as in the app), and the phone top bar over the bottom tab bar. The real shell
 * positions them against the viewport; here they sit in the page. One organisation, so the
 * switcher is static (a switch would post to the real action).
 */
function AppShellDemo({ theme }: { theme: Theme }) {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <Group label="Sidebar and rail">
        <div className="flex w-sidebar flex-col gap-5 border border-line bg-panel p-3">
          <Logo size="m" />
          <OrgSwitcher organisations={SHELL_ORGS} currentId="sample-org" variant="sidebar" />
          <nav aria-label={`Sample sidebar (${theme})`}>
            <NavLinks items={SHELL_ITEMS} variant="side" counts={SHELL_COUNTS} />
          </nav>
          <AccountMenu user={SHELL_USER} variant="sidebar" />
        </div>
      </Group>
      <Group label="Rail parts">
        <div className="flex w-rail flex-col items-center gap-3.5 border border-line bg-panel py-4">
          <LogoMark size="s" />
          <OrgSwitcher organisations={SHELL_ORGS} currentId="sample-org" variant="rail" />
          <AccountMenu user={SHELL_USER} variant="rail" />
        </div>
      </Group>
      <Group label="Phone · top bar and tab bar">
        <div className="flex w-96 max-w-full flex-col border border-line bg-canvas">
          <header className="wl-topbar flex">
            <OrgSwitcher organisations={SHELL_ORGS} currentId="sample-org" variant="topbar" />
            <AccountMenu user={SHELL_USER} variant="topbar" />
          </header>
          <p className="m-0 p-4 text-body-s text-ink-muted">Page content. Sample only.</p>
          <nav
            aria-label={`Sample tab bar (${theme})`}
            className="grid auto-cols-fr grid-flow-col border-t border-line bg-panel"
          >
            <NavLinks items={SHELL_ITEMS} variant="tabbar" counts={SHELL_COUNTS} />
          </nav>
        </div>
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 font-mono text-overline uppercase text-ink-muted">{label}</p>
      <div>{children}</div>
    </div>
  );
}

/**
 * One themed band of the component gallery (Floodlight): every core and football
 * component in its states, as Wideline Components and Wideline Patterns show them.
 * IDs carry the theme prefix, so the light and dark bands stay unique.
 */
export function Gallery({ theme }: { theme: Theme }) {
  const heading = theme === "light" ? "Light theme" : "Dark theme";
  const id = (name: string) => `${theme}-${name}`;

  return (
    <section id={id("theme")} data-gallery-theme={theme} aria-labelledby={id("theme-heading")}>
      <h2
        id={id("theme-heading")}
        className="m-0 font-display text-display-phone stretch-wide uppercase tablet:text-display-l"
      >
        {heading}
      </h2>

      <div className="mt-6 grid gap-x-6 gap-y-10 desktop:grid-cols-12">
        {/* --- core --- */}
        <Block
          theme={theme}
          name="Button"
          title="Button"
          rule="One primary per view. Danger only inside confirm dialogs. Disabled buttons stay focusable and say why nearby."
        >
          <Group label="Variants">
            <div className="wl-row">
              <Button variant="primary" icon={Check}>
                Mark as reviewed
              </Button>
              <Button variant="secondary" icon={Upload}>
                Upload match
              </Button>
              <Button variant="ghost" icon={Plus}>
                Add missed event
              </Button>
              <Button variant="danger">Withdraw consent</Button>
            </div>
          </Group>
          <Group label="Sizes · s 32 · m 36 · l 44 · xl 56">
            <div className="wl-row items-end">
              <Button variant="secondary" size="s">
                Review
              </Button>
              <Button variant="secondary" size="m">
                Claim match
              </Button>
              <Button variant="secondary" size="l">
                Claim match
              </Button>
              <Button variant="primary" size="xl">
                Continue review
              </Button>
            </div>
          </Group>
          <Group label="Disabled and loading">
            <div className="wl-row">
              <Button variant="primary" disabled>
                Mark as reviewed
              </Button>
              <span className="text-body-s text-ink-muted">32 left</span>
              <Button variant="primary" loading>
                Save
              </Button>
              <Button variant="secondary" loading loadingLabel="Loading">
                Load more
              </Button>
            </div>
          </Group>
          <Group label="Shortcuts">
            <div className="wl-row">
              <Button variant="secondary" icon={Check} kbd="Y">
                Confirm
              </Button>
              <Button variant="secondary" icon={X} kbd="N">
                Reject
              </Button>
              <Button variant="secondary" icon={Pencil} kbd="E">
                Edit
              </Button>
            </div>
          </Group>
          <Group label="Links and icon buttons">
            <div className="wl-row">
              <ButtonLink variant="secondary" href="/lab/matches">
                Back to matches
              </ButtonLink>
              <IconButton icon={Pencil} aria-label="Edit (E)" />
              <IconButton icon={Check} tone="ok" aria-label="Confirm (Y)" />
              <IconButton icon={X} tone="no" aria-label="Reject (N)" />
              <IconButton icon={RotateCcw} variant="ghost" aria-label="Undo (U)" />
            </div>
          </Group>
          <Group label="Full width on phones">
            <div className="flex flex-col gap-2 tablet:max-w-md">
              <Button variant="primary" block>
                Yes, scouts can see them
              </Button>
              <Button variant="secondary" block>
                No, keep them inside the club
              </Button>
            </div>
          </Group>
        </Block>

        <Block
          theme={theme}
          name="TextField"
          title="Input and select"
          rule="The label is always above the field. Placeholders show format only. Errors say how to fix it."
        >
          <div className="grid gap-5 tablet:grid-cols-2 desktop:grid-cols-4">
            <TextField
              id={id("field-email")}
              label="Email"
              type="email"
              placeholder="name@club.co.za"
              help="We send the sign-in link here."
            />
            <TextField
              id={id("field-time")}
              label="Match time"
              mono
              defaultValue="94:30"
              error="Use a time between 00:00 and 92:10"
            />
            <Select
              id={id("field-position")}
              label="Position"
              placeholder="Choose a position"
              options={[
                { value: "gk", label: "Goalkeeper" },
                { value: "cb", label: "Centre-back" },
                { value: "cm", label: "Central midfielder" },
                { value: "lw", label: "Left winger" },
              ]}
            />
            <TextField
              id={id("field-disabled")}
              label="Club"
              defaultValue="Orlando Pirates"
              disabled
            />
            <TextArea
              id={id("field-reason")}
              className="tablet:col-span-2"
              label="Reason (optional)"
              help="Included in the email. Keep it short and factual."
            />
          </div>
        </Block>

        <Block
          theme={theme}
          name="Tabs"
          title="Tabs"
          rule="Switch between views of one thing. The selected tab has a 2px ink underline, never lime. Counts are mono."
          half
        >
          <TabsDemo theme={theme} />
        </Block>

        <Block
          theme={theme}
          name="SegmentedFilter"
          title="Segmented filter"
          rule="Narrows one list in place. The selected option has the selected fill and a hairline inset."
          half
        >
          <SegmentedDemo />
        </Block>

        <Block
          theme={theme}
          name="StatusChip"
          title="Status chip"
          rule="Colour, icon and word, plus shape: solid is settled, dashed waits on a person, a thin outline waits on the system. Never interactive."
        >
          <Group label="Match">
            <div className="wl-row">
              {MATCH_FIXTURES.map((m) => (
                <MatchStatusChip key={m.status} status={m.status} progress={m.progress} />
              ))}
            </div>
          </Group>
          <Group label="Event · size m, s and disc">
            <div className="wl-row">
              {(["confirmed", "pending", "rejected"] as const).map((s) => (
                <StatusChip key={s} kind="event" status={s} />
              ))}
              {(["confirmed", "pending", "rejected"] as const).map((s) => (
                <StatusChip key={`s-${s}`} kind="event" status={s} size="s" />
              ))}
              {(["confirmed", "pending", "rejected"] as const).map((s) => (
                <StatusChip key={`d-${s}`} kind="event" status={s} size="disc" />
              ))}
            </div>
          </Group>
          <Group label="Footage and claim">
            <div className="wl-row">
              {(Object.keys(FOOTAGE_STATES) as FootageState[]).map((s) => (
                <FootageChip key={s} state={s} size="s" />
              ))}
              {(Object.keys(CLAIM_STATES) as ReviewClaimStatus[]).map((s) => (
                <ClaimStatusChip key={s} status={s} size="s" />
              ))}
            </div>
          </Group>
          <Group label="Invitation, organisation, scout and club">
            <div className="wl-row">
              {INVITATION_STATE_FIXTURES.map((s) => (
                <InvitationStatusChip key={`i-${s}`} state={s} size="s" />
              ))}
              {ORGANISATION_STATE_FIXTURES.map((s) => (
                <OrganisationStatusChip key={`o-${s}`} status={s} size="s" />
              ))}
              {SCOUT_STATE_FIXTURES.map((s) => (
                <ScoutStatusChip key={`sc-${s}`} status={s} size="s" />
              ))}
              {CLUB_STATE_FIXTURES.map((s) => (
                <ClubStatusChip key={`c-${s}`} status={s} size="s" />
              ))}
            </div>
          </Group>
        </Block>

        <Block
          theme={theme}
          name="ConsentBadge"
          title="Consent badge"
          rule="Club staff only. Given is solid, awaiting is dashed, withdrawn is subtle and never struck through."
          half
        >
          <div className="wl-row">
            {CONSENT_STATES.map((s) => (
              <ConsentBadge key={s} state={s} />
            ))}
          </div>
          <div className="wl-row">
            <ConsentBadge state="scout_visible" date="12 Oct 2026" />
            {CONSENT_STATES.map((s) => (
              <ConsentBadge key={`icon-${s}`} state={s} iconOnly />
            ))}
          </div>
        </Block>

        <Block
          theme={theme}
          name="TeamMarker"
          title="Team marker"
          rule="A fixed colour and the H or A letter, never kit colours."
          half
        >
          <div className="wl-row items-end gap-4">
            {([16, 20, 24, 32] as const).map((s) => (
              <TeamMarker key={`h-${s}`} side="H" size={s} />
            ))}
            {([16, 20, 24, 32] as const).map((s) => (
              <TeamMarker key={`a-${s}`} side="A" size={s} />
            ))}
          </div>
          <div className="wl-row gap-6">
            <TeamMarker side="home" name={HOME_TEAM} />
            <TeamMarker side="away" name={AWAY_TEAM} />
          </div>
        </Block>

        <Block
          theme={theme}
          name="ConfidenceMeter"
          title="Confidence meter"
          rule="Ten segments and a two-decimal number. Under 0.50 it turns pending and adds Low. Review only."
          half
        >
          <dl className="m-0 grid grid-cols-2 gap-4">
            {[
              { term: "High", node: <ConfidenceMeter value={0.93} /> },
              { term: "Low", node: <ConfidenceMeter value={0.42} /> },
              { term: "Large", node: <ConfidenceMeter value={0.71} size="large" /> },
              {
                term: "Added by a scout",
                node: <ConfidenceMeter value={1} manual addedBy="Daniel Fourie" addedAt="31:24" />,
              },
            ].map((m) => (
              <div key={m.term}>
                <dt className="font-mono text-overline uppercase text-ink-muted">{m.term}</dt>
                <dd className="m-0 mt-2">{m.node}</dd>
              </div>
            ))}
          </dl>
        </Block>

        <Block
          theme={theme}
          name="Toast"
          title="Toast"
          rule="Bottom left on desktop, above the tab bar on phones. 6 s, paused on hover or focus. Errors stay until dismissed."
          half
        >
          <div className="flex max-w-md flex-col gap-2">
            <Toast tone="success" title="Event confirmed" />
            <Toast
              tone="info"
              title="Lineup saved"
              description="Home 16 players · away 14 shirt numbers"
            />
            <Toast
              tone="warning"
              title="You are offline"
              description="Decisions are kept on this phone and sync later."
            />
            <Toast
              tone="error"
              title="Couldn't save the event"
              description="Check your connection and try again."
            />
          </div>
        </Block>

        <Block
          theme={theme}
          name="Modal"
          title="Modal, sheet and confirm dialog"
          rule="Focus is trapped, Esc closes and focus returns to the trigger. A bottom sheet on phones. The confirm dialog focuses the safe button first."
        >
          <ModalDemo />
        </Block>

        {/* --- domain --- */}
        <Block
          theme={theme}
          name="StatTile"
          title="Stat tile"
          rule="One verified figure, its rate per 90, and the sample it comes from. The whole tile is a link to the clips behind the number. Under 3 matches: dashed top edge and Small sample."
        >
          <StatStrip label={`Season stats, ${theme} theme`} columns={4}>
            <StatTile
              label="Goals"
              value="5"
              rate="0.62 per 90"
              matches={8}
              clipHref={`#${id("stat-tile")}`}
            />
            <StatTile
              label="Shots"
              value="14"
              rate="2.06 per 90"
              matches={8}
              clipHref={`#${id("stat-tile")}`}
            />
            <StatTile label="Distance" value="9.1" unit="km" rate="per match" matches={2} />
            <StatTile label="Sprints" matches={0} reason="Needs tracking from both halves" />
          </StatStrip>
          <StatStrip columns={2}>
            <StatTile label="Passes" matches={8} loading />
            <StatTile label="Touches" value="412" rate="51.5 per 90" matches={8} />
          </StatStrip>
        </Block>

        <Block
          theme={theme}
          name="PlayerCard"
          title="Player card"
          rule="Initials, never a photo. Three figures, each a per-90 rate with the sample in the footer. Scouts see the shortlist toggle; club staff see the consent badge."
        >
          <div className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
            <ShortlistCardDemo href={`#${id("player-card")}`} />
            <PlayerCard
              name="Sipho Dlamini"
              position="Centre-back"
              ageGroup="U17"
              number={4}
              currentClub="Orlando Pirates Academy"
              consent="requested"
              viewer="club"
              figures={siphoFigures}
              matches={2}
              href={`#${id("player-card")}`}
            />
            <PlayerCard
              name="Kagiso Molefe"
              position="Striker"
              ageGroup="U17"
              formerClub="Kaizer Chiefs Academy"
              viewer="club"
              consent="withdrawn"
              departed={{ on: "3 Sep 2026" }}
              href={`#${id("player-card")}`}
            />
            <PlayerCard
              name="Loading"
              position=""
              ageGroup=""
              figures={thaboFigures}
              href={`#${id("player-card")}`}
              loading
            />
          </div>
        </Block>

        <Block
          theme={theme}
          name="ReviewEventRow"
          title="Review event row"
          rule="42px rows. J and K move the selection, which opens the row with Confirm, Reject and Edit. Rejected events are struck through; edited events say what changed. The list never reorders."
        >
          <div className="wl-elist max-w-2xl border border-line bg-panel">
            <ReviewEventListHeader />
            <ul aria-label={`Sample events, ${theme} theme`} className="m-0 list-none p-0">
              <ReviewEventRow
                time="31:24"
                type="Shot on target"
                side="home"
                who={{ kind: "player", number: 7, name: "Thabo Nkosi" }}
                confidence={0.68}
                state="pending"
                selected
                facts={["Right foot · inside the box", "Saved by the keeper"]}
              />
              <ReviewEventRow
                time="38:02"
                type="Goal"
                side="away"
                who={{ kind: "track", trackId: 22 }}
                confidence={0.42}
                state="pending"
              />
              <ReviewEventRow
                time="41:57"
                type="Pass"
                side="home"
                who={{ kind: "player", number: 4, name: "Sipho Dlamini" }}
                confidence={0.91}
                state="confirmed"
                edited
                editedFrom="Touch"
                saved
              />
              <ReviewEventRow
                time="44:10"
                type="Shot"
                side="away"
                who="Away #9"
                confidence={0.57}
                state="rejected"
              />
              <ReviewEventRow
                time="52:33"
                type="Shot"
                side="home"
                who="Home #11"
                source="scout"
                state="confirmed"
              />
            </ul>
          </div>
        </Block>

        <Block
          theme={theme}
          name="ExpiryBanner"
          title="Expiry banner"
          rule="Raw footage is deleted on a fixed schedule, so time left is always visible. Urgency goes up in steps; the countdown updates once a minute and never ticks seconds."
        >
          <div className="flex flex-col gap-3">
            <ExpiryBanner deletesAt={neutralExpiry} now={now} />
            <ExpiryBanner deletesAt={pendingExpiry} now={now} />
            <ExpiryBanner deletesAt={urgentExpiry} now={now} />
            <ExpiryBanner deletesAt={hoursFromNow(-2)} now={now} deleted />
          </div>
          <Group label="Countdown chip">
            <div className="wl-row">
              <ExpiryChip deletesAt={neutralExpiry} now={now} />
              <ExpiryChip deletesAt={pendingExpiry} now={now} />
              <ExpiryChip deletesAt={urgentExpiry} now={now} />
              <ExpiryChip deletesAt={urgentExpiry} now={now} deleted />
            </div>
          </Group>
        </Block>

        <Block
          theme={theme}
          name="PitchHeatmap"
          title="Pitch heatmap"
          rule="16 by 10 zones on a graphite pitch that looks the same in both themes. The five lime steps are fixed shares of minutes. Attack runs left to right; the legend and sample are always shown."
          half
        >
          <PitchHeatmap
            title="Heatmap"
            zones={heatmapZones}
            matches={8}
            minutes={612}
            label="Most time: central midfield, left half-space, edge of the box"
          />
          <PitchHeatmap
            title="Heatmap"
            zones={thinZones}
            matches={2}
            minutes={140}
            label="Most time: central midfield. Small sample, 2 matches"
          />
        </Block>

        <Block
          theme={theme}
          name="MiniPitch"
          title="Mini pitch"
          rule="A lime diamond for the usual position, outlined diamonds for the others."
          half
        >
          <MiniPitch usual={usualSpot} also={alsoSpots} />
          <Group label="Average positions">
            <AveragePositionMap
              players={averagePositions}
              matches={7}
              home={HOME_TEAM}
              away={AWAY_TEAM}
              label="Average positions: home players highest in the attacking half, away players spread across midfield"
            />
          </Group>
        </Block>

        <Block
          theme={theme}
          name="DataTable"
          title="Data table"
          rule="The header stays fixed with an ink underline. Hairlines, never zebra stripes. Text left, numbers right in mono. On phones the table becomes 56px rows."
        >
          <DataTable
            caption={`Squad, by shirt number, ${theme} theme`}
            columns={[
              { id: "no", header: "No.", numeric: true, sort: "ascending", width: "3.5rem" },
              { id: "player", header: "Player" },
              { id: "pos", header: "Pos", width: "4rem" },
              { id: "consent", header: "Consent" },
              { id: "matches", header: "Matches", numeric: true, width: "5.5rem" },
              { id: "min", header: "Min", numeric: true, width: "4.5rem" },
            ]}
            rows={SQUAD.map((p) => ({
              id: `${theme}-${p.id}`,
              selected: p.no === 4,
              cells: [
                p.no,
                <span key="name" className="font-semibold">
                  {p.name}
                </span>,
                p.pos,
                <ConsentBadge key="consent" state={p.consent} size="s" />,
                p.matches,
                p.min,
              ],
            }))}
            cards={SQUAD.map((p) => (
              <DataListRow
                key={p.id}
                href={`#${id("data-table")}`}
                initials={p.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")}
                title={p.name}
                meta={`${p.pos} · No. ${p.no} · ${p.min} min`}
                status={<ConsentBadge state={p.consent} size="s" iconOnly />}
              />
            ))}
            footer={
              <DataTablePagination
                from={1}
                to={4}
                total={24}
                noun="players"
                page={1}
                pages={6}
                nextHref={`#${id("data-table")}`}
              />
            }
          />
        </Block>

        <Block
          theme={theme}
          name="StepHeader"
          title="Step header"
          rule="Numbered discs: confirmed when done, ink when current. Phones show n of m plus bars."
          half
        >
          <StepHeader
            label={`Upload steps, ${theme} theme`}
            steps={["Recording", "Lineup", "Markers"]}
            current={2}
          />
          <StepHeader
            label={`Registration steps, ${theme} theme`}
            steps={["Identity", "Contact", "Clubs", "Terms"]}
            current={3}
            compact="always"
          />
        </Block>

        <Block
          theme={theme}
          name="StateMessage"
          title="Empty, loading, error, forbidden"
          rule="A pitch-line mark, a title that says what happened, one sentence on what to do, and at most one main action. Always inside the page, under its header."
          half
        >
          <StateMessage
            kind="empty"
            icon={Inbox}
            headingLevel={3}
            title="No matches waiting"
            body="New matches appear here as clubs upload them."
          />
          <StateMessage
            kind="error"
            headingLevel={3}
            title="We couldn't load the squad"
            body="This is on our side. Try again in a moment."
            action={<Button variant="secondary">Try again</Button>}
            code="Reference 7F2K-91"
          />
          <StateMessage
            kind="forbidden"
            headingLevel={3}
            title="You can't open this match"
            body="Only staff of Orlando Pirates Academy can see it. Ask its admin for access."
          />
          <StateMessage
            kind="offline"
            icon={WifiOff}
            headingLevel={3}
            title="You are offline"
            body="Your decisions are kept on this phone and sync when you reconnect."
          />
          <StateMessage kind="loading" title="Loading squad" rows={3} />
        </Block>

        <Block
          theme={theme}
          name="Progress"
          title="Upload progress"
          rule="Lime for live progress, always with the percent and words. Paused uses pending."
          half
        >
          <div className="flex flex-col gap-4">
            {PROGRESS_FIXTURES.map((p) => (
              <div key={p.key} className="border border-line bg-panel p-4">
                <p id={id(`progress-${p.key}`)} className="m-0 font-semibold">
                  {p.title}
                </p>
                <div className="wl-progress__head mt-2">
                  <span className="min-w-0 break-all">match-final.mp4</span>
                  <span className="font-mono text-mono-m tabular-nums">{p.head}</span>
                </div>
                <div
                  className={p.paused ? "wl-progress wl-progress--paused" : "wl-progress"}
                  role="progressbar"
                  aria-labelledby={id(`progress-${p.key}`)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={p.percent}
                  aria-valuetext={`${p.percent}%`}
                >
                  <span
                    className="wl-progress__fill"
                    style={{ "--wl-progress": `${p.percent}%` } as CSSProperties}
                  />
                </div>
                <p className="m-0 mt-2 font-mono text-body-s tabular-nums text-ink-muted">
                  {p.caption}
                </p>
                {p.paused && (
                  <div className="wl-banner mt-3" role="status">
                    <WifiOff {...iconProps} />
                    <p className="m-0">
                      Paused: you are offline. The upload carries on from the last chunk when you
                      reconnect.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Block>

        {/* --- shell --- */}
        <Block
          theme={theme}
          name="AppShell"
          title="App shell"
          rule="A 232px sidebar from 992px, a 64px icon rail from 768 to 991px, a 56px top bar and bottom tab bar on phones. The current page has the selected fill and a 2px ink inset, never lime. Counts only where action waits. The theme choice lives only in the account menu."
        >
          <AppShellDemo theme={theme} />
        </Block>

        <Block
          theme={theme}
          name="Logo"
          title="Logo"
          rule="The wide channel: a pitch outline with the near touchline as a solid lime bar. Sizes l (auth and print), m (sidebar) and s (rail)."
          half
        >
          <div className="wl-row items-center gap-6">
            <Logo size="l" />
            <Logo size="m" />
            <LogoMark size="s" />
          </div>
        </Block>

        <Block
          theme={theme}
          name="Cover"
          title="Cover"
          rule="Pitch geometry only. No photos of players, ever."
        >
          <div className="overflow-hidden border border-line">
            <Cover titleAs="p" />
          </div>
        </Block>
      </div>
    </section>
  );
}
