import { EmptyState } from "@/components/states/EmptyState";
import { ListPage } from "@/components/templates/ListPage";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";

export const metadata = { title: "Dashboard" };

// Draft copy: replaced by C14
export default async function DashboardPage() {
  const ctx = await requirePageRole(CLUB_ROLES);
  return (
    <ListPage
      header={{ title: "Dashboard", intro: `${ctx.organisationName} at a glance.` }}
      isEmpty
      empty={
        <EmptyState
          title="Nothing to show yet"
          body="Your squad, matches by status and consent gaps appear here once your club adds players and uploads matches."
        />
      }
    />
  );
}
