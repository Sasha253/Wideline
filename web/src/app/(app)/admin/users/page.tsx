import { PageHeader } from "@/components/templates/PageHeader";
import { ROLE_LABELS, SCOUT_STATUS_LABELS } from "@/lib/labels";
import { PLATFORM_ROLES, requirePageRole } from "@/server/auth/session";
import { listUsers } from "@/server/platform/users";
import { AdminNav } from "../AdminNav";
import { UsersTable, type UserItem } from "./UsersTable";

export const metadata = { title: "Users" };

/**
 * Every user and their roles, with "Log in as" to see the app as them
 * (src/server/auth/impersonation.ts). Platform admins only.
 */
export default async function UsersPage() {
  const ctx = await requirePageRole(PLATFORM_ROLES);
  const rows = await listUsers(ctx);

  const items: UserItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    memberships: r.memberships.map(
      (m) => `${m.organisationName} · ${m.roles.map((role) => ROLE_LABELS[role]).join(", ")}`,
    ),
    scout: r.scoutStatus ? `Independent scout · ${SCOUT_STATUS_LABELS[r.scoutStatus]}` : null,
    canImpersonate: r.canImpersonate,
  }));

  return (
    <>
      <PageHeader
        title="Users"
        intro="Everyone with a Wideline account. Log in as someone to see the app with their roles; the session lasts an hour and every start and stop is in the audit log. Platform admins cannot be logged in as."
      />
      <AdminNav current="users" />
      <UsersTable items={items} />
    </>
  );
}
