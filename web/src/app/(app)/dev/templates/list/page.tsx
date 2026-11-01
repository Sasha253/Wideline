import { Search } from "lucide-react";
import { DataTable, Missing } from "@/components/templates/DataTable";
import { ListPage } from "@/components/templates/ListPage";
import { Button } from "@/components/ui/Button";
import { DEV_ROLES, requirePageRole } from "@/server/auth/session";
import { SHOWCASE_BACK, SMALL_SAMPLE, SQUAD, type SquadRow } from "../fixtures";

export const metadata = { title: "List page" };

function GoalsPer90({ row }: { row: SquadRow }) {
  if (row.goalsPer90 === null) return <Missing />;
  return (
    <>
      {row.goalsPer90}
      {row.matches < SMALL_SAMPLE && (
        <span className="text-body-s block text-warning">Small sample · {row.matches} matches</span>
      )}
    </>
  );
}

export default async function ListTemplatePage() {
  await requirePageRole(DEV_ROLES);
  return (
    <ListPage
      header={{
        back: SHOWCASE_BACK,
        eyebrow: "Sample",
        title: "Squad",
        intro: "Players in Wideline Demo FC.",
      }}
      toolbar={
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="wl-field">
            <label htmlFor="squad-search" className="text-label">
              Search players
            </label>
            <input id="squad-search" name="q" type="search" className="wl-input" />
          </div>
          <Button variant="secondary" size="sm" type="submit" icon={Search}>
            Search
          </Button>
        </form>
      }
    >
      <DataTable
        caption="Players, by name"
        columns={[
          { id: "name", header: "Name" },
          { id: "position", header: "Position" },
          { id: "age", header: "Age group" },
          { id: "matches", header: "Matches", numeric: true },
          { id: "goals", header: "Goals per 90", numeric: true },
        ]}
        rows={SQUAD.map((r) => ({
          id: r.id,
          cells: [
            <span key="name" className="font-semibold break-words">
              {r.name}
            </span>,
            r.position,
            r.ageGroup,
            r.matches,
            <GoalsPer90 key="goals" row={r} />,
          ],
        }))}
        cards={SQUAD.map((r) => (
          <li key={r.id} className="wl-card flex flex-col gap-1">
            <span className="font-semibold break-words">{r.name}</span>
            <span className="text-body-s text-ink-muted">
              {r.position} · {r.ageGroup}
            </span>
            <span>
              <span className="font-mono text-mono-m tabular-nums">{r.matches}</span> matches ·
              Goals per 90:{" "}
              <span className="font-mono text-mono-m tabular-nums">
                <GoalsPer90 row={r} />
              </span>
            </span>
          </li>
        ))}
      />
    </ListPage>
  );
}
