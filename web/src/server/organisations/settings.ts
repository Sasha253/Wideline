import "server-only";
import { z } from "zod";
import {
  AUTO_ACCEPT_TYPES,
  autoAcceptThresholds,
  mergeAutoAccept,
  thresholdsInputSchema,
  type AutoAcceptThresholds,
  type ThresholdsInput,
} from "@/lib/auto-accept";
import { SELECTABLE_ORG_TYPES } from "@/lib/labels";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { requireSquadOrg } from "../squad/access";
import { countryField, orgNameField, regionField } from "./fields";

/** Organisation settings (AUTH-02): name, type, country and region. */

export const TYPE_ERROR = "The type can only be academy, club or agency.";

export const settingsSchema = z.object({
  name: orgNameField,
  // Left out for the platform organisation, whose type cannot change.
  type: z.enum(SELECTABLE_ORG_TYPES, { error: TYPE_ERROR }).optional(),
  country: countryField,
  region: regionField,
});

export type SettingsInput = z.input<typeof settingsSchema>;

export class SettingsError extends Error {
  constructor(readonly code: "platform_type") {
    super(`Settings: ${code}`);
    this.name = "SettingsError";
  }
}

/**
 * Updates the active organisation through the scoped client, with whitelisted
 * fields only. Audits organisation.updated with the changed fields; a save
 * with no changes writes nothing.
 */
export async function updateOrganisationSettings(
  ctx: AuthContext,
  input: SettingsInput,
): Promise<{ changed: string[] }> {
  const data = settingsSchema.parse(input);
  const org = await ctx.db.organisation.findUniqueOrThrow({
    where: { id: ctx.organisationId },
    select: { name: true, type: true, country: true, region: true },
  });
  if (org.type === "platform" && data.type) {
    throw new SettingsError("platform_type");
  }

  const next = {
    name: data.name,
    type: org.type === "platform" ? org.type : (data.type ?? org.type),
    country: data.country,
    region: data.region,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== org[k]);
  if (changed.length === 0) return { changed };

  const update = Object.fromEntries(changed.map((k) => [k, next[k]]));
  await ctx.db.organisation.update({ where: { id: ctx.organisationId }, data: update });
  await audit({
    organisationId: ctx.organisationId,
    actorUserId: ctx.user.id,
    action: "organisation.updated",
    targetType: "Organisation",
    targetId: ctx.organisationId,
    metadata: {
      changed,
      from: Object.fromEntries(changed.map((k) => [k, org[k]])),
      to: update,
    },
  });
  return { changed };
}

/** The active organisation's auto-accept thresholds (REVIEW10), defaults filled in. */
export async function readAutoAcceptThresholds(ctx: AuthContext): Promise<AutoAcceptThresholds> {
  requireSquadOrg(ctx);
  const org = await ctx.db.organisation.findUniqueOrThrow({
    where: { id: ctx.organisationId },
    select: { settings: true },
  });
  return autoAcceptThresholds(org.settings);
}

/**
 * C11 (REVIEW10, Q-069, Q-070): saves the auto-accept thresholds of the
 * active academy or club in Organisation.settings.autoAccept, keeping every
 * other settings key, through the scoped client. The caller checks the role
 * (owners and admins). New thresholds apply to the next CV ingest only; events
 * already stored keep their status (Q-069). Audits
 * organisation.thresholds_changed with the old and new values; a save with no
 * change writes nothing. Throws ZodError for a value that is not a score.
 */
export async function updateAutoAcceptThresholds(
  ctx: AuthContext,
  input: ThresholdsInput,
): Promise<{ changed: boolean }> {
  requireSquadOrg(ctx);
  const next = thresholdsInputSchema.parse(input);
  const org = await ctx.db.organisation.findUniqueOrThrow({
    where: { id: ctx.organisationId },
    select: { settings: true },
  });
  const before = autoAcceptThresholds(org.settings);
  const stored = (org.settings as { autoAccept?: unknown } | null)?.autoAccept;
  const changed = AUTO_ACCEPT_TYPES.some((t) => before[t] !== next[t]) || stored === undefined;
  if (!changed) return { changed: false };
  await ctx.db.organisation.update({
    where: { id: ctx.organisationId },
    data: { settings: mergeAutoAccept(org.settings, next) },
  });
  await audit({
    organisationId: ctx.organisationId,
    actorUserId: ctx.user.id,
    action: "organisation.thresholds_changed",
    targetType: "Organisation",
    targetId: ctx.organisationId,
    metadata: { from: before, to: next },
  });
  return { changed: true };
}
