import { EmptyState } from "@/components/states/EmptyState";
import { DataTable } from "@/components/templates/DataTable";
import { ListPage } from "@/components/templates/ListPage";
import { MatchStatusChip } from "@/components/ui/StatusChip";
import { LAB_ROLES, requirePageRole } from "@/server/auth/session";

export const metadata = { title: "Matches" };

const dateFormat = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const COLUMNS = [
  { id: "match", header: "Match" },
  { id: "date", header: "Date" },
  { id: "status", header: "Status" },
  { id: "video", header: "Video", numeric: true },
  { id: "job", header: "Latest job" },
  { id: "recall", header: "Recall", numeric: true },
];

export default async function MatchesPage() {
  const { db } = await requirePageRole(LAB_ROLES);

  const matches = await db.match.findMany({
    orderBy: { playedAt: "desc" },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  const fixture = (m: (typeof matches)[number]) => (
    <>
      <span className="body-strong">{m.homeTeam.name}</span>
      <span className="text-ink-muted"> v </span>
      <span className="body-strong">{m.awayTeam.name}</span>
    </>
  );

  return (
    <ListPage
      header={{ eyebrow: "CV Lab", title: "Matches" }}
      isEmpty={matches.length === 0}
      empty={
        <EmptyState
          title="No matches yet"
          body="Create one to upload footage and run the pipeline."
        />
      }
    >
      <DataTable
        caption="Matches, newest first"
        columns={COLUMNS}
        rows={matches.map((m) => ({
          id: m.id,
          cells: [
            <>
              {fixture(m)}
              {m.competition && (
                <span className="caption block text-ink-muted">{m.competition}</span>
              )}
            </>,
            <span key="date" className="data whitespace-nowrap">
              {dateFormat.format(m.playedAt)}
            </span>,
            <MatchStatusChip key="status" status={m.status} />,
            // Video, job and recall columns fill in from Phase 2 onward.
            <span key="video" className="text-ink-muted">
              –
            </span>,
            <span key="job" className="text-ink-muted">
              None yet
            </span>,
            <span key="recall" className="text-ink-muted">
              –
            </span>,
          ],
        }))}
        cards={matches.map((m) => (
          <li key={m.id} className="wl-card flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">{fixture(m)}</span>
              <MatchStatusChip status={m.status} />
            </div>
            {m.competition && <span className="caption text-ink-muted">{m.competition}</span>}
            <span className="data">{dateFormat.format(m.playedAt)}</span>
          </li>
        ))}
      />
    </ListPage>
  );
}
