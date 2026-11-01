import { UserRoundCog } from "lucide-react";
import { stopImpersonatingAction } from "@/app/(app)/admin/users/actions";
import { SubmitButton } from "@/components/forms";

/**
 * Shown on every page of a "Log in as" session (src/server/auth/impersonation.ts),
 * so the platform admin always knows whose account they are in and how to leave.
 * Floodlight banner: square, a hairline in the pending colour on the pending-subtle fill,
 * with an icon and the words (never colour alone).
 */
export function ImpersonationBanner({
  user,
  impersonator,
}: {
  user: { name: string; email: string };
  impersonator: { name: string };
}) {
  return (
    <div role="status" className="wl-impersonation">
      <UserRoundCog
        size={20}
        strokeWidth={1.8}
        aria-hidden="true"
        className="wl-impersonation__icon"
      />
      <p className="wl-impersonation__text">
        <b>Logged in as {user.name}</b> ({user.email}). You see what they see, and what you do is
        done as them. {impersonator.name}, return to your own account when you are done.
      </p>
      <form action={stopImpersonatingAction} className="wl-impersonation__action">
        <SubmitButton variant="secondary" size="sm" pendingLabel="Returning…">
          Return to my account
        </SubmitButton>
      </form>
    </div>
  );
}
