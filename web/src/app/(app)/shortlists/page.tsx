import { EmptyState } from "@/components/states/EmptyState";
import { ListPage } from "@/components/templates/ListPage";
import { SCOUT_ROLES, requirePageRole } from "@/server/auth/session";

export const metadata = { title: "Shortlists" };

// Draft copy: replaced by C15
export default async function ShortlistsPage() {
  await requirePageRole(SCOUT_ROLES);
  return (
    <ListPage
      header={{ title: "Shortlists", intro: "Players you are following." }}
      isEmpty
      empty={
        <EmptyState
          title="No shortlists yet"
          body="Shortlists you build from player profiles appear here."
        />
      }
    />
  );
}
