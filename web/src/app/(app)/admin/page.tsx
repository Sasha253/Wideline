import { redirect } from "next/navigation";
import { PLATFORM_ROLES, requirePageRole } from "@/server/auth/session";

// Admin has no index page yet: it opens on the organisation applications.
export default async function AdminIndex() {
  await requirePageRole(PLATFORM_ROLES);
  redirect("/admin/organisations");
}
