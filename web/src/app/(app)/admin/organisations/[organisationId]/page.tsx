import { notFound } from "next/navigation";
import { cache } from "react";
import { Banner } from "@/components/forms";
import { PageHeader } from "@/components/templates/PageHeader";
import { OrganisationStatusChip } from "@/components/ui/StatusChip";
import { FEATURE_KEYS, isFeatureKey, isLimitKey, LIMIT_KEYS } from "@/lib/entitlement-keys";
import {
  formatDate,
  limitText,
  locationText,
  ORG_TYPE_LABELS,
  sourceText,
  SUBSCRIPTION_STATUS_LABELS,
} from "@/lib/labels";
import { PLATFORM_ROLES, requirePageRole, type AuthContext } from "@/server/auth/session";
import {
  EntitlementAdminError,
  getOrganisationEntitlements,
  type OrganisationEntitlementsView,
  type SetterInfo,
} from "@/server/platform/entitlements";
import { AdminNav } from "../../AdminNav";
import { FlagsSection, type FlagItem } from "./FlagsSection";
import { LimitsSection, type LimitItem } from "./LimitsSection";

type Props = { params: Promise<{ organisationId: string }> };

// One read per request, shared by generateMetadata and the page.
const loadView = cache(
  async (
    ctx: AuthContext,
    organisationId: string,
  ): Promise<OrganisationEntitlementsView | null> => {
    try {
      return await getOrganisationEntitlements(ctx, organisationId);
    } catch (err) {
      if (err instanceof EntitlementAdminError && err.code === "not_found") return null;
      throw err;
    }
  },
);

export async function generateMetadata({ params }: Props) {
  const ctx = await requirePageRole(PLATFORM_ROLES);
  const view = await loadView(ctx, (await params).organisationId);
  return { title: view ? `Flags and limits · ${view.organisation.name}` : "Flags and limits" };
}

const INTRO_TAIL = "Changes apply straight away and are recorded in the audit log.";

/** "Set on 24 Oct 2026 by Lab Admin." */
function setText(info: SetterInfo | null): string | null {
  if (!info) return null;
  const date = formatDate(info.updatedAt);
  return info.setByName ? `Set on ${date} by ${info.setByName}.` : `Set on ${date}.`;
}

/** The override as the number input shows it: whole numbers, or GB with 2 decimals at most. */
function inputValue(bytes: boolean, value: number | boolean | null | undefined): string {
  if (typeof value !== "number" || value === Infinity) return "";
  return bytes ? String(Number((value / 1_000_000_000).toFixed(2))) : String(value);
}

/**
 * Flags and limits for one organisation (ADMIN04, BILL01, BILL02;
 * docs/build/design/C03.md, Surface 1). Platform admins only.
 */
export default async function OrganisationEntitlementsPage({ params }: Props) {
  const ctx = await requirePageRole(PLATFORM_ROLES);
  const view = await loadView(ctx, (await params).organisationId);
  if (!view) notFound();
  const { organisation: org, plan, subscription, basis } = view;
  const planName = plan?.name ?? null;

  let intro: string;
  if (basis === "subscription" && plan) {
    const status =
      subscription && subscription.status !== "active"
        ? ` (${SUBSCRIPTION_STATUS_LABELS[subscription.status].toLowerCase()})`
        : "";
    intro = `On the ${plan.name} plan${status}. ${INTRO_TAIL}`;
  } else if (basis === "pilot_fallback" && plan) {
    intro = `No plan. Uses the ${plan.name} plan. ${INTRO_TAIL}`;
  } else {
    intro = `No plan. Uses built-in defaults. ${INTRO_TAIL}`;
  }

  const flags: FlagItem[] = [];
  const limits: LimitItem[] = [];
  for (const e of view.entitlements) {
    const source = sourceText(e.source, planName);
    if (isFeatureKey(e.key)) {
      const def = FEATURE_KEYS[e.key];
      flags.push({
        key: e.key,
        label: def.label,
        description: def.description,
        release: def.release,
        on: e.value === true,
        source,
        planOn: e.plan.value === true,
        flag: e.flag ? (e.flag.parsed === null ? "invalid" : e.flag.parsed ? "on" : "off") : null,
        setText: setText(e.flagInfo),
        reason: e.flagInfo?.reason ?? null,
      });
    } else if (isLimitKey(e.key)) {
      const key = e.key;
      const def = LIMIT_KEYS[key];
      const bytes = def.unit === "bytes";
      const text = (v: number | boolean) => limitText(key, v as number);
      limits.push({
        key,
        label: def.label,
        description: def.description,
        unit: def.unit,
        planText: text(e.plan.value),
        planIsDefault: e.plan.source === "default",
        overrideText: e.override
          ? e.override.parsed === null
            ? "invalid"
            : text(e.override.parsed)
          : null,
        overrideInput: inputValue(bytes, e.override?.parsed),
        overrideUnlimited: e.override?.parsed === Infinity,
        hasOverride: e.override !== null,
        effectiveText: text(e.value),
        source,
        flagSet: e.flag !== null && e.flag.parsed !== null,
        flagInvalid: e.flag !== null && e.flag.parsed === null,
        setText: setText(e.overrideInfo),
        reason: e.overrideInfo?.reason ?? null,
        valueKey: `${e.source}-${String(e.value)}`,
      });
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: "/admin/organisations?status=all", label: "All organisations" }}
        eyebrow="Flags and limits"
        title={org.name}
        intro={intro}
      />
      <div className="wl-row mt-3">
        <OrganisationStatusChip status={org.status} />
        <span className="caption text-ink-muted">
          {ORG_TYPE_LABELS[org.type]} · {locationText(org.country, org.region)}
        </span>
      </div>
      {org.status !== "active" && (
        <div className="mt-4">
          <Banner tone="warn">
            {org.name} is not active. Changes are saved and apply if it becomes active.
          </Banner>
        </div>
      )}
      {basis !== "subscription" && (
        <div className="mt-4">
          <Banner tone="warn">
            {basis === "pilot_fallback"
              ? `${org.name} has no plan, so it uses the ${planName} plan's limits.`
              : `${org.name} has no plan, so it uses built-in defaults.`}
          </Banner>
        </div>
      )}
      <AdminNav current="organisations" />
      <FlagsSection organisationId={org.id} items={flags} />
      <LimitsSection organisationId={org.id} items={limits} />
    </>
  );
}
