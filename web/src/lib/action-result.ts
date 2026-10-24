/**
 * What a form's server action returns to useActionState
 * (docs/build/design/C01.md, "Server action results").
 */
export type ActionResult =
  | {
      ok: true;
      message: string;
      /** "warn" for a partial success, such as a saved invitation whose email did not send. */
      tone?: "ok" | "warn";
      /** Changes on every success, so a form can reset itself. */
      key?: string;
      /** A page about what the action made, linked after the message ("View player", C04). */
      href?: string;
      /** Values the client shows once and never puts in a URL, such as a guardian link (C05). */
      values?: Record<string, string>;
    }
  | {
      ok: false;
      formError?: string;
      /** First message per field name. */
      fieldErrors?: Record<string, string>;
    }
  | null;

export const UNEXPECTED_ERROR = "Something went wrong. Try again.";

/** The first message of each field from a zod error's issues. */
export function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/**
 * Like fieldErrorsFrom, keyed by the whole path ("clubName.2"), for forms with
 * repeated rows (docs/build/design/C02.md, registration step 3).
 */
export function fieldErrorsByPath(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}
