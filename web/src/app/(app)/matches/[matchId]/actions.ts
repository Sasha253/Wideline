"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { MATCH_DELETE_ROLES, MATCH_ROLES, requireRole } from "@/server/auth/session";
import { log } from "@/server/log";
import { requireSquadOrg } from "@/server/matches/access";
import { MatchError } from "@/server/matches/errors";
import { deleteMatch, updateMatch } from "@/server/matches/matches";
import { matchActionError, matchInput } from "../form-data";

// Server actions for one match (MATCH01, MATCH08; docs/build/design/C06.md,
// Surfaces 2 and 6). Editing is club staff; deleting is owners and admins.

export async function updateMatchAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(MATCH_ROLES));
  const matchId = String(formData.get("matchId") ?? "");
  try {
    await updateMatch(ctx, matchId, matchInput(formData));
  } catch (err) {
    return matchActionError(err, "match update");
  }
  revalidatePath("/matches", "layout");
  redirect(`/matches/${matchId}?done=updated`);
}

export async function deleteMatchAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(MATCH_DELETE_ROLES));
  const matchId = String(formData.get("matchId") ?? "");
  try {
    await deleteMatch(ctx, matchId);
  } catch (err) {
    if (!(err instanceof MatchError && err.code === "not_found")) {
      log.error({ err }, "match delete failed");
    }
    return { ok: false, formError: "The match could not be deleted. Try again." };
  }
  revalidatePath("/matches", "layout");
  redirect("/matches?done=deleted");
}
