"use client";

import { Pencil, UserMinus } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Field, SuccessBanner } from "@/components/forms";
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
}: {
  member: MemberItem;
  orgName: string;
  roles: RoleOption[];
  isOwner: boolean;
  forms: { changeRole: SectionForm; remove: SectionForm };
}) {
  if (!member.canManage) {
    return <p className="caption text-ink-muted">Only an owner can change this</p>;
  }
  const role = member.roleLabel.toLowerCase();
  return (
    <div className="wl-row md:justify-end">
      <ConfirmDialog
        trigger={{
          label: "Change role",
          variant: "ghost",
          icon: Pencil,
          ariaLabel: `Change role for ${member.name}, ${member.roleLabel}`,
        }}
        title={`Change role for ${member.name}`}
        body={`${member.name} is ${article(role)} ${role} at ${orgName}.`}
        form={forms.changeRole}
        hidden={{ membershipId: member.id, memberName: member.name }}
        submit={{ label: "Save role", pendingLabel: "Saving…", variant: "primary" }}
      >
        <Field
          label="New role"
          hint={isOwner ? undefined : "Only an owner can make someone an owner."}
        >
          {(p) => (
            <select {...p} name="role" defaultValue={member.role} className="wl-input">
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        trigger={{
          label: "Remove",
          variant: "danger",
          icon: UserMinus,
          ariaLabel: `Remove ${member.name} as ${member.roleLabel}`,
        }}
        title={`Remove ${member.name} as ${role}?`}
        body={
          member.isSelf
            ? `You lose ${role} access to ${orgName} straight away.`
            : `They lose ${role} access to ${orgName} straight away. Their other roles here stay, and their Wideline account is not deleted.`
        }
        form={forms.remove}
        hidden={{ membershipId: member.id }}
        submit={{ label: "Remove", pendingLabel: "Removing…", variant: "danger" }}
      />
    </div>
  );
}

/** Members, one row per membership: a table from 768px, a card list on phones. */
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
  const actions = (m: MemberItem) => (
    <MemberActions member={m} orgName={orgName} roles={roles} isOwner={isOwner} forms={forms} />
  );
  const name = (m: MemberItem) => (
    <>
      <span className="body-strong">{m.name}</span>
      {m.isSelf && <span className="text-ink-muted"> (you)</span>}
    </>
  );

  return (
    <section aria-labelledby="members-heading" className="mt-8">
      <h2 id="members-heading" ref={headingRef} tabIndex={-1} className="heading-2">
        Members <span className="data text-ink-muted">{members.length}</span>
      </h2>
      <div aria-live="polite" className="mt-4 empty:mt-0">
        <SuccessBanner result={result} />
      </div>

      <div className="wl-card mt-4 hidden overflow-x-auto p-0 md:block">
        <table className="wl-table">
          <caption className="sr-only">Members of {orgName}, by name</caption>
          <thead>
            <tr>
              <th scope="col" className="label">
                Member
              </th>
              <th scope="col" className="label">
                Role
              </th>
              <th scope="col" className="label">
                Joined
              </th>
              <th scope="col" className="label num">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  {name(m)}
                  <span className="caption block break-all text-ink-muted">{m.email}</span>
                </td>
                <td className="body">{m.roleLabel}</td>
                <td className="data whitespace-nowrap">{m.joined}</td>
                <td>{actions(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul role="list" className="mt-4 flex flex-col gap-3 md:hidden">
        {members.map((m) => (
          <li key={m.id} className="wl-card flex flex-col gap-2">
            <p>{name(m)}</p>
            <p className="caption break-all text-ink-muted">{m.email}</p>
            <p className="caption text-ink-muted">
              {m.roleLabel} · Joined {m.joined}
            </p>
            {actions(m)}
          </li>
        ))}
      </ul>

      {members.length === 1 && (
        <p className="caption mt-4 text-ink-muted">You are the only member so far.</p>
      )}
    </section>
  );
}
