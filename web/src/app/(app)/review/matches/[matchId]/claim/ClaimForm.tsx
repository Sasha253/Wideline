"use client";

import { Check, Timer } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  Banner,
  FieldErrorText,
  fieldError,
  SubmitButton,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import { ButtonLink } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import type { ReviewErrorCode } from "@/server/review/errors";
import { claimMatchAction, type ReviewActionResult } from "../../../actions";

/** Refusals that replace the form: trying again cannot help. */
const REPLACES_FORM = new Set<ReviewErrorCode | "failed">([
  "already_claimed",
  "conflict",
  "claim_limit",
  "not_available",
  "impersonation_refused",
]);

/** The links under a refusal (docs/build/design/C10.md, Surface 2, "Errors"). */
export function RefusalLinks({ code }: { code: ReviewErrorCode | "failed" }) {
  if (code === "impersonation_refused") {
    return (
      <ButtonLink variant="secondary" href="/review" block className="justify-center">
        Back to the review queue
      </ButtonLink>
    );
  }
  if (code === "claim_limit") {
    return (
      <ButtonLink variant="primary" href="/review" block className="justify-center">
        Go to your claimed match
      </ButtonLink>
    );
  }
  return (
    <>
      <ButtonLink variant="primary" href="/review" block className="justify-center">
        Back to the review queue
      </ButtonLink>
      {code === "conflict" && (
        <Link
          href="/scout#scout-conflicts-heading"
          className="body wl-link-row text-pitch underline"
        >
          Check your list on your scout profile
        </Link>
      )}
    </>
  );
}

/**
 * The no-conflict declaration and Claim match (REVIEW01, REVIEW02;
 * docs/build/design/C10.md, Surface 2). Posts without JavaScript too. The
 * server checks everything again; a refusal that trying again cannot fix
 * replaces the form with its banner and links.
 */
export function ClaimForm({
  matchId,
  coolingOffDays,
}: {
  matchId: string;
  /** CONFLICT_COOLING_OFF_DAYS (Q-006), passed by the server page. */
  coolingOffDays: number;
}) {
  const { state, pending, formProps } = useFormAction(
    claimMatchAction.bind(null, matchId),
    null as ReviewActionResult,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, state);
  useEffect(() => {
    if (state && !state.ok && state.formError) bannerRef.current?.focus();
  }, [state]);

  const error = fieldError(state, "declaration");
  const formError = state && !state.ok ? state.formError : undefined;

  if (state && !state.ok && formError && REPLACES_FORM.has(state.code)) {
    return (
      <div className="mt-8">
        <div ref={bannerRef} tabIndex={-1}>
          <Banner tone={state.code === "impersonation_refused" ? "warn" : "danger"}>
            {formError}
          </Banner>
        </div>
        <div className="wl-row mt-4">
          <RefusalLinks code={state.code} />
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} {...formProps} noValidate aria-busy={pending || undefined} className="mt-8">
      {formError && (
        <div ref={bannerRef} tabIndex={-1} className="mb-4">
          <Banner tone="danger">{formError}</Banner>
        </div>
      )}
      <label className="wl-decision__choice wl-decision__choice--top">
        <input
          type="checkbox"
          name="declaration"
          value="yes"
          required
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? "claim-declaration-hint claim-declaration-error" : "claim-declaration-hint"
          }
        />
        <span className="body min-w-0 break-words">
          I have no link to either club or to any player in this match.
        </span>
        <Check {...iconProps} />
      </label>
      <p id="claim-declaration-hint" className="caption mt-2 text-ink-muted">
        This includes clubs and players you stopped working with in the last {coolingOffDays} days.
        Wideline records that you confirmed this.
      </p>
      {error && <FieldErrorText id="claim-declaration-error" message={error} />}
      <div className="wl-row mt-6">
        <SubmitButton
          icon={Timer}
          pendingLabel="Claiming…"
          pending={pending}
          block
          className="justify-center"
        >
          Claim match
        </SubmitButton>
        <ButtonLink variant="secondary" href="/review" block className="justify-center">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
