import { UserRoundCog } from "lucide-react";
import { stopImpersonatingAction } from "@/app/(app)/admin/users/actions";
import { SubmitButton } from "@/components/forms";

/**
 * Shown on every page of a "Log in as" session (src/server/auth/impersonation.ts),
 * so the platform admin always knows whose account they are in and how to leave.
 */
export function ImpersonationBanner({
  user,
  impersonator,
}: {
  user: { name: string; email: string };
  impersonator: { name: string };
}) {
  return (
    <div role="status" className="wl-banner mb-6 flex-wrap items-center">
      <UserRoundCog aria-hidden="true" />
      <p className="body min-w-0 flex-1">
        <b>Logged in as {user.name}</b> ({user.email}). You see what they see, and what you do is
        done as them. {impersonator.name}, return to your own account when you are done.
      </p>
      <form action={stopImpersonatingAction}>
        <SubmitButton variant="secondary" size="sm" pendingLabel="Returning…">
          Return to my account
        </SubmitButton>
      </form>
    </div>
  );
}
