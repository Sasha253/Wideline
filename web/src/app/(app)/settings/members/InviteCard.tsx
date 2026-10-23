"use client";

import { Send } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  Field,
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import type { ActionResult } from "@/lib/action-result";
import { inviteMember } from "./actions";

type RoleOption = { value: string; label: string };

/** The invite form. On success the form resets and focus returns to Email. */
export function InviteCard({
  orgName,
  roles,
  isOwner,
}: {
  orgName: string;
  roles: RoleOption[];
  isOwner: boolean;
}) {
  const { state, formProps } = useFormAction(inviteMember, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  useFocusFirstInvalid(formRef, state);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      emailRef.current?.focus();
    }
  }, [state]);

  return (
    <section aria-labelledby="invite-heading" className="wl-card mt-8">
      <h2 id="invite-heading" tabIndex={-1} className="heading-2">
        Invite someone
      </h2>
      <div aria-live="polite" className="mt-4 empty:mt-0">
        <SuccessBanner result={state} />
      </div>
      <form
        ref={formRef}
        {...formProps}
        noValidate
        className="mt-4 grid grid-cols-1 items-start gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-6"
      >
        <FormBusy formRef={formRef} />
        <Field label="Email" error={fieldError(state, "email")} className="lg:col-span-5">
          {(p) => (
            <input
              {...p}
              ref={emailRef}
              type="email"
              name="email"
              autoComplete="off"
              required
              className="wl-input"
            />
          )}
        </Field>
        <Field
          label="Name (optional)"
          hint="Used in the email greeting."
          error={fieldError(state, "name")}
          className="lg:col-span-3"
        >
          {(p) => (
            <input {...p} name="name" autoComplete="off" maxLength={120} className="wl-input" />
          )}
        </Field>
        <Field
          label="Role"
          hint={isOwner ? undefined : "Only an owner can invite another owner."}
          className="lg:col-span-2"
        >
          {(p) => (
            <select {...p} name="role" defaultValue="coach" className="wl-input">
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {/* An invisible label-sized spacer lines the button up with the inputs, whatever
            hints sit under them. */}
        <div className="wl-field md:self-start lg:col-span-2">
          <span className="label invisible hidden md:block" aria-hidden="true">
            Send
          </span>
          <SubmitButton icon={Send} block pendingLabel="Sending…" className="justify-center">
            Send invitation
          </SubmitButton>
        </div>
        <div className="flex flex-col gap-2 md:col-span-2 lg:col-span-12">
          <FormErrorBanner result={state} />
          <p className="wl-field__hint caption">
            Invitations expire after 14 days. We email a link to join {orgName}.
          </p>
        </div>
      </form>
    </section>
  );
}
