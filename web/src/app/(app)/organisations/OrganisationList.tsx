"use client";

import { Check } from "lucide-react";
import { useActionState } from "react";
import { FormErrorBanner, SubmitButton } from "@/components/forms";
import { orgInitials } from "@/components/shell/OrgSwitcher";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { switchOrganisation } from "./actions";

type Item = { id: string; name: string; meta: string; roles: string };

/**
 * The organisation rows (Floodlight, as the organisation switcher's list): an initials
 * tile, the name, type and place, and your roles. The current one has the selected fill,
 * a 2px ink inset and "Current" with a check (never lime); every other one has a Switch
 * form.
 */
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
      <ul
        role="list"
        className="m-0 mt-6 flex max-w-2xl list-none flex-col border border-line bg-panel p-0"
      >
        {organisations.map((o) => {
          const current = o.id === currentId;
          return (
            <li
              key={o.id}
              aria-current={current ? "true" : undefined}
              className={cx(
                "flex flex-col gap-3 border-b border-line p-4 last:border-b-0 tablet:flex-row tablet:items-center tablet:gap-4",
                current && "bg-selected shadow-[inset_2px_0_0_var(--wl-color-ink)]",
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className="grid size-10 flex-none place-items-center rounded-control bg-ink font-display text-label font-extrabold stretch-wide text-ink-inverse"
                  aria-hidden="true"
                >
                  {orgInitials(o.name)}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="m-0 font-semibold break-words">{o.name}</p>
                  <p className="m-0 text-body-s text-ink-muted">{o.meta}</p>
                  <p className="m-0 text-body-s">Your roles: {o.roles}</p>
                </div>
              </div>
              <div className="shrink-0">
                {current ? (
                  <span className="inline-flex items-center gap-1.5 text-label">
                    <Check {...iconProps} />
                    Current
                  </span>
                ) : (
                  <form action={action}>
                    <input type="hidden" name="organisationId" value={o.id} />
                    <SubmitButton
                      variant="secondary"
                      block
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
