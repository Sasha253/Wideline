import Link from "next/link";
import { formatDate, locationText, ORG_TYPE_LABELS } from "@/lib/labels";
import { PLATFORM_ROLES, requirePageRole } from "@/server/auth/session";
import {
  countPendingApplications,
  listOrganisationApplications,
  type OwnerInvitationState,
} from "@/server/platform/organisations";
import { Applications, type ApplicationItem } from "./Applications";

export const metadata = { title: "Organisation applications" };

/** The pilot approval queue (ADMIN01): Pending and Decided tabs. Platform admins only. */
export default async function OrganisationApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requirePageRole(PLATFORM_ROLES);
  const status = (await searchParams).status === "decided" ? "decided" : "pending";
  const [rows, pendingCount] = await Promise.all([
    listOrganisationApplications(ctx, { status }),
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
      <h1 className="heading-1">Organisation applications</h1>
      <p className="body mt-2 max-w-prose text-ink-muted">
        Academies, clubs and agencies that asked to join the pilot. Approving one emails the
        applicant an owner invitation.
      </p>
      <nav aria-label="Application status" className="wl-tabs mt-6">
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
      </nav>
      <Applications status={status} items={items} />
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
