"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { MARKER_KEYS, MARKER_PARSE_ERROR, parseClock, type MarkerKey } from "@/lib/match-clock";
import { MATCH_ROLES, requireRole } from "@/server/auth/session";
import { requireSquadOrg } from "@/server/matches/access";
import { saveMarkers } from "@/server/matches/markers";
import { matchActionError } from "../../form-data";

// Server action for /matches/[matchId]/markers (MATCH05; docs/build/design/C06.md,
// Surface 5). Times arrive as typed video times ("47:12.4"); blank is unset.

export async function saveMarkersAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(MATCH_ROLES));
  const matchId = String(formData.get("matchId") ?? "");
  const values = {} as Record<MarkerKey, number | null>;
  const fieldErrors: Record<string, string> = {};
  for (const key of MARKER_KEYS) {
    const raw = String(formData.get(key) ?? "").trim();
    if (!raw) {
      values[key] = null;
      continue;
    }
    const ms = parseClock(raw);
    if (ms === null) fieldErrors[key] = MARKER_PARSE_ERROR;
    values[key] = ms;
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  try {
    await saveMarkers(ctx, matchId, values);
  } catch (err) {
    return matchActionError(err, "markers save");
  }
  revalidatePath(`/matches/${matchId}`, "layout");
  return {
    ok: true,
    message: "Markers saved. Match minutes now follow these times.",
    key: String(Date.now()),
  };
}
