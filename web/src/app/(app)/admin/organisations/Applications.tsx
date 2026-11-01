"use client";

import { Building2, Check, RotateCw, X } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Banner, SubmitButton, SuccessBanner } from "@/components/forms";
import { DataTable, Missing } from "@/components/templates/DataTable";
import { orgInitials } from "@/components/shell/OrgSwitcher";
import { StateMessage } from "@/components/ui/StateMessage";
import { OrganisationStatusChip } from "@/components/ui/StatusChip";
import { TextArea } from "@/components/ui/TextField";
import type { OrganisationStatus } from "@/generated/prisma/enums";
import { useSectionAction, useSectionResult, type SectionForm } from "@/components/section-result";
import {
  approveOrganisationAction,
  rejectOrganisationAction,
  resendOwnerInvitationAction,
} from "./actions";

export type ApplicationItem = {
  id: string;
  name: string;
  meta: string;
  applicantName: string;
  applicantEmail: string;
  status: OrganisationStatus;
  applied: string;
  decided: string;
  reason: string | null;
  /**
   * Set for an approved organisation that has no owner yet: what happened to
   * its owner invitation. The platform admin can resend it.
   */
  owner: string | null;
};

type Forms = {
  approve: SectionForm;
  reject: SectionForm;
  resend: SectionForm;
  /** Remembers the row a submit came from, so a failed email can offer a resend. */
  track: (form: SectionForm, item: ApplicationItem) => SectionForm["formProps"];
};

function ApproveButton({
  item,
  forms,
  block,
}: {
  item: ApplicationItem;
  forms: Forms;
  block?: boolean;
}) {
  return (
    <form {...forms.track(forms.approve, item)} className={block ? "flex-1" : undefined}>
      <input type="hidden" name="organisationId" value={item.id} />
      <input type="hidden" name="name" value={item.name} />
      <SubmitButton
        variant="secondary"
        size={block ? "l" : "s"}
        block={block}
        icon={Check}
        pendingLabel="Approving…"
        aria-label={`Approve ${item.name}`}
      >
        Approve
      </SubmitButton>
    </form>
  );
}

function ResendOwnerButton({
  item,
  forms,
  block,
}: {
  item: ApplicationItem;
  forms: Forms;
  block?: boolean;
}) {
  return (
    <form {...forms.track(forms.resend, item)}>
      <input type="hidden" name="organisationId" value={item.id} />
      <input type="hidden" name="name" value={item.name} />
      <SubmitButton
        variant="secondary"
        size={block ? "l" : "s"}
        block={block}
        icon={RotateCw}
        pendingLabel="Sending…"
        aria-label={`Resend owner invitation to ${item.applicantEmail}`}
      >
        Resend owner invitation
      </SubmitButton>
    </form>
  );
}

function RejectDialog({
  item,
  forms,
  block,
}: {
  item: ApplicationItem;
  forms: Forms;
  block?: boolean;
}) {
  return (
    <ConfirmDialog
      // Danger only inside the confirm dialog (Floodlight Button rule).
      trigger={{
        label: "Reject",
        variant: block ? "secondary" : "ghost",
        icon: X,
        ariaLabel: `Reject ${item.name}`,
        block,
        size: block ? "l" : "s",
      }}
      title={`Reject ${item.name}?`}
      body={`We email ${item.applicantName} at ${item.applicantEmail} to say the application was not approved.`}
      icon={X}
      form={forms.reject}
      hidden={{ organisationId: item.id, name: item.name }}
      submit={{ label: "Reject application", pendingLabel: "Rejecting…", variant: "danger" }}
    >
      <TextArea
        label="Reason (optional)"
        help="Included in the email. Keep it short and factual."
        name="reason"
        maxLength={500}
      />
    </ConfirmDialog>
  );
}

/**
 * The organisation name. On the Decided tab it links to flags and limits (C03);
 * a pending organisation is decided first.
 */
function OrgName({ item, linked }: { item: ApplicationItem; linked: boolean }) {
  if (!linked) return <span className="font-semibold break-words">{item.name}</span>;
  return (
    <Link
      href={`/admin/organisations/${item.id}`}
      className="font-semibold break-words text-ink underline-offset-3 hover:underline"
    >
      {item.name}
    </Link>
  );
}

function Person({ name, email }: { name: string; email: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span>{name}</span>
      {email && <span className="font-mono text-body-s break-all text-ink-muted">{email}</span>}
    </span>
  );
}

