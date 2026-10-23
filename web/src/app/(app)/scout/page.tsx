import { EmptyState } from "@/components/states/EmptyState";
import { Banner } from "@/components/forms";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { formatDate, identityText } from "@/lib/labels";
import { hasPassword } from "@/server/auth/password";
import { requirePageRole, SCOUT_ROLES } from "@/server/auth/session";
import { getOwnScoutProfile } from "@/server/scouts/profile";
import { REVIEWER_TERMS_VERSION } from "@/server/scouts/terms";
import { TermsText } from "@/app/register/TermsText";
import { AffiliationsSection, type AffiliationItem } from "./AffiliationsSection";
import { DetailsSection } from "./DetailsSection";
import { PasswordSection } from "./PasswordSection";
import { StatusPanel } from "./StatusPanel";
import { TermsSection } from "./TermsSection";

export const metadata = { title: "Scout profile" };

const TITLE = "Scout profile";
const INTRO =
  "Your registration, the clubs and players you are linked to, and the terms you accepted.";

/**
 * The scout's own profile (AUTH09, AUTH10; docs/build/design/C02.md, Surface 3):
 * where the registration stands, the phone number, declared conflicts and the
 * terms record. Scouts only; every action touches only the caller's profile.
 */
export default async function ScoutProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; from?: string }>;
}) {
  const ctx = await requirePageRole(SCOUT_ROLES);
  const [profile, params, passwordSet] = await Promise.all([
    getOwnScoutProfile(ctx.user.id),
    searchParams,
    hasPassword(ctx.user.id),
  ]);

  if (!profile) {
    return (
      <div className="max-w-3xl">
        <PageHeader title={TITLE} intro={INTRO} />
        <EmptyState
          title="No scout profile yet"
          body="To review matches on Wideline, register as a scout. Your club membership stays as it is."
          action={
            <ButtonLink href="/register" variant="primary">
              Register as a scout
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const affiliations: AffiliationItem[] = profile.affiliations.map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    clubName: a.clubName,
    linked: a.linked,
    declared: formatDate(a.declaredAt),
  }));

  return (
    <div className="max-w-3xl">
      <PageHeader title={TITLE} intro={INTRO} />
      <div aria-live="polite" className="mt-6 empty:mt-0">
        {params.registered === "1" && (
          <Banner tone="ok">
            {profile.user.emailVerified
              ? "Registration received. A Wideline admin checks your details. We email you when it is decided."
              : "Registration received. Confirm your email, then a Wideline admin checks your details. We email you when it is decided."}
          </Banner>
        )}
        {params.from === "review" && (
          <Banner tone="warn">
            The review queue opens once your scout profile is approved and you have accepted the
            current terms.
          </Banner>
        )}
        {params.from === "shortlists" && (
          <Banner tone="warn">
            Shortlists open once your scout profile is approved and you have accepted the current
            terms.
          </Banner>
        )}
      </div>
      <StatusPanel
        status={profile.status}
        email={profile.user.email}
        emailVerified={profile.user.emailVerified}
        termsCurrent={profile.termsCurrent}
        verified={profile.verifiedAt ? formatDate(profile.verifiedAt) : null}
        reviewed={profile.reviewedAt ? formatDate(profile.reviewedAt) : null}
        suspended={profile.suspendedAt ? formatDate(profile.suspendedAt) : null}
        rejectionReason={profile.rejectionReason}
        suspensionReason={profile.suspensionReason}
      />
      {!passwordSet && profile.user.emailVerified && <PasswordSection email={profile.user.email} />}
      <DetailsSection
        name={profile.user.name}
        email={profile.user.email}
        emailVerified={profile.user.emailVerified}
        identity={identityText(profile.idDocumentType, profile.idCountry, "issued by")}
        registered={formatDate(profile.createdAt)}
        phone={profile.phone}
      />
      <AffiliationsSection items={affiliations} />
      <TermsSection
        current={profile.termsCurrent}
        acceptedVersion={profile.termsVersion}
        acceptedOn={formatDate(profile.termsAcceptedAt)}
        currentVersion={REVIEWER_TERMS_VERSION}
        terms={<TermsText />}
        termsOpen={<TermsText className="mt-4" />}
      />
    </div>
  );
}
