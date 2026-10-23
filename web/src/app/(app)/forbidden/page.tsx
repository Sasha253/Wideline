import { ForbiddenState } from "@/components/states/ForbiddenState";
import { homeFor } from "@/lib/nav";
import { requireUser } from "@/server/auth/session";

export const metadata = { title: "No access" };

// Inside the shell, so the user can move on from here (docs/build/design/D02.md, Surface 6).
export default async function Forbidden() {
  const ctx = await requireUser();
  return <ForbiddenState homeHref={ctx.organisationId ? homeFor(ctx.roles) : undefined} />;
}
