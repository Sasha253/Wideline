import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/templates/DataTable";
import { iconProps } from "@/components/ui/icons";
import { OrganisationStatusChip } from "@/components/ui/StatusChip";
import type { OrganisationStatus } from "@/generated/prisma/enums";

export type OrganisationItem = {
  id: string;
  name: string;
  /** "Club · Gauteng, South Africa". */
  meta: string;
  status: OrganisationStatus;
  /** Null with no subscription: it resolves against the pilot plan (BILL02). */
  planName: string | null;
};

function NoPlan() {
  return (
    <span className="wl-inline-status wl-inline-status--warn caption">
      <TriangleAlert {...iconProps} />
      No plan, uses Pilot
    </span>
  );
}

function NameLink({ item, className }: { item: OrganisationItem; className?: string }) {
  return (
    <Link
      href={`/admin/organisations/${item.id}`}
      className={`body-strong text-pitch underline ${className ?? ""}`}
    >
      {item.name}
    </Link>
  );
}

/**
 * Every organisation, seeded ones included, with its plan (docs/build/design/C03.md,
 * Surface 2). The name is the way into flags and limits.
 */
export function OrganisationsTable({ items }: { items: OrganisationItem[] }) {
  return (
    <section aria-labelledby="all-organisations-heading" className="mt-6">
      <h2 id="all-organisations-heading" className="sr-only">
        Organisations
      </h2>
      {items.length === 0 ? (
        <p className="body-lg mt-6 text-ink-muted">No organisations yet.</p>
      ) : (
        <DataTable
          caption="All organisations, by name"
          columns={[
            { id: "organisation", header: "Organisation" },
            { id: "status", header: "Status" },
            { id: "plan", header: "Plan" },
          ]}
          rows={items.map((i) => ({
            id: i.id,
            cells: [
              <>
                <NameLink item={i} />
                <span className="caption block text-ink-muted">{i.meta}</span>
              </>,
              <OrganisationStatusChip key="status" status={i.status} />,
              i.planName ?? <NoPlan />,
            ],
          }))}
          cards={items.map((i) => (
            <li key={i.id} className="wl-card flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <NameLink item={i} className="min-w-0 break-words" />
                <OrganisationStatusChip status={i.status} />
              </div>
              <p className="caption text-ink-muted">{i.meta}</p>
              {i.planName ? (
                <p className="caption text-ink-muted">Plan: {i.planName}</p>
              ) : (
                <p>
                  <NoPlan />
                </p>
              )}
            </li>
          ))}
        />
      )}
    </section>
  );
}
