"use client";

import { Check } from "lucide-react";
import { useActionState } from "react";
import { FormErrorBanner, SubmitButton } from "@/components/forms";
import { StatusChip } from "@/components/ui/StatusChip";
import { switchOrganisation } from "./actions";

type Item = { id: string; name: string; meta: string; roles: string };

/** The organisation cards. The current one is marked; every other one has a Switch form. */
export function OrganisationList({
  currentId,
  organisations,
}: {
  currentId: string | null;
  organisations: Item[];
}) {
  const [state, action] = useActionState(switchOrganisation, null);
  return (
    <>
      {state && !state.ok && (
        <div className="mt-6 max-w-2xl">
          <FormErrorBanner result={state} />
        </div>
      )}
      <ul role="list" className="mt-6 flex max-w-2xl flex-col gap-3">
        {organisations.map((o) => {
          const current = o.id === currentId;
          return (
            <li
              key={o.id}
              aria-current={current ? "true" : undefined}
              className={`wl-card flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4 ${current ? "border-pitch" : ""}`}
            >
              <div className="min-w-0">
                <p className="body-strong break-words">{o.name}</p>
                <p className="caption text-ink-muted">{o.meta}</p>
                <p className="body">Your roles: {o.roles}</p>
              </div>
              <div className="shrink-0">
                {current ? (
                  <StatusChip tone="ok" icon={Check} label="Current" />
                ) : (
                  <form action={action}>
                    <input type="hidden" name="organisationId" value={o.id} />
                    <SubmitButton
                      variant="secondary"
                      block
                      className="justify-center"
                      pendingLabel="Switching…"
                      aria-label={`Switch to ${o.name}`}
                    >
                      Switch
                    </SubmitButton>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
