"use client";

import { fieldError, FormErrorBanner, SubmitButton, useFormAction } from "@/components/forms";
import type { ActionResult } from "@/lib/action-result";
import { undoDepartureAction } from "./players/actions";

/**
 * Restore on the Departed list (Floodlight, "Squad"): the same undo-departure action as the
 * player page, shown only while the undo window is open. Success opens the player page with
 * its banner; an error (a squad number a teammate now wears) shows under the button.
 */
export function RestorePlayer({ playerId, name }: { playerId: string; name: string }) {
  const { state, pending, formProps } = useFormAction(undoDepartureAction, null as ActionResult);
  const error = fieldError(state, "squadNumber");
  return (
    <form {...formProps} className="flex flex-col items-end gap-2">
      <input type="hidden" name="playerId" value={playerId} />
      <SubmitButton
        variant="secondary"
        size="s"
        pending={pending}
        pendingLabel="Restoring"
        aria-label={`Restore ${name}`}
      >
        Restore
      </SubmitButton>
      <FormErrorBanner result={state} />
      {error && (
        <p role="alert" className="m-0 max-w-64 text-right text-body-s text-rejected">
          {error}
        </p>
      )}
    </form>
  );
}
