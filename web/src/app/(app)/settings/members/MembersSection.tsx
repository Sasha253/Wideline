"use client";

import { Pencil, UserMinus } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SuccessBanner } from "@/components/forms";
import { personInitials } from "@/components/shell/AccountMenu";
import { DataTable } from "@/components/templates/DataTable";
import { Select } from "@/components/ui/TextField";
import { useSectionAction, useSectionResult, type SectionForm } from "@/components/section-result";
import { changeMemberRoleAction, removeMemberAction } from "./actions";

export type MemberItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  joined: string;
  isSelf: boolean;
  canManage: boolean;
};

type RoleOption = { value: string; label: string };

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

function MemberActions({
  member,
  orgName,
  roles,
  isOwner,
  forms,
  block,
}: {
  member: MemberItem;
  orgName: string;
  roles: RoleOption[];
  isOwner: boolean;
  forms: { changeRole: SectionForm; remove: SectionForm };
  block?: boolean;
}) {
  if (!member.canManage) {
    return (
      <p
        className={
          block ? "m-0 text-body-s text-ink-muted" : "m-0 text-right text-body-s text-ink-muted"
        }
      >
        Only an owner can change this
      </p>
    );
  }
  const role = member.roleLabel.toLowerCase();
  return (
    <div className={block ? "flex gap-2 [&>*]:flex-1" : "flex justify-end gap-2"}>
      <ConfirmDialog
        trigger={{
          label: "Change role",
          variant: block ? "secondary" : "ghost",
          icon: Pencil,
          ariaLabel: `Change role for ${member.name}, ${member.roleLabel}`,
          block,
          size: block ? "l" : "s",
        }}
        title={`Change role for ${member.name}`}
        body={`${member.name} is ${article(role)} ${role} at ${orgName}.`}
        icon={Pencil}
        form={forms.changeRole}
        hidden={{ membershipId: member.id, memberName: member.name }}
        submit={{ label: "Save role", pendingLabel: "Saving…", variant: "primary" }}
      >
        <Select
          label="New role"
          name="role"
          defaultValue={member.role}
          options={roles}
          help={isOwner ? undefined : "Only an owner can make someone an owner."}
        />
      </ConfirmDialog>
      <ConfirmDialog
        trigger={{
          label: "Remove",
          // Danger only inside the confirm dialog (Floodlight Button rule).
          variant: block ? "secondary" : "ghost",
          icon: UserMinus,
          ariaLabel: `Remove ${member.name} as ${member.roleLabel}`,
          block,
          size: block ? "l" : "s",
        }}
        title={`Remove ${member.name} as ${role}?`}
        body={
          member.isSelf
            ? `You lose ${role} access to ${orgName} straight away.`
            : `They lose ${role} access to ${orgName} straight away. Their other roles here stay, and their Wideline account is not deleted.`
        }
        icon={UserMinus}
        form={forms.remove}
        hidden={{ membershipId: member.id }}
        submit={{ label: "Remove", pendingLabel: "Removing…", variant: "danger" }}
      />
    </div>
  );
}

/** Members, one row per membership: a table from 768px, a list of rows on phones. */
export function MembersSection({
  orgName,
  members,
  roles,
  isOwner,
}: {
  orgName: string;
  members: MemberItem[];
  roles: RoleOption[];
  isOwner: boolean;
}) {
  const { result, setResult, headingRef } = useSectionResult();
  const forms = {
    changeRole: useSectionAction(changeMemberRoleAction, setResult, { okOnly: true }),
    remove: useSectionAction(removeMemberAction, setResult, { okOnly: true }),
  };
  const actions = (m: MemberItem, block?: boolean) => (
    <MemberActions
      member={m}
      orgName={orgName}
      roles={roles}
      isOwner={isOwner}
      forms={forms}
      block={block}
    />
  );
  const name = (m: MemberItem) => (
    <span className="font-semibold break-words">
      {m.name}
      {m.isSelf && <span className="font-normal text-ink-muted"> (you)</span>}
    </span>
  );

  return (
    <section aria-labelledby="members-heading" className="mt-8 flex flex-col gap-3">
      <h2
        id="members-heading"
        ref={headingRef}
        tabIndex={-1}
        className="m-0 font-display text-heading-section stretch-wide uppercase"
      >
        Members{" "}
        <span className="font-mono text-mono-m tabular-nums text-ink-muted normal-case">
          {members.length}
        </span>
      </h2>
      <div aria-live="polite" className="empty:hidden">
        <SuccessBanner result={result} />
      </div>

      <DataTable
        caption={`Members of ${orgName}, by name`}
        columns={[
          { id: "member", header: "Member" },
          { id: "role", header: "Role", width: "9rem" },
          { id: "joined", header: "Joined", width: "9rem" },
          { id: "actions", header: "", label: "Actions", width: "15rem" },
        ]}
        rows={members.map((m) => ({
          id: m.id,
          cells: [
            <span key="member" className="flex min-w-0 items-center gap-3">
              <span className="wl-avatar wl-avatar--m" aria-hidden="true">
                {personInitials(m.name)}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                {name(m)}
                <span className="font-mono text-body-s break-all text-ink-muted">{m.email}</span>
              </span>
            </span>,
            m.roleLabel,
            <span key="joined" className="font-mono text-mono-m tabular-nums whitespace-nowrap">
              {m.joined}
            </span>,
            <span key="actions">{actions(m)}</span>,
          ],
        }))}
        cards={members.map((m) => (
          <li
            key={m.id}
            className="flex flex-col gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="wl-avatar wl-avatar--m" aria-hidden="true">
                {personInitials(m.name)}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                {name(m)}
                <span className="font-mono text-body-s break-all text-ink-muted">{m.email}</span>
                <span className="text-body-s text-ink-muted">
                  {m.roleLabel} · Joined <span className="font-mono tabular-nums">{m.joined}</span>
                </span>
              </span>
            </div>
            {actions(m, true)}
          </li>
        ))}
      />

      {members.length === 1 && (
        <p className="m-0 text-body-s text-ink-muted">You are the only member so far.</p>
      )}
    </section>
  );
}
