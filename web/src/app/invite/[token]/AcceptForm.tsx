"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import { TextField } from "@/components/ui/TextField";
import type { ActionResult } from "@/lib/action-result";
import { acceptInvitationAction, type AcceptResult } from "./actions";

/**
 * Join (signed in, matching email) or create an account and join (new email).
 * When the invitation changed since the page loaded, the page re-renders the
 * matching state instead of showing an error.
 */
export function AcceptForm(
  props:
    | { token: string; mode: "join"; joinLabel: string }
    | { token: string; mode: "new"; email: string; name: string },
) {
  const router = useRouter();
  const { state, formProps } = useFormAction(acceptInvitationAction, null as AcceptResult);
  const formRef = useRef<HTMLFormElement>(null);
  const result: ActionResult = state && "refresh" in state ? null : state;
  useFocusFirstInvalid(formRef, result);

  useEffect(() => {
    if (state && "refresh" in state) router.refresh();
  }, [state, router]);

  const err = (name: string) => (result && !result.ok ? result.fieldErrors?.[name] : undefined);

  if (props.mode === "join") {
    return (
      <form ref={formRef} {...formProps} className="mt-6 flex flex-col gap-4">
        <FormBusy formRef={formRef} />
        <input type="hidden" name="token" value={props.token} />
        <FormErrorBanner result={result} />
        <SubmitButton size="l" block pendingLabel="Joining…">
          {props.joinLabel}
        </SubmitButton>
      </form>
    );
  }

  return (
    <form ref={formRef} {...formProps} className="mt-6 flex flex-col gap-5" noValidate>
      <FormBusy formRef={formRef} />
      <input type="hidden" name="token" value={props.token} />
      {/* Read-only, not disabled, so it can be copied (Floodlight input rule). */}
      <TextField
        label="Email"
        type="email"
        readOnly
        autoComplete="username"
        value={props.email}
        help="The email this invitation was sent to."
      />
      <TextField
        label="Your name"
        name="name"
        autoComplete="name"
        required
        maxLength={120}
        defaultValue={props.name}
        error={err("name")}
      />
      <TextField
        label="Password"
        type="password"
        name="password"
        autoComplete="new-password"
        required
        minLength={12}
        help="At least 12 characters."
        error={err("password")}
      />
      <FormErrorBanner result={result} />
      <SubmitButton size="l" block pendingLabel="Creating account…">
        Create account and join
      </SubmitButton>
    </form>
  );
}
