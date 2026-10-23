import { redirect } from "next/navigation";
import { ORG_ADMIN_ROLES, requirePageRole } from "@/server/auth/session";

// Settings has no index page: it opens on the organisation tab.
export default async function SettingsIndex() {
  await requirePageRole(ORG_ADMIN_ROLES);
  redirect("/settings/organisation");
}
