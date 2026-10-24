"use client";

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
import { useSectionAction, useSectionResult } from "@/components/section-result";
import type { ActionResult } from "@/lib/action-result";
import { addSubstitutionAction, removeSubstitutionAction } from "./actions";

export type SubstitutionItem = {
  offLineupId: string;
  minute: number;
  /** "#9 Sipho Dlamini" */
  offLabel: string;
  onLabel: string | null;
};

export type PlayerOption = { id: string; label: string };

/**
 * Substitutions for one side (SQUAD06; docs/build/design/C06.md, Surface 4):
 * the list by minute, with Remove, and the add form. Minutes played come from
 * these. Locked matches show the list only.
 */
export function Substitutions({
  matchId,
  teamId,
  maxMinute,
  items,
  onPitch,
  unused,
  hasLineup,
  locked,
}: {
  matchId: string;
  teamId: string;
  maxMinute: number;
  items: SubstitutionItem[];
  onPitch: PlayerOption[];
  unused: PlayerOption[];
  hasLineup: boolean;
  locked: boolean;
}) {
  const { result, setResult, headingRef } = useSectionResult();
  // Row forms share one section-level action: a removed row could not report its own result.
  const remove = useSectionAction(removeSubstitutionAction, setResult);
  const { state, formProps } = useFormAction(addSubstitutionAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  useFocusFirstInvalid(formRef, state);
  const okKey = state?.ok ? state.key : undefined;
  useEffect(() => {
    if (!okKey) return;
    formRef.current?.reset();
    minuteRef.current?.focus();
  }, [okKey]);
  // The newest success of the add form and the remove buttons.
  const banner =
    [state, result]
      .filter((r): r is Extract<ActionResult, { ok: true }> => !!r?.ok)
      .sort((a, b) => Number(b.key ?? 0) - Number(a.key ?? 0))[0] ?? null;

  return (
    <section aria-labelledby="substitutions-heading" className="mt-8 max-w-4xl">
      <h2 id="substitutions-heading" ref={headingRef} tabIndex={-1} className="heading-2">
        Substitutions
      </h2>
      <p className="body mt-2 text-ink-muted">
        Add each change with the minute it happened. Minutes played are worked out from these.
      </p>
      <div aria-live="polite" className="mt-4 empty:mt-0">
        <SuccessBanner key={banner?.ok ? banner.key : undefined} result={banner} />
        {result && !result.ok && <FormErrorBanner result={result} />}
      </div>
      {!hasLineup ? (
        <p className="body mt-4">Save the lineup first. Then add substitutions.</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="body mt-4 text-ink-muted">No substitutions yet.</p>
          ) : (
            <ul className="mt-4" role="list">
              {items.map((item) => (
                <li
                  key={item.offLineupId}
                  className="flex flex-wrap items-center gap-3 border-b border-line py-3"
                >
                  <span className="data">{item.minute} min</span>
                  <span className="body">
                    Off: <span className="body-strong">{item.offLabel}</span>
                  </span>
                  <span className="body">
                    On:{" "}
                    {item.onLabel ? (
                      <span className="body-strong">{item.onLabel}</span>
                    ) : (
                      <span className="text-ink-muted">No replacement</span>
                    )}
                  </span>
                  {!locked && (
                    <form {...remove.formProps} className="ml-auto">
                      <input type="hidden" name="matchId" value={matchId} />
                      <input type="hidden" name="teamId" value={teamId} />
                      <input type="hidden" name="offLineupId" value={item.offLineupId} />
                      <SubmitButton
                        variant="ghost"
                        size="sm"
                        pendingLabel="Removing…"
                        aria-label={`Remove the substitution at ${item.minute} min`}
                      >
                        Remove
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!locked && (
            <form ref={formRef} {...formProps} noValidate className="wl-card mt-4">
              <FormBusy formRef={formRef} />
              <input type="hidden" name="matchId" value={matchId} />
              <input type="hidden" name="teamId" value={teamId} />
              <input type="hidden" name="maxMinute" value={maxMinute} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field
                  label="Minute"
                  hint={`1 to ${maxMinute}.`}
                  error={fieldError(state, "minute")}
                >
                  {(p) => (
                    <input
                      {...p}
                      ref={minuteRef}
                      type="number"
                      inputMode="numeric"
                      name="minute"
                      min={1}
                      max={maxMinute}
                      className="wl-input"
                    />
                  )}
                </Field>
                <Field label="Player off" error={fieldError(state, "offLineupId")}>
                  {(p) => (
                    <select {...p} name="offLineupId" className="wl-input" defaultValue="">
                      <option value="">Choose a player</option>
                      {onPitch.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Player on" error={fieldError(state, "onLineupId")}>
                  {(p) => (
                    <select {...p} name="onLineupId" className="wl-input" defaultValue="">
                      <option value="">Choose a player</option>
                      {unused.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                      <option value="none">No replacement (injury or red card)</option>
                    </select>
                  )}
                </Field>
              </div>
              <div className="mt-4 flex flex-col gap-4">
                <FormErrorBanner result={state} />
                <div>
                  <SubmitButton
                    variant="secondary"
                    block
                    pendingLabel="Adding…"
                    className="justify-center"
                  >
                    Add substitution
                  </SubmitButton>
                </div>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
