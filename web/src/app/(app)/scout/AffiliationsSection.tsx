"use client";

import { CircleDashed, Link2, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Banner,
  Field,
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFormAction,
} from "@/components/forms";
import { useSectionAction, type SectionForm } from "@/components/section-result";
import { iconProps } from "@/components/ui/icons";
import type { ScoutAffiliationType } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import { addAffiliationAction, removeAffiliationAction } from "./actions";

export type AffiliationItem = {
  id: string;
  type: ScoutAffiliationType;
  name: string;
  clubName: string | null;
  linked: boolean;
  declared: string;
};

/**
 * The clubs and players a scout is linked to (AUTH10; docs/build/design/C02.md,
 * Conflicts section). Added and removed rows report to the section banner;
 * removal is soft on the server and audited. A removed entry keeps blocking
 * for CONFLICT_COOLING_OFF_DAYS (Q-006; docs/build/design/C10.md, Surface 5):
 * the page passes the number and the date worked out from its `now`.
 */
export function AffiliationsSection({
  items,
  coolingOffDays,
  removedBlocksUntil,
}: {
  items: AffiliationItem[];
  coolingOffDays: number;
  /** formatDate(now + coolingOffDays), for the remove dialog. */
  removedBlocksUntil: string;
}) {
  const [result, setResult] = useState<ActionResult>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const remove = useSectionAction(removeAffiliationAction, (r) => {
    setResult(r);
    if (r?.ok) headingRef.current?.focus();
  });
  const clubs = items.filter((i) => i.type === "club");
  const players = items.filter((i) => i.type === "player");

  return (
    <section aria-labelledby="scout-conflicts-heading" className="mt-8">
      <h2 id="scout-conflicts-heading" ref={headingRef} tabIndex={-1} className="heading-2">
        Clubs and players you are linked to
      </h2>
      <p className="body mt-2 max-w-prose text-ink-muted">
        You cannot review a match involving a club on this list, a player you represent, or that
        player&apos;s club. We check these names against both teams and the lineups of every match,
        and Wideline staff match each name to a club on Wideline, so check the spelling.
      </p>
      <p className="caption mt-2 text-ink-muted">
        A club or player you remove keeps blocking matches for {coolingOffDays} days.
      </p>
      {items.length === 0 && (
        <p className="caption mt-2 text-ink-muted">
          You told us you have no conflicts. Add any club you start working with, or player you
          start representing.
        </p>
      )}
      <div aria-live="polite" className="mt-4 empty:mt-0">
        <SuccessBanner result={result} />
        {result && !result.ok && result.formError && (
          <Banner tone="danger">{result.formError}</Banner>
        )}
      </div>

      <h3 className="body-strong mt-6">Clubs</h3>
      <AffiliationList
        items={clubs}
        empty="No clubs on your list."
        remove={remove}
        coolingOffDays={coolingOffDays}
        removedBlocksUntil={removedBlocksUntil}
      />
      <AddForm type="club" onAdded={setResult} />

      <h3 className="body-strong mt-6">Players you represent</h3>
      <AffiliationList
        items={players}
        empty="No players on your list."
        remove={remove}
        coolingOffDays={coolingOffDays}
        removedBlocksUntil={removedBlocksUntil}
      />
      <AddForm type="player" onAdded={setResult} />
    </section>
  );
}

function AffiliationList({
  items,
  empty,
  remove,
  coolingOffDays,
  removedBlocksUntil,
}: {
  items: AffiliationItem[];
  empty: string;
  remove: SectionForm;
  coolingOffDays: number;
  removedBlocksUntil: string;
}) {
  if (items.length === 0) return <p className="body mt-2 text-ink-muted">{empty}</p>;
  return (
    <ul role="list" className="wl-card mt-2 divide-y divide-line p-0">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <span className="body-strong block break-words">{a.name}</span>
            {a.type === "player" && (
              <span className="caption block text-ink-muted">{a.clubName ?? "Club not given"}</span>
            )}
            {a.linked ? (
              <span className="wl-inline-status wl-inline-status--ok caption">
                <Link2 {...iconProps} />
                Matched on Wideline
              </span>
            ) : (
              <span className="wl-inline-status wl-inline-status--muted caption">
                <CircleDashed {...iconProps} />
                Not matched yet
              </span>
            )}
            <span className="caption block text-ink-muted">Added {a.declared}</span>
          </div>
          <div className="shrink-0">
            <ConfirmDialog
              trigger={{
                label: "Remove",
                variant: "danger",
                icon: Trash2,
                ariaLabel: `Remove ${a.name}`,
              }}
              title={`Remove ${a.name}?`}
              body={`${a.name} keeps blocking your review of their matches for ${coolingOffDays} days, until ${removedBlocksUntil}. Wideline keeps a record that you removed it.`}
              form={remove}
              hidden={{ affiliationId: a.id }}
              submit={{ label: "Remove", pendingLabel: "Removing…", variant: "danger" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function AddForm({
  type,
  onAdded,
}: {
  type: ScoutAffiliationType;
  onAdded: (result: ActionResult) => void;
}) {
  const { state, formProps } = useFormAction(addAffiliationAction, null as ActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  // A new key after each success resets the form; focus returns to its first field.
  const key = state?.ok ? state.key : undefined;
  useEffect(() => {
    if (state?.ok) {
      onAdded(state);
      formRef.current?.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus();
    } else if (state && !state.ok && state.fieldErrors) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
    // Report each result once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const club = type === "club";

  return (
    <div className="mt-3">
      <form key={key} ref={formRef} {...formProps} noValidate className="wl-inline-form">
        <FormBusy formRef={formRef} />
        <input type="hidden" name="type" value={type} />
        <Field label={club ? "Club name" : "Player name"} error={fieldError(state, "name")}>
          {(p) => (
            <input {...p} name="name" maxLength={120} autoComplete="off" className="wl-input" />
          )}
        </Field>
        {!club && (
          <Field
            label="Their club (optional)"
            hint="Helps us match the right player."
            error={fieldError(state, "clubName")}
          >
            {(p) => (
              <input
                {...p}
                name="clubName"
                maxLength={120}
                autoComplete="off"
                className="wl-input"
              />
            )}
          </Field>
        )}
        <SubmitButton
          variant="secondary"
          icon={Plus}
          block
          pendingLabel="Adding…"
          className="justify-center"
        >
          {club ? "Add club" : "Add player"}
        </SubmitButton>
      </form>
      <div className="mt-3 empty:mt-0">
        <FormErrorBanner result={state} />
      </div>
    </div>
  );
}
