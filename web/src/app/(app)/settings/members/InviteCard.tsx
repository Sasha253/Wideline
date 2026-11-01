"use client";

import { Send } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import { FieldMessage, Select, TextField } from "@/components/ui/TextField";
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
    <section
      aria-labelledby="invite-heading"
      className="mt-6 flex flex-col gap-4 border border-line bg-panel p-4 tablet:p-5"
    >
      <h2
        id="invite-heading"
        tabIndex={-1}
        className="m-0 font-display text-heading-section stretch-wide uppercase"
      >
        Invite someone
      </h2>
      <div aria-live="polite" className="empty:hidden">
        <SuccessBanner result={state} />
      </div>
      <form
        ref={formRef}
        {...formProps}
        noValidate
        className="grid grid-cols-1 items-start gap-4 tablet:grid-cols-2 desktop:grid-cols-12 desktop:gap-5"
      >
        <FormBusy formRef={formRef} />
        <TextField
          ref={emailRef}
          label="Email"
          type="email"
          name="email"
          autoComplete="off"
          placeholder="name@club.co.za"
          required
          error={fieldError(state, "email")}
          className="desktop:col-span-5"
        />
        <TextField
          label="Name (optional)"
          name="name"
          autoComplete="off"
          maxLength={120}
          help="Used in the email greeting."
          error={fieldError(state, "name")}
          className="desktop:col-span-3"
        />
        <Select
          label="Role"
          name="role"
          defaultValue="coach"
          options={roles}
          help={isOwner ? undefined : "Only an owner can invite another owner."}
          className="desktop:col-span-2"
        />
        {/* An invisible label-sized spacer lines the button up with the inputs, whatever
            hints sit under them. */}
        <div className="wl-field tablet:self-start desktop:col-span-2">
          <span className="wl-field__label invisible hidden tablet:block" aria-hidden="true">
            Send
          </span>
          <SubmitButton icon={Send} block pendingLabel="Sending…">
            Send invitation
          </SubmitButton>
        </div>
        <div className="flex flex-col gap-2 tablet:col-span-2 desktop:col-span-12">
          <FormErrorBanner result={state} />
          <FieldMessage>
            Invitations expire after 14 days. We email a link to join {orgName}.
          </FieldMessage>
        </div>
      </form>
    </section>
  );
}
