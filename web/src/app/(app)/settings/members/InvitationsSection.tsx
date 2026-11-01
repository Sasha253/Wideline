"use client";

import { Mail, RotateCw, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Banner, SubmitButton, SuccessBanner } from "@/components/forms";
import { DataTable } from "@/components/templates/DataTable";
import { StateMessage } from "@/components/ui/StateMessage";
import { InvitationStatusChip, type InvitationState } from "@/components/ui/StatusChip";
import { useSectionAction, useSectionResult, type SectionForm } from "@/components/section-result";
import { resendInvitationAction, revokeInvitationAction } from "./actions";

export type InvitationItem = {
  id: string;
  email: string;
  role: string;
  status: InvitationState;
  invitedCaption: string;
  expiresDate: string;
  expiresRelative: string;
};

type Forms = { resend: SectionForm; revoke: SectionForm };

function RowActions({
  item,
  forms,
  block,
}: {
  item: InvitationItem;
  forms: Forms;
  block?: boolean;
}) {
  return (
    <div className={block ? "flex gap-2 [&>*]:flex-1" : "flex justify-end gap-2"}>
      <form {...forms.resend.formProps}>
        <input type="hidden" name="invitationId" value={item.id} />
        <SubmitButton
          variant="secondary"
          size={block ? "l" : "s"}
          block={block}
          icon={RotateCw}
          pendingLabel="Sending…"
          aria-label={`Resend invitation to ${item.email}`}
        >
          Resend
        </SubmitButton>
      </form>
      <ConfirmDialog
        trigger={{
          label: "Revoke",
          // Danger only inside the confirm dialog (Floodlight Button rule).
          variant: block ? "secondary" : "ghost",
          icon: X,
          ariaLabel: `Revoke invitation to ${item.email}`,
          block,
          size: block ? "l" : "s",
        }}
        title={`Revoke the invitation to ${item.email}?`}
        body="The link in their email stops working straight away. You can invite them again later."
        icon={X}
        form={forms.revoke}
        hidden={{ invitationId: item.id }}
        submit={{ label: "Revoke invitation", pendingLabel: "Revoking…", variant: "danger" }}
      />
    </div>
  );
}

/** Open invitations: a table from 768px, a list of rows on phones. */
export function InvitationsSection({ invitations }: { invitations: InvitationItem[] }) {
  const { result, setResult, headingRef } = useSectionResult();
  const forms: Forms = {
    resend: useSectionAction(resendInvitationAction, setResult),
    revoke: useSectionAction(revokeInvitationAction, setResult, { okOnly: true }),
  };

  return (
    <section aria-labelledby="invitations-heading" className="mt-8 flex flex-col gap-3">
      <h2
        id="invitations-heading"
        ref={headingRef}
        tabIndex={-1}
        className="m-0 font-display text-heading-section stretch-wide uppercase"
      >
        Invitations{" "}
        <span className="font-mono text-mono-m tabular-nums text-ink-muted normal-case">
          {invitations.length}
        </span>
      </h2>
      <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
        <SuccessBanner result={result} />
        {result && !result.ok && result.formError && (
          <Banner tone="danger">{result.formError}</Banner>
        )}
      </div>

      {invitations.length === 0 ? (
        <StateMessage
          kind="empty"
          icon={Mail}
          headingLevel={3}
          title="No open invitations"
          body="Invite your coaches and staff above."
        />
      ) : (
        <DataTable
          caption="Open invitations, newest first"
          columns={[
            { id: "invitation", header: "Invitation" },
            { id: "role", header: "Role", width: "8rem" },
            { id: "status", header: "Status", width: "9rem" },
            { id: "expires", header: "Expires", width: "9rem" },
            { id: "actions", header: "", label: "Actions", width: "13rem" },
          ]}
          rows={invitations.map((i) => ({
            id: i.id,
            cells: [
              <span key="inv" className="flex min-w-0 flex-col gap-1">
                <span className="font-semibold break-all">{i.email}</span>
                <span className="text-body-s text-ink-muted">{i.invitedCaption}</span>
              </span>,
              i.role,
              <InvitationStatusChip key="status" state={i.status} size="s" />,
              <span key="expires" className="flex flex-col gap-1">
                <span className="font-mono text-mono-m tabular-nums whitespace-nowrap">
                  {i.expiresDate}
                </span>
                <span className="text-body-s text-ink-muted">{i.expiresRelative}</span>
              </span>,
              <RowActions key="actions" item={i} forms={forms} />,
            ],
          }))}
          cards={invitations.map((i) => (
            <li
              key={i.id}
              className="flex flex-col gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 font-semibold break-all">{i.email}</span>
                <InvitationStatusChip state={i.status} size="s" />
              </div>
              <p className="m-0 text-body-s text-ink-muted">
                {i.role} · Expires <span className="font-mono tabular-nums">{i.expiresDate}</span> (
                {i.expiresRelative})
              </p>
              <p className="m-0 text-body-s text-ink-muted">{i.invitedCaption}</p>
              <RowActions item={i} forms={forms} block />
            </li>
          ))}
        />
      )}
    </section>
  );
}
