"use client";

import {
  Ban,
  Check,
  CircleDashed,
  Clock,
  Link2,
  MailCheck,
  MailWarning,
  RotateCcw,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Banner, Field, fieldError, SubmitButton, SuccessBanner } from "@/components/forms";
import { useSectionAction, type SectionForm } from "@/components/section-result";
import { iconProps } from "@/components/ui/icons";
import { StateMessage } from "@/components/ui/StateMessage";
import { StatusChip, type ChipTone } from "@/components/ui/StatusChip";
import type { ScoutStatus } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import {
  approveScoutAction,
  linkAffiliationAction,
  reinstateScoutAction,
  rejectScoutAction,
  suspendScoutAction,
} from "./actions";

export type ScoutAffiliationItem = {
  id: string;
  name: string;
  /** "Club", "Player · Orlando Pirates", "Player · club not given". */
  meta: string;
  linkedName: string | null;
  /** An admin linked it or saved Not matched. Unchecked rows are new to the admins. */
  checked: boolean;
  /** An active organisation with the same name: it counts as a conflict while unlinked. */
  suggestionName: string | null;
  /** Preselected organisation: the linked one, else (unchecked) the suggestion, else "". */
  selected: string;
};

export type ScoutItem = {
  id: string;
  status: ScoutStatus;
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string;
  /** "South African ID" or "Passport · United Kingdom". Never a number. */
  identity: string;
  dateLabel: string;
  date: string;
  termsVersion: string;
  termsCurrent: boolean;
  reason: string | null;
  affiliations: ScoutAffiliationItem[];
};

type OrgOption = { id: string; label: string };

type Forms = {
  approve: SectionForm;
  reject: SectionForm;
  suspend: SectionForm;
  reinstate: SectionForm;
  link: SectionForm;
};

const CAPTIONS: Record<ScoutStatus, string> = {
  pending: "Pending scout registrations, oldest first",
  approved: "Approved scouts, newest first",
  suspended: "Suspended scouts, newest first",
  rejected: "Registrations not approved, newest first",
};

const EMPTY: Record<ScoutStatus, string> = {
  pending: "No registrations waiting. New scouts appear here when they register.",
  approved: "No approved scouts yet.",
  suspended: "No suspended scouts.",
  rejected: "No registrations turned down.",
};

/** The applicant's status chip (Floodlight, "Scout approvals"): shape, icon and word. */
const STATUS_LOOK: Record<ScoutStatus, { tone: ChipTone; icon: LucideIcon; label: string }> = {
  pending: { tone: "warn", icon: Clock, label: "Waiting" },
  approved: { tone: "ok", icon: Check, label: "Approved" },
  suspended: { tone: "danger", icon: Ban, label: "Suspended" },
  rejected: { tone: "danger", icon: X, label: "Rejected" },
};

function ScoutChip({ status }: { status: ScoutStatus }) {
  return <StatusChip size="s" {...STATUS_LOOK[status]} />;
}

function EmailState({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="wl-inline-status wl-inline-status--ok text-body-s font-semibold">
      <MailCheck {...iconProps} />
      Email confirmed
    </span>
  ) : (
    <span className="wl-inline-status wl-inline-status--warn text-body-s font-semibold">
      <MailWarning {...iconProps} />
      Email not confirmed
    </span>
  );
}

function TermsLine({ item }: { item: ScoutItem }) {
  return (
    <>
      <span className="block text-body-s text-ink-muted">Terms {item.termsVersion}</span>
      {!item.termsCurrent && (
        <span className="wl-inline-status wl-inline-status--warn text-body-s">
          <TriangleAlert {...iconProps} />
          Not on current terms
        </span>
      )}
    </>
  );
}

/**
 * The match control. In cards (stacked) the select and Save match stack, full
 * width. In the table they stack below 1280px and share a row from 1280px; the
 * select keeps a minimum width (.wl-table .wl-link-select), so a narrow
 * column makes the table region scroll sideways instead of crushing it.
 */
function LinkForm({
  item,
  affiliation,
  organisations,
  form,
  stacked,
}: {
  item: ScoutItem;
  affiliation: ScoutAffiliationItem;
  organisations: OrgOption[];
  form: SectionForm;
  stacked?: boolean;
}) {
  return (
    <form
      {...form.formProps}
      className={
        stacked
          ? "mt-1 flex flex-col gap-2"
          : "mt-1 flex flex-col items-start gap-2 wide:flex-row wide:items-end"
      }
    >
      <input type="hidden" name="affiliationId" value={affiliation.id} />
      <input type="hidden" name="name" value={item.name} />
      <label className={stacked ? "block" : "wl-link-select block w-full wide:flex-1"}>
        <span className="sr-only">Wideline organisation for {affiliation.name}</span>
        <select name="organisationId" defaultValue={affiliation.selected} className="wl-input">
          <option value="">Not matched</option>
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <SubmitButton
        variant="secondary"
        size="s"
        pendingLabel="Saving"
        aria-label={`Save match for ${affiliation.name}`}
        className={stacked ? "w-full justify-center" : undefined}
      >
        Save match
      </SubmitButton>
    </form>
  );
}

