import { ForbiddenState } from "@/components/states/ForbiddenState";
import { PageHeader } from "@/components/templates/PageHeader";
import { ROLE_LABELS } from "@/lib/labels";
import { homeFor } from "@/lib/nav";
import { requireUser } from "@/server/auth/session";

export const metadata = { title: "No access" };

// Inside the shell, so the user can move on from here (Floodlight, "State · forbidden"):
// it says who can grant access and who the user is signed in as.
export default async function Forbidden() {
  const ctx = await requireUser();
  const roles = ctx.roles.map((r) => ROLE_LABELS[r].toLowerCase());
  const signedInAs = roles.length ? roles.join(" and ") : undefined;
  const home = ctx.organisationId ? homeFor(ctx.roles) : undefined;
  // Phones say it in the sentence ("as a club admin"); wider screens show the code line.
  // Switch organisation waits for an organisation switch route.
  return (
    <>
      <PageHeader title="No access" />
      <ForbiddenState
        headingLevel={2}
        homeHref={home}
        homeLabel={home === "/dashboard" ? "Go to dashboard" : undefined}
        reason={
          ctx.organisationName && signedInAs ? (
            <span className="tablet:hidden">
              You&apos;re signed in to {ctx.organisationName} as {article(signedInAs)} {signedInAs}.
            </span>
          ) : undefined
        }
        signedInAs={signedInAs}
      />
    </>
  );
}

/** "a club admin", "an owner". */
const article = (words: string) => (/^[aeiou]/i.test(words) ? "an" : "a");
