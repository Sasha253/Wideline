"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { UNEXPECTED_ERROR } from "@/lib/action-result";
import { acceptInvitation, InvitationError, signInNewMember } from "@/server/auth/invitations";
import { setActiveOrganisation } from "@/server/auth/organisations";
import { getUserContext } from "@/server/auth/session";
import { log } from "@/server/log";

/**
 * Public: the invitation token is the capability, so this action is on the
 * guarded-actions allowlist (tests/unit/server-actions-guarded.test.ts).
 * acceptInvitation re-checks the token in one transaction.
 */

export type AcceptResult =
  | null
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> }
  /** The invitation changed since the page loaded: the page re-renders that state. */
  | { ok: false; refresh: true };

const newUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Enter your name." })
    .max(120, { error: "Use 120 characters or fewer." }),
  password: z
    .string()
    .min(12, { error: "Use at least 12 characters." })
    .max(128, { error: "Use 128 characters or fewer." }),
});

export async function acceptInvitationAction(
  _prev: AcceptResult,
  formData: FormData,
): Promise<AcceptResult> {
  const token = String(formData.get("token") ?? "");
  const ctx = await getUserContext();

  let organisationId: string;
  try {
    if (ctx) {
      const res = await acceptInvitation({
        token,
        signedInUser: { id: ctx.user.id, email: ctx.user.email },
      });
      organisationId = res.organisationId;
      await setActiveOrganisation(ctx.sessionId, ctx.user.id, organisationId);
    } else {
      const parsed = newUserSchema.safeParse({
        name: formData.get("name") ?? "",
        password: formData.get("password") ?? "",
      });
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0]);
          fieldErrors[key] ??= issue.message;
        }
        return { ok: false, fieldErrors };
      }
      const res = await acceptInvitation({ token, newUser: parsed.data });
      organisationId = res.organisationId;
      await signInNewMember({
        email: res.email,
        password: parsed.data.password,
        organisationId,
      });
    }
  } catch (err) {
    if (err instanceof InvitationError) return { ok: false, refresh: true };
    log.error({ err }, "accept invitation failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
  redirect("/");
}
