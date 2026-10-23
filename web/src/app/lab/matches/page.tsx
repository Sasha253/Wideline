import { MatchStatusChip } from "@/components/ui/StatusChip";
import { LAB_ROLES, requirePageRole } from "@/server/auth/session";

export const metadata = { title: "Matches" };

const dateFormat = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function MatchesPage() {
  const { db } = await requirePageRole(LAB_ROLES);

  const matches = await db.match.findMany({
    orderBy: { playedAt: "desc" },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="heading-1">Matches</h1>
      </header>

      {matches.length === 0 ? (
        <p className="body-lg mt-8 text-ink-muted">
          No matches yet. Create one to upload footage and run the pipeline.
        </p>
      ) : (
        <div className="wl-card mt-6 overflow-x-auto p-0">
          <table className="wl-table">
            <caption className="sr-only">Matches, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Match</th>
                <th scope="col">Date</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Video
                </th>
                <th scope="col">Latest job</th>
                <th scope="col" className="num">
                  Recall
                </th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className="body-strong">{m.homeTeam.name}</span>
                    <span className="text-ink-muted"> v </span>
                    <span className="body-strong">{m.awayTeam.name}</span>
                    {m.competition && (
                      <span className="caption block text-ink-muted">{m.competition}</span>
                    )}
                  </td>
                  <td className="data whitespace-nowrap">{dateFormat.format(m.playedAt)}</td>
                  <td>
                    <MatchStatusChip status={m.status} />
                  </td>
                  {/* Video, job and recall columns fill in from Phase 2 onward. */}
                  <td className="num text-ink-muted">–</td>
                  <td className="text-ink-muted">None yet</td>
                  <td className="num text-ink-muted">–</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
