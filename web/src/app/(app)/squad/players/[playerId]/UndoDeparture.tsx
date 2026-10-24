"use client";

import { Undo2 } from "lucide-react";
import {
  Banner,
  fieldError,
  FormErrorBanner,
  SubmitButton,
  useFormAction,
} from "@/components/forms";
import type { ActionResult } from "@/lib/action-result";
import { undoDepartureAction } from "../actions";

/**
 * Undo a departure (SQUAD09, Q-012) while the window is open. Success reloads
 * the player page with its banner; a squad number a teammate now wears comes
 * back as an error above the button.
 */
export function UndoDeparture({ playerId, until }: { playerId: string; until: string }) {
  const { state, formProps } = useFormAction(undoDepartureAction, null as ActionResult);
  const numberError = fieldError(state, "squadNumber");
  return (
    <form {...formProps} className="flex flex-col items-start gap-3">
      <input type="hidden" name="playerId" value={playerId} />
      <FormErrorBanner result={state} />
      {numberError && <Banner tone="danger">{numberError}</Banner>}
      <SubmitButton variant="secondary" size="sm" icon={Undo2} pendingLabel="Undoing…">
        Undo departure
      </SubmitButton>
      <p className="caption text-ink-muted">You can undo this until {until}.</p>
    </form>
  );
}
