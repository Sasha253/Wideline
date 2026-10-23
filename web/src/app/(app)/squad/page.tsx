import { EmptyState } from "@/components/states/EmptyState";
import { ListPage } from "@/components/templates/ListPage";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";

export const metadata = { title: "Squad" };

// Draft copy: replaced by C04
export default async function SquadPage() {
  const ctx = await requirePageRole(CLUB_ROLES);
  return (
    <ListPage
      header={{ title: "Squad", intro: `Teams and players in ${ctx.organisationName}.` }}
      isEmpty
      empty={
        <EmptyState
          title="No players yet"
          body="Squad lists arrive here once your club adds teams and players."
        />
      }
    />
  );
}
