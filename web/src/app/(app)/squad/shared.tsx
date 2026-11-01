import { Fragment, type ReactNode } from "react";
import { Missing } from "@/components/templates/DataTable";
import { EmptyState } from "@/components/states/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import type { Role } from "@/generated/prisma/enums";
import { SQUAD_ADMIN_ROLES } from "@/server/auth/session";

// Pieces shared by the C04 squad pages (docs/build/design/C04.md).

/** Owners and admins write the squad; coaches read it. The actions check this again. */
export function canEditSquad(roles: readonly Role[]): boolean {
  return roles.some((r) => SQUAD_ADMIN_ROLES.includes(r));
}

/** Shown to a coach instead of a form on the pages that only write. */
export function AdminOnlyNotice({ organisationName }: { organisationName: string }) {
  return (
    <div className="mt-8">
      <EmptyState
        art={false}
        headingLevel={2}
        title="Only owners, admins and coaches can do this"
        body={`Ask an owner or admin of ${organisationName} to add teams and players.`}
        action={
          <ButtonLink variant="secondary" href="/squad">
            Back to squad
          </ButtonLink>
        }
      />
    </div>
  );
}

/** A read-only fact list: label and value pairs, Missing for blanks. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="wl-facts">
      {items.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-label">{label}</dt>
          <dd>{value ?? <Missing />}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** "a · b · c", leaving out missing parts. */
export function metaText(parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(" · ");
}
