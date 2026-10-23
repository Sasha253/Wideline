import { EmptyState } from "@/components/states/EmptyState";
import { ListPage } from "@/components/templates/ListPage";
import { SCOUT_ROLES, requirePageRole } from "@/server/auth/session";

export const metadata = { title: "Review queue" };

// Draft copy: replaced by C10
export default async function ReviewQueuePage() {
  await requirePageRole(SCOUT_ROLES);
  return (
    <ListPage
      header={{ title: "Review queue", intro: "Matches to claim, soonest footage deletion first." }}
      isEmpty
      empty={
        <EmptyState
          title="No matches waiting"
          body="New matches appear here as clubs upload them."
        />
      }
    />
  );
}
