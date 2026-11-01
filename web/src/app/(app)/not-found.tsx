import { ButtonLink } from "@/components/ui/Button";
import { StateMessage } from "@/components/ui/StateMessage";

export const metadata = { title: "Page not found" };

// notFound() thrown by a page inside the shell: the state message keeps the shell in place.
export default function AppNotFound() {
  return (
    <StateMessage
      kind="empty"
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
