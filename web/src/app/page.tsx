import { redirect } from "next/navigation";
import { getUserContext } from "@/server/auth/session";

// The root has no UI: it sends each person to where their role works
// (docs/build/design/C01.md, "Root redirect").
export default async function Home() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.organisationId) redirect("/organisations");
  if (ctx.roles.includes("platform_admin")) redirect("/lab/matches");
  if (ctx.roles.includes("owner") || ctx.roles.includes("admin")) redirect("/settings/members");
  redirect("/organisations");
}
