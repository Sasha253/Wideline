import { EmptyState } from "@/components/states/EmptyState";
import { ButtonLink } from "@/components/ui/Button";

export const metadata = { title: "Page not found" };

// notFound() thrown by a page inside the shell.
export default function AppNotFound() {
  return (
    <EmptyState
      headingLevel={1}
      title="Page not found"
      body="The page you asked for does not exist or has moved."
      action={
        <ButtonLink variant="secondary" href="/">
          Go to Wideline
        </ButtonLink>
      }
    />
  );
}
