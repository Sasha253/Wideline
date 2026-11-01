import { Fragment } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/templates/PageHeader";
import {
  AUTO_ACCEPT_DEFAULTS,
  AUTO_ACCEPT_TYPES,
  formatThreshold,
  THRESHOLD_LABELS,
  type AutoAcceptType,
} from "@/lib/auto-accept";
import { CLUB_ROLES, ORG_ADMIN_ROLES, requirePageRole } from "@/server/auth/session";
import { readAutoAcceptThresholds } from "@/server/organisations/settings";
import { isSquadOrg } from "@/server/squad/access";
import { adminSettingsTabs, SettingsNav } from "../SettingsNav";
import { ThresholdsForm } from "./ThresholdsForm";

export const metadata = { title: "Review settings" };

/**
 * Review settings (REVIEW10; docs/build/design/C11.md, Surface 6): the
 * confidence an event needs to skip review, per event type. Every club role
 * may read them; owners and admins edit (Q-070), and a coach sees only this
 * tab (Q-071). Academies and clubs only: other organisations hold no matches.
 */
export default async function ReviewSettingsPage() {
  const ctx = await requirePageRole(CLUB_ROLES);
  if (!isSquadOrg(ctx.organisationType)) notFound();
  const thresholds = await readAutoAcceptThresholds(ctx);
  const canEdit = ctx.roles.some((r) => ORG_ADMIN_ROLES.includes(r));

  return (
    <>
      <PageHeader
        title="Review settings"
        eyebrow={`${ctx.organisationName} / Settings`}
        intro="How sure the model must be before an event is accepted without a scout checking it."
      />
      <SettingsNav current="review" tabs={canEdit ? adminSettingsTabs(true) : ["review"]} />
      <section
        aria-labelledby="thresholds-title"
        className="mt-6 flex max-w-xl flex-col gap-2 border border-line bg-panel p-4 tablet:p-5"
      >
        <h2
          id="thresholds-title"
          className="m-0 font-display text-heading-section stretch-wide uppercase"
        >
          Auto-accept thresholds
        </h2>
        <p className="m-0">
          Events at or above the threshold are accepted without review. Events below it go to a
          scout. A higher threshold sends more events to review.
        </p>
        {canEdit ? (
          <ThresholdsForm
            initial={
              Object.fromEntries(
                AUTO_ACCEPT_TYPES.map((t) => [t, formatThreshold(thresholds[t])]),
              ) as Record<AutoAcceptType, string>
            }
          />
        ) : (
          <>
            <dl className="wl-facts mt-3">
              {AUTO_ACCEPT_TYPES.map((t) => (
                <Fragment key={t}>
                  <dt>{THRESHOLD_LABELS[t]}</dt>
                  <dd>
                    <span className="font-mono text-mono-m tabular-nums">
                      {formatThreshold(thresholds[t])}
                    </span>
                    {thresholds[t] === AUTO_ACCEPT_DEFAULTS[t] && (
                      <span className="text-ink-muted"> (default)</span>
                    )}
                  </dd>
                </Fragment>
              ))}
            </dl>
            <p className="m-0 mt-2 text-body-s text-ink-muted">
              Changes apply to matches processed from now on. Matches already processed keep their
              events as they are.
            </p>
            <p className="m-0 text-body-s text-ink-muted">
              Only owners and admins can change these.
            </p>
          </>
        )}
      </section>
    </>
  );
}
