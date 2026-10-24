"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { fieldErrorsFrom, UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { safeNextPath } from "@/lib/safe-next";
import { requireRole, SQUAD_ADMIN_ROLES } from "@/server/auth/session";
import { log } from "@/server/log";
import { requireSquadOrg } from "@/server/squad/access";
import {
  parseShirtNumbers,
  SHIRT_NUMBERS_INVALID,
  SHIRT_NUMBERS_REQUIRED,
  teamNameTaken,
} from "@/server/squad/fields";
import { addPlaceholders, PlayerError } from "@/server/squad/players";
import { createTeam, deleteTeam, inUseMessage, TeamError, updateTeam } from "@/server/squad/teams";

// Server actions for /squad/teams (SQUAD01, SQUAD07; docs/build/design/C04.md,
// Surfaces 3 and 4). Owners and admins only.

const TEAM_GONE = "This team no longer exists. Go back to Teams.";

// C06 (Q-024): the create-match form links here to add an opposition team and
// comes back with it chosen as away. Only this path is allowed as next.
const RETURN_PATHS = new Set(["/matches/new"]);

function teamInput(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    ageGroup: String(formData.get("ageGroup") ?? ""),
    gender: String(formData.get("gender") ?? ""),
    season: String(formData.get("season") ?? ""),
  };
}

function teamError(err: unknown, input: { name: string; season: string }): ActionResult {
  if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
  if (err instanceof TeamError) {
    if (err.code === "duplicate_name") {
      return {
        ok: false,
        fieldErrors: { name: teamNameTaken(input.name.trim(), input.season.trim()) },
      };
    }
    if (err.code === "not_found") return { ok: false, formError: TEAM_GONE };
  }
  log.error({ err }, "team save failed");
  return { ok: false, formError: UNEXPECTED_ERROR };
}

export async function createTeamAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(SQUAD_ADMIN_ROLES));
  const input = teamInput(formData);
  const kind = formData.get("kind") === "opposition" ? "opposition" : "own";
  let id: string;
  try {
    id = (await createTeam(ctx, input, kind)).id;
  } catch (err) {
    return teamError(err, input);
  }
  revalidatePath("/squad", "layout");
  const next = safeNextPath(String(formData.get("next") ?? ""), "");
  if (RETURN_PATHS.has(next)) redirect(`${next}?away=${id}`);
  redirect(`/squad/teams/${id}?done=created`);
}

export async function updateTeamAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(SQUAD_ADMIN_ROLES));
  const teamId = String(formData.get("teamId") ?? "");
  const input = teamInput(formData);
  try {
    await updateTeam(ctx, teamId, input);
  } catch (err) {
    return teamError(err, input);
  }
  revalidatePath("/squad", "layout");
  return { ok: true, message: "Changes saved.", key: String(Date.now()) };
}

export async function deleteTeamAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(SQUAD_ADMIN_ROLES));
  const teamId = String(formData.get("teamId") ?? "");
  try {
    await deleteTeam(ctx, teamId);
  } catch (err) {
    if (err instanceof TeamError && err.code === "in_use" && err.detail.usage) {
      return { ok: false, formError: inUseMessage(err.detail.usage, !!err.detail.isOpposition) };
    }
    if (err instanceof TeamError && err.code === "not_found") {
      return { ok: false, formError: TEAM_GONE };
    }
    log.error({ err }, "team delete failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
  revalidatePath("/squad", "layout");
  redirect("/squad/teams?done=deleted");
}

export async function addPlaceholdersAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(SQUAD_ADMIN_ROLES));
  const teamId = String(formData.get("teamId") ?? "");
  const numbers = parseShirtNumbers(String(formData.get("numbers") ?? ""));
  if (numbers === "empty") return { ok: false, fieldErrors: { numbers: SHIRT_NUMBERS_REQUIRED } };
  if (numbers === "invalid") return { ok: false, fieldErrors: { numbers: SHIRT_NUMBERS_INVALID } };
  let added: number;
  try {
    added = (await addPlaceholders(ctx, teamId, numbers)).added;
  } catch (err) {
    if (err instanceof PlayerError && err.code === "squad_number_taken" && err.userMessage) {
      return { ok: false, fieldErrors: { numbers: err.userMessage } };
    }
    if (err instanceof PlayerError && err.code === "not_found") {
      return { ok: false, formError: TEAM_GONE };
    }
    log.error({ err }, "placeholder add failed");
    return { ok: false, formError: UNEXPECTED_ERROR };
  }
  revalidatePath("/squad", "layout");
  return {
    ok: true,
    message: added === 1 ? "1 placeholder player added." : `${added} placeholder players added.`,
    key: String(Date.now()),
  };
}
