import { ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { StateMessage } from "@/components/ui/StateMessage";

/**
 * No access to this page (Floodlight, "State · forbidden"). Says who can grant access.
 *
 * - `reason` leads the sentence: "Shortlists are only for scouts."
 * - `switchHref`: the primary "Switch organisation" (for people in more than one).
 * - `homeHref`: "Go to your home page" (`homeLabel` overrides it, "Go to dashboard").
 * - With neither, "Sign in as someone else".
 * - `signedInAs` adds the code line, "403 · signed in as club admin".
 */
export function ForbiddenState({
  homeHref,
  homeLabel = "Go to your home page",
  switchHref,
  reason,
  signedInAs,
  headingLevel = 1,
}: {
  homeHref?: string;
  homeLabel?: string;
  switchHref?: string;
  reason?: ReactNode;
  /** The role the user is signed in as, in words ("club admin"). */
  signedInAs?: string;
  headingLevel?: 1 | 2;
}) {
  return (
    <StateMessage
      kind="forbidden"
      headingLevel={headingLevel}
      title="You don't have access to this page"
      body={
        <>
          {reason && <>{reason} </>}
          If you think you should have access, ask your organisation&apos;s admin.
        </>
      }
      action={
        switchHref ? (
          <ButtonLink variant="primary" href={switchHref} icon={ChevronsUpDown}>
            Switch organisation
          </ButtonLink>
        ) : undefined
      }
      secondary={
        homeHref ? (
          <ButtonLink variant="secondary" href={homeHref}>
            {homeLabel}
          </ButtonLink>
        ) : !switchHref ? (
          <ButtonLink variant="secondary" href="/login">
            Sign in as someone else
          </ButtonLink>
        ) : undefined
      }
      code={signedInAs ? `403 · signed in as ${signedInAs}` : undefined}
    />
  );
}
