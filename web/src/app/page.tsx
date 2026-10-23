import { redirect } from "next/navigation";
import { homeFor } from "@/lib/nav";
import { getUserContext } from "@/server/auth/session";

// The root has no UI: it sends each person to where their role works
// (docs/build/design/D02.md, homeFor in src/lib/nav.ts).
export default async function Home() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.organisationId) redirect("/organisations");
  redirect(homeFor(ctx.roles));
}
