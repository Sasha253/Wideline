import "server-only";
import { z } from "zod";
import { SELECTABLE_ORG_TYPES } from "@/lib/labels";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
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
