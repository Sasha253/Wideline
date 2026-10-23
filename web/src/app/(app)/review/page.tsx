import { EmptyState } from "@/components/states/EmptyState";
import { ListPage } from "@/components/templates/ListPage";
import { requireReviewerPage } from "@/server/auth/reviewer";

export const metadata = { title: "Review queue" };

// Draft copy: replaced by C10. Review access needs an approved scout profile on
// the current terms (requireReviewerPage, C02), not only the scout role.
export default async function ReviewQueuePage() {
  await requireReviewerPage();
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
