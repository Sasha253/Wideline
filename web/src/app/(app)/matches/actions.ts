"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { MATCH_ROLES, requireRole } from "@/server/auth/session";
import { requireSquadOrg } from "@/server/matches/access";
import { createMatch } from "@/server/matches/matches";
import { matchActionError, matchInput } from "./form-data";

// Server actions for /matches/new (MATCH01; docs/build/design/C06.md, Surface 2).

export async function createMatchAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(MATCH_ROLES));
  let id: string;
  try {
    id = (await createMatch(ctx, matchInput(formData))).id;
  } catch (err) {
    return matchActionError(err, "match create");
  }
  revalidatePath("/matches", "layout");
  redirect(`/matches/${id}?done=created`);
}