function Conflicts({
  item,
  organisations,
  forms,
  stacked,
}: {
  item: ScoutItem;
  organisations: OrgOption[];
  forms: Forms;
  stacked?: boolean;
}) {
  if (item.affiliations.length === 0) {
    return (
      <>
        <span className="block text-body-s text-ink-muted">None declared</span>
      </>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {item.affiliations.map((a) => (
        <li key={a.id}>
          <span className="inline-flex h-5 max-w-full items-center rounded-control border border-line-strong px-1.5 text-body-s font-medium">
            <span className="truncate">{a.name}</span>
          </span>
          <span className="block text-body-s text-ink-muted">{a.meta}</span>
          {a.linkedName ? (
            <span className="wl-inline-status wl-inline-status--ok text-body-s">
              <Link2 {...iconProps} />
              Matched to {a.linkedName}
            </span>
          ) : a.checked ? (
            <span className="wl-inline-status wl-inline-status--muted text-body-s">
              <Check {...iconProps} />
              Checked: not matched
            </span>
          ) : (
            <span className="wl-inline-status wl-inline-status--warn text-body-s">
              <CircleDashed {...iconProps} />
              Not checked yet
            </span>
          )}
          {!a.linkedName && a.suggestionName && (
            <span className="block text-body-s text-ink-muted">
              Same name as {a.suggestionName}, so it counts as a conflict with it.
            </span>
          )}
          <LinkForm
            item={item}
            affiliation={a}
            organisations={organisations}
            form={forms.link}
            stacked={stacked}
          />
        </li>
      ))}
    </ul>
  );
}

function ReasonField({ visible, required }: { visible: ActionResult; required?: boolean }) {
  return (
    <Field
      label={required ? "Reason" : "Reason (optional)"}
      hint="Included in the email. Keep it short and factual."
      error={fieldError(visible, "reason")}
    >
      {(p) => (
        <textarea {...p} name="reason" required={required} maxLength={500} className="wl-input" />
      )}
    </Field>
  );
}

/** The row actions for a tab. In cards, `block` makes each one share the row. */
function Actions({ item, forms, block }: { item: ScoutItem; forms: Forms; block?: boolean }) {
  const noteId = useId();
  const hidden = { profileId: item.id, name: item.name };
  const row = block ? "flex gap-2 [&>*]:flex-1" : "wl-row justify-end";
  switch (item.status) {
    case "pending":
      return (
        <div>
          <div className={row}>
            <form {...forms.approve.formProps}>
              <input type="hidden" name="profileId" value={item.id} />
              <input type="hidden" name="name" value={item.name} />
              {item.emailVerified ? (
                <SubmitButton
                  variant="secondary"
                  size="s"
                  icon={Check}
                  pendingLabel="Approving"
                  aria-label={`Approve ${item.name}`}
                  className={block ? "w-full justify-center" : undefined}
                >
                  Approve
                </SubmitButton>
              ) : (
                <button
                  type="submit"
                  disabled
                  aria-label={`Approve ${item.name}`}
                  aria-describedby={noteId}
                  className={`wl-btn wl-btn--secondary wl-btn--s${block ? " w-full justify-center" : ""}`}
                >
                  <Check {...iconProps} />
                  Approve
                </button>
              )}
            </form>
            <ConfirmDialog
              trigger={{
                label: "Reject",
                // Danger only inside the dialog (Floodlight); the trigger is secondary.
                variant: "secondary",
                icon: X,
                ariaLabel: `Reject ${item.name}`,
              }}
              title={`Reject ${item.name}?`}
              body={`We email ${item.name} at ${item.email} to say their registration was not approved. They cannot register again with the same ID or passport.`}
              form={forms.reject}
              hidden={hidden}
              submit={{
                label: "Reject registration",
                pendingLabel: "Rejecting",
                variant: "danger",
              }}
            >
              {(visible) => <ReasonField visible={visible} />}
            </ConfirmDialog>
          </div>
          {!item.emailVerified && (
            <p
              id={noteId}
              className={`m-0 mt-2 text-body-s text-ink-muted${block ? "" : " text-right"}`}
            >
              Approve once their email is confirmed.
            </p>
          )}
        </div>
      );
    case "approved":
      return (
        <div className={row}>
          <ConfirmDialog
            trigger={{
              label: "Suspend",
              variant: "secondary",
              icon: Ban,
              ariaLabel: `Suspend ${item.name}`,
            }}
            title={`Suspend ${item.name}?`}
            body={`${item.name} loses access to the review queue on their next page load. We email them the reason.`}
            form={forms.suspend}
            hidden={hidden}
            submit={{ label: "Suspend scout", pendingLabel: "Suspending", variant: "danger" }}
          >
            {(visible) => <ReasonField visible={visible} required />}
          </ConfirmDialog>
        </div>
      );
    case "suspended":
      return (
        <div className={row}>
          <ConfirmDialog
            trigger={{
              label: "Reinstate",
              variant: "secondary",
              icon: RotateCcw,
              ariaLabel: `Reinstate ${item.name}`,
            }}
            title={`Reinstate ${item.name}?`}
            body={`${item.name} can review matches again once they have accepted the current terms. We email them to say so.`}
            form={forms.reinstate}
            hidden={hidden}
            submit={{ label: "Reinstate scout", pendingLabel: "Reinstating", variant: "primary" }}
          />
        </div>
      );
    case "rejected":
      return null;
  }
}

/** The scouts of one tab: a table from 768px, cards on phones, with the banner slot. */
export function ScoutApplications({
  status,
  uncheckedOnly = false,
  items,
  organisations,
}: {
  status: ScoutStatus;
  /** The list keeps only scouts with an unchecked club or player. */
  uncheckedOnly?: boolean;
  items: ScoutItem[];
  organisations: OrgOption[];
}) {
  const [result, setResult] = useState<ActionResult>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  // Decisions move focus to the section heading; a saved match keeps focus on its button.
  const report = (moveFocus: boolean) => (r: ActionResult) => {
    setResult(r);
    if (r?.ok && moveFocus) headingRef.current?.focus();
  };
  const forms: Forms = {
    approve: useSectionAction(approveScoutAction, report(true)),
    reject: useSectionAction(rejectScoutAction, report(true)),
    suspend: useSectionAction(suspendScoutAction, report(true)),
    reinstate: useSectionAction(reinstateScoutAction, report(true)),
    link: useSectionAction(linkAffiliationAction, report(false)),
  };
  const rejected = status === "rejected";
  const caption = CAPTIONS[status];

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="sr-only">
        Scouts
      </h2>
      <div aria-live="polite" className="mt-6 empty:mt-0">
        <SuccessBanner result={result} />
        {result && !result.ok && result.formError && (
          <Banner tone="danger">{result.formError}</Banner>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-6">
          <StateMessage
            kind="empty"
            icon={Users}
            headingLevel={3}
            title={uncheckedOnly ? "Everything here is checked" : "No scouts here"}
            body={uncheckedOnly ? "Every club and player here has been checked." : EMPTY[status]}
          />
        </div>
      ) : (
        <>
          <div
            className="wl-table-wrap mt-4 hidden border border-line bg-panel tablet:block"
            role="region"
            aria-label={caption}
            tabIndex={0}
          >
            <table className="wl-table">
              <caption className="sr-only">{caption}</caption>
              <thead>
                <tr>
                  <th scope="col">Applicant</th>
                  <th scope="col" aria-sort={status === "pending" ? "ascending" : "descending"}>
                    {items[0]!.dateLabel}
                  </th>
                  <th scope="col">{rejected ? "Reason" : "Declared clubs"}</th>
                  <th scope="col">ID document</th>
                  <th scope="col">Status</th>
                  {!rejected && (
                    <th scope="col" className="num">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="align-top">
                    <td>
                      <span className="block font-semibold break-words">{i.name}</span>
                      <span className="block font-mono text-body-s break-all text-ink-muted">
                        {i.email} · {i.phone}
                      </span>
                      <EmailState verified={i.emailVerified} />
                    </td>
                    <td>
                      <span className="block font-mono text-mono-m whitespace-nowrap text-ink-muted tabular-nums">
                        {i.date}
                      </span>
                      <TermsLine item={i} />
                      {i.status === "suspended" && i.reason && (
                        <span className="block text-body-s">Reason: {i.reason}</span>
                      )}
                    </td>
                    <td>
                      {rejected ? (
                        i.reason ? (
                          <span>{i.reason}</span>
                        ) : (
                          <span className="text-ink-muted">–</span>
                        )
                      ) : (
                        <Conflicts item={i} organisations={organisations} forms={forms} />
                      )}
                    </td>
                    <td className="text-body-s">{i.identity}</td>
                    <td>
                      <ScoutChip status={i.status} />
                    </td>
                    {!rejected && (
                      <td>
                        <Actions item={i} forms={forms} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul role="list" className="wl-listrows mt-4 tablet:hidden">
            {items.map((i) => (
              <li key={i.id} className="flex flex-col gap-3 border-b border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-semibold break-words">{i.name}</span>
                  <ScoutChip status={i.status} />
                </div>
                <div>
                  <span className="block font-mono text-body-s break-all">{i.email}</span>
                  <EmailState verified={i.emailVerified} />
                  <span className="block font-mono text-body-s tabular-nums">{i.phone}</span>
                </div>
                <div className="text-body-s text-ink-muted">
                  <span className="block">{i.identity}</span>
                  <span className="block">
                    {i.dateLabel} <span className="font-mono tabular-nums">{i.date}</span>
                  </span>
                  <TermsLine item={i} />
                </div>
                {i.reason && i.status !== "pending" && (
                  <p className="m-0">
                    {i.status === "suspended" ? `Reason: ${i.reason}` : i.reason}
                  </p>
                )}
                {!rejected && (
                  <>
                    <h3 className="m-0 font-mono text-overline uppercase text-ink-muted">
                      Declared clubs
                    </h3>
                    <Conflicts item={i} organisations={organisations} forms={forms} stacked />
                  </>
                )}
                <Actions item={i} forms={forms} block />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
