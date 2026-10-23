"use client";

import { Check, RotateCw, X } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Banner, Field, SubmitButton, SuccessBanner } from "@/components/forms";
import { OrganisationStatusChip } from "@/components/ui/StatusChip";
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
        size="sm"
        icon={Check}
        pendingLabel="Approving…"
        aria-label={`Approve ${item.name}`}
        className={block ? "w-full justify-center" : undefined}
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
        size="sm"
        icon={RotateCw}
        pendingLabel="Sending…"
        aria-label={`Resend owner invitation to ${item.applicantEmail}`}
        className={block ? "w-full justify-center" : undefined}
      >
        Resend owner invitation
      </SubmitButton>
    </form>
  );
}

function RejectDialog({ item, forms }: { item: ApplicationItem; forms: Forms }) {
  return (
    <ConfirmDialog
      trigger={{ label: "Reject", variant: "danger", icon: X, ariaLabel: `Reject ${item.name}` }}
      title={`Reject ${item.name}?`}
      body={`We email ${item.applicantName} at ${item.applicantEmail} to say the application was not approved.`}
      form={forms.reject}
      hidden={{ organisationId: item.id, name: item.name }}
      submit={{ label: "Reject application", pendingLabel: "Rejecting…", variant: "danger" }}
    >
      <Field label="Reason (optional)" hint="Included in the email. Keep it short and factual.">
        {(p) => <textarea {...p} name="reason" maxLength={500} className="wl-input" />}
      </Field>
    </ConfirmDialog>
  );
}

/**
 * The organisation name. On the Decided tab it links to flags and limits (C03);
 * a pending organisation is decided first.
 */
function OrgName({
  item,
  linked,
  className,
}: {
  item: ApplicationItem;
  linked: boolean;
  className: string;
}) {
  if (!linked) return <span className={`body-strong ${className}`}>{item.name}</span>;
  return (
    <Link
      href={`/admin/organisations/${item.id}`}
      className={`body-strong text-pitch underline ${className}`}
    >
      {item.name}
    </Link>
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

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="sr-only">
        Applications
      </h2>
      <div aria-live="polite" className="mt-6 empty:mt-0">
        <SuccessBanner result={result} />
        {retry && (
          <div className="mt-3">
            <ResendOwnerButton item={retry} forms={forms} />
          </div>
        )}
        {result && !result.ok && result.formError && (
          <Banner tone="danger">{result.formError}</Banner>
        )}
      </div>

      {items.length === 0 ? (
        <p className="body-lg mt-6 text-ink-muted">
          {pending
            ? "No applications waiting. New applications appear here when clubs apply to join the pilot."
            : "No decisions yet."}
        </p>
      ) : (
        <>
          <div className="wl-card mt-6 hidden overflow-x-auto p-0 md:block">
            <table className="wl-table">
              <caption className="sr-only">
                {pending
                  ? "Pending applications, oldest first"
                  : "Decided applications, newest first"}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="label">
                    Organisation
                  </th>
                  <th scope="col" className="label">
                    Applicant
                  </th>
                  <th scope="col" className="label">
                    {pending ? "Applied" : "Decided"}
                  </th>
                  <th scope="col" className="label">
                    Status
                  </th>
                  <th scope="col" className={pending ? "label num" : "label"}>
                    {pending ? "Actions" : "Reason"}
                  </th>
                  {!pending && (
                    <th scope="col" className="label">
                      Owner invitation
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <OrgName item={i} linked={!pending} className="block" />
                      <span className="caption block text-ink-muted">{i.meta}</span>
                    </td>
                    <td>
                      <span className="body block">{i.applicantName}</span>
                      <span className="caption block break-all text-ink-muted">
                        {i.applicantEmail}
                      </span>
                    </td>
                    <td className="data whitespace-nowrap">{pending ? i.applied : i.decided}</td>
                    <td>
                      <OrganisationStatusChip status={i.status} />
                    </td>
                    <td>
                      {pending ? (
                        <div className="wl-row justify-end">
                          <ApproveButton item={i} forms={forms} />
                          <RejectDialog item={i} forms={forms} />
                        </div>
                      ) : i.reason ? (
                        <span className="body">{i.reason}</span>
                      ) : (
                        <span className="text-ink-muted">–</span>
                      )}
                    </td>
                    {!pending && (
                      <td>
                        {i.owner ? (
                          <div className="flex flex-col items-start gap-2">
                            <span className="caption text-ink-muted">{i.owner}</span>
                            <ResendOwnerButton item={i} forms={forms} />
                          </div>
                        ) : (
                          <span className="text-ink-muted">–</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul role="list" className="mt-6 flex flex-col gap-3 md:hidden">
            {items.map((i) => (
              <li key={i.id} className="wl-card flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <OrgName item={i} linked={!pending} className="min-w-0 break-words" />
                  <OrganisationStatusChip status={i.status} />
                </div>
                <p className="caption text-ink-muted">{i.meta}</p>
                <p className="caption text-ink-muted">
                  {pending
                    ? `Applied by ${i.applicantName} on ${i.applied}`
                    : `Decided on ${i.decided}`}
                  <span className="block break-all">{i.applicantEmail}</span>
                </p>
                {!pending && i.reason && <p className="body">{i.reason}</p>}
                {!pending && i.owner && (
                  <>
                    <p className="caption text-ink-muted">{i.owner}</p>
                    <ResendOwnerButton item={i} forms={forms} block />
                  </>
                )}
                {pending && (
                  <div className="flex gap-2 [&>*]:flex-1">
                    <ApproveButton item={i} forms={forms} block />
                    <RejectDialog item={i} forms={forms} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
