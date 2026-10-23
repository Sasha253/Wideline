import { formatDate, relativeExpiry, ROLE_LABELS } from "@/lib/labels";
import { ORG_ADMIN_ROLES, requirePageRole } from "@/server/auth/session";
import { listInvitations } from "@/server/organisations/invitations";
import { listMembers } from "@/server/organisations/members";
import { assignableRoles, canManageMembership } from "@/server/organisations/roles";
import { SettingsNav } from "../SettingsNav";
import { InvitationsSection, type InvitationItem } from "./InvitationsSection";
import { InviteCard } from "./InviteCard";
import { MembersSection, type MemberItem } from "./MembersSection";

export const metadata = { title: "Members" };

/** Members, the invite form and open invitations (AUTH03, AUTH04). Owners and admins only. */
export default async function MembersPage() {
  const ctx = await requirePageRole(ORG_ADMIN_ROLES);
  const now = new Date();
  const [invitations, members] = await Promise.all([listInvitations(ctx, now), listMembers(ctx)]);
  const roles = assignableRoles(ctx.roles).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const isOwner = ctx.roles.includes("owner");

  const invitationItems: InvitationItem[] = invitations.map((i) => {
    const date = formatDate(i.createdAt);
    const by = i.inviterName ? `Invited by ${i.inviterName} on ${date}` : `Invited on ${date}`;
    return {
      id: i.id,
      email: i.email,
      role: ROLE_LABELS[i.role],
      status: i.status,
      invitedCaption: i.inviteeName ? `${i.inviteeName} · ${by}` : by,
      expiresDate: formatDate(i.expiresAt),
      expiresRelative: relativeExpiry(i.expiresAt, now),
    };
  });

  const memberItems: MemberItem[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    roleLabel: ROLE_LABELS[m.role],
    joined: formatDate(m.joinedAt),
    isSelf: m.userId === ctx.user.id,
    canManage: canManageMembership(ctx.roles, m.role),
  }));

  return (
    <>
      <h1 className="heading-1">Members</h1>
      <p className="body mt-2 max-w-prose text-ink-muted">
        People who can sign in to {ctx.organisationName}, and invitations that are still open.
      </p>
      <SettingsNav current="members" />
      <InviteCard orgName={ctx.organisationName} roles={roles} isOwner={isOwner} />
      <InvitationsSection invitations={invitationItems} />
      <MembersSection
        orgName={ctx.organisationName}
        members={memberItems}
        roles={roles}
        isOwner={isOwner}
      />
    </>
  );
}
