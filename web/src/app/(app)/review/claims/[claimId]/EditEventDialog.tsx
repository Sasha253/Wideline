"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReviewSide, WorkspaceEntry, WorkspaceEvent } from "@/lib/review-workspace";
import type { ReviewRefusal } from "./actions";
import { EventFields, type EventFieldValues } from "./EventFields";
import { ReviewDialog } from "./ReviewDialog";

/**
 * Edit event (REVIEW03, REVIEW04; docs/build/design/C11.md, Surface 2): the
 * type, on target, side and player of one event, saved as one action that
 * also confirms it. A player refusal (not_attributable, not_in_lineup) is a
 * field error on Player, which takes focus; any other error shows in the
 * dialog. Nothing shows as saved until the server answers.
 */
export function EditEventDialog({
  event,
  summary,
  entries,
  teams,
  onSave,
  onClose,
}: {
  /** Null while closed. */
  event: WorkspaceEvent | null;
  /** "{time} · {type} · {who}". */
  summary: string;
  entries: readonly WorkspaceEntry[];
  teams: Record<ReviewSide, string>;
  onSave: (event: WorkspaceEvent, values: EventFieldValues) => Promise<ReviewRefusal | null>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<EventFieldValues | null>(null);
  const [error, setError] = useState<ReviewRefusal | null>(null);
  const [pending, setPending] = useState(false);
  const playerRef = useRef<HTMLSelectElement>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  // A new event opens a fresh form.
  if ((event?.id ?? null) !== openedFor) {
    setOpenedFor(event?.id ?? null);
    setError(null);
    setValues(
      event
        ? {
            type: event.type,
            onTarget: event.onTarget === true,
            side: event.side ?? "home",
            entryId:
              event.entryId &&
              entries.find((e) => e.id === event.entryId)?.side === (event.side ?? "home")
                ? event.entryId
                : null,
          }
        : null,
    );
  }

  useEffect(() => {
    if (error?.field === "player") playerRef.current?.focus();
  }, [error]);

  async function save() {
    if (!event || !values) return;
    setPending(true);
    const refusal = await onSave(event, values);
    setPending(false);
    setError(refusal);
  }

  return (
    <ReviewDialog
      open={event !== null}
      title="Edit event"
      body={
        <>
          <span className="block">was {summary}</span>
          <span className="mt-1 block font-ui text-body-s">Saving confirms the event.</span>
        </>
      }
      formError={error && error.field !== "player" ? error.message : null}
      pending={pending}
      submitIcon={Check}
      submitLabel="Save and confirm"
      pendingLabel="Saving…"
      onSubmit={save}
      onClose={onClose}
    >
      {values && (
        <EventFields
          values={values}
          onChange={setValues}
          entries={entries}
          teams={teams}
          playerRef={playerRef}
          playerHint="Choosing a player moves this event to them. To move every event of a track, use the Tracks tab."
          playerError={error?.field === "player" ? error.message : undefined}
        />
      )}
    </ReviewDialog>
  );
}
