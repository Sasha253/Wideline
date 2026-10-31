"use client";

import { LogIn } from "lucide-react";
import { useActionState } from "react";
import { FormErrorBanner, SubmitButton } from "@/components/forms";
import { DataTable } from "@/components/templates/DataTable";
import { impersonateAction } from "./actions";

export type UserItem = {
  id: string;
  name: string;
  email: string;
  /** One line per organisation: "Wideline Demo FC · Owner, Coach". */
  memberships: string[];
  /** "Independent scout · Approved", or null. */
  scout: string | null;
  canImpersonate: boolean;
};

function LogInAs({ item, action }: { item: UserItem; action: (fd: FormData) => void }) {
  if (!item.canImpersonate) return <span className="caption text-ink-muted">–</span>;
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={item.id} />
      <SubmitButton
        variant="secondary"
        size="sm"
        icon={LogIn}
        pendingLabel="Logging in…"
        aria-label={`Log in as ${item.name}`}
      >
        Log in as
      </SubmitButton>
    </form>
  );
}

function Roles({ item }: { item: UserItem }) {
  if (item.memberships.length === 0 && !item.scout) {
    return <span className="caption text-ink-muted">No active organisation</span>;
  }
  return (
    <ul role="list" className="flex flex-col gap-1">
      {item.memberships.map((m) => (
        <li key={m} className="body">
          {m}
        </li>
      ))}
      {item.scout && <li className="caption text-ink-muted">{item.scout}</li>}
    </ul>
  );
}

/**
 * Every user with their organisations and roles, and "Log in as" for platform
 * admins (src/server/auth/impersonation.ts). Platform admins themselves cannot
 * be impersonated, so their row has no button.
 */
export function UsersTable({ items }: { items: UserItem[] }) {
  const [state, action] = useActionState(impersonateAction, null);
  return (
    <section aria-labelledby="users-heading" className="mt-6">
      <h2 id="users-heading" className="sr-only">
        Users
      </h2>
      {state && !state.ok && (
        <div className="mb-4 max-w-2xl">
          <FormErrorBanner result={state} />
        </div>
      )}
      <DataTable
        caption="All users, by name"
        columns={[
          { id: "user", header: "User" },
          { id: "roles", header: "Organisations and roles" },
          { id: "actions", header: <span className="sr-only">Actions</span> },
        ]}
        rows={items.map((i) => ({
          id: i.id,
          cells: [
            <>
              <span className="body-strong block">{i.name}</span>
              <span className="caption block break-all text-ink-muted">{i.email}</span>
            </>,
            <Roles key="roles" item={i} />,
            <LogInAs key="login" item={i} action={action} />,
          ],
        }))}
        cards={items.map((i) => (
          <li key={i.id} className="wl-card flex flex-col gap-2">
            <p className="body-strong break-words">{i.name}</p>
            <p className="caption break-all text-ink-muted">{i.email}</p>
            <Roles item={i} />
            <LogInAs item={i} action={action} />
          </li>
        ))}
      />
    </section>
  );
}
