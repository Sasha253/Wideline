import { Bookmark } from "lucide-react";
import { DataTable } from "@/components/templates/DataTable";
import { DetailPage } from "@/components/templates/DetailPage";
import { ButtonLink } from "@/components/ui/Button";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { StatTile } from "@/components/ui/StatTile";
import { DEV_ROLES, requirePageRole } from "@/server/auth/session";
import { MATCH_LOG, SHOWCASE_BACK } from "../fixtures";

export const metadata = { title: "Detail page" };

export default async function DetailTemplatePage() {
  await requirePageRole(DEV_ROLES);
  return (
    <DetailPage
      back={SHOWCASE_BACK}
      eyebrow="Player"
      title="Thabo Nkosi"
      meta="Winger · U17 · Left foot · Orlando Pirates Academy"
      badges={<ConsentBadge state="scout_visible" />}
      media={
        <span className="wl-avatar" aria-hidden="true">
          TN
        </span>
      }
      actions={
        <ButtonLink variant="secondary" icon={Bookmark} href="/dev/templates/detail">
          Add to shortlist
        </ButtonLink>
      }
      sections={[
        {
          id: "season",
          title: "Season 2026 · U17",
          content: (
            <div className="grid grid-cols-1 gap-4 tablet:grid-cols-3 tablet:gap-6">
              <StatTile label="Goals per 90" value="0.62" matches={14} minutes={1180} />
              <StatTile label="Distance covered" value="8.4" unit="km per match" matches={14} />
              <StatTile label="Shots on target" value="71" unit="%" matches={2} />
            </div>
          ),
        },
        {
          id: "match-log",
          title: "Match log",
          content: (
            <DataTable
              caption="Matches, newest first"
              columns={[
                { id: "match", header: "Match" },
                { id: "date", header: "Date" },
                { id: "minutes", header: "Minutes", numeric: true },
                { id: "goals", header: "Goals", numeric: true },
              ]}
              rows={MATCH_LOG.map((m) => ({
                id: m.id,
                cells: [
                  m.fixture,
                  <span key="date" className="font-mono text-mono-m tabular-nums whitespace-nowrap">
                    {m.date}
                  </span>,
                  m.minutes,
                  m.goals,
                ],
              }))}
            />
          ),
        },
      ]}
    />
  );
}
