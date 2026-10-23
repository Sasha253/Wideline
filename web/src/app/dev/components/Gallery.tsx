import { Check, CircleDot, Pencil, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { ConfidenceMeter } from "@/components/ui/ConfidenceMeter";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { Cover } from "@/components/ui/Cover";
import { formatDeletionDate } from "@/components/ui/expiry";
import { ExpiryBanner, ExpiryLabel } from "@/components/ui/ExpiryBanner";
import { AveragePositionMap, PitchHeatmap } from "@/components/ui/PitchHeatmap";
import { PlayerCard } from "@/components/ui/PlayerCard";
import { ReviewEventRow } from "@/components/ui/ReviewEventRow";
import { StatTile } from "@/components/ui/StatTile";
import {
  EVENT_STATES,
  EventStatusChip,
  MATCH_STATES,
  MatchStatusChip,
  StatusChip,
  type EventReviewState,
} from "@/components/ui/StatusChip";
import { TeamMarker } from "@/components/ui/TeamMarker";
import type { ConsentState, MatchStatus } from "@/generated/prisma/enums";
import {
  averagePositions,
  AWAY_TEAM,
  dangerExpiry,
  heatmapZones,
  HOME_TEAM,
  leboStats,
  now,
  siphoStats,
  thaboStats,
  warningExpiry,
} from "./fixtures";

type Theme = "light" | "dark";

const CONSENT_STATES: ConsentState[] = [
  "scout_visible",
  "club_only",
  "requested",
  "withdrawn",
  "none",
];

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
      className={half ? "min-w-0 lg:col-span-6" : "min-w-0 lg:col-span-12"}
    >
      <h3 className="body-strong">{title}</h3>
      <p className="caption mt-1 text-ink-muted">{rule}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="eyebrow text-ink-muted">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * One themed band of the component gallery: every component in every variant.
 * IDs carry the theme prefix, so the light and dark bands stay unique.
 */
export function Gallery({ theme }: { theme: Theme }) {
  const heading = theme === "light" ? "Light theme" : "Dark theme";
  const id = (name: string) => `${theme}-${name}`;

  return (
    <section id={id("theme")} data-gallery-theme={theme} aria-labelledby={id("theme-heading")}>
      <h2 id={id("theme-heading")} className="heading-2">
        {heading}
      </h2>

      <div className="mt-6 grid gap-8 lg:grid-cols-12 lg:gap-x-6">
        <Block
          theme={theme}
          name="Button"
          title="Button"
          rule="One primary button per view. Buttons act; links navigate."
        >
          {/* Real screens keep one primary per view; the gallery shows every variant. */}
          <div className="space-y-4">
            <Group label="Variants">
              <div className="wl-row">
                <Button variant="primary" icon={Check}>
                  Mark as reviewed
                </Button>
                <Button variant="secondary">Upload match</Button>
                <Button variant="ghost" icon={Plus}>
                  Add missed event
                </Button>
                <Button variant="danger">Withdraw consent</Button>
              </div>
            </Group>
            <Group label="Size and state">
              <div className="wl-row">
                <Button variant="primary" size="sm">
                  Claim match
                </Button>
                <Button variant="primary" size="sm" disabled>
                  Claim match
                </Button>
                <Button variant="secondary" size="sm">
                  Export CSV
                </Button>
              </div>
            </Group>
            <Group label="Shortcuts">
              <div className="wl-row">
                <Button variant="primary" kbd="Y">
                  Confirm
                </Button>
                <Button variant="secondary" kbd="E">
                  Edit
                </Button>
                <Button variant="danger" kbd="N">
                  Reject
                </Button>
              </div>
            </Group>
            <Group label="Links">
              <div className="wl-row">
                <ButtonLink variant="secondary" href="/lab/matches">
                  Back to matches
                </ButtonLink>
                <ButtonLink variant="ghost" href={`#${id("player-card")}`}>
                  View profile
                </ButtonLink>
              </div>
            </Group>
            <Group label="Icon buttons">
              <div className="wl-row">
                <IconButton icon={Pencil} aria-label="Edit (E)" />
                <IconButton icon={Check} tone="ok" aria-label="Confirm (Y)" />
                <IconButton icon={X} tone="no" aria-label="Reject (N)" />
              </div>
            </Group>
            <Group label="Full width on phones">
              <div className="wl-stack md:max-w-md md:items-start">
                <Button variant="primary" block>
                  Yes, scouts can see them
                </Button>
                <Button variant="secondary" block>
                  No, keep them inside the club
                </Button>
              </div>
            </Group>
          </div>
        </Block>

        <Block
          theme={theme}
          name="StatusChip"
          title="Status chip"
          rule="Every chip pairs a colour with a word and an icon. Chips are never clickable."
        >
          <div className="space-y-4">
            <Group label="Event states">
              <div className="wl-row">
                {(Object.keys(EVENT_STATES) as EventReviewState[]).map((s) => (
                  <EventStatusChip key={s} state={s} />
                ))}
              </div>
            </Group>
            <Group label="Match states">
              <div className="wl-row">
                {(Object.keys(MATCH_STATES) as MatchStatus[]).map((s) => (
                  <MatchStatusChip key={s} status={s} />
                ))}
              </div>
            </Group>
            <Group label="Accent">
              <div className="wl-row">
                <StatusChip tone="new" icon={CircleDot} label="New" />
              </div>
            </Group>
          </div>
        </Block>

        <Block
          theme={theme}
          name="ConsentBadge"
          title="Consent badge"
          rule="Club staff only. Scouts never see this badge."
          half
        >
          <div className="wl-row">
            {CONSENT_STATES.map((s) => (
              <ConsentBadge key={s} state={s} />
            ))}
          </div>
        </Block>

        <Block
          theme={theme}
          name="TeamMarker"
          title="Team marker"
          rule="Shape and letter as well as colour."
          half
        >
          <div className="wl-row gap-6">
            <TeamMarker side="home" name={HOME_TEAM} />
            <TeamMarker side="away" name={AWAY_TEAM} />
          </div>
        </Block>

        <Block
          theme={theme}
          name="ConfidenceMeter"
          title="Confidence meter"
          rule="Auto-accept threshold 0.75. Never shown on public profiles."
          half
        >
          <dl className="grid grid-cols-2 gap-4">
            {[
              { term: "Above threshold", score: 0.93 },
              { term: "At threshold", score: 0.75 },
              { term: "Below threshold", score: 0.68 },
              { term: "Below threshold, detail view", score: 0.58, detail: true },
            ].map((m) => (
              <div key={m.term}>
                <dt className="caption text-ink-muted">{m.term}</dt>
                <dd className="mt-1">
                  <ConfidenceMeter score={m.score} threshold={0.75} detail={m.detail} />
                </dd>
              </div>
            ))}
          </dl>
        </Block>

        <Block
          theme={theme}
          name="ExpiryBanner"
          title="Expiry banner"
          rule="Warning from 3 days left, danger under 24 hours."
          half
        >
          <div className="wl-stack">
            <ExpiryBanner expiresAt={warningExpiry} now={now}>
              Review this match before {formatDeletionDate(warningExpiry)} to add missed events.
              Stats you confirm are kept.
            </ExpiryBanner>
            <ExpiryBanner expiresAt={dangerExpiry} now={now}>
              This match has no reviewer yet. Claim it now or it will publish with auto-accepted
              events only.
            </ExpiryBanner>
            <Group label="Queue row label">
              <div className="wl-row">
                <ExpiryLabel expiresAt={warningExpiry} now={now} />
                <ExpiryLabel expiresAt={dangerExpiry} now={now} />
              </div>
            </Group>
          </div>
        </Block>

        <Block
          theme={theme}
          name="StatTile"
          title="Stat tile"
          rule="Under 3 matches, the small-sample flag shows."
        >
          <div className="grid grid-cols-2 gap-4 md:gap-6 lg:grid-cols-4">
            <StatTile label="Goals per 90" value="0.62" matches={7} minutes={612} />
            <StatTile label="Distance covered" value="8.4" unit="km per match" matches={7} />
            <StatTile label="Shots on target" value="71" unit="%" matches={2} />
            <StatTile
              label="Shots per 90"
              value="2.1"
              matches={7}
              minutes={612}
              href={`#${id("stat-tile")}`}
            />
          </div>
        </Block>

        <Block
          theme={theme}
          name="PlayerCard"
          title="Player card"
          rule="The whole card links to the profile."
        >
          <div className="grid gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
            <PlayerCard
              name="Thabo Nkosi"
              position="Winger"
              ageGroup="U17"
              foot="left"
              currentClub="Orlando Pirates Academy"
              consent="scout_visible"
              stats={thaboStats}
              href={`#${id("player-card")}`}
              shortlistHref={`#${id("player-card")}`}
            />
            <PlayerCard
              name="Sipho Dlamini"
              position="Centre-back"
              ageGroup="U17"
              foot="right"
              formerClub="Kaizer Chiefs Academy"
              consent="club_only"
              stats={siphoStats}
              href={`#${id("player-card")}`}
            />
            <PlayerCard
              name="Lebo Mokoena"
              position="Central midfielder"
              ageGroup="U15"
              foot="both"
              currentClub="SuperSport Academy"
              stats={leboStats}
              href={`#${id("player-card")}`}
            />
          </div>
        </Block>

        <Block
          theme={theme}
          name="ReviewEventRow"
          title="Review event row"
          rule="Y confirms, E edits, N rejects. J and K move between rows in the review workspace."
        >
          <ul
            aria-label="Sample events"
            className="max-w-xl overflow-hidden rounded-md border border-line"
          >
            <ReviewEventRow
              time="31:24"
              type="Shot on target"
              side="home"
              who={{ kind: "player", number: 7, name: "Thabo Nkosi" }}
              confidence={0.68}
              threshold={0.75}
              state="pending"
              current
            />
            <ReviewEventRow
              time="38:02"
              type="Goal"
              side="away"
              who={{ kind: "track", trackId: 22 }}
              confidence={0.84}
              threshold={0.9}
              state="pending"
            />
            <ReviewEventRow
              time="41:57"
              type="Touch"
              side="home"
              who={{ kind: "player", number: 4, name: "Sipho Dlamini" }}
              note="corrected"
              confidence={0.91}
              threshold={0.75}
              state="confirmed"
            />
          </ul>
        </Block>

        <Block
          theme={theme}
          name="PitchHeatmap"
          title="Pitch heatmap"
          rule="Attacking left to right, always with a legend."
          half
        >
          <div className="wl-card">
            <PitchHeatmap
              zones={heatmapZones}
              matches={7}
              label="Heatmap: most time in the attacking half, left of centre"
            />
          </div>
        </Block>

        <Block
          theme={theme}
          name="AveragePositionMap"
          title="Average position map"
          rule="One dot per player, with the side letter."
          half
        >
          <div className="wl-card">
            <AveragePositionMap
              players={averagePositions}
              matches={7}
              home={HOME_TEAM}
              away={AWAY_TEAM}
              label="Average positions: home players highest in the attacking half, away players spread across midfield"
            />
          </div>
        </Block>

        <Block theme={theme} name="Cover" title="Cover" rule="Pitch geometry only. No photos.">
          <div className="overflow-hidden rounded-md border border-line">
            <Cover titleAs="p" />
          </div>
        </Block>
      </div>
    </section>
  );
}
