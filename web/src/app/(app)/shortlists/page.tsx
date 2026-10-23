import { EmptyState } from "@/components/states/EmptyState";
import { ListPage } from "@/components/templates/ListPage";
import { requireReviewerPage } from "@/server/auth/reviewer";

export const metadata = { title: "Shortlists" };

// Draft copy: replaced by C15. Shortlists show player data, so they need an
// approved scout profile on the current terms (requireReviewerPage, C02), not
// only the scout role.
export default async function ShortlistsPage() {
  await requireReviewerPage("shortlists");
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
