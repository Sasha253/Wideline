"use client";

import { Circle, CircleCheck, MailWarning, RotateCw } from "lucide-react";
import { useRef } from "react";
import { Banner, FormBusy, SubmitButton, useFormAction } from "@/components/forms";
import { ButtonLink } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import { ScoutStatusChip } from "@/components/ui/StatusChip";
import type { ScoutStatus } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import { resendEmailConfirmationAction } from "./actions";

/** Where the registration stands and what happens next (docs/build/design/C02.md, Status panel). */
export function StatusPanel({
  status,
  email,
  emailVerified,
  termsCurrent,
  verified,
  reviewed,
  suspended,
  rejectionReason,
  suspensionReason,
}: {
  status: ScoutStatus;
  email: string;
  emailVerified: boolean;
  termsCurrent: boolean;
  verified: string | null;
  reviewed: string | null;
  suspended: string | null;
  rejectionReason: string | null;
  suspensionReason: string | null;
}) {
  const questions = (
    <p className="mt-2 text-ink-muted">If you have questions, reply to the email we sent you.</p>
  );

  let title: string;
  let body: string;
  let action: React.ReactNode = null;
  let content: React.ReactNode = null;
  switch (status) {
    case "pending":
      title = "We are checking your registration";
      body = `A Wideline admin checks every scout before they can review matches. We email ${email} when it is decided.`;
      content = (
        <>
          <h3 className="text-label">What happens next</h3>
          <ol className="wl-checklist mt-2">
            <ChecklistItem done={emailVerified}>Confirm your email</ChecklistItem>
            <ChecklistItem done={false}>A Wideline admin checks your details</ChecklistItem>
            <ChecklistItem done={false}>You can review matches</ChecklistItem>
          </ol>
        </>
      );
      break;
    case "approved":
      if (termsCurrent) {
        title = "You can review matches";
        body = verified ? `Approved on ${verified}.` : "Approved.";
        action = (
          <ButtonLink href="/review" variant="primary" block className="justify-center">
            Go to the review queue
          </ButtonLink>
        );
      } else {
        title = "Accept the new terms to keep reviewing";
        body =
          "We updated the reviewer confidentiality terms. Read them and accept them to review matches again.";
        action = (
          <ButtonLink href="#terms" variant="secondary" block className="justify-center">
            Read the new terms
          </ButtonLink>
        );
      }
      break;
    case "rejected":
      title = "Your registration was not approved";
      body = reviewed ? `Decided on ${reviewed}.` : "";
      content = (
        <>
          {rejectionReason && <p>Reason: {rejectionReason}</p>}
          {questions}
        </>
      );
      break;
    case "suspended":
      title = "Your review access is suspended";
      body = `${suspended ? `Suspended on ${suspended}. ` : ""}You cannot claim or review matches. Your details and conflicts stay as they are.`;
      content = (
        <>
          {suspensionReason && <p>Reason: {suspensionReason}</p>}
          {questions}
        </>
      );
      break;
  }

  return (
    <section aria-labelledby="scout-status-heading" className="wl-card mt-6">
      <ScoutStatusChip status={status} />
      <div className="mt-2 flex flex-col gap-4 tablet:flex-row tablet:flex-wrap tablet:items-start tablet:justify-between">
        <h2
          id="scout-status-heading"
          tabIndex={-1}
          className="m-0 font-display text-heading-section uppercase stretch-wide"
        >
          {title}
        </h2>
        {action}
      </div>
      {body && <p className="mt-2 text-ink-muted">{body}</p>}
      {content && <div className="mt-4">{content}</div>}
      {!emailVerified && status !== "rejected" && (
        <EmailConfirmation email={email} approved={status === "approved"} />
      )}
    </section>
  );
}

function ChecklistItem({ done, children }: { done: boolean; children: React.ReactNode }) {
  const Icon = done ? CircleCheck : Circle;
  return (
    <li data-done={done ? "true" : undefined}>
      <Icon {...iconProps} />
      <span>
        <span className="sr-only">{done ? "Done: " : "To do: "}</span>
        {children}
      </span>
    </li>
  );
}

function EmailConfirmation({ email, approved }: { email: string; approved: boolean }) {
  const { state, formProps } = useFormAction(resendEmailConfirmationAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <div className="mt-4" aria-live="polite">
      {state?.ok ? (
        <Banner tone="ok">{state.message}</Banner>
      ) : (
        <>
          <div className="wl-banner" role="status">
            <MailWarning {...iconProps} />
            <p>
              {approved
                ? `Confirm your email. We sent a link to ${email}.`
                : `Confirm your email. We sent a link to ${email}. We cannot approve your registration until you confirm it.`}
            </p>
          </div>
          {state && !state.ok && state.formError && (
            <div className="mt-3">
              <Banner tone="danger">{state.formError}</Banner>
            </div>
          )}
        </>
      )}
      <form ref={formRef} {...formProps} className="mt-3">
        <FormBusy formRef={formRef} />
        <SubmitButton variant="secondary" size="sm" icon={RotateCw} pendingLabel="Sending…">
          Resend email
        </SubmitButton>
      </form>
    </div>
  );
}
