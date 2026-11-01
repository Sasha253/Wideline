import { Workspace } from "@/components/templates/Workspace";
import { ReviewEventRow } from "@/components/ui/ReviewEventRow";
import { DEV_ROLES, requirePageRole } from "@/server/auth/session";

export const metadata = { title: "Workspace" };

export default async function WorkspaceTemplatePage() {
  await requirePageRole(DEV_ROLES);
  return (
    <Workspace
      theme="dark"
      toolbar={
        <>
          {/* The page's one h1: the workspace is about this match. */}
          <h1 className="font-display text-heading-section stretch-wide uppercase">
            Wideline Demo FC v Hellenic U17
          </h1>
          <span className="font-mono text-mono-m tabular-nums text-ink-muted">12 Oct 2026</span>
        </>
      }
      primary={{
        title: "Match video",
        content: (
          <div className="grid aspect-video place-items-center rounded-control bg-sunken">
            <span className="text-body-s text-ink-muted">Video plays here</span>
          </div>
        ),
      }}
      side={{
        title: "Events",
        content: (
          <ul
            aria-label="Sample events"
            className="overflow-hidden rounded-control border border-line"
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
        ),
      }}
    />
  );
}