/** The application list for one tab, with the banner slot and the focus target. */
export function Applications({
  status,
  items,
}: {
  status: "pending" | "decided";
  items: ApplicationItem[];
}) {
  const { result, setResult, headingRef } = useSectionResult();
  const headingId = useId();
  const [lastItem, setLastItem] = useState<ApplicationItem | null>(null);
  const forms: Forms = {
    approve: useSectionAction(approveOrganisationAction, setResult),
    reject: useSectionAction(rejectOrganisationAction, setResult, { okOnly: true }),
    resend: useSectionAction(resendOwnerInvitationAction, setResult),
    track: (form, item) => ({
      ...form.formProps,
      onSubmit: (e: FormEvent<HTMLFormElement>) => {
        setLastItem(item);
        form.formProps.onSubmit(e);
      },
    }),
  };
  const pending = status === "pending";
  // On the Pending tab an approved row has already moved to Decided, so a
  // failed owner invitation email gets its resend button under the banner.
  const fromOwnerInvite = result === forms.approve.state || result === forms.resend.state;
  const retry =
    pending && fromOwnerInvite && result?.ok && result.tone === "warn" && lastItem?.applicantEmail
      ? lastItem
      : null;

  const columns = pending
    ? [
        { id: "organisation", header: "Organisation" },
        { id: "applicant", header: "Applicant" },
        { id: "applied", header: "Applied", sort: "ascending" as const, width: "8rem" },
        { id: "status", header: "Status", width: "10rem" },
        { id: "actions", header: "", label: "Actions", width: "13rem" },
      ]
    : [
        { id: "organisation", header: "Organisation" },
        { id: "applicant", header: "Applicant" },
        { id: "decided", header: "Decided", sort: "descending" as const, width: "8rem" },
        { id: "status", header: "Status", width: "10rem" },
        { id: "reason", header: "Reason" },
        { id: "owner", header: "Owner invitation" },
      ];

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="sr-only">
        Applications
      </h2>
      <div aria-live="polite" className="mt-5 flex flex-col gap-3 empty:mt-0">
        <SuccessBanner result={result} />
        {retry && (
          <div>
            <ResendOwnerButton item={retry} forms={forms} />
          </div>
        )}
        {result && !result.ok && result.formError && (
          <Banner tone="danger">{result.formError}</Banner>
        )}
      </div>

      {items.length === 0 ? (
        <StateMessage
          kind="empty"
          icon={Building2}
          headingLevel={3}
          className="mt-5"
          title={pending ? "No applications waiting" : "No decisions yet"}
          body={
            pending ? "New applications appear here when clubs apply to join the pilot." : undefined
          }
        />
      ) : (
        <DataTable
          className="mt-5"
          caption={
            pending ? "Pending applications, oldest first" : "Decided applications, newest first"
          }
          columns={columns}
          rows={items.map((i) => ({
            id: i.id,
            cells: pending
              ? [
                  <span key="org" className="flex min-w-0 flex-col gap-1">
                    <OrgName item={i} linked={false} />
                    <span className="text-body-s text-ink-muted">{i.meta}</span>
                  </span>,
                  <Person key="applicant" name={i.applicantName} email={i.applicantEmail} />,
                  <span
                    key="date"
                    className="font-mono text-mono-m tabular-nums whitespace-nowrap text-ink-muted"
                  >
                    {i.applied}
                  </span>,
                  <OrganisationStatusChip key="status" status={i.status} size="s" />,
                  <span key="actions" className="flex justify-end gap-2">
                    <ApproveButton item={i} forms={forms} />
                    <RejectDialog item={i} forms={forms} />
                  </span>,
                ]
              : [
                  <span key="org" className="flex min-w-0 flex-col gap-1">
                    <OrgName item={i} linked />
                    <span className="text-body-s text-ink-muted">{i.meta}</span>
                  </span>,
                  <Person key="applicant" name={i.applicantName} email={i.applicantEmail} />,
                  <span
                    key="date"
                    className="font-mono text-mono-m tabular-nums whitespace-nowrap text-ink-muted"
                  >
                    {i.decided}
                  </span>,
                  <OrganisationStatusChip key="status" status={i.status} size="s" />,
                  i.reason ? <span key="reason">{i.reason}</span> : <Missing key="reason" />,
                  i.owner ? (
                    <span key="owner" className="flex flex-col items-start gap-2">
                      <span className="text-body-s text-ink-muted">{i.owner}</span>
                      <ResendOwnerButton item={i} forms={forms} />
                    </span>
                  ) : (
                    <Missing key="owner" />
                  ),
                ],
          }))}
          cards={items.map((i) => (
            <li
              key={i.id}
              className="flex flex-col gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="wl-avatar wl-avatar--m" aria-hidden="true">
                  {orgInitials(i.name)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <OrgName item={i} linked={!pending} />
                  <span className="text-body-s text-ink-muted">{i.meta}</span>
                </span>
                <OrganisationStatusChip status={i.status} size="s" />
              </div>
              <p className="m-0 text-body-s text-ink-muted">
                {pending
                  ? `Applied by ${i.applicantName} on ${i.applied}`
                  : `Decided on ${i.decided}`}
                {i.applicantEmail && (
                  <span className="block font-mono break-all">{i.applicantEmail}</span>
                )}
              </p>
              {!pending && i.reason && <p className="m-0">{i.reason}</p>}
              {!pending && i.owner && (
                <>
                  <p className="m-0 text-body-s text-ink-muted">{i.owner}</p>
                  <ResendOwnerButton item={i} forms={forms} block />
                </>
              )}
              {pending && (
                <div className="flex gap-2 [&>*]:flex-1">
                  <ApproveButton item={i} forms={forms} block />
                  <RejectDialog item={i} forms={forms} block />
                </div>
              )}
            </li>
          ))}
          footer={
            <span className="flex-1">
              {pending ? "Oldest first" : "Newest first"} ·{" "}
              <span className="font-mono tabular-nums">{items.length}</span>{" "}
              {pending ? "waiting" : items.length === 1 ? "decision" : "decisions"}
            </span>
          }
        />
      )}
    </section>
  );
}
