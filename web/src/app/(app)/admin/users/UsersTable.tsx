"use client";

import { LogIn } from "lucide-react";
import { useActionState } from "react";
import { FormErrorBanner, SubmitButton } from "@/components/forms";
import { DataTable, Missing } from "@/components/templates/DataTable";
import { personInitials } from "@/components/shell/AccountMenu";
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

function LogInAs({
  item,
  action,
  block,
}: {
  item: UserItem;
  action: (fd: FormData) => void;
  block?: boolean;
}) {
  if (!item.canImpersonate) return <Missing />;
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={item.id} />
      <SubmitButton
        variant="secondary"
        size={block ? "l" : "s"}
        block={block}
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
    return <span className="text-body-s text-ink-muted">No active organisation</span>;
  }
  return (
    <ul role="list" className="m-0 flex list-none flex-col gap-1 p-0">
      {item.memberships.map((m) => (
        <li key={m}>{m}</li>
      ))}
      {item.scout && <li className="text-body-s text-ink-muted">{item.scout}</li>}
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
    <section aria-labelledby="users-heading" className="mt-5">
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
          { id: "actions", header: "", label: "Actions", width: "9rem" },
        ]}
        rows={items.map((i) => ({
          id: i.id,
          cells: [
            <span key="user" className="flex min-w-0 flex-col gap-1">
              <span className="font-semibold">{i.name}</span>
              <span className="font-mono text-body-s break-all text-ink-muted">{i.email}</span>
            </span>,
            <Roles key="roles" item={i} />,
            <span key="login" className="flex justify-end">
              <LogInAs item={i} action={action} />
            </span>,
          ],
        }))}
        cards={items.map((i) => (
          <li
            key={i.id}
            className="flex flex-col gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="wl-avatar wl-avatar--m" aria-hidden="true">
                {personInitials(i.name)}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-semibold break-words">{i.name}</span>
                <span className="font-mono text-body-s break-all text-ink-muted">{i.email}</span>
              </span>
            </div>
            <Roles item={i} />
            {i.canImpersonate && <LogInAs item={i} action={action} block />}
          </li>
        ))}
        footer={
          <span className="flex-1">
            Showing{" "}
            <span className="font-mono tabular-nums">
              {items.length === 0 ? 0 : 1}–{items.length}
            </span>{" "}
            of <span className="font-mono tabular-nums">{items.length}</span>{" "}
            {items.length === 1 ? "user" : "users"}
          </span>
        }
      />
    </section>
  );
}
