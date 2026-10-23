"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { useFormAction } from "./forms";

/**
 * The banner state of a page section (docs/build/design/C01.md). Row actions
 * keep their action state here, in the section, not in the row: a successful
 * action often removes its own row (revoke, approve), and a row that unmounts
 * could never report its result. On success, focus moves to the section h2.
 */
export function useSectionResult() {
  const [result, setResult] = useState<ActionResult>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (result?.ok) headingRef.current?.focus();
  }, [result]);
  return { result, setResult, headingRef };
}

/**
 * A section-level action shared by every row's form. Its results go to the
 * section banner; with `okOnly`, errors stay with the caller (a dialog shows
 * its own errors).
 */
export function useSectionAction(
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>,
  report: (result: ActionResult) => void,
  { okOnly = false }: { okOnly?: boolean } = {},
) {
  const form = useFormAction(action, null as ActionResult);
  useEffect(() => {
    if (form.state && (form.state.ok || !okOnly)) report(form.state);
    // Report each result once; report is a state setter or a fresh closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.state]);
  return form;
}

export type SectionForm = ReturnType<typeof useSectionAction>;
