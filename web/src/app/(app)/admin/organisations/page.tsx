import Link from "next/link";
import { PageHeader } from "@/components/templates/PageHeader";
import { formatDate, locationText, ORG_TYPE_LABELS } from "@/lib/labels";
import { PLATFORM_ROLES, requirePageRole } from "@/server/auth/session";
import {
  countPendingApplications,
  listAllOrganisations,
  listOrganisationApplications,
  type OwnerInvitationState,
} from "@/server/platform/organisations";
import { AdminNav } from "../AdminNav";
import { Applications, type ApplicationItem } from "./Applications";
import { OrganisationsTable } from "./OrganisationsTable";

export const metadata = { title: "Organisation applications" };

/**
 * The pilot approval queue (ADMIN01): Pending and Decided tabs, plus All (C03),
 * every organisation with its plan, linked to flags and limits. Platform admins only.
 */
export default async function OrganisationApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requirePageRole(PLATFORM_ROLES);
  const param = (await searchParams).status;
  const status = param === "decided" || param === "all" ? param : "pending";
  const [rows, all, pendingCount] = await Promise.all([
    status === "all" ? [] : listOrganisationApplications(ctx, { status }),
    status === "all" ? listAllOrganisations(ctx) : [],
    countPendingApplications(ctx),
  ]);

  const items: ApplicationItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    meta: `${ORG_TYPE_LABELS[r.type]} · ${locationText(r.country, r.region)}`,
    applicantName: r.applicantName ?? "–",
    applicantEmail: r.applicantEmail ?? "",
    status: r.status,
    applied: formatDate(r.createdAt),
    decided: r.reviewedAt ? formatDate(r.reviewedAt) : "–",
    reason: r.rejectionReason,
    owner: r.ownerInvitation && r.applicantEmail ? ownerText(r.ownerInvitation) : null,
  }));

  return (
    <>
      <PageHeader
        title="Organisation applications"
        intro="Academies, clubs and agencies that asked to join the pilot. Approving one emails the applicant an owner invitation."
      />
      <AdminNav current="organisations" />
      <nav aria-label="Organisation list" className="wl-tabs mt-6">
        <Link
          href="/admin/organisations?status=pending"
          className="body-strong"
          aria-current={status === "pending" ? "page" : undefined}
        >
          Pending <span className="data">{pendingCount}</span>
        </Link>
        <Link
          href="/admin/organisations?status=decided"
          className="body-strong"
          aria-current={status === "decided" ? "page" : undefined}
        >
          Decided
        </Link>
        <Link
          href="/admin/organisations?status=all"
          className="body-strong"
          aria-current={status === "all" ? "page" : undefined}
        >
          All
        </Link>
      </nav>
      {status === "all" ? (
        <>
          <p className="body mt-4 max-w-prose text-ink-muted">
            Every organisation on Wideline, including Wideline&apos;s own. Open one to change its
            flags and limits.
          </p>
          <OrganisationsTable
            items={all.map((o) => ({
              id: o.id,
              name: o.name,
              meta: `${ORG_TYPE_LABELS[o.type]} · ${locationText(o.country, o.region)}`,
              status: o.status,
              planName: o.planName,
            }))}
          />
        </>
      ) : (
        <Applications status={status} items={items} />
      )}
    </>
  );
}

/** What the Decided tab says about an approved organisation that has no owner yet. */
function ownerText(inv: OwnerInvitationState): string {
  switch (inv.status) {
    case "pending":
      return `No owner yet. Invitation expires ${formatDate(inv.expiresAt)}.`;
    case "expired":
      return `No owner yet. Invitation expired ${formatDate(inv.expiresAt)}.`;
    case "none":
      return "No owner yet. No open invitation.";
  }
}
