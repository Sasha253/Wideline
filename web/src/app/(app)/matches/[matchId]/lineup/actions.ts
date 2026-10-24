"use server";

import { revalidatePath } from "next/cache";
import { UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { MATCH_ROLES, requireRole } from "@/server/auth/session";
import { log } from "@/server/log";
import { requireSquadOrg } from "@/server/matches/access";
import { MATCH_GONE, MatchError } from "@/server/matches/errors";
import { type LineupRowInput } from "@/server/matches/fields";
import {
  addSubstitution,
  getLineups,
  removeSubstitution,
  saveLineup,
} from "@/server/matches/lineups";
import {
  parseShirtNumbers,
  SHIRT_NUMBERS_INVALID,
  SHIRT_NUMBERS_REQUIRED,
} from "@/server/squad/fields";
import { addPlaceholders, PlayerError } from "@/server/squad/players";
import { matchActionError } from "../../form-data";

// Server actions for /matches/[matchId]/lineup (SQUAD05, SQUAD06, SQUAD07;
// docs/build/design/C06.md, Surface 4). Club staff, checked on the server.

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function saveLineupAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(MATCH_ROLES));
  const matchId = text(formData, "matchId");
  const teamId = text(formData, "teamId");
  const rows: LineupRowInput[] = [];
  for (const playerId of text(formData, "playerIds").split(",").filter(Boolean)) {
    const selection = text(formData, `rows[${playerId}].selection`);
    if (selection !== "starter" && selection !== "substitute") continue;
    const shirt = text(formData, `rows[${playerId}].shirtNumber`);
    const position = text(formData, `rows[${playerId}].position`);
    rows.push({
      playerId,
      isStarter: selection === "starter",
      shirtNumber: /^\d{1,3}$/.test(shirt) ? Number(shirt) : NaN,
      position: position || null,
    });
  }
  let removed: number;
  try {
    removed = (await saveLineup(ctx, matchId, teamId, rows)).substitutionsRemoved;
  } catch (err) {
    return matchActionError(err, "lineup save");
  }
  revalidatePath(`/matches/${matchId}`, "layout");
  return {
    ok: true,
    message: removed
      ? `Lineup saved. ${plural(removed, "substitution", "substitutions")} removed because a player is no longer selected.`
      : "Lineup saved.",
    key: String(Date.now()),
  };
}

export async function addSubstitutionAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(MATCH_ROLES));
  const matchId = text(formData, "matchId");
  const teamId = text(formData, "teamId");
  const minuteText = text(formData, "minute");
  const off = text(formData, "offLineupId");
  const on = text(formData, "onLineupId");
  const max = Number(text(formData, "maxMinute")) || 0;
  const fieldErrors: Record<string, string> = {};
  if (!/^\d{1,3}$/.test(minuteText)) fieldErrors.minute = `Enter a minute from 1 to ${max}.`;
  if (!off) fieldErrors.offLineupId = "Choose the player who came off.";
  if (!on) fieldErrors.onLineupId = "Choose who came on, or No replacement.";
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  try {
    await addSubstitution(ctx, matchId, {
      teamId,
      offLineupId: off,
      onLineupId: on === "none" ? null : on,
      minute: Number(minuteText),
    });
  } catch (err) {
    return matchActionError(err, "substitution add");
  }
  revalidatePath(`/matches/${matchId}`, "layout");
  return { ok: true, message: "Substitution added.", key: String(Date.now()) };
}

export async function removeSubstitutionAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(MATCH_ROLES));
  const matchId = text(formData, "matchId");
  try {
    await removeSubstitution(ctx, matchId, {
      teamId: text(formData, "teamId"),
      offLineupId: text(formData, "offLineupId"),
    });
  } catch (err) {
    return matchActionError(err, "substitution remove");
  }
  revalidatePath(`/matches/${matchId}`, "layout");
  return { ok: true, message: "Substitution removed.", key: String(Date.now()) };
}

/** Adds opposition shirt numbers (SQUAD07) to the match's opposition side, through the C04 service. */
export async function addPlaceholderAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(MATCH_ROLES));
  const matchId = text(formData, "matchId");
  const teamId = text(formData, "teamId");
  const numbers = parseShirtNumbers(text(formData, "numbers"));
  if (numbers === "empty") return { ok: false, fieldErrors: { numbers: SHIRT_NUMBERS_REQUIRED } };
  if (numbers === "invalid") return { ok: false, fieldErrors: { numbers: SHIRT_NUMBERS_INVALID } };
  let added: number;
  try {
    const { match } = await getLineups(ctx, matchId);
    const side = [match.homeTeam, match.awayTeam].find((t) => t.id === teamId);
    if (!side?.isOpposition) return { ok: false, formError: MATCH_GONE };
    added = (await addPlaceholders(ctx, teamId, numbers)).added;
  } catch (err) {
    if (err instanceof PlayerError && err.code === "squad_number_taken" && err.userMessage) {
      return { ok: false, fieldErrors: { numbers: err.userMessage } };
    }
    if (err instanceof MatchError) return matchActionError(err, "placeholder add");
    log.error({ err }, "placeholder add failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
  revalidatePath(`/matches/${matchId}`, "layout");
  return {
    ok: true,
    message: `${plural(added, "player", "players")} added.`,
    key: String(Date.now()),
  };
}
