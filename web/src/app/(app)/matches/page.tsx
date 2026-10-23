import { EmptyState } from "@/components/states/EmptyState";
import { ListPage } from "@/components/templates/ListPage";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";

export const metadata = { title: "Matches" };

// Draft copy: replaced by C06
export default async function MatchesPage() {
  await requirePageRole(CLUB_ROLES);
  return (
    <ListPage
      header={{ title: "Matches", intro: "Matches your club has uploaded, by status." }}
      isEmpty
      empty={<EmptyState title="No matches yet" body="Uploaded matches appear here." />}
    />
  );
}
