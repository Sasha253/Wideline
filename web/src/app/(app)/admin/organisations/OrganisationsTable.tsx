import { Building2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { DataListRow, DataTable } from "@/components/templates/DataTable";
import { iconProps, ICON_SIZE_DENSE } from "@/components/ui/icons";
import { StateMessage } from "@/components/ui/StateMessage";
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

/**
 * The initials square for an organisation: the first letter of its first two words, or the
 * first two letters of a one-word name. Kept here, not imported from the client OrgSwitcher,
 * because this is a server component.
 */
function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0]?.slice(0, 2) ?? "");
  return letters.toUpperCase();
}

function NoPlan() {
  return (
    <span className="wl-inline-status wl-inline-status--warn text-body-s">
      <TriangleAlert {...iconProps} size={ICON_SIZE_DENSE} />
      No plan, uses Pilot
    </span>
  );
}

/**
 * Every organisation, seeded ones included, with its plan (docs/build/design/C03.md,
 * Surface 2). The name is the way into flags and limits.
 */
export function OrganisationsTable({ items }: { items: OrganisationItem[] }) {
  return (
    <section aria-labelledby="all-organisations-heading" className="mt-5">
      <h2 id="all-organisations-heading" className="sr-only">
        Organisations
      </h2>
      {items.length === 0 ? (
        <StateMessage kind="empty" icon={Building2} headingLevel={3} title="No organisations yet" />
      ) : (
        <DataTable
          caption="All organisations, by name"
          columns={[
            { id: "organisation", header: "Organisation" },
            { id: "status", header: "Status", width: "11rem" },
            { id: "plan", header: "Plan", width: "13rem" },
          ]}
          rows={items.map((i) => ({
            id: i.id,
            cells: [
              <span key="org" className="flex min-w-0 flex-col gap-1">
                <Link
                  href={`/admin/organisations/${i.id}`}
                  className="font-semibold text-ink underline-offset-3 hover:underline"
                >
                  {i.name}
                </Link>
                <span className="text-body-s text-ink-muted">{i.meta}</span>
              </span>,
              <OrganisationStatusChip key="status" status={i.status} size="s" />,
              i.planName ?? <NoPlan key="plan" />,
            ],
          }))}
          cards={items.map((i) => (
            <DataListRow
              key={i.id}
              href={`/admin/organisations/${i.id}`}
              initials={orgInitials(i.name)}
              title={i.name}
              meta={
                <>
                  {i.meta} · {i.planName ?? <NoPlan />}
                </>
              }
              status={<OrganisationStatusChip status={i.status} size="s" />}
            />
          ))}
          footer={
            <span className="flex-1">
              Showing <span className="font-mono tabular-nums">1–{items.length}</span> of{" "}
              <span className="font-mono tabular-nums">{items.length}</span>{" "}
              {items.length === 1 ? "organisation" : "organisations"}
            </span>
          }
        />
      )}
    </section>
  );
}
