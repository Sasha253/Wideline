"use client";

import { RotateCw, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Banner, SubmitButton, SuccessBanner } from "@/components/forms";
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

function RowActions({ item, forms }: { item: InvitationItem; forms: Forms }) {
  return (
    <div className="wl-row md:justify-end">
      <form {...forms.resend.formProps}>
        <input type="hidden" name="invitationId" value={item.id} />
        <SubmitButton
          variant="secondary"
          size="sm"
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
          variant: "danger",
          icon: X,
          ariaLabel: `Revoke invitation to ${item.email}`,
        }}
        title={`Revoke the invitation to ${item.email}?`}
        body="The link in their email stops working straight away. You can invite them again later."
        form={forms.revoke}
        hidden={{ invitationId: item.id }}
        submit={{ label: "Revoke invitation", pendingLabel: "Revoking…", variant: "danger" }}
      />
    </div>
  );
}

/** Open invitations: a table from 768px, a card list on phones. */
export function InvitationsSection({ invitations }: { invitations: InvitationItem[] }) {
  const { result, setResult, headingRef } = useSectionResult();
  const forms: Forms = {
    resend: useSectionAction(resendInvitationAction, setResult),
    revoke: useSectionAction(revokeInvitationAction, setResult, { okOnly: true }),
  };

  return (
    <section aria-labelledby="invitations-heading" className="mt-8">
      <h2 id="invitations-heading" ref={headingRef} tabIndex={-1} className="heading-2">
        Invitations
      </h2>
      <div aria-live="polite" className="mt-4 empty:mt-0">
        <SuccessBanner result={result} />
        {result && !result.ok && result.formError && (
          <Banner tone="danger">{result.formError}</Banner>
        )}
      </div>

      {invitations.length === 0 ? (
        <p className="body mt-4 text-ink-muted">
          No open invitations. Invite your coaches and staff above.
        </p>
      ) : (
        <>
          <div className="wl-card mt-4 hidden overflow-x-auto p-0 md:block">
            <table className="wl-table">
              <caption className="sr-only">Open invitations, newest first</caption>
              <thead>
                <tr>
                  <th scope="col" className="label">
                    Invitation
                  </th>
                  <th scope="col" className="label">
                    Role
                  </th>
                  <th scope="col" className="label">
                    Status
                  </th>
                  <th scope="col" className="label">
                    Expires
                  </th>
                  <th scope="col" className="label num">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className="body-strong block break-all">{i.email}</span>
                      <span className="caption block text-ink-muted">{i.invitedCaption}</span>
                    </td>
                    <td className="body">{i.role}</td>
                    <td>
                      <InvitationStatusChip state={i.status} />
                    </td>
                    <td>
                      <span className="data block whitespace-nowrap">{i.expiresDate}</span>
                      <span className="caption block text-ink-muted">{i.expiresRelative}</span>
                    </td>
                    <td>
                      <RowActions item={i} forms={forms} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul role="list" className="mt-4 flex flex-col gap-3 md:hidden">
            {invitations.map((i) => (
              <li key={i.id} className="wl-card flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <span className="body-strong min-w-0 break-all">{i.email}</span>
                  <InvitationStatusChip state={i.status} />
                </div>
                <p className="caption text-ink-muted">
                  {i.role} · Expires {i.expiresDate} ({i.expiresRelative})
                </p>
                <p className="caption text-ink-muted">{i.invitedCaption}</p>
                <RowActions item={i} forms={forms} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
