import { CircleDashed } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/templates/PageHeader";
import { iconProps } from "@/components/ui/icons";
import type { ScoutStatus } from "@/generated/prisma/enums";
import { formatDate, identityText, ORG_TYPE_LABELS } from "@/lib/labels";
import { PLATFORM_ROLES, requirePageRole } from "@/server/auth/session";
import {
  countPendingScouts,
  countScoutsWithUnchecked,
  listLinkableOrganisations,
  listScouts,
  type ScoutRow,
} from "@/server/platform/scouts";
import { AdminNav } from "../AdminNav";
import { ScoutApplications, type ScoutItem } from "./ScoutApplications";

export const metadata = { title: "Scout registrations" };

const TABS: { status: ScoutStatus; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "approved", label: "Approved" },
  { status: "suspended", label: "Suspended" },
  { status: "rejected", label: "Not approved" },
];

const DATE_LABEL: Record<ScoutStatus, string> = {
  pending: "Registered",
  approved: "Approved",
  suspended: "Suspended",
  rejected: "Decided",
};

function dateOf(r: ScoutRow): Date | null {
  switch (r.status) {
    case "pending":
      return r.createdAt;
    case "approved":
      return r.verifiedAt;
    case "suspended":
      return r.suspendedAt;
    case "rejected":
      return r.reviewedAt;
  }
}

/**
 * The scout approval queue (AUTH08, ADMIN01, ADMIN06; docs/build/design/C02.md,
 * Surface 4): Pending, Approved, Suspended and Not approved tabs. Platform
 * admins only. ID and passport numbers are never stored, so never shown.
 * `?unchecked=1` keeps the scouts with a club or player no admin has checked,
 * such as one a scout added on /scout after approval.
 */
export default async function ScoutRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; unchecked?: string }>;
}) {
  const ctx = await requirePageRole(PLATFORM_ROLES);
  const params = await searchParams;
  const status = TABS.find((t) => t.status === params.status)?.status ?? "pending";
  // Not approved has no Conflicts column, so no filter.
  const filterable = status !== "rejected";
  const unchecked = filterable && params.unchecked === "1";
  const [rows, pendingCount, organisations, uncheckedCount] = await Promise.all([
    listScouts(ctx, { status, unchecked }),
    countPendingScouts(ctx),
    listLinkableOrganisations(ctx),
    filterable ? countScoutsWithUnchecked(ctx, { status }) : 0,
  ]);

  const items: ScoutItem[] = rows.map((r) => {
    const date = dateOf(r);
    return {
      id: r.id,
      status: r.status,
      name: r.name,
      email: r.email,
      emailVerified: r.emailVerified,
      phone: r.phone,
      identity: identityText(r.idDocumentType, r.idCountry),
      dateLabel: DATE_LABEL[r.status],
      date: date ? formatDate(date) : "–",
      termsVersion: r.termsVersion,
      termsCurrent: r.termsCurrent,
      reason: r.status === "suspended" ? r.suspensionReason : r.rejectionReason,
      affiliations: r.affiliations.map((a) => ({
        id: a.id,
        name: a.name,
        meta: a.type === "club" ? "Club" : `Player · ${a.clubName ?? "club not given"}`,
        linkedName: a.organisationName,
        checked: a.checked,
        suggestionName: a.suggestion?.name ?? null,
        selected: a.organisationId ?? (a.checked ? "" : (a.suggestion?.id ?? "")),
      })),
    };
  });

  return (
    <>
      <PageHeader
        title="Scout registrations"
        intro="Independent scouts who asked to review matches. Approving a scout opens the review queue to them. Wideline never stores ID or passport numbers, so they are not shown here."
      />
      <AdminNav current="scouts" />
      <nav aria-label="Registration status" className="wl-tabs mt-6">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={`/admin/scouts?status=${t.status}`}
            className="body-strong"
            aria-current={status === t.status ? "page" : undefined}
          >
            {t.label}
            {t.status === "pending" && <span className="data">{pendingCount}</span>}
          </Link>
        ))}
      </nav>
      {filterable && (uncheckedCount > 0 || unchecked) && (
        <p className="body mt-4">
          <span className="wl-inline-status wl-inline-status--warn">
            <CircleDashed {...iconProps} />
            {uncheckedCount === 1
              ? "1 scout here has a club or player nobody has checked."
              : `${uncheckedCount} scouts here have clubs or players nobody has checked.`}
          </span>{" "}
          <Link
            href={`/admin/scouts?status=${status}${unchecked ? "" : "&unchecked=1"}`}
            className="text-pitch underline"
          >
            {unchecked ? "Show all scouts" : "Show only these"}
          </Link>
        </p>
      )}
      <ScoutApplications
        status={status}
        uncheckedOnly={unchecked}
        items={items}
        organisations={organisations.map((o) => ({
          id: o.id,
          label: `${o.name} · ${ORG_TYPE_LABELS[o.type]}`,
        }))}
      />
    </>
  );
}
